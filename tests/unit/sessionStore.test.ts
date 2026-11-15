import { describe, expect, it } from 'vitest';
import { InMemorySessionStore, SessionConflictError } from '../../core/session/sessionStore';
import { newSession } from '../../core/session/types';
import { DailyLimitError } from '../../core/billing/quota';

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
