import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSessionHandlers } from '../../app/server/handlers';
import { createReviewHandlers } from '../../app/server/review';
import { InMemoryMisconceptionStore } from '../../core/memory/misconceptionStore';
import { loadRegistries } from '../../modules';
import { say, ScriptedProvider } from '../../providers/model/scriptedProvider';
import { PostgresSessionStore } from '../../providers/postgres/stores';
import { signStudentCookie } from '../../core/access/studentCookie';
import { createPool, type Db } from '../../providers/postgres/db';
import { createInvitedOwner, createInvitedStudent, findOrCreateOrganization } from '../../providers/postgres/invitations';
import { PostgresAccountDirectory, PostgresReviewStore } from '../../providers/postgres/review';
import { APP_URL } from './env';
import { adminClient } from './fixtures';

// Backlog D3: the review is reachable only by the owner account, and every view is written to access_log.

const SECRET = 'review-secret-review-secret-review-00';
let admin: pg.Client;
let pool: Db;
let review: ReturnType<typeof createReviewHandlers>;

beforeAll(async () => {
  admin = await adminClient();
  pool = createPool(APP_URL);
  review = createReviewHandlers({ cookieSecret: SECRET, accounts: new PostgresAccountDirectory(pool), review: new PostgresReviewStore(pool) });
});
afterAll(async () => {
  await pool?.end();
  await admin?.end();
});

const cookieOf = (orgId: string, userId: string) => signStudentCookie({ role: 'student', orgId, studentId: userId }, SECRET);

async function org(name: string) {
  const orgId = await findOrCreateOrganization(admin, `${name} ${randomUUID()}`, 'center');
  const owner = await createInvitedOwner(admin, { orgId, displayName: `Propriétaire ${name}` });
  const student = await createInvitedStudent(admin, { orgId, displayName: `Élève ${name}` });
  const sessionId = randomUUID();
  const state = {
    sessionId,
    transcript: [
      { role: 'user', content: [{ type: 'text', text: '(The student opens the session.)' }] },
      { role: 'assistant', content: [{ type: 'text', text: `Voici le piège pour ${name}.` }] },
    ],
  };
  await admin.query(
    "INSERT INTO sessions (id, org_id, student_id, lesson_id, step, state, cost_usd, input_tokens, output_tokens) VALUES ($1, $2, $3, 'work-kinetic-energy', 'law', $4, 0.0123, 4000, 300)",
    [sessionId, orgId, student.studentId, state],
  );
  return { orgId, ownerId: owner.userId, studentId: student.studentId, sessionId };
}

const logCount = async (orgId: string) => (await admin.query('SELECT count(*)::int AS n FROM access_log WHERE org_id = $1', [orgId])).rows[0].n as number;

describe('owner review', () => {
  it('lists the sessions of the owner organization with step and cost, and logs the view', async () => {
    const a = await org('A');
    await org('B');
    const rows = await review.list(cookieOf(a.orgId, a.ownerId));
    expect(rows).toEqual([
      expect.objectContaining({ sessionId: a.sessionId, studentName: 'Élève A', step: 'law', costUsd: 0.0123, inputTokens: 4000, outputTokens: 300 }),
    ]);
    const log = await admin.query('SELECT actor_id, student_id, action FROM access_log WHERE org_id = $1', [a.orgId]);
    expect(log.rows).toEqual([{ actor_id: a.ownerId, student_id: null, action: 'review_list_sessions' }]);
  });

  it('shows a transcript and logs the student whose session was viewed', async () => {
    const a = await org('A');
    const detail = await review.detail(cookieOf(a.orgId, a.ownerId), a.sessionId);
    expect(detail?.lines).toEqual([
      { who: 'server', text: '(The student opens the session.)' },
      { who: 'tutor', text: 'Voici le piège pour A.' },
    ]);
    const log = await admin.query('SELECT actor_id, student_id, action FROM access_log WHERE org_id = $1', [a.orgId]);
    expect(log.rows).toEqual([{ actor_id: a.ownerId, student_id: a.studentId, action: 'review_view_transcript' }]);
  });

  it('is not reachable by a student, and writes nothing to the log', async () => {
    const a = await org('A');
    expect(await review.list(cookieOf(a.orgId, a.studentId))).toBeNull();
    expect(await review.detail(cookieOf(a.orgId, a.studentId), a.sessionId)).toBeNull();
    expect(await logCount(a.orgId)).toBe(0);
  });

  it("does not show another organization's session to an owner, nor log it", async () => {
    const a = await org('A');
    const b = await org('B');
    expect(await review.detail(cookieOf(a.orgId, a.ownerId), b.sessionId)).toBeNull();
    expect(await logCount(a.orgId)).toBe(0);
    expect(await logCount(b.orgId)).toBe(0);
  });

  it('shows nothing when the access log cannot be written', async () => {
    const a = await org('A');
    await admin.query('REVOKE INSERT ON access_log FROM fahim_app');
    try {
      await expect(review.list(cookieOf(a.orgId, a.ownerId))).rejects.toThrow();
      await expect(review.detail(cookieOf(a.orgId, a.ownerId), a.sessionId)).rejects.toThrow();
    } finally {
      await admin.query('GRANT INSERT ON access_log TO fahim_app');
    }
    expect(await logCount(a.orgId)).toBe(0);
  });

  it('is not reachable without a valid cookie, or by an owner cookie forged for another organization', async () => {
    const a = await org('A');
    const b = await org('B');
    expect(await review.list(undefined)).toBeNull();
    expect(await review.list('forged.value')).toBeNull();
    // A signed cookie naming A's owner in B's organization: no platform_admin membership there.
    expect(await review.list(cookieOf(b.orgId, a.ownerId))).toBeNull();
    expect(await logCount(b.orgId)).toBe(0);
  });

  it('tells the owner clearly that their account cannot start a session, and creates nothing', async () => {
    const a = await org('A');
    const model = new ScriptedProvider([say('piège')]);
    const sessions = createSessionHandlers({
      service: {
        engine: {
          model,
          modelName: 'm',
          maxTokens: 1,
          systemPrompt: '',
          registries: loadRegistries(),
          misconceptions: new InMemoryMisconceptionStore(),
          rng: () => 0.5,
          env: 'development',
        },
        store: new PostgresSessionStore(pool),
        newSessionId: randomUUID,
      },
      accounts: new PostgresAccountDirectory(pool),
      cookieSecret: SECRET,
      secureCookies: false,
      lessonId: 'work-kinetic-energy',
    });
    const res = await sessions.start(
      new Request('http://localhost/api/sessions', { method: 'POST', headers: { cookie: `fahim_student=${cookieOf(a.orgId, a.ownerId)}` } }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_a_student' });
    expect(model.requests).toHaveLength(0);
    const count = await admin.query('SELECT count(*)::int AS n FROM sessions WHERE student_id = $1', [a.ownerId]);
    expect(count.rows[0].n).toBe(0);
  });
});
