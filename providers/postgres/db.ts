import pg from 'pg';

/**
 * PostgreSQL access for the application. Every query on organization data runs
 * inside withIdentity, which opens a transaction and sets the verified identity
 * for that transaction only, so row-level security filters every row.
 */

export interface DbIdentity {
  orgId: string;
  userId: string;
}

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10 });
}

export async function withIdentity<T>(db: Db, identity: DbIdentity, work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // set_config(name, value, true) is SET LOCAL with bind parameters: it ends with the transaction.
    await client.query("SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [
      identity.orgId,
      identity.userId,
    ]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
