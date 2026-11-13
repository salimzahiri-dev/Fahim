import { canAccessStudent, type Actor } from '../access/access';
import { handleEvent, type EngineDeps } from './engine';
import type { SessionStore } from './sessionStore';
import { InvalidEventError, newSession, type SessionEvent, type Step, type UiAction } from './types';

/**
 * What the HTTP layer calls. It loads the session, checks that the actor may
 * act on it, runs one engine turn and saves the result. The browser receives
 * only what it displays: never the transcript, the usage or the server state.
 */

export interface SessionServiceDeps {
  engine: EngineDeps;
  store: SessionStore;
  newSessionId: () => string;
}

export interface PublicTurn {
  sessionId: string;
  step: Step;
  tutorText: string[];
  ui: UiAction[];
}

/** The session does not exist for this actor. Deliberately the same for "missing" and "not yours". */
export class SessionNotFoundError extends Error {}

/** Events a browser may send. `start` is not one of them: a session starts through startSession. */
export type ClientEvent = Exclude<SessionEvent, { type: 'start' }>;

export const MAX_MESSAGE_LENGTH = 2000;

const onlyKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).every((k) => keys.includes(k)) && keys.every((k) => k in value);

/**
 * Strict reading of a client event. Any extra field is refused, so a body that
 * tries to carry an identity ("studentId", "orgId") is rejected, not ignored.
 */
export function parseClientEvent(body: unknown): ClientEvent | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  switch (value.type) {
    case 'bet':
    case 'law_choice':
      if (!onlyKeys(value, ['type', 'choiceId']) || typeof value.choiceId !== 'string' || value.choiceId === '') return null;
      return { type: value.type, choiceId: value.choiceId };
    case 'message':
      if (!onlyKeys(value, ['type', 'text']) || typeof value.text !== 'string') return null;
      if (value.text.trim() === '' || value.text.length > MAX_MESSAGE_LENGTH) return null;
      return { type: 'message', text: value.text };
    default:
      return null;
  }
}

// One turn at a time per session: a double tap must not run two model turns on the same state.
const queues = new Map<string, Promise<unknown>>();

async function serialized<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  queues.set(sessionId, current);
  try {
    return await current;
  } finally {
    if (queues.get(sessionId) === current) queues.delete(sessionId);
  }
}

export async function startSession(actor: Actor, lessonId: string, deps: SessionServiceDeps): Promise<PublicTurn> {
  if (!deps.engine.registries.lessons.has(lessonId)) throw new InvalidEventError(`Unknown lesson ${lessonId}`);
  const state = newSession({ sessionId: deps.newSessionId(), orgId: actor.orgId, studentId: actor.studentId, lessonId });
  const turn = await handleEvent(state, { type: 'start' }, deps.engine);
  await deps.store.create(actor.orgId, turn.state);
  return { sessionId: turn.state.sessionId, step: turn.state.step, tutorText: turn.tutorText, ui: turn.ui };
}

export async function sendSessionEvent(
  actor: Actor,
  sessionId: string,
  event: ClientEvent,
  deps: SessionServiceDeps,
): Promise<PublicTurn> {
  return serialized(sessionId, async () => {
    const state = await deps.store.get(actor.orgId, sessionId);
    if (!state || !canAccessStudent(actor, state)) throw new SessionNotFoundError();
    const turn = await handleEvent(state, event, deps.engine);
    await deps.store.save(actor.orgId, turn.state);
    return { sessionId, step: turn.state.step, tutorText: turn.tutorText, ui: turn.ui };
  });
}
