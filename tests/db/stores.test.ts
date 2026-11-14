import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSessionHandlers } from '../../app/server/handlers';
import { signStudentCookie } from '../../core/access/studentCookie';
import { SessionConflictError } from '../../core/session/sessionStore';
import { loadRegistries } from '../../modules';
import { createPool, type Db } from '../../providers/postgres/db';
import { PostgresMisconceptionStore, PostgresSessionStore } from '../../providers/postgres/stores';
import { callTool, say, ScriptedProvider, type ScriptStep } from '../../providers/model/scriptedProvider';
import { randomUUID } from 'node:crypto';
import { APP_URL } from './env';
import { adminClient, seedStudent } from './fixtures';

const SECRET = 'db-test-secret-db-test-secret-000000';

let admin: pg.Client;
const pools: Db[] = [];

beforeAll(async () => {
  admin = await adminClient();
});
afterAll(async () => {
  for (const pool of pools) await pool.end().catch(() => undefined);
  await admin?.end();
});

/** The application as it runs: PostgreSQL stores connected as fahim_app, scripted model. */
function app(steps: ScriptStep[]) {
  const pool = createPool(APP_URL);
  pools.push(pool);
  const store = new PostgresSessionStore(pool);
  const handlers = createSessionHandlers({
    service: {
      engine: {
        model: new ScriptedProvider(steps),
        modelName: 'test-model',
        maxTokens: 500,
        systemPrompt: 'BASE PROMPT',
        registries: loadRegistries(),
        misconceptions: new PostgresMisconceptionStore(pool),
        rng: () => 0.5, // 1 200 kg at 72 km/h -> 240 kJ
        env: 'development',
      },
      store,
      newSessionId: randomUUID,
    },
    cookieSecret: SECRET,
    secureCookies: false,
    lessonId: 'work-kinetic-energy',
  });
  return { pool, store, handlers };
}

const cookieFor = (s: { orgId: string; studentId: string }) =>
  `fahim_student=${signStudentCookie({ role: 'student', orgId: s.orgId, studentId: s.studentId }, SECRET)}`;

