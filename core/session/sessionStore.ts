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

export interface SessionStore {
  create(scope: StoreScope, state: SessionState): Promise<void>;
  /** Returns the state with its current revision, or null if it does not exist for this organization. */
  get(scope: StoreScope, sessionId: string): Promise<SessionState | null>;
  /**
   * Saves a state read with get. Refuses with SessionConflictError if the stored
   * revision moved in between, then increments the revision.
   */
  save(scope: StoreScope, state: SessionState): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  async create(scope: StoreScope, state: SessionState): Promise<void> {
    if (state.orgId !== scope.orgId) throw new Error('Session belongs to another organization');
    if (this.sessions.has(state.sessionId)) throw new Error('Session already exists');
    this.sessions.set(state.sessionId, { ...structuredClone(state), revision: 0 });
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
  }
}
