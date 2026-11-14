import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, appClient, asIdentity, seedOrg, type OrgFixture } from './fixtures';

/**
 * Isolation: connected as the application role (not owner, not superuser), a
 * user of organization A can neither read nor write the rows of organization B,
 * and a transaction with no identity sees nothing.
 */

let admin: pg.Client;
let app: pg.Client;
let A: OrgFixture;
let B: OrgFixture;

beforeAll(async () => {
  admin = await adminClient();
  app = await appClient();
  A = await seedOrg(admin, 'A');
  B = await seedOrg(admin, 'B');
});

afterAll(async () => {
  await app?.end();
  await admin?.end();
});

const asA = <T>(work: () => Promise<T>) => asIdentity(app, { orgId: A.orgId, userId: A.studentId }, work);

/** Expects a statement to be refused by PostgreSQL (row-level security or missing privilege). */
async function refused(sql: string, params: unknown[]): Promise<string> {
  try {
    await app.query(sql, params);
  } catch (error) {
    return (error as { code?: string }).code ?? 'error';
  }
  throw new Error(`Expected refusal: ${sql}`);
}

/** Sign-in tables (decision 0003): reached only through the fahim_sign_in function. */
const NO_DIRECT_ACCESS = ['invitations', 'sign_in_attempts'];

interface TableCase {
  table: string;
  /** Column holding the organization. */
  orgColumn: string;
  /** Selects B's row by its key. */
  keyOfB: () => [string, unknown[]];
  /** Inserts a row claiming B's organization. */
  insertIntoB: () => [string, unknown[]];
  update: string;
  /** Inserts a row in A's own organization, when the application may insert. */
  insertIntoA?: () => [string, unknown[]];
}

const CASES: TableCase[] = [
  {
    table: 'organizations',
    orgColumn: 'id',
    keyOfB: () => ['SELECT * FROM organizations WHERE id = $1', [B.orgId]],
    insertIntoB: () => ["INSERT INTO organizations (id, type, name) VALUES ($1, 'family', 'x')", [randomUUID()]],
    update: "UPDATE organizations SET name = 'changed'",
  },
  {
    table: 'users',
    orgColumn: '',
    keyOfB: () => ['SELECT * FROM users WHERE id = $1', [B.studentId]],
    insertIntoB: () => ['INSERT INTO users (id, display_name) VALUES ($1, $2)', [randomUUID(), 'x']],
    update: "UPDATE users SET display_name = 'changed'",
  },
  {
    table: 'memberships',
    orgColumn: 'org_id',
    keyOfB: () => ['SELECT * FROM memberships WHERE user_id = $1', [B.studentId]],
    insertIntoB: () => ["INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'teacher')", [B.orgId, A.studentId]],
    update: "UPDATE memberships SET role = 'org_admin'",
  },
  {
    table: 'student_profiles',
    orgColumn: 'org_id',
    keyOfB: () => ['SELECT * FROM student_profiles WHERE user_id = $1', [B.studentId]],
    insertIntoB: () => ['INSERT INTO student_profiles (org_id, user_id) VALUES ($1, $2)', [B.orgId, A.studentId]],
    update: "UPDATE student_profiles SET language = 'ar'",
  },
  {
    table: 'sessions',
    orgColumn: 'org_id',
    keyOfB: () => ['SELECT * FROM sessions WHERE id = $1', [B.sessionId]],
    insertIntoB: () => [
      "INSERT INTO sessions (org_id, student_id, lesson_id, step, state) VALUES ($1, $2, 'work-kinetic-energy', 'bet', '{}')",
      [B.orgId, B.studentId],
    ],
    update: "UPDATE sessions SET step = 'summary'",
    insertIntoA: () => [
      "INSERT INTO sessions (org_id, student_id, lesson_id, step, state) VALUES ($1, $2, 'work-kinetic-energy', 'bet', '{}')",
      [A.orgId, A.studentId],
    ],
  },
  {
    table: 'messages',
    orgColumn: 'org_id',
    keyOfB: () => ['SELECT * FROM messages WHERE id = $1', [B.messageId]],
    insertIntoB: () => ["INSERT INTO messages (org_id, session_id, author, content) VALUES ($1, $2, 'student', 'x')", [B.orgId, B.sessionId]],
    update: "UPDATE messages SET content = 'changed'",
    insertIntoA: () => ["INSERT INTO messages (org_id, session_id, author, content) VALUES ($1, $2, 'student', 'x')", [A.orgId, A.sessionId]],
  },
  {
    table: 'misconceptions',
    orgColumn: 'org_id',
    keyOfB: () => ['SELECT * FROM misconceptions WHERE id = $1', [B.misconceptionId]],
    insertIntoB: () => ["INSERT INTO misconceptions (org_id, student_id, code) VALUES ($1, $2, 'SPEED_UNIT_KMH')", [B.orgId, B.studentId]],
    update: 'UPDATE misconceptions SET seen_count = seen_count + 1',
    insertIntoA: () => ["INSERT INTO misconceptions (org_id, student_id, code) VALUES ($1, $2, 'SPEED_UNIT_KMH')", [A.orgId, A.studentId]],
  },
  {
    table: 'access_log',
    orgColumn: 'org_id',
    keyOfB: () => ['SELECT * FROM access_log WHERE id = $1', [B.accessLogId]],
    insertIntoB: () => ["INSERT INTO access_log (org_id, actor_id, student_id, action) VALUES ($1, $2, $2, 'x')", [B.orgId, A.studentId]],
    update: "UPDATE access_log SET action = 'changed'",
    insertIntoA: () => ["INSERT INTO access_log (org_id, actor_id, student_id, action) VALUES ($1, $2, $2, 'x')", [A.orgId, A.studentId]],
  },
];

