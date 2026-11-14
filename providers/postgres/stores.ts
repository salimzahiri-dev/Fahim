import type { MisconceptionRecord, MisconceptionStore } from '../../core/memory/misconceptionStore';
import { SessionConflictError, type SessionStore, type StoreScope } from '../../core/session/sessionStore';
import type { SessionState } from '../../core/session/types';
import { withIdentity, type Db } from './db';

/**
 * PostgreSQL implementations of the core stores. Every call runs in its own
 * transaction under the caller's verified identity (withIdentity), so
 * row-level security decides which rows exist.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly db: Db) {}

  async create(scope: StoreScope, state: SessionState): Promise<void> {
    if (state.orgId !== scope.orgId) throw new Error('Session belongs to another organization');
    await withIdentity(this.db, scope, (c) =>
      c.query(
        `INSERT INTO sessions (id, org_id, student_id, lesson_id, step, state, revision, input_tokens, output_tokens)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8)`,
        [state.sessionId, state.orgId, state.studentId, state.lessonId, state.step, { ...state, revision: 0 }, state.usage.inputTokens, state.usage.outputTokens],
      ),
    );
  }

  async get(scope: StoreScope, sessionId: string): Promise<SessionState | null> {
    // A malformed id cannot name a session; answering null keeps "missing" and "invalid" alike.
    if (!UUID.test(sessionId)) return null;
    const result = await withIdentity(this.db, scope, (c) =>
      c.query<{ state: SessionState; revision: number }>('SELECT state, revision FROM sessions WHERE id = $1', [sessionId]),
    );
    const row = result.rows[0];
    return row ? { ...row.state, revision: row.revision } : null;
  }

  async save(scope: StoreScope, state: SessionState): Promise<void> {
    if (state.orgId !== scope.orgId) throw new Error('Unknown session');
    const next = state.revision + 1;
    const result = await withIdentity(this.db, scope, (c) =>
      c.query(
        `UPDATE sessions
            SET state = $3, step = $4, revision = $5, input_tokens = $6, output_tokens = $7, updated_at = now(),
                ended_at = CASE WHEN $4 = 'summary' AND ended_at IS NULL THEN now() ELSE ended_at END
          WHERE id = $1 AND revision = $2`,
        [state.sessionId, state.revision, { ...state, revision: next }, state.step, next, state.usage.inputTokens, state.usage.outputTokens],
      ),
    );
    if (result.rowCount !== 1) throw new SessionConflictError();
  }
}

export class PostgresMisconceptionStore implements MisconceptionStore {
  constructor(private readonly db: Db) {}

  // The pilot's only caller is the student acting on their own map, hence userId = studentId.
  async record(orgId: string, studentId: string, code: string): Promise<void> {
    await withIdentity(this.db, { orgId, userId: studentId }, (c) =>
      c.query(
        `INSERT INTO misconceptions (org_id, student_id, code) VALUES ($1, $2, $3)
         ON CONFLICT (org_id, student_id, code)
         DO UPDATE SET seen_count = misconceptions.seen_count + 1, status = 'in_progress', last_seen_at = now()`,
        [orgId, studentId, code],
      ),
    );
  }

  async list(orgId: string, studentId: string): Promise<MisconceptionRecord[]> {
    const result = await withIdentity(this.db, { orgId, userId: studentId }, (c) =>
      c.query<{ code: string; seen_count: number; status: MisconceptionRecord['status'] }>(
        'SELECT code, seen_count, status FROM misconceptions WHERE student_id = $1 ORDER BY id',
        [studentId],
      ),
    );
    return result.rows.map((r) => ({ code: r.code, seenCount: r.seen_count, status: r.status }));
  }
}
