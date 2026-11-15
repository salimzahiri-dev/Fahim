import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSessionHandlers } from '../../app/server/handlers';
import { estimateCostUsd } from '../../core/billing/cost';
import { signStudentCookie } from '../../core/access/studentCookie';
import { loadRegistries } from '../../modules';
import { createPool, type Db } from '../../providers/postgres/db';
import { PostgresMisconceptionStore, PostgresSessionStore } from '../../providers/postgres/stores';
import { callTool, say, ScriptedProvider } from '../../providers/model/scriptedProvider';
import type { ModelProvider, ModelResponse } from '../../providers/model/ModelProvider';
import { APP_URL } from './env';
import { adminClient, seedStudent } from './fixtures';

// Backlog C4: the limit is enforced, and the stored cost matches the usage of the session.

const SECRET = 'quota-db-secret-quota-db-secret-0000';
const PRICES = { priceInputPerMTok: 3, priceOutputPerMTok: 15 };
let admin: pg.Client;
let pool: Db;

beforeAll(async () => {
  admin = await adminClient();
  pool = createPool(APP_URL);
});
afterAll(async () => {
  await pool?.end();
  await admin?.end();
});

/** Each scripted reply reports a different usage, so the total is not a coincidence. */
const withUsage = (r: ModelResponse, input: number, output: number): ModelResponse => ({ ...r, usage: { inputTokens: input, outputTokens: output } });

function handlers(steps: ModelResponse[], maxSessionsPerDay = 0, delayMs = 0) {
  const scripted = new ScriptedProvider(steps);
  // A slow model widens the gap between the limit check and the insert, as a real model call does.
  const model: ModelProvider = { respond: async (r) => (await new Promise((ok) => setTimeout(ok, delayMs)), scripted.respond(r)) };
  return createSessionHandlers({
    service: {
      engine: {
        model,
        modelName: 'test-model',
        maxTokens: 500,
        systemPrompt: '',
        registries: loadRegistries(),
        misconceptions: new PostgresMisconceptionStore(pool),
        rng: () => 0.5,
        env: 'development',
      },
      store: new PostgresSessionStore(pool, PRICES),
      newSessionId: randomUUID,
      maxSessionsPerDay,
    },
    cookieSecret: SECRET,
    secureCookies: false,
    lessonId: 'work-kinetic-energy',
  });
}

const req = (url: string, cookie: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('quotas and cost in PostgreSQL', () => {
  it('stores the cost computed from the usage the provider reported', async () => {
    const student = await seedStudent(admin);
    const cookie = `fahim_student=${signStudentCookie({ role: 'student', ...student }, SECRET)}`;
    const steps = [
      withUsage(say('piège'), 1200, 80),
      withUsage(callTool('launch_simulation', { simulation_id: 'train-kinetic-energy' }), 1500, 40),
      withUsage(say('Regarde.'), 1700, 60),
      withUsage(say('Bonne formule.'), 1900, 90),
      withUsage(callTool('check_answer', { answer: '240 kJ' }), 2100, 30),
      withUsage(say('Exact. Sami : …'), 2300, 120),
    ];
    const h = handlers(steps);
    const { sessionId } = await (await h.start(req('/api/sessions', cookie))).json();
    for (const event of [
      { type: 'bet', choiceId: 'x4' },
      { type: 'law_choice', choiceId: 'b' },
      { type: 'message', text: '240 kJ' },
    ]) {
      expect((await h.event(req(`/api/sessions/${sessionId}/events`, cookie, event), sessionId)).status).toBe(200);
    }
    const usage = {
      inputTokens: steps.reduce((n, s) => n + s.usage.inputTokens, 0),
      outputTokens: steps.reduce((n, s) => n + s.usage.outputTokens, 0),
    };
    const row = (await admin.query('SELECT input_tokens, output_tokens, cost_usd, state FROM sessions WHERE id = $1', [sessionId])).rows[0];
    expect(Number(row.input_tokens)).toBe(usage.inputTokens);
    expect(Number(row.output_tokens)).toBe(usage.outputTokens);
    expect(row.state.usage).toEqual(usage);
    expect(Number(row.cost_usd)).toBeCloseTo(estimateCostUsd(usage, PRICES), 6);
    expect(Number(row.cost_usd)).toBeGreaterThan(0);
  });

  it('enforces the daily limit against the sessions stored in the database', async () => {
    const student = await seedStudent(admin);
    const cookie = `fahim_student=${signStudentCookie({ role: 'student', ...student }, SECRET)}`;
    const h = handlers([say('piège'), say('piège')], 1);
    expect((await h.start(req('/api/sessions', cookie))).status).toBe(201);
    const second = await h.start(req('/api/sessions', cookie));
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: 'daily_limit' });
    const count = await admin.query('SELECT count(*)::int AS n FROM sessions WHERE student_id = $1', [student.studentId]);
    expect(count.rows[0].n).toBe(1);
  });

  it('does not exceed the limit when two starts arrive at the same time', async () => {
    const student = await seedStudent(admin);
    const cookie = `fahim_student=${signStudentCookie({ role: 'student', ...student }, SECRET)}`;
    const h = handlers([say('piège'), say('piège')], 1, 300);
    const statuses = (await Promise.all([h.start(req('/api/sessions', cookie)), h.start(req('/api/sessions', cookie))])).map((r) => r.status);
    expect(statuses.sort()).toEqual([201, 429]);
    const count = await admin.query('SELECT count(*)::int AS n FROM sessions WHERE student_id = $1', [student.studentId]);
    expect(count.rows[0].n).toBe(1);
  });

  it('creates one session when the same start arrives twice at the same time, and replays it on a retry', async () => {
    const student = await seedStudent(admin);
    const cookie = `fahim_student=${signStudentCookie({ role: 'student', ...student }, SECRET)}`;
    const h = handlers([say('piège'), say('autre piège'), say('encore')], 3, 300);
    const body = { startKey: randomUUID() };
    const [a, b] = await Promise.all([h.start(req('/api/sessions', cookie, body)), h.start(req('/api/sessions', cookie, body))]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const first = await a.json();
    expect(await b.json()).toEqual(first);
    // The browser retries after a lost response: same session again, no new model call.
    expect(await (await h.start(req('/api/sessions', cookie, body))).json()).toEqual(first);
    const count = await admin.query('SELECT count(*)::int AS n FROM sessions WHERE student_id = $1', [student.studentId]);
    expect(count.rows[0].n).toBe(1);
    // A new start (a new key) is a new session.
    const next = await h.start(req('/api/sessions', cookie, { startKey: randomUUID() }));
    expect(next.status).toBe(201);
    expect((await next.json()).sessionId).not.toBe(first.sessionId);
  });
});
