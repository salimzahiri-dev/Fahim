/**
 * Identity and the single permission check of the project (ARCHITECTURE.md, "Roles and permissions").
 *
 * The identity is always established by the server from a verified cookie or
 * login session: never from a request body, never from the model.
 */

export interface StudentIdentity {
  role: 'student';
  orgId: string;
  studentId: string;
}

/** Anyone the server has verified. Parent, teacher and admin roles arrive after the pilot. */
export type Actor = StudentIdentity;

export interface StudentRef {
  orgId: string;
  studentId: string;
}

/**
 * "Can this user see this student?" Every page and route asks this function and
 * nothing else. In the pilot only students exist, so the answer is: only themselves.
 */
export function canAccessStudent(actor: Actor, student: StudentRef): boolean {
  switch (actor.role) {
    case 'student':
      return actor.orgId === student.orgId && actor.studentId === student.studentId;
  }
}
