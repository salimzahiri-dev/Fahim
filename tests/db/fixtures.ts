import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ADMIN_URL, APP_URL } from './env';

/** Fictional organizations and students, created as the owner (row-level security does not apply). */
export interface OrgFixture {
  orgId: string;
  studentId: string;
  sessionId: string;
  messageId: string;
  misconceptionId: string;
  accessLogId: string;
}

export async function adminClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  return client;
}

export async function appClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: APP_URL });
  await client.connect();
  return client;
}

export async function seedOrg(admin: pg.Client, name: string): Promise<OrgFixture> {
  const orgId = randomUUID();
  const studentId = randomUUID();
  const sessionId = randomUUID();
  await admin.query("INSERT INTO organizations (id, type, name) VALUES ($1, 'family', $2)", [orgId, name]);
  await admin.query('INSERT INTO users (id, display_name) VALUES ($1, $2)', [studentId, `Élève ${name}`]);
  await admin.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [orgId, studentId]);
  await admin.query('INSERT INTO student_profiles (org_id, user_id) VALUES ($1, $2)', [orgId, studentId]);
  await admin.query(
    "INSERT INTO sessions (id, org_id, student_id, lesson_id, step, state) VALUES ($1, $2, $3, 'work-kinetic-energy', 'bet', '{}')",
    [sessionId, orgId, studentId],
  );
  const message = await admin.query<{ id: string }>(
    "INSERT INTO messages (org_id, session_id, author, content) VALUES ($1, $2, 'student', 'bonjour') RETURNING id",
    [orgId, sessionId],
  );
  const misconception = await admin.query<{ id: string }>(
    "INSERT INTO misconceptions (org_id, student_id, code) VALUES ($1, $2, 'EC_LINEAR_IN_V') RETURNING id",
    [orgId, studentId],
  );
  const log = await admin.query<{ id: string }>(
    "INSERT INTO access_log (org_id, actor_id, student_id, action) VALUES ($1, $2, $2, 'test') RETURNING id",
    [orgId, studentId],
  );
  return {
    orgId,
    studentId,
    sessionId,
    messageId: message.rows[0]!.id,
    misconceptionId: misconception.rows[0]!.id,
    accessLogId: log.rows[0]!.id,
  };
}

/** An organization with one student, enough for the session API. */
export async function seedStudent(admin: pg.Client, orgId: string = randomUUID()): Promise<{ orgId: string; studentId: string }> {
  const studentId = randomUUID();
  await admin.query("INSERT INTO organizations (id, type, name) VALUES ($1, 'family', 'Famille test') ON CONFLICT (id) DO NOTHING", [orgId]);
  await admin.query('INSERT INTO users (id, display_name) VALUES ($1, $2)', [studentId, 'Élève test']);
  await admin.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [orgId, studentId]);
  await admin.query('INSERT INTO student_profiles (org_id, user_id) VALUES ($1, $2)', [orgId, studentId]);
  return { orgId, studentId };
}

/** Runs queries as the application role with a verified identity, like withIdentity does. */
export async function asIdentity<T>(
  client: pg.Client,
  identity: { orgId: string; userId: string } | null,
  work: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    if (identity) {
      await client.query("SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [
        identity.orgId,
        identity.userId,
      ]);
    }
    return await work();
  } finally {
    await client.query('ROLLBACK');
  }
}
