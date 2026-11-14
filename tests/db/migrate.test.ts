import { expect, it } from 'vitest';
import { migrate } from '../../db/migrate';
import { adminClient } from './fixtures';

it('applies nothing twice and re-applies the policies safely', async () => {
  const admin = await adminClient();
  try {
    const again = await migrate(admin);
    expect(again.applied).toEqual([]);
    expect(again.policies.length).toBeGreaterThanOrEqual(8);
    const recorded = await admin.query('SELECT name FROM schema_migrations ORDER BY name');
    expect(recorded.rows.map((r) => r.name)).toContain('0001_initial.sql');
  } finally {
    await admin.end();
  }
});
