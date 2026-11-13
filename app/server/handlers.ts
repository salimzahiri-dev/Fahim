import type { StudentIdentity } from '../../core/access/access';
import {
  readCookie,
  signStudentCookie,
  STUDENT_COOKIE,
  studentCookieHeader,
  verifyStudentCookie,
} from '../../core/access/studentCookie';
import {
  parseClientEvent,
  sendSessionEvent,
  SessionNotFoundError,
  startSession,
  type SessionServiceDeps,
} from '../../core/session/service';
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
   * Identity given to a browser that has none yet. The pilot has no sign-in
   * (backlog C3): the server mints an anonymous student in the pilot organization.
   */
  newStudent: () => StudentIdentity;
}

type ErrorCode = 'unauthenticated' | 'invalid_event' | 'not_found' | 'lesson_not_validated' | 'server_error';

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  invalid_event: 400,
  not_found: 404,
  lesson_not_validated: 503,
  server_error: 500,
};

const NO_STORE = { 'cache-control': 'no-store' };

function error(code: ErrorCode): Response {
  return Response.json({ error: code }, { status: STATUS[code], headers: NO_STORE });
}

function mapError(err: unknown): Response {
  if (err instanceof SessionNotFoundError) return error('not_found');
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
  };
}

export type SessionHandlers = ReturnType<typeof createSessionHandlers>;
