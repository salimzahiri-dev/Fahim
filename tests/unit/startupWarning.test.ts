import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from '../../instrumentation';

// Owner decision (2026-11-15): a server started in development mode says so loudly at startup.

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

async function warningsAtStartup(env: Record<string, string>): Promise<string[]> {
  process.env = { ...saved, NEXT_RUNTIME: 'nodejs', ...env };
  delete process.env.FAHIM_ENV;
  Object.assign(process.env, env);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await register();
  return warn.mock.calls.map((c) => String(c[0]));
}

describe('startup warning', () => {
  it('warns when FAHIM_ENV is development, even in a production build', async () => {
    const lines = await warningsAtStartup({ NODE_ENV: 'production', FAHIM_ENV: 'development' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/DEVELOPMENT mode/);
    expect(lines[0]).toMatch(/FAHIM_ENV=production/);
  });

  it('stays silent in production', async () => {
    expect(await warningsAtStartup({ NODE_ENV: 'production', FAHIM_ENV: 'production' })).toEqual([]);
    expect(await warningsAtStartup({ NODE_ENV: 'production' })).toEqual([]);
  });
});
