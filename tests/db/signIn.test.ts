import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSessionHandlers } from '../../app/server/handlers';
import { loadRegistries } from '../../modules';
import { createPool, type Db } from '../../providers/postgres/db';
import { createInvitedStudent, findOrCreateOrganization, issueInvitation, PostgresInvitationDirectory } from '../../providers/postgres/invitations';
import { PostgresMisconceptionStore, PostgresSessionStore } from '../../providers/postgres/stores';
import { OfflineProvider } from '../../providers/model/offlineProvider';
import { APP_URL } from './env';
import { adminClient } from './fixtures';

// Backlog C3: a student signs in with a code, finds their progress the next day,
// and cannot open another student's session (decision 0003).

const SECRET = 'sign-in-test-secret-sign-in-test-000';
let admin: pg.Client;
const pools: Db[] = [];

beforeAll(async () => {
  admin = await adminClient();
});
afterAll(async () => {
  for (const pool of pools) await pool.end().catch(() => undefined);
  await admin?.end();
});

/** The secret Caddy adds to every request it forwards (D2); the tests play the proxy. */
const PROXY_SECRET = 'proxy-secret-proxy-secret-proxy-0000';

/** A server process: PostgreSQL as fahim_app, the offline model (no API spending). */
function server(cookieSecret = SECRET) {
  const pool = createPool(APP_URL);
  pools.push(pool);
  return createSessionHandlers({
    service: {
      engine: {
        model: new OfflineProvider(),
        modelName: 'offline',
        maxTokens: 500,
        systemPrompt: '',
        registries: loadRegistries(),
        misconceptions: new PostgresMisconceptionStore(pool),
        rng: () => 0.5, // 1 200 kg at 72 km/h -> 240 kJ
        env: 'development',
      },
      store: new PostgresSessionStore(pool),
      newSessionId: randomUUID,
    },
    cookieSecret,
    secureCookies: false,
    lessonId: 'work-kinetic-energy',
    invitations: new PostgresInvitationDirectory(pool),
    proxySecret: PROXY_SECRET,
  });
}

type Handlers = ReturnType<typeof server>;

