import { describe, expect, it } from 'vitest';
import { InMemorySessionStore, SessionConflictError } from '../../core/session/sessionStore';
import { newSession } from '../../core/session/types';
import { DailyLimitError } from '../../core/billing/quota';
import { parseStartBody } from '../../core/session/service';

describe('in-memory session store', () => {
  const scope = { orgId: 'org1', userId: 'stu1' };
  const state = () => newSession({ sessionId: 's1', orgId: 'org1', studentId: 'stu1', lessonId: 'work-kinetic-energy' });

  it('counts saves and refuses a save made from an outdated state', async () => {
    const store = new InMemorySessionStore();
    await store.create(scope, state());
    const a = (await store.get(scope, 's1'))!;
    const b = (await store.get(scope, 's1'))!;
    await store.save(scope, { ...a, step: 'law' });
    expect((await store.get(scope, 's1'))?.revision).toBe(1);
    await expect(store.save(scope, { ...b, step: 'summary' })).rejects.toBeInstanceOf(SessionConflictError);
    expect((await store.get(scope, 's1'))?.step).toBe('law');
  });

  it("hides another organization's session", async () => {
    const store = new InMemorySessionStore();
    await store.create(scope, state());
    expect(await store.get({ orgId: 'org2', userId: 'stu1' }, 's1')).toBeNull();
  });
});

describe('atomic start', () => {
  const scope = { orgId: 'org1', userId: 'stu1' };
  const request = { studentId: 'stu1', since: '2000-01-01T00:00:00.000Z', limit: 1 };
  let n = 0;
  const slowFirstTurn = async () => {
    await new Promise((ok) => setTimeout(ok, 50));
    const state = newSession({ sessionId: `s${++n}`, orgId: 'org1', studentId: 'stu1', lessonId: 'work-kinetic-energy' });
    return { state, reply: state.sessionId };
  };

  it('lets only one of two simultaneous starts through when one session is left today', async () => {
    const store = new InMemorySessionStore();
    const results = await Promise.allSettled([store.start(scope, request, slowFirstTurn), store.start(scope, request, slowFirstTurn)]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: expect.any(DailyLimitError) });
    expect(await store.listForStudent(scope, 'stu1', 10)).toHaveLength(1);
  });
});

describe('idempotent start', () => {
  const scope = { orgId: 'org1', userId: 'stu1' };
  it('returns the session already created for the same start key, without a second first turn', async () => {
    const store = new InMemorySessionStore();
    let turns = 0;
    const firstTurn = async () => {
      turns++;
      await new Promise((ok) => setTimeout(ok, 20));
      const state = newSession({ sessionId: `s${turns}`, orgId: 'org1', studentId: 'stu1', lessonId: 'work-kinetic-energy' });
      return { state, reply: { sessionId: state.sessionId } };
    };
    const request = { studentId: 'stu1', since: '2000-01-01T00:00:00.000Z', limit: 3, startKey: 'k1' };
    const [a, b] = await Promise.all([store.start(scope, request, firstTurn), store.start(scope, request, firstTurn)]);
    expect(a).toEqual({ sessionId: 's1' });
    expect(b).toEqual(a);
    expect(await store.start(scope, request, firstTurn)).toEqual(a);
    expect(turns).toBe(1);
    expect(await store.start(scope, { ...request, startKey: 'k2' }, firstTurn)).toEqual({ sessionId: 's2' });
  });
});

describe('start body', () => {
  it('accepts nothing or a UUID start key, and refuses anything else, identity fields included', () => {
    const key = '0b6c3c1e-7c47-4d2a-9a4e-2f1f7e9b8a10';
    expect(parseStartBody(undefined)).toEqual({});
    expect(parseStartBody({})).toEqual({});
    expect(parseStartBody({ startKey: key })).toEqual({ startKey: key });
    expect(parseStartBody({ startKey: 'abc' })).toBeNull();
    expect(parseStartBody({ startKey: key, studentId: 'x' })).toBeNull();
    expect(parseStartBody({ orgId: 'x' })).toBeNull();
    expect(parseStartBody([key])).toBeNull();
  });
});
