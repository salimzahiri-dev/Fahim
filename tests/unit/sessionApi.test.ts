import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionHandlers, type HandlerDeps } from '../../app/server/handlers';
import { signStudentCookie, verifyStudentCookie } from '../../core/access/studentCookie';
import { InMemoryMisconceptionStore } from '../../core/memory/misconceptionStore';
import type { EngineDeps } from '../../core/session/engine';
import { InMemorySessionStore } from '../../core/session/sessionStore';
import { loadRegistries } from '../../modules';
import { ClaudeAdapter } from '../../providers/model/claudeAdapter';
import type { ModelProvider } from '../../providers/model/ModelProvider';
import { callTool, say, ScriptedProvider, type ScriptStep } from '../../providers/model/scriptedProvider';

const SECRET = 'test-secret-test-secret-test-secret-00';

/** A complete session: trap, bet, wrong then right law, wrong then right answer, two replies to Sami. */
const FULL_LOOP: ScriptStep[] = [
  say('Voici le piège.'),
  callTool('launch_simulation', { simulation_id: 'train-kinetic-energy' }),
  say('Regarde les barres.'),
  say('Teste ta formule.'),
  say('Bonne formule.'),
  callTool('check_answer', { answer: '3110,4' }),
  say('Regarde ton unité de vitesse.'),
  callTool('check_answer', { answer: '240 kJ' }),
  say('Exact.\n\nSami : Si je roule deux fois plus vite…'),
  say('Sami : Mais pourquoi ?'),
  say('Sami : Ah oui !\n\nTon explication est juste. À bientôt.'),
];

let studentCounter = 0;

function setup(model: ModelProvider) {
  const store = new InMemorySessionStore();
  const misconceptions = new InMemoryMisconceptionStore();
  const engine: EngineDeps = {
    model,
    modelName: 'test-model',
    maxTokens: 500,
    systemPrompt: 'BASE PROMPT',
    registries: loadRegistries(),
    misconceptions,
    rng: () => 0.5, // 1 200 kg at 72 km/h -> 240 kJ
    env: 'development',
  };
  let sessionCounter = 0;
  const deps: HandlerDeps = {
    service: { engine, store, newSessionId: () => `session-${++sessionCounter}` },
    cookieSecret: SECRET,
    secureCookies: false,
    lessonId: 'work-kinetic-energy',
    newStudent: () => ({ role: 'student', orgId: 'pilot', studentId: `student-${++studentCounter}` }),
  };
  return { handlers: createSessionHandlers(deps), store, misconceptions };
}

const post = (url: string, body?: unknown, cookie?: string): Request =>
  new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie');
  if (!header) throw new Error('no cookie set');
  return header.split(';')[0]!;
}

