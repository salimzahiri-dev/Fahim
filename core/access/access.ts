/**
 * Identity and the permission checks of the project (ARCHITECTURE.md, "Roles and permissions").
 *
 * The identity is always established by the server from a verified cookie or
 * login session: never from a request body, never from the model. A role other
 * than student is read from the database for each request, never from the cookie.
 */

export interface StudentIdentity {
  role: 'student';
  orgId: string;
  studentId: string;
}

/** The pilot's owner (backlog D3): reviews the sessions of their organization, every view logged. */
export interface PlatformAdminIdentity {
  role: 'platform_admin';
  orgId: string;
  userId: string;
}

/** Anyone the server has verified. Parent, teacher and organization admin roles arrive after the pilot. */
export type Actor = StudentIdentity | PlatformAdminIdentity;

export interface StudentRef {
  orgId: string;
  studentId: string;
}

/**
 * "Can this user see this student?" Every page and route asks this function and
 * nothing else. A student sees only themselves; the platform admin sees the
 * students of their organization, and each view is written to the access log.
 */
export function canAccessStudent(actor: Actor, student: StudentRef): boolean {
  switch (actor.role) {
    case 'student':
      return actor.orgId === student.orgId && actor.studentId === student.studentId;
    case 'platform_admin':
      return actor.orgId === student.orgId;
  }
}

/** Who may open the session review pages (backlog D3). */
export function canReviewSessions(actor: Actor): actor is PlatformAdminIdentity {
  return actor.role === 'platform_admin';
}
