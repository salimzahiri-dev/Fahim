import type { SessionState } from './types';

/**
 * Where session state lives between requests.
 *
 * Every call is scoped to an organization: the PostgreSQL implementation sets
 * app.org_id from it so row-level security applies, and the in-memory one
 * behaves the same way. Whether the actor may act on the session is decided by
 * canAccessStudent, not here.
 */
export interface SessionStore {
  create(orgId: string, state: SessionState): Promise<void>;
  get(orgId: string, sessionId: string): Promise<SessionState | null>;
  save(orgId: string, state: SessionState): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  async create(orgId: string, state: SessionState): Promise<void> {
    if (state.orgId !== orgId) throw new Error('Session belongs to another organization');
    if (this.sessions.has(state.sessionId)) throw new Error('Session already exists');
    this.sessions.set(state.sessionId, structuredClone(state));
  }

  async get(orgId: string, sessionId: string): Promise<SessionState | null> {
    const state = this.sessions.get(sessionId);
    // Same outcome as row-level security: another organization's row does not exist for this caller.
    if (!state || state.orgId !== orgId) return null;
    return structuredClone(state);
  }

  async save(orgId: string, state: SessionState): Promise<void> {
    const existing = this.sessions.get(state.sessionId);
    if (!existing || existing.orgId !== orgId || state.orgId !== orgId) throw new Error('Unknown session');
    this.sessions.set(state.sessionId, structuredClone(state));
  }
}
