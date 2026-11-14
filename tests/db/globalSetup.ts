import pg from 'pg';
import { migrate } from '../../db/migrate';
import { ADMIN_SERVER_URL, ADMIN_URL, APP_PASSWORD, TEST_DB } from './env';

/** Recreates the test database from the migrations, then lets the application role log in. */
export default async function setup(): Promise<void> {
  const server = new pg.Client({ connectionString: `${ADMIN_SERVER_URL}/postgres` });
  try {
    await server.connect();
  } catch {
    throw new Error('Test database unreachable. Start it with: npm run db:test:up');
  }
  await server.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await server.query(`CREATE DATABASE ${TEST_DB}`);
  await server.end();

  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await migrate(admin);
  await admin.query(`ALTER ROLE fahim_app WITH LOGIN PASSWORD '${APP_PASSWORD}'`);
  await admin.end();
}
