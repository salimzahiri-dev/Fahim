import pg from 'pg';
import { createInvitedStudent, findOrCreateOrganization, issueInvitation } from '../providers/postgres/invitations';

/**
 * Operator tool (decision 0003): creates a student and prints their invitation
 * code, once. The code is not stored anywhere; only its hash is.
 *
 *   npm run invite -- --org "Pilote Fahim" --name "Élève 1"
 *   npm run invite -- --org "Pilote Fahim" --replace <student id>   (new code, old one revoked)
 *
 * Uses DATABASE_ADMIN_URL (owner connection).
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the environment.
  }
  const url = process.env.DATABASE_ADMIN_URL;
  const orgName = arg('org');
  const name = arg('name');
  const replace = arg('replace');
  if (!url || !orgName || (!name && !replace)) {
    console.error('Usage: npm run invite -- --org "<organization>" (--name "<student>" | --replace <student id>). Needs DATABASE_ADMIN_URL.');
    process.exit(1);
  }
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    const orgId = await findOrCreateOrganization(admin, orgName, 'center');
    if (replace) {
      const code = await issueInvitation(admin, orgId, replace);
      console.log(`New code for student ${replace} (the previous one no longer works):\n\n  ${code}\n`);
    } else {
      const { studentId, code } = await createInvitedStudent(admin, { orgId, displayName: name! });
      console.log(`Student ${studentId} created in "${orgName}". Give them this code, it is shown only once:\n\n  ${code}\n`);
    }
  } finally {
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
