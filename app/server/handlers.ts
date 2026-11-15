import { createHmac, timingSafeEqual } from 'node:crypto';
import { DailyLimitError } from '../../core/billing/quota';
import type { StudentIdentity } from '../../core/access/access';
import { hashInvitationCode, normalizeInvitationCode, type InvitationDirectory } from '../../core/access/invitationCode';
import {
  clearStudentCookieHeader,
  readCookie,
  signStudentCookie,
  STUDENT_COOKIE,
  studentCookieHeader,
  verifyStudentCookie,
} from '../../core/access/studentCookie';
import {
  getProgress,
  parseClientEvent,
  parseStartBody,
  sendSessionEvent,
  SessionNotFoundError,
  startSession,
  type SessionServiceDeps,
} from '../../core/session/service';
import { resolveActor, type AccountDirectory } from '../../core/review/service';
import { SessionConflictError } from '../../core/session/sessionStore';
import { InvalidEventError, LessonNotValidatedError } from '../../core/session/types';

/**
 * HTTP handlers of the session API, written against the standard Request and
 * Response so they can be tested without a running Next.js server. They hold
 * no business rule: identity from the cookie, input parsing, error mapping.
 */

export interface HandlerDeps {
  service: SessionServiceDeps;
  cookieSecret: string;
  secureCookies: boolean;
  lessonId: string;
  /**
   * Development only (decision 0002): identity given to a browser that has none yet.
   * Absent in production, where a session without sign-in is refused.
   */
  newStudent?: () => StudentIdentity;
  /** Invitation codes (decision 0003). Without it, sign-in is not offered. */
  invitations?: InvitationDirectory;
  /**
   * Roles from the database (decision 0006). With it, an owner account that tries to
   * start a session gets a clear refusal instead of a failed insert.
   */
  accounts?: AccountDirectory;
  /**
   * Secret the reverse proxy (Caddy, D2) adds to every request it forwards, in
   * X-Fahim-Proxy-Secret. X-Forwarded-For is trusted only on requests that carry it.
   */
  proxySecret?: string;
}

type ErrorCode =
  | 'unauthenticated'
  | 'invalid_code'
  | 'too_many_attempts'
  | 'invalid_event'
  | 'not_found'
  | 'conflict'
  | 'daily_limit'
  | 'not_a_student'
  | 'lesson_not_validated'
  | 'server_error';

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  invalid_code: 401,
  too_many_attempts: 429,
  invalid_event: 400,
  not_found: 404,
  lesson_not_validated: 503,
  conflict: 409,
  daily_limit: 429,
  not_a_student: 403,
  server_error: 500,
};

const NO_STORE = { 'cache-control': 'no-store' };

function error(code: ErrorCode): Response {
  return Response.json({ error: code }, { status: STATUS[code], headers: NO_STORE });
}

