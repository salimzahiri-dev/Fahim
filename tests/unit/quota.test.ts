import { describe, expect, it } from 'vitest';
import { createSessionHandlers } from '../../app/server/handlers';
import { assertWithinDailyLimit, DailyLimitError, QUOTA_WINDOW_MS } from '../../core/billing/quota';
import { signStudentCookie } from '../../core/access/studentCookie';
import { InMemoryMisconceptionStore } from '../../core/memory/misconceptionStore';
import { InMemorySessionStore } from '../../core/session/sessionStore';
import { loadRegistries } from '../../modules';
import { say, ScriptedProvider } from '../../providers/model/scriptedProvider';

const SECRET = 'quota-secret-quota-secret-quota-0000';

describe('daily session limit', () => {
  it('allows up to the limit, and treats 0 as no limit', () => {
    expect(() => assertWithinDailyLimit(1, 2)).not.toThrow();
    expect(() => assertWithinDailyLimit(2, 2)).toThrow(DailyLimitError);
    expect(() => assertWithinDailyLimit(500, 0)).not.toThrow();
  });

  it('refuses a third session in 24 hours before any model call, per student, and reopens after the window', async () => {
    let now = new Date('2026-11-14T08:00:00Z');
    const clock = () => now;
    const model = new ScriptedProvider(Array.from({ length: 10 }, () => say('piège')));
    const handlers = createSessionHandlers({
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
        store: new InMemorySessionStore(clock),
        newSessionId: (() => {
          let n = 0;
          return () => `s${++n}`;
        })(),
        maxSessionsPerDay: 2,
        now: clock,
      },
      cookieSecret: SECRET,
      secureCookies: false,
      lessonId: 'work-kinetic-energy',
    });
    const cookie = (studentId: string) =>
      // Signed with the real clock, which the cookie check uses; only the quota window uses the test clock.
      `fahim_student=${signStudentCookie({ role: 'student', orgId: 'org', studentId }, SECRET)}`;
    const start = (studentId: string) =>
      handlers.start(new Request('http://localhost/api/sessions', { method: 'POST', headers: { cookie: cookie(studentId) } }));

    expect((await start('a')).status).toBe(201);
    now = new Date(now.getTime() + 60 * 60 * 1000);
    expect((await start('a')).status).toBe(201);
    const calls = model.requests.length;

    const refused = await start('a');
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'daily_limit' });
    expect(model.requests.length).toBe(calls);

    expect((await start('b')).status).toBe(201);

    // 24 hours after the first session, one slot is free again.
    now = new Date(Date.parse('2026-11-14T08:00:00Z') + QUOTA_WINDOW_MS + 1);
    expect((await start('a')).status).toBe(201);
    expect((await start('a')).status).toBe(429);
  });
});
