import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Applies the numbered SQL files of db/migrations that have not run yet, each in
 * its own transaction, then re-applies every file of db/policies (they drop and
 * recreate their policies, so they can run on every deploy).
 *
 * Runs as the database owner, never as the application role.
 * Usage: DATABASE_ADMIN_URL=postgres://... npm run db:migrate
 */

const DB_DIR = path.dirname(fileURLToPath(import.meta.url));

const sqlFiles = (dir: string): string[] =>
  readdirSync(path.join(DB_DIR, dir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

export async function migrate(client: pg.Client): Promise<{ applied: string[]; policies: string[] }> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));

  const applied: string[] = [];
  for (const name of sqlFiles('migrations')) {
    if (done.has(name)) continue;
    const sql = readFileSync(path.join(DB_DIR, 'migrations', name), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    applied.push(name);
  }

  const policies = sqlFiles('policies');
  await client.query('BEGIN');
  try {
    for (const name of policies) await client.query(readFileSync(path.join(DB_DIR, 'policies', name), 'utf8'));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`Policies failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { applied, policies };
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the environment.
  }
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    console.error('DATABASE_ADMIN_URL is missing (owner connection used for migrations).');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { applied, policies } = await migrate(client);
    console.log(`Migrations applied: ${applied.length ? applied.join(', ') : 'none'}. Policies applied: ${policies.length}.`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('db/migrate.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
