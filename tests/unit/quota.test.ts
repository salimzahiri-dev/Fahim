import { describe, expect, it } from 'vitest';
import { createSessionHandlers } from '../../app/server/handlers';
import { assertWithinDailyLimit, DailyLimitError, startOfLocalDay } from '../../core/billing/quota';
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

  it('refuses a third session on the same Moroccan calendar day before any model call, per student, and reopens at local midnight', async () => {
    // Times are placed around the local midnight that starts 15 November in Casablanca, as the
    // runtime's time zone data computes it: Morocco's offset differs between tzdata versions.
    const midnight = startOfLocalDay(new Date('2026-11-15T12:00:00Z')).getTime();
    const minutes = (m: number) => new Date(midnight + m * 60 * 1000);
    let now = minutes(-150); // 21:30 local on 14 November

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
    now = minutes(-30); // 23:30 local, same day
    expect((await start('a')).status).toBe(201);
    const calls = model.requests.length;

    const refused = await start('a');
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'daily_limit' });
    expect(model.requests.length).toBe(calls);

    expect((await start('b')).status).toBe(201);

    // 23:59 local is still the same day; a sliding 24-hour window would also refuse here.
    now = minutes(-1);
    expect((await start('a')).status).toBe(429);
    // 00:10 local on 15 November: a new day, although less than 24 hours have passed.
    now = minutes(10);
    expect((await start('a')).status).toBe(201);
    expect((await start('a')).status).toBe(201);
    expect((await start('a')).status).toBe(429);
  });
});

describe('start of the local day', () => {
  const localTime = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Casablanca', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(d);
  const localDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(d);

  it('is local midnight in the given zone, not UTC midnight', () => {
    // Tokyo has kept UTC+9 without daylight saving for decades, so the expected instants are stable.
    expect(startOfLocalDay(new Date('2026-11-14T16:30:00Z'), 'Asia/Tokyo').toISOString()).toBe('2026-11-14T15:00:00.000Z');
    expect(startOfLocalDay(new Date('2026-11-14T14:30:00Z'), 'Asia/Tokyo').toISOString()).toBe('2026-11-13T15:00:00.000Z');
  });

  it('is 00:00 on the same local date, whatever the offset in force (Ramadan included)', () => {
    for (let t = Date.parse('2026-01-01T00:00:00Z'); t < Date.parse('2027-01-01T00:00:00Z'); t += 7 * 3600 * 1000 + 1234567) {
      const now = new Date(t);
      const start = startOfLocalDay(now);
      expect(localTime(start)).toBe('00:00');
      expect(localDate(start)).toBe(localDate(now));
      expect(start.getTime()).toBeLessThanOrEqual(t);
    }
  });
});
