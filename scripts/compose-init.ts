import pg from 'pg';
import { migrate } from '../db/migrate';
import { createInvitedStudent, findOrCreateOrganization, issueInvitation } from '../providers/postgres/invitations';

/**
 * Runs once when the containers start (docker-compose.yml, service "init"):
 *  1. applies the migrations and policies as the database owner;
 *  2. lets the application role log in with FAHIM_APP_DB_PASSWORD;
 *  3. outside production only, creates a local test student and prints a fresh
 *     invitation code (the previous one is revoked), so a session can be played.
 */

const LOCAL_ORG = 'Développement local';
const LOCAL_STUDENT = 'Élève local';

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const appPassword = process.env.FAHIM_APP_DB_PASSWORD;
  if (!adminUrl || !appPassword) throw new Error('DATABASE_ADMIN_URL and FAHIM_APP_DB_PASSWORD are required');
  const production = (process.env.FAHIM_ENV ?? 'production') === 'production';

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const { applied } = await migrate(admin);
    console.log(`Migrations applied: ${applied.length ? applied.join(', ') : 'none (already up to date)'}.`);
    await admin.query(`ALTER ROLE fahim_app WITH LOGIN PASSWORD ${admin.escapeLiteral(appPassword)}`);

    if (production) {
      console.log('Production: no local student is created. Issue codes with npm run invite.');
      return;
    }
    const orgId = await findOrCreateOrganization(admin, LOCAL_ORG, 'family');
    const existing = await admin.query<{ user_id: string }>(
      `SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = $1 AND m.role = 'student' AND u.display_name = $2 LIMIT 1`,
      [orgId, LOCAL_STUDENT],
    );
    const code = existing.rows[0]
      ? await issueInvitation(admin, orgId, existing.rows[0].user_id)
      : (await createInvitedStudent(admin, { orgId, displayName: LOCAL_STUDENT })).code;
    console.log(`\nDevelopment only. Code d'accès de l'élève local (valable jusqu'au prochain démarrage) :\n\n    ${code}\n`);
  } finally {
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
