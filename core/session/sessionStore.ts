import { assertWithinDailyLimit } from '../billing/quota';
import type { SessionState } from './types';

/**
 * Where session state lives between requests.
 *
 * Every call carries the verified identity it runs for: the PostgreSQL
 * implementation sets app.org_id and app.user_id from it so row-level security
 * applies, and the in-memory one behaves the same way for organizations.
 * Whether the actor may act on the session is decided by canAccessStudent, not here.
 */
export interface StoreScope {
  orgId: string;
  userId: string;
}

/** The session changed since it was read: another request saved it first. */
export class SessionConflictError extends Error {}

/** What a start needs to know about the daily limit (C4). */
export interface StartRequest {
  studentId: string;
  /** Start of the current quota day, ISO 8601. */
  since: string;
  /** Sessions allowed per day; 0 or less means no limit. */
  limit: number;
  /**
   * Random key the page sends with one press of "Commencer". A start with a key
   * already used by this student returns the reply of the session it created.
   */
  startKey?: string;
}

/** The first turn of a new session: its state to store and the reply for the browser. */
export interface StartedSession<T> {
  state: SessionState;
  reply: T;
}

export interface SessionStore {
  /**
   * Starts a session atomically: under a lock held for this student, counts the
   * sessions started since `request.since`, throws DailyLimitError at the limit,
   * otherwise runs `produce` (the first turn) and stores its state. A second start
   * for the same student waits for the first one, so the limit holds under concurrency.
   * If `request.startKey` was already used by this student, returns the stored reply
   * of that session without counting, calling `produce` or creating anything.
   */
  start<T>(scope: StoreScope, request: StartRequest, produce: () => Promise<StartedSession<T>>): Promise<T>;
  create(scope: StoreScope, state: SessionState): Promise<void>;
  /** Returns the state with its current revision, or null if it does not exist for this organization. */
  get(scope: StoreScope, sessionId: string): Promise<SessionState | null>;
  /**
   * Saves a state read with get. Refuses with SessionConflictError if the stored
   * revision moved in between, then increments the revision.
   */
  save(scope: StoreScope, state: SessionState): Promise<void>;
  /** The sessions of one student, most recent first. */
  listForStudent(scope: StoreScope, studentId: string, limit: number): Promise<SessionSummary[]>;
}

export interface SessionSummary {
  sessionId: string;
  lessonId: string;
  step: SessionState['step'];
  /** ISO 8601. */
  startedAt: string;
  endedAt: string | null;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionState>();
  private readonly times = new Map<string, { startedAt: string; endedAt: string | null }>();

  /** One chain of pending starts per student: the in-memory equivalent of the database lock. */
  private readonly startLocks = new Map<string, Promise<unknown>>();
  private readonly startReplies = new Map<string, unknown>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async start<T>(scope: StoreScope, request: StartRequest, produce: () => Promise<StartedSession<T>>): Promise<T> {
    const lockKey = `${scope.orgId}:${request.studentId}`;
    const previous = this.startLocks.get(lockKey) ?? Promise.resolve();
    const replyKey = request.startKey ? `${lockKey}:${request.startKey}` : null;
    const current = previous.catch(() => undefined).then(async () => {
      if (replyKey && this.startReplies.has(replyKey)) return structuredClone(this.startReplies.get(replyKey)) as T;
      const startedToday = [...this.sessions.values()].filter(
        (s) => s.orgId === scope.orgId && s.studentId === request.studentId && this.times.get(s.sessionId)!.startedAt >= request.since,
      ).length;
      assertWithinDailyLimit(startedToday, request.limit);
      const { state, reply } = await produce();
      await this.create(scope, state);
      if (replyKey) this.startReplies.set(replyKey, structuredClone(reply));
      return reply;
    });
    this.startLocks.set(lockKey, current);
    try {
      return await current;
    } finally {
      if (this.startLocks.get(lockKey) === current) this.startLocks.delete(lockKey);
    }
  }

  async create(scope: StoreScope, state: SessionState): Promise<void> {
    if (state.orgId !== scope.orgId) throw new Error('Session belongs to another organization');
    if (this.sessions.has(state.sessionId)) throw new Error('Session already exists');
    this.sessions.set(state.sessionId, { ...structuredClone(state), revision: 0 });
    this.times.set(state.sessionId, { startedAt: this.now().toISOString(), endedAt: null });
  }

  async listForStudent(scope: StoreScope, studentId: string, limit: number): Promise<SessionSummary[]> {
    return [...this.sessions.values()]
      .filter((s) => s.orgId === scope.orgId && s.studentId === studentId)
      .map((s) => ({ sessionId: s.sessionId, lessonId: s.lessonId, step: s.step, ...this.times.get(s.sessionId)! }))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  async get(scope: StoreScope, sessionId: string): Promise<SessionState | null> {
    const state = this.sessions.get(sessionId);
    // Same outcome as row-level security: another organization's row does not exist for this caller.
    if (!state || state.orgId !== scope.orgId) return null;
    return structuredClone(state);
  }

  async save(scope: StoreScope, state: SessionState): Promise<void> {
    const existing = this.sessions.get(state.sessionId);
    if (!existing || existing.orgId !== scope.orgId || state.orgId !== scope.orgId) throw new Error('Unknown session');
    if (existing.revision !== state.revision) throw new SessionConflictError();
    this.sessions.set(state.sessionId, { ...structuredClone(state), revision: state.revision + 1 });
    const times = this.times.get(state.sessionId)!;
    if (state.step === 'summary' && !times.endedAt) times.endedAt = this.now().toISOString();
  }
}
