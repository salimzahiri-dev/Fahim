import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config';

describe('deployment environment', () => {
  it('follows NODE_ENV when FAHIM_ENV is not set, so a production build is production', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).env).toBe('production');
    expect(loadConfig({ NODE_ENV: 'development' }).env).toBe('development');
    expect(loadConfig({ NODE_ENV: 'test' }).env).toBe('development');
  });

  it('takes FAHIM_ENV when set, for a local container of a production build', () => {
    expect(loadConfig({ NODE_ENV: 'production', FAHIM_ENV: 'development' }).env).toBe('development');
    expect(loadConfig({ NODE_ENV: 'development', FAHIM_ENV: 'production' }).env).toBe('production');
  });

  it('refuses any other value instead of guessing', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', FAHIM_ENV: 'prod' })).toThrow(/FAHIM_ENV/);
  });

  it('reads the daily session limit, 3 by default', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).maxSessionsPerDay).toBe(3);
    expect(loadConfig({ NODE_ENV: 'test', FAHIM_MAX_SESSIONS_PER_DAY: '5' }).maxSessionsPerDay).toBe(5);
  });
});
