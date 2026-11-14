import { describe, expect, it } from 'vitest';
import { canAccessStudent, canReviewSessions, type Actor } from '../../core/access/access';
import { resolveActor, transcriptLines, type AccountDirectory } from '../../core/review/service';

const student: Actor = { role: 'student', orgId: 'org-a', studentId: 'stu-1' };
const admin: Actor = { role: 'platform_admin', orgId: 'org-a', userId: 'owner' };

describe('permission checks, one test per role', () => {
  it('a student sees only themselves', () => {
    expect(canAccessStudent(student, { orgId: 'org-a', studentId: 'stu-1' })).toBe(true);
    expect(canAccessStudent(student, { orgId: 'org-a', studentId: 'stu-2' })).toBe(false);
    expect(canAccessStudent(student, { orgId: 'org-b', studentId: 'stu-1' })).toBe(false);
    expect(canReviewSessions(student)).toBe(false);
  });

  it('the platform admin sees the students of their organization only, and may review', () => {
    expect(canAccessStudent(admin, { orgId: 'org-a', studentId: 'stu-2' })).toBe(true);
    expect(canAccessStudent(admin, { orgId: 'org-b', studentId: 'stu-2' })).toBe(false);
    expect(canReviewSessions(admin)).toBe(true);
  });
});

describe('role resolution', () => {
  const directory = (roles: string[]): AccountDirectory => ({ roles: async () => roles });
  const identity = { role: 'student' as const, orgId: 'org-a', studentId: 'u1' };

  it('reads the role from the database, not from the cookie', async () => {
    expect(await resolveActor(identity, directory(['platform_admin']))).toEqual({ role: 'platform_admin', orgId: 'org-a', userId: 'u1' });
    expect(await resolveActor(identity, directory(['student']))).toEqual(identity);
    expect(await resolveActor(identity, directory([]))).toEqual(identity);
  });
});

describe('transcript for review', () => {
  it('labels student, tutor, server markers and tool traffic', () => {
    expect(
      transcriptLines([
        { role: 'user', content: [{ type: 'text', text: '(The student opens the session.)' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Voici le piège.' }] },
        { role: 'user', content: [{ type: 'text', text: 'Je parie : ×2' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'launch_simulation', input: { simulation_id: 'x' } }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: 'nope', isError: true }] },
      ]),
    ).toEqual([
      { who: 'server', text: '(The student opens the session.)' },
      { who: 'tutor', text: 'Voici le piège.' },
      { who: 'student', text: 'Je parie : ×2' },
      { who: 'tool_call', text: 'launch_simulation {"simulation_id":"x"}' },
      { who: 'tool_result', text: 'error: nope' },
    ]);
  });
});
