import { describe, expect, it } from 'vitest';
import { buildSessionHandlers } from '../../app/server/runtime';

// Owner decisions (2026-11-14): anonymous students and the offline provider are for development only.

const SECRET = 'x'.repeat(40);
const start = () => new Request('http://localhost/api/sessions', { method: 'POST' });

describe('server wiring by environment', () => {
  it('refuses to start with the offline provider in production', () => {
    expect(() =>
      buildSessionHandlers({ NODE_ENV: 'production', FAHIM_MODEL_PROVIDER: 'offline', FAHIM_COOKIE_SECRET: SECRET }),
    ).toThrow(/development only/);
  });

  it('refuses a session without sign-in in production', async () => {
    // A placeholder key: the request is refused before any model call.
    const handlers = buildSessionHandlers({ NODE_ENV: 'production', ANTHROPIC_API_KEY: 'placeholder-not-a-key', FAHIM_COOKIE_SECRET: SECRET });
    const res = await handlers.start(start());
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
  });

  it('refuses to start in production without a cookie secret', () => {
    expect(() => buildSessionHandlers({ NODE_ENV: 'production', ANTHROPIC_API_KEY: 'placeholder-not-a-key' })).toThrow(
      /FAHIM_COOKIE_SECRET/,
    );
  });

  it('gives an anonymous identity in development with the offline provider', async () => {
    const handlers = buildSessionHandlers({ NODE_ENV: 'development', FAHIM_MODEL_PROVIDER: 'offline' });
    const res = await handlers.start(start());
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toMatch(/^fahim_student=.*HttpOnly/);
  });
});
