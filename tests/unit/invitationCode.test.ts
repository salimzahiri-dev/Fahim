import { describe, expect, it } from 'vitest';
import { clientAddress, createSessionHandlers, type HandlerDeps } from '../../app/server/handlers';
import {
  CODE_LENGTH,
  generateInvitationCode,
  hashInvitationCode,
  normalizeInvitationCode,
  type InvitationDirectory,
  type SignInResult,
} from '../../core/access/invitationCode';
import { verifyStudentCookie } from '../../core/access/studentCookie';
import { InMemoryMisconceptionStore } from '../../core/memory/misconceptionStore';
import { InMemorySessionStore } from '../../core/session/sessionStore';
import { loadRegistries } from '../../modules';
import { ScriptedProvider } from '../../providers/model/scriptedProvider';

describe('invitation codes', () => {
  it('are 26 base32 characters in groups of four, about 130 random bits', () => {
    const { code, hash } = generateInvitationCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{2}$/);
    expect(code.replace(/-/g, '')).toHaveLength(CODE_LENGTH);
    expect(hash).toEqual(hashInvitationCode(code.replace(/-/g, '')));
    expect(generateInvitationCode().code).not.toBe(code);
  });

  it('accept what a student types: case, spaces, dashes, and letters mistaken for digits', () => {
    const canonical = '0123456789ABCDEFGHJKMNPQRS';
    expect(normalizeInvitationCode('0123-4567-89ab-cdef-ghjk-mnpq-rs')).toBe(canonical);
    expect(normalizeInvitationCode(' o123 4567 89AB CDEF GHJK MNPQ RS ')).toBe(canonical);
    expect(normalizeInvitationCode('0I23456789ABCDEFGHJKMNPQRS')).toBe('01' + canonical.slice(2));
    expect(normalizeInvitationCode('0L23456789ABCDEFGHJKMNPQRS')).toBe('01' + canonical.slice(2));
  });

  it('reject anything that cannot be a code', () => {
    expect(normalizeInvitationCode('')).toBeNull();
    expect(normalizeInvitationCode('ABCD')).toBeNull();
    expect(normalizeInvitationCode('0123456789ABCDEFGHJKMNPQRU')).toBeNull(); // U is not in the alphabet
    expect(normalizeInvitationCode("' OR 1=1 --")).toBeNull();
  });

  it('hash to 32 bytes, the same for the same code', () => {
    expect(hashInvitationCode('X')).toHaveLength(32);
    expect(hashInvitationCode('ABC')).toEqual(hashInvitationCode('ABC'));
  });
});

describe('sign-in route', () => {
  const SECRET = 'unit-secret-unit-secret-unit-secret-0';
  const { code } = generateInvitationCode();
  const goodHash = hashInvitationCode(normalizeInvitationCode(code)!);

  const PROXY = 'proxy-secret-proxy-secret-proxy-1111';
  const viaProxy = { 'x-fahim-proxy-secret': PROXY };

  function setup(override?: SignInResult) {
    const calls: Array<{ hash: Buffer; client: string }> = [];
    const directory: InvitationDirectory = {
      async signIn(hash, client) {
        calls.push({ hash, client });
        if (override) return override;
        return hash.equals(goodHash)
          ? { status: 'ok', identity: { role: 'student', orgId: 'org-1', studentId: 'student-1' } }
          : { status: 'invalid' };
      },
    };
    const deps: HandlerDeps = {
      service: {
        engine: {
          model: new ScriptedProvider([]),
          modelName: 'm',
          maxTokens: 1,
          systemPrompt: '',
          registries: loadRegistries(),
          misconceptions: new InMemoryMisconceptionStore(),
          rng: () => 0.5,
          env: 'development',
        },
        store: new InMemorySessionStore(),
        newSessionId: () => 's',
      },
      cookieSecret: SECRET,
      secureCookies: true,
      lessonId: 'work-kinetic-energy',
      invitations: directory,
      proxySecret: PROXY,
    };
    return { handlers: createSessionHandlers(deps), calls };
  }

  const signIn = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('http://localhost/api/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('sets the signed http-only cookie for a valid code, typed loosely', async () => {
    const { handlers } = setup();
    const res = await handlers.signIn(signIn({ code: ` ${code.toLowerCase()} ` }));
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    const value = cookie.split(';')[0]!.split('=')[1];
    expect(verifyStudentCookie(value, SECRET)).toEqual({ role: 'student', orgId: 'org-1', studentId: 'student-1' });
    expect(await res.text()).not.toContain(code);
  });

  it('refuses a wrong code without a cookie, and counts a malformed one as a failure', async () => {
    const { handlers, calls } = setup();
    for (const typed of ['AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA', 'pas un code']) {
      const res = await handlers.signIn(signIn({ code: typed }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_code' });
      expect(res.headers.get('set-cookie')).toBeNull();
    }
    expect(calls).toHaveLength(2);
    expect(calls[1]!.hash).toEqual(Buffer.alloc(32));
  });

  it('answers 429 once the client is locked out', async () => {
    const { handlers } = setup({ status: 'locked' });
    const res = await handlers.signIn(signIn({ code }));
    expect(res.status).toBe(429);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('keys the attempt limit on a hash of the client address, never the address itself', async () => {
    const { handlers, calls } = setup();
    await handlers.signIn(signIn({ code: 'x' }, { ...viaProxy, 'x-forwarded-for': '203.0.113.7' }));
    await handlers.signIn(signIn({ code: 'x' }, { ...viaProxy, 'x-forwarded-for': '203.0.113.8' }));
    expect(calls[0]!.client).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0]!.client).not.toContain('203.0.113.7');
    expect(calls[0]!.client).not.toBe(calls[1]!.client);
  });

  it('believes X-Forwarded-For only with the proxy secret', () => {
    const h = (extra: Record<string, string>) => new Headers({ 'x-forwarded-for': '203.0.113.9', ...extra });
    expect(clientAddress(h(viaProxy), PROXY)).toBe('203.0.113.9');
    expect(clientAddress(h({}), PROXY)).toBe('direct');
    expect(clientAddress(h({ 'x-fahim-proxy-secret': 'wrong' }), PROXY)).toBe('direct');
    expect(clientAddress(h({ 'x-fahim-proxy-secret': PROXY.replace('1', '2') }), PROXY)).toBe('direct');
    // No proxy configured (development): nobody's header is believed.
    expect(clientAddress(h(viaProxy), undefined)).toBe('direct');
  });

  it('refuses a body with anything but the code', async () => {
    const { handlers, calls } = setup();
    for (const body of [{ code, studentId: 'someone' }, { code: 42 }, {}, { code: 'x'.repeat(65) }]) {
      expect((await handlers.signIn(signIn(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it('signs out by expiring the cookie', async () => {
    const { handlers } = setup();
    const res = await handlers.signOut();
    expect(res.headers.get('set-cookie')).toMatch(/^fahim_student=;.*Max-Age=0/);
  });
});