describe('the application database role', () => {
  it('is neither superuser, nor exempt from row-level security, nor owner of any table', async () => {
    const role = await app.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await app.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user");
    expect(owned.rows).toEqual([]);
  });

  it('has row-level security enabled and forced on every table of the schema', async () => {
    const tables = await admin.query(
      "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> 'schema_migrations' ORDER BY relname",
    );
    expect(tables.rows.map((r) => r.relname).sort()).toEqual([...CASES.map((c) => c.table), ...NO_DIRECT_ACCESS].sort());
    for (const row of tables.rows) expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it.each(NO_DIRECT_ACCESS)('cannot read or write %s directly, even with an identity', async (table) => {
    for (const sql of [`SELECT * FROM ${table}`, `DELETE FROM ${table}`]) {
      expect(await asA(() => refused(sql, []))).toBe('42501');
    }
  });
});

describe.each(CASES)('isolation of $table', (c) => {
  it("reads only the rows of the user's organization", async () => {
    const rows = await asA(async () => (await app.query(`SELECT * FROM ${c.table}`)).rows);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      if (c.orgColumn) expect(row[c.orgColumn]).toBe(A.orgId);
      else expect(row.id).toBe(A.studentId);
    }
    const [sql, params] = c.keyOfB();
    expect(await asA(async () => (await app.query(sql, params)).rows)).toEqual([]);
  });

  it("cannot insert a row in another organization", async () => {
    const [sql, params] = c.insertIntoB();
    expect(await asA(() => refused(sql, params))).toBe('42501');
  });

  it("cannot update or delete another organization's rows", async () => {
    const [sql, params] = c.keyOfB();
    const where = sql.slice(sql.indexOf(' WHERE '));
    for (const statement of [`${c.update}${where}`, `DELETE FROM ${c.table}${where}`]) {
      const outcome = await asA(async () => {
        try {
          return (await app.query(statement, params)).rowCount;
        } catch (error) {
          return (error as { code?: string }).code;
        }
      });
      // Either the privilege is missing (42501) or row-level security hides every row (0 rows affected).
      expect([0, '42501'], statement).toContain(outcome);
    }
    // And B's row is still there, unchanged, seen as the owner.
    const still = await admin.query(sql, params);
    expect(still.rows).toHaveLength(1);
    expect(JSON.stringify(still.rows[0])).not.toContain('changed');
  });

  it('sees nothing without a verified identity', async () => {
    const rows = await asIdentity(app, null, async () => (await app.query(`SELECT * FROM ${c.table}`)).rows);
    expect(rows).toEqual([]);
  });

  it.runIf(Boolean(c.insertIntoA))('can still write in its own organization', async () => {
    const [sql, params] = c.insertIntoA!();
    const inserted = await asA(async () => (await app.query(sql, params)).rowCount);
    expect(inserted).toBe(1);
  });
});
