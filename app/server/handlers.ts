import { createHmac } from 'node:crypto';
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
  sendSessionEvent,
  SessionNotFoundError,
  startSession,
  type SessionServiceDeps,
} from '../../core/session/service';
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
}

type ErrorCode =
  | 'unauthenticated'
  | 'invalid_code'
  | 'too_many_attempts'
  | 'invalid_event'
  | 'not_found'
  | 'conflict'
  | 'daily_limit'
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
    /** POST /api/sessions: starts a session of the pilot lesson for the cookie's student. */
    async start(request: Request): Promise<Response> {
      let actor = identify(request);
      const headers = new Headers(NO_STORE);
      if (!actor) {
        if (!deps.newStudent) return error('unauthenticated');
        actor = deps.newStudent();
        headers.append('set-cookie', studentCookieHeader(signStudentCookie(actor, deps.cookieSecret), deps.secureCookies));
      }
      try {
        const turn = await startSession(actor, deps.lessonId, deps.service);
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
        const result = await deps.invitations.signIn(hash, clientKey(request, deps.cookieSecret));
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

/**
 * Identifies the client for the failed-attempt limit without storing its address:
 * an HMAC of the address the reverse proxy reports. Without a proxy header every
 * client shares one bucket, which fails closed.
 */
function clientKey(request: Request, secret: string): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const address = forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
  return createHmac('sha256', secret).update(`sign-in:${address}`).digest('hex');
}

export type SessionHandlers = ReturnType<typeof createSessionHandlers>;