function mapError(err: unknown): Response {
  if (err instanceof SessionNotFoundError) return error('not_found');
  if (err instanceof SessionConflictError) return error('conflict');
  if (err instanceof DailyLimitError) return error('daily_limit');
  if (err instanceof InvalidEventError) return error('invalid_event');
  if (err instanceof LessonNotValidatedError) return error('lesson_not_validated');
  // Details stay on the server and carry no student content.
  console.error('Session API error:', err instanceof Error ? err.name : 'unknown');
  return error('server_error');
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function createSessionHandlers(deps: HandlerDeps) {
  const identify = (request: Request): StudentIdentity | null =>
    verifyStudentCookie(readCookie(request.headers.get('cookie'), STUDENT_COOKIE), deps.cookieSecret);

  return {
    /**
     * POST /api/sessions [{ startKey }]: starts a session of the pilot lesson for the cookie's student.
     * The same startKey twice returns the same session (double tap, retried request).
     */
    async start(request: Request): Promise<Response> {
      let actor = identify(request);
      const headers = new Headers(NO_STORE);
      if (!actor) {
        if (!deps.newStudent) return error('unauthenticated');
        actor = deps.newStudent();
        headers.append('set-cookie', studentCookieHeader(signStudentCookie(actor, deps.cookieSecret), deps.secureCookies));
      }
      const body = parseStartBody(await readJson(request));
      if (!body) return error('invalid_event');
      try {
        // Decision 0006: the owner's account reviews sessions; it has no student profile to play one.
        if (deps.accounts && (await resolveActor(actor, deps.accounts)).role === 'platform_admin') return error('not_a_student');
        const turn = await startSession(actor, deps.lessonId, deps.service, body.startKey);
        return Response.json(turn, { status: 201, headers });
      } catch (err) {
        return mapError(err);
      }
    },

    /** POST /api/sessions/:id/events: one student event. The body never carries an identity. */
    async event(request: Request, sessionId: string): Promise<Response> {
      const actor = identify(request);
      if (!actor) return error('unauthenticated');
      const event = parseClientEvent(await readJson(request));
      if (!event) return error('invalid_event');
      try {
        const turn = await sendSessionEvent(actor, sessionId, event, deps.service);
        return Response.json(turn, { headers: NO_STORE });
      } catch (err) {
        return mapError(err);
      }
    },

    /** POST /api/sign-in { code }: exchanges an invitation code for the signed cookie. */
    async signIn(request: Request): Promise<Response> {
      if (!deps.invitations) return error('not_found');
      const body = await readJson(request);
      const typed =
        typeof body === 'object' && body !== null && !Array.isArray(body) && Object.keys(body).join() === 'code'
          ? (body as { code: unknown }).code
          : null;
      if (typeof typed !== 'string' || typed.length > 64) return error('invalid_event');
      const canonical = normalizeInvitationCode(typed);
      try {
        // A string that cannot be a code still counts as a failed attempt, under an impossible hash.
        const hash = canonical ? hashInvitationCode(canonical) : Buffer.alloc(32);
        const result = await deps.invitations.signIn(hash, clientKey(request, deps.cookieSecret, deps.proxySecret));
        if (result.status === 'locked') return error('too_many_attempts');
        if (result.status !== 'ok') return error('invalid_code');
        const headers = new Headers(NO_STORE);
        headers.append('set-cookie', studentCookieHeader(signStudentCookie(result.identity, deps.cookieSecret), deps.secureCookies));
        return Response.json({ signedIn: true }, { headers });
      } catch (err) {
        return mapError(err);
      }
    },

    /** POST /api/sign-out: forgets the cookie on this device. */
    async signOut(): Promise<Response> {
      const headers = new Headers(NO_STORE);
      headers.append('set-cookie', clearStudentCookieHeader(deps.secureCookies));
      return Response.json({ signedIn: false }, { headers });
    },

    /** GET /api/progress: the signed-in student's recent sessions and misconception map. */
    async progress(request: Request): Promise<Response> {
      const actor = identify(request);
      if (!actor) return error('unauthenticated');
      try {
        return Response.json(await getProgress(actor, deps.service), { headers: NO_STORE });
      } catch (err) {
        return mapError(err);
      }
    },
  };
}

export const PROXY_SECRET_HEADER = 'x-fahim-proxy-secret';

function sameSecret(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The client address for the failed-attempt limit. X-Forwarded-For is believed
 * only when the request carries the proxy's secret: Caddy replaces any
 * X-Forwarded-For sent by the client with the address it sees, and adds the
 * secret. Anything else (no proxy configured, a request that reached the app
 * directly, a wrong secret) falls into one shared bucket, which fails closed.
 */
export function clientAddress(headers: Headers, proxySecret: string | undefined): string {
  if (!proxySecret || !sameSecret(headers.get(PROXY_SECRET_HEADER), proxySecret)) return 'direct';
  // Caddy sends one address; if a chain ever arrives, the last hop is the one Caddy saw.
  return headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'direct';
}

/** Identifies the client without storing its address: an HMAC of it. */
function clientKey(request: Request, secret: string, proxySecret: string | undefined): string {
  return createHmac('sha256', secret).update(`sign-in:${clientAddress(request.headers, proxySecret)}`).digest('hex');
}

export type SessionHandlers = ReturnType<typeof createSessionHandlers>;