const post = (url: string, cookie: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function send(handlers: ReturnType<typeof app>['handlers'], cookie: string, sessionId: string, event: unknown) {
  const res = await handlers.event(post(`/api/sessions/${sessionId}/events`, cookie, event), sessionId);
  return { status: res.status, body: await res.json() };
}

const FIRST_HALF: ScriptStep[] = [
  say('Voici le piège.'),
  callTool('launch_simulation', { simulation_id: 'train-kinetic-energy' }),
  say('Regarde les barres.'),
];
const SECOND_HALF: ScriptStep[] = [
  say('Teste ta formule.'),
  say('Bonne formule.'),
  callTool('check_answer', { answer: '3110,4' }),
  say('Regarde ton unité de vitesse.'),
  callTool('check_answer', { answer: '240 kJ' }),
  say('Exact.\n\nSami : Si je roule deux fois plus vite…'),
  say('Sami : Mais pourquoi ?'),
  say('Sami : Ah oui !\n\nTon explication est juste.'),
];

describe('PostgreSQL session and misconception stores', () => {
  it('plays a full session through the routes and survives a server restart', async () => {
    const student = await seedStudent(admin);
    const cookie = cookieFor(student);

    // First server process: trap and bet.
    const first = app(FIRST_HALF);
    const started = await first.handlers.start(post('/api/sessions', cookie));
    expect(started.status).toBe(201);
    const { sessionId } = await started.json();
    expect((await send(first.handlers, cookie, sessionId, { type: 'bet', choiceId: 'x2' })).body.step).toBe('law');
    await first.pool.end();

    // Restart: new pool, new handlers, nothing kept in memory.
    const second = app(SECOND_HALF);
    expect((await send(second.handlers, cookie, sessionId, { type: 'law_choice', choiceId: 'a' })).body.step).toBe('law');
    expect((await send(second.handlers, cookie, sessionId, { type: 'law_choice', choiceId: 'b' })).body.step).toBe('exercise');
    expect((await send(second.handlers, cookie, sessionId, { type: 'message', text: '3110,4' })).body.step).toBe('exercise');
    expect((await send(second.handlers, cookie, sessionId, { type: 'message', text: '240 kJ' })).body.step).toBe('reversed_role');
    expect((await send(second.handlers, cookie, sessionId, { type: 'message', text: 'Oui' })).body.step).toBe('reversed_role');
    const end = await send(second.handlers, cookie, sessionId, { type: 'message', text: 'Ec ×4 donc d ×4' });
    expect(end.status).toBe(200);
    expect(end.body.step).toBe('summary');
    expect(end.body.ui[0]).toMatchObject({
      type: 'show_summary',
      exerciseAttempts: 2,
      misconceptions: [
        { code: 'EC_LINEAR_IN_V', seenCount: 2 },
        { code: 'SPEED_UNIT_KMH', seenCount: 1 },
      ],
    });

    // What is stored, read as the owner.
    const row = (await admin.query('SELECT step, revision, ended_at, state FROM sessions WHERE id = $1', [sessionId])).rows[0];
    expect(row.step).toBe('summary');
    expect(row.revision).toBe(7);
    expect(row.ended_at).not.toBeNull();
    expect(row.state.studentId).toBe(student.studentId);
    const map = await admin.query('SELECT code, seen_count FROM misconceptions WHERE student_id = $1 ORDER BY id', [student.studentId]);
    expect(map.rows).toEqual([
      { code: 'EC_LINEAR_IN_V', seen_count: 2 },
      { code: 'SPEED_UNIT_KMH', seen_count: 1 },
    ]);
  });

  it("refuses an event on another student's session, in the same or another organization", async () => {
    const owner = await seedStudent(admin);
    const sameOrg = await seedStudent(admin, owner.orgId);
    const otherOrg = await seedStudent(admin);
    const { handlers } = app([say('piège'), say('Pari noté.')]);
    const { sessionId } = await (await handlers.start(post('/api/sessions', cookieFor(owner)))).json();

    for (const intruder of [sameOrg, otherOrg]) {
      const res = await send(handlers, cookieFor(intruder), sessionId, { type: 'bet', choiceId: 'x4' });
      expect(res).toEqual({ status: 404, body: { error: 'not_found' } });
    }
    const stored = await admin.query('SELECT step, revision FROM sessions WHERE id = $1', [sessionId]);
    expect(stored.rows[0]).toEqual({ step: 'bet', revision: 0 });
    expect((await send(handlers, cookieFor(owner), sessionId, { type: 'bet', choiceId: 'x4' })).status).toBe(200);
  });

  it('answers 404 for a malformed or unknown session id', async () => {
    const student = await seedStudent(admin);
    const { handlers } = app([]);
    for (const id of ['abc', "1' OR '1'='1", randomUUID()]) {
      expect((await send(handlers, cookieFor(student), id, { type: 'bet', choiceId: 'x4' })).status).toBe(404);
    }
  });

  it('refuses a save made from an outdated state', async () => {
    const student = await seedStudent(admin);
    const { handlers, store } = app([say('piège')]);
    const { sessionId } = await (await handlers.start(post('/api/sessions', cookieFor(student)))).json();
    const scope = { orgId: student.orgId, userId: student.studentId };
    const a = (await store.get(scope, sessionId))!;
    const b = (await store.get(scope, sessionId))!;
    await store.save(scope, { ...a, step: 'law' });
    await expect(store.save(scope, { ...b, step: 'summary' })).rejects.toBeInstanceOf(SessionConflictError);
    expect((await store.get(scope, sessionId))?.step).toBe('law');
  });

  it("does not create a session for a student of another organization", async () => {
    const student = await seedStudent(admin);
    const other = await seedStudent(admin);
    const forged = `fahim_student=${signStudentCookie({ role: 'student', orgId: student.orgId, studentId: other.studentId }, SECRET)}`;
    const { handlers } = app([say('piège')]);
    // The cookie is signed but names a student who has no profile in that organization: the database refuses it.
    const res = await handlers.start(post('/api/sessions', forged));
    expect(res.status).toBe(500);
    const count = await admin.query('SELECT count(*)::int AS n FROM sessions WHERE student_id = $1', [other.studentId]);
    expect(count.rows[0].n).toBe(0);
  });
});
