import type pg from 'pg';
import { generateInvitationCode, type InvitationDirectory, type SignInResult } from '../../core/access/invitationCode';
import type { Db } from './db';

/** Sign-in through fahim_sign_in, the only way the application role reads invitations. */
export class PostgresInvitationDirectory implements InvitationDirectory {
  constructor(private readonly db: Db) {}

  async signIn(codeHash: Buffer, client: string): Promise<SignInResult> {
    const result = await this.db.query<{ status: string; org_id: string | null; user_id: string | null }>(
      'SELECT status, org_id, user_id FROM fahim_sign_in($1, $2)',
      [codeHash, client],
    );
    const row = result.rows[0];
    if (row?.status === 'ok' && row.org_id && row.user_id) {
      return { status: 'ok', identity: { role: 'student', orgId: row.org_id, studentId: row.user_id } };
    }
    return { status: row?.status === 'locked' ? 'locked' : 'invalid' };
  }
}

/**
 * Operator side, run with the owner connection (scripts/invite.ts and tests):
 * creates a student in an organization and issues their code.
 */
export async function createInvitedStudent(
  admin: pg.Client,
  input: { orgId: string; displayName: string },
): Promise<{ studentId: string; code: string }> {
  await admin.query('BEGIN');
  try {
    const user = await admin.query<{ id: string }>('INSERT INTO users (display_name) VALUES ($1) RETURNING id', [input.displayName]);
    const studentId = user.rows[0]!.id;
    await admin.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [input.orgId, studentId]);
    await admin.query('INSERT INTO student_profiles (org_id, user_id) VALUES ($1, $2)', [input.orgId, studentId]);
    const code = await issueInvitation(admin, input.orgId, studentId);
    await admin.query('COMMIT');
    return { studentId, code };
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}

/** Issues a new code for a person, revoking the previous one. Returns the code: it is never stored. */
export async function issueInvitation(admin: pg.Client, orgId: string, userId: string): Promise<string> {
  const { code, hash } = generateInvitationCode();
  await admin.query('UPDATE invitations SET revoked_at = now() WHERE org_id = $1 AND user_id = $2 AND revoked_at IS NULL', [orgId, userId]);
  await admin.query('INSERT INTO invitations (org_id, user_id, code_hash) VALUES ($1, $2, $3)', [orgId, userId, hash]);
  return code;
}

export async function findOrCreateOrganization(admin: pg.Client, name: string, type: 'school' | 'center' | 'family'): Promise<string> {
  const existing = await admin.query<{ id: string }>('SELECT id FROM organizations WHERE name = $1 ORDER BY created_at LIMIT 1', [name]);
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await admin.query<{ id: string }>('INSERT INTO organizations (type, name) VALUES ($1, $2) RETURNING id', [type, name]);
  return created.rows[0]!.id;
}
