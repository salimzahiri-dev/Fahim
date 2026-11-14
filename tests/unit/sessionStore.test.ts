import { describe, expect, it } from 'vitest';
import { InMemorySessionStore, SessionConflictError } from '../../core/session/sessionStore';
import { newSession } from '../../core/session/types';

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