const request = (url: string, init: { cookie?: string; body?: unknown; ip?: string; method?: string; proxy?: string | null } = {}) =>
  new Request(`http://localhost${url}`, {
    method: init.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': init.ip ?? '198.51.100.1',
      ...(init.proxy === null ? {} : { 'x-fahim-proxy-secret': init.proxy ?? PROXY_SECRET }),
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

async function signIn(h: Handlers, code: string, ip?: string, proxy?: string | null): Promise<{ status: number; cookie: string | null }> {
  const res = await h.signIn(request('/api/sign-in', { body: { code }, ip, proxy }));
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? null };
}

async function play(h: Handlers, cookie: string): Promise<string> {
  const started = await h.start(request('/api/sessions', { cookie }));
  expect(started.status).toBe(201);
  const { sessionId } = await started.json();
  const send = async (event: unknown) => {
    const res = await h.event(request(`/api/sessions/${sessionId}/events`, { cookie, body: event }), sessionId);
    expect(res.status).toBe(200);
    return res.json();
  };
  await send({ type: 'bet', choiceId: 'x2' });
  await send({ type: 'law_choice', choiceId: 'b' });
  await send({ type: 'message', text: '3110,4 kJ' });
  await send({ type: 'message', text: '240 kJ' });
  await send({ type: 'message', text: 'Non Sami' });
  expect((await send({ type: 'message', text: 'Ec ×4 donc d ×4' })).step).toBe('summary');
  return sessionId;
}

describe('sign-in with invitation codes', () => {
  it('signs in, finds the progress the next day, and cannot open another student session', async () => {
    const orgId = await findOrCreateOrganization(admin, `Pilote ${randomUUID()}`, 'center');
    const yasmine = await createInvitedStudent(admin, { orgId, displayName: 'Élève A' });
    const omar = await createInvitedStudent(admin, { orgId, displayName: 'Élève B' });

    // Day 1: sign in and play a full session.
    const day1 = server();
    const first = await signIn(day1, yasmine.code);
    expect(first.status).toBe(200);
    const sessionId = await play(day1, first.cookie!);

    // Day 2, another device: no cookie, a fresh server process.
    const day2 = server();
    expect((await day2.progress(request('/api/progress', { method: 'GET' }))).status).toBe(401);
    const again = await signIn(day2, yasmine.code.toLowerCase().replace(/-/g, ' '));
    expect(again.status).toBe(200);
    const progress = await (await day2.progress(request('/api/progress', { method: 'GET', cookie: again.cookie! }))).json();
    expect(progress.sessions).toEqual([
      expect.objectContaining({ sessionId, lessonTitle: 'Travail et énergie cinétique', step: 'summary', endedAt: expect.any(String) }),
    ]);
    expect(progress.misconceptions).toEqual([
      { code: 'EC_LINEAR_IN_V', label: "L'énergie cinétique est proportionnelle à la vitesse", seenCount: 1, status: 'new' },
      { code: 'SPEED_UNIT_KMH', label: 'La vitesse est laissée en km/h dans la formule', seenCount: 1, status: 'new' },
    ]);

    // Another student of the same organization signs in: Yasmine's session does not exist for them.
    const other = await signIn(day2, omar.code);
    const intrusion = await day2.event(
      request(`/api/sessions/${sessionId}/events`, { cookie: other.cookie!, body: { type: 'message', text: 'merci' } }),
      sessionId,
    );
    expect(intrusion.status).toBe(404);
    const theirs = await (await day2.progress(request('/api/progress', { method: 'GET', cookie: other.cookie! }))).json();
    expect(theirs).toEqual({ sessions: [], misconceptions: [] });
  });

  it('locks a client out after 10 failed attempts, even for a right code, without locking others', async () => {
    const orgId = await findOrCreateOrganization(admin, `Pilote ${randomUUID()}`, 'center');
    const student = await createInvitedStudent(admin, { orgId, displayName: 'Élève C' });
    const h = server();
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    for (let i = 0; i < 10; i++) expect((await signIn(h, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA', ip)).status).toBe(401);
    expect(await signIn(h, student.code, ip)).toEqual({ status: 429, cookie: null });
    expect((await signIn(h, student.code, '192.0.2.44')).status).toBe(200);
    // Only a hash of the address is stored.
    const stored = await admin.query('SELECT client FROM sign_in_attempts');
    expect(JSON.stringify(stored.rows)).not.toContain(ip);
  });

  it('trusts X-Forwarded-For only from the proxy: a forged address does not escape the lockout', async () => {
    const orgId = await findOrCreateOrganization(admin, `Pilote ${randomUUID()}`, 'center');
    const student = await createInvitedStudent(admin, { orgId, displayName: 'Élève F' });
    // A cookie secret of its own gives this test its own buckets.
    const h = server(`forged-${randomUUID()}`);
    const forged = () => `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    // A client that reaches the app directly, with a new address in each request.
    for (let i = 0; i < 10; i++) expect((await signIn(h, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA', forged(), null)).status).toBe(401);
    expect((await signIn(h, student.code, forged(), null)).status).toBe(429);
    expect((await signIn(h, student.code, forged(), 'not-the-proxy-secret-not-the-proxy')).status).toBe(429);
    // A real client behind the proxy is not affected.
    expect((await signIn(h, student.code, '192.0.2.77')).status).toBe(200);
  });

  it('revokes the previous code when a new one is issued, and stores no code in clear', async () => {
    const orgId = await findOrCreateOrganization(admin, `Pilote ${randomUUID()}`, 'center');
    const student = await createInvitedStudent(admin, { orgId, displayName: 'Élève D' });
    const replacement = await issueInvitation(admin, orgId, student.studentId);
    const h = server();
    expect((await signIn(h, student.code, '192.0.2.50')).status).toBe(401);
    expect((await signIn(h, replacement, '192.0.2.50')).status).toBe(200);
    const rows = await admin.query('SELECT code_hash, revoked_at FROM invitations WHERE user_id = $1 ORDER BY id', [student.studentId]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].revoked_at).not.toBeNull();
    expect(rows.rows[1].revoked_at).toBeNull();
    const dump = JSON.stringify(rows.rows);
    for (const code of [student.code, replacement]) expect(dump).not.toContain(code.replace(/-/g, ''));
  });
});