describe('session API', () => {
  it('plays a full session through the routes with an identity set by the server', async () => {
    const { handlers, store } = setup(new ScriptedProvider(FULL_LOOP));

    const started = await handlers.start(post('/api/sessions'));
    expect(started.status).toBe(201);
    const setCookie = started.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^fahim_student=/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    const cookie = cookieFrom(started);
    const first = await started.json();
    expect(first).toMatchObject({ step: 'bet', tutorText: ['Voici le piège.'] });
    expect(first.ui[0]).toMatchObject({ type: 'show_choices', kind: 'bet' });
    // The browser receives what it displays, not the server state.
    expect(Object.keys(first).sort()).toEqual(['sessionId', 'step', 'tutorText', 'ui']);

    const send = async (event: unknown) => {
      const res = await handlers.event(post(`/api/sessions/${first.sessionId}/events`, event, cookie), first.sessionId);
      expect(res.status).toBe(200);
      return res.json();
    };

    const bet = await send({ type: 'bet', choiceId: 'x2' });
    expect(bet.step).toBe('law');
    expect(bet.ui.map((a: { type: string }) => a.type)).toEqual(['show_simulation', 'show_choices']);

    expect((await send({ type: 'law_choice', choiceId: 'a' })).step).toBe('law');
    const law = await send({ type: 'law_choice', choiceId: 'b' });
    expect(law.step).toBe('exercise');
    expect(law.ui).toContainEqual(expect.objectContaining({ type: 'show_exercise', values: { massKg: 1200, speedKmh: 72 } }));

    expect((await send({ type: 'message', text: '3110,4' })).step).toBe('exercise');
    expect((await send({ type: 'message', text: '240 kJ' })).step).toBe('reversed_role');
    expect((await send({ type: 'message', text: 'Oui tu as raison' })).step).toBe('reversed_role');
    const end = await send({ type: 'message', text: 'Non, Ec est ×4 donc la distance aussi.' });
    expect(end.step).toBe('summary');
    expect(end.ui).toEqual([
      expect.objectContaining({ type: 'show_summary', betLabel: '×2', betWasCorrect: false, exerciseAttempts: 2 }),
    ]);

    const identity = verifyStudentCookie(cookie.split('=')[1], SECRET)!;
    const saved = await store.get({ orgId: identity.orgId, userId: identity.studentId }, first.sessionId);
    expect(saved).toMatchObject({ step: 'summary', studentId: identity.studentId, orgId: 'pilot' });
  });

  it('keeps the identity of a returning cookie instead of minting a new one', async () => {
    const { handlers, store } = setup(new ScriptedProvider([say('piège')]));
    const cookie = `fahim_student=${signStudentCookie({ role: 'student', orgId: 'pilot', studentId: 'known' }, SECRET)}`;
    const res = await handlers.start(post('/api/sessions', undefined, cookie));
    expect(res.headers.get('set-cookie')).toBeNull();
    const { sessionId } = await res.json();
    expect((await store.get({ orgId: 'pilot', userId: 'test' }, sessionId))?.studentId).toBe('known');
  });

  it("refuses an event on another student's session and leaves it untouched", async () => {
    const { handlers, store } = setup(new ScriptedProvider([say('piège A'), say('piège B'), say('Pari noté.')]));
    const a = await handlers.start(post('/api/sessions'));
    const b = await handlers.start(post('/api/sessions'));
    const cookieA = cookieFrom(a);
    const cookieB = cookieFrom(b);
    const sessionA = (await a.json()).sessionId;
    expect(cookieA).not.toBe(cookieB);

    const intrusion = await handlers.event(post(`/api/sessions/${sessionA}/events`, { type: 'bet', choiceId: 'x4' }, cookieB), sessionA);
    expect(intrusion.status).toBe(404);
    expect(await intrusion.json()).toEqual({ error: 'not_found' });
    expect((await store.get({ orgId: 'pilot', userId: 'test' }, sessionA))?.step).toBe('bet');

    // The owner still can.
    const own = await handlers.event(post(`/api/sessions/${sessionA}/events`, { type: 'bet', choiceId: 'x4' }, cookieA), sessionA);
    expect(own.status).toBe(200);
  });

  it('refuses an event from another organization even with the same student id', async () => {
    const { handlers } = setup(new ScriptedProvider([say('piège')]));
    const own = `fahim_student=${signStudentCookie({ role: 'student', orgId: 'org-a', studentId: 'same' }, SECRET)}`;
    const other = `fahim_student=${signStudentCookie({ role: 'student', orgId: 'org-b', studentId: 'same' }, SECRET)}`;
    const { sessionId } = await (await handlers.start(post('/api/sessions', undefined, own))).json();
    const res = await handlers.event(post(`/api/sessions/${sessionId}/events`, { type: 'bet', choiceId: 'x4' }, other), sessionId);
    expect(res.status).toBe(404);
  });

  it('refuses events without a cookie or with a forged one', async () => {
    const { handlers } = setup(new ScriptedProvider([say('piège')]));
    const started = await handlers.start(post('/api/sessions'));
    const { sessionId } = await started.json();
    const url = `/api/sessions/${sessionId}/events`;
    const event = { type: 'bet', choiceId: 'x4' };

    expect((await handlers.event(post(url, event), sessionId)).status).toBe(401);

    const forgedPayload = Buffer.from(JSON.stringify({ o: 'pilot', s: 'someone', iat: Math.floor(Date.now() / 1000) })).toString('base64url');
    const realSignature = cookieFrom(started).split('.')[1];
    expect((await handlers.event(post(url, event, `fahim_student=${forgedPayload}.${realSignature}`), sessionId)).status).toBe(401);

    const otherSecret = `fahim_student=${signStudentCookie({ role: 'student', orgId: 'pilot', studentId: 'x' }, 'another-secret-another-secret-0000')}`;
    expect((await handlers.event(post(url, event, otherSecret), sessionId)).status).toBe(401);
  });

  it('refuses a body that tries to carry an identity, and malformed events', async () => {
    const { handlers } = setup(new ScriptedProvider([say('piège')]));
    const started = await handlers.start(post('/api/sessions'));
    const cookie = cookieFrom(started);
    const { sessionId } = await started.json();
    const url = `/api/sessions/${sessionId}/events`;

    for (const body of [
      { type: 'bet', choiceId: 'x4', studentId: 'someone-else' },
      { type: 'bet', choiceId: 'x4', orgId: 'other' },
      { type: 'start' },
      { type: 'message', text: '   ' },
      { type: 'message', text: 'a'.repeat(2001) },
      { type: 'bet' },
      'bet',
      null,
    ]) {
      const res = await handlers.event(post(url, body, cookie), sessionId);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('answers an event that does not fit the step with 400, without changing the session', async () => {
    const { handlers, store } = setup(new ScriptedProvider([say('piège')]));
    const started = await handlers.start(post('/api/sessions'));
    const cookie = cookieFrom(started);
    const { sessionId } = await started.json();
    const res = await handlers.event(post(`/api/sessions/${sessionId}/events`, { type: 'law_choice', choiceId: 'b' }, cookie), sessionId);
    expect(res.status).toBe(400);
    expect((await store.get({ orgId: 'pilot', userId: 'test' }, sessionId))?.step).toBe('bet');
  });

  it('never sends the API key to the browser', async () => {
    const KEY = 'sk-test-THIS-KEY-MUST-STAY-ON-THE-SERVER';
    const seenKeys: string[] = [];
    // The real adapter, talking to a fake Messages API that replays the scripted session.
    const scripted = new ScriptedProvider(FULL_LOOP);
    const fakeFetch: typeof fetch = async (_url, init) => {
      seenKeys.push(new Headers(init?.headers).get('x-api-key') ?? '');
      const reply = await scripted.respond({ systemPrompt: '', messages: [], tools: [], model: 'm', maxTokens: 1 });
      const content = reply.content.map((b) => (b.type === 'text' ? b : { type: 'tool_use', id: b.id, name: b.name, input: b.input }));
      return Response.json({
        content,
        stop_reason: reply.stopReason === 'tool_use' ? 'tool_use' : 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    };
    const { handlers } = setup(new ClaudeAdapter({ apiKey: KEY, fetchImpl: fakeFetch }));

    const responses: Response[] = [];
    const started = await handlers.start(post('/api/sessions'));
    responses.push(started.clone());
    const cookie = cookieFrom(started);
    const { sessionId } = await started.json();
    for (const event of [
      { type: 'bet', choiceId: 'x2' },
      { type: 'law_choice', choiceId: 'a' },
      { type: 'law_choice', choiceId: 'b' },
      { type: 'message', text: '3110,4' },
      { type: 'message', text: '240 kJ' },
      { type: 'message', text: 'Oui' },
      { type: 'message', text: 'Non' },
    ]) {
      responses.push(await handlers.event(post(`/api/sessions/${sessionId}/events`, event, cookie), sessionId));
    }

    expect(seenKeys.length).toBeGreaterThan(0);
    expect(seenKeys.every((k) => k === KEY)).toBe(true);
    for (const res of responses) {
      const headers = JSON.stringify([...res.headers.entries()]);
      expect(headers).not.toContain(KEY);
      expect(await res.text()).not.toContain(KEY);
    }
  });

  it('reads the API key only in the server wiring, never in code that can reach the browser', () => {
    const appDir = path.join(process.cwd(), 'app');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) files.push(full);
      }
    };
    walk(appDir);
    const rel = (f: string) => path.relative(appDir, f).replace(/\\/g, '/');

    const readingKey = files.filter((f) => readFileSync(f, 'utf8').includes('ANTHROPIC_API_KEY')).map(rel);
    expect(readingKey).toEqual(['server/runtime.ts']);

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // No variable exposed to the browser bundle, and no client component that imports the server side.
      expect(source, rel(file)).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(KEY|SECRET)/);
      if (/^['"]use client['"]/m.test(source)) {
        expect(source, rel(file)).not.toMatch(/from ['"][^'"]*(server\/|providers\/|claudeAdapter)/);
      }
    }
  });
});
