import { estimateCostUsd } from '../../core/billing/cost';
import type { MisconceptionRecord, MisconceptionStore } from '../../core/memory/misconceptionStore';
import { SessionConflictError, type SessionStore, type SessionSummary, type StoreScope } from '../../core/session/sessionStore';
import type { SessionState } from '../../core/session/types';
import { withIdentity, type Db } from './db';

/**
 * PostgreSQL implementations of the core stores. Every call runs in its own
 * transaction under the caller's verified identity (withIdentity), so
 * row-level security decides which rows exist.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prices used to store each session's cost from its reported usage (C4). */
export type Prices = { priceInputPerMTok: number; priceOutputPerMTok: number };

export class PostgresSessionStore implements SessionStore {
  constructor(
    private readonly db: Db,
    private readonly prices: Prices = { priceInputPerMTok: 0, priceOutputPerMTok: 0 },
  ) {}

  private cost(state: SessionState): number {
    return estimateCostUsd(state.usage, this.prices);
  }

  async create(scope: StoreScope, state: SessionState): Promise<void> {
    if (state.orgId !== scope.orgId) throw new Error('Session belongs to another organization');
    await withIdentity(this.db, scope, (c) =>
      c.query(
        `INSERT INTO sessions (id, org_id, student_id, lesson_id, step, state, revision, input_tokens, output_tokens, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9)`,
        [
          state.sessionId,
          state.orgId,
          state.studentId,
          state.lessonId,
          state.step,
          { ...state, revision: 0 },
          state.usage.inputTokens,
          state.usage.outputTokens,
          this.cost(state),
        ],
      ),
    );
  }

  async countStartedSince(scope: StoreScope, studentId: string, since: string): Promise<number> {
    const result = await withIdentity(this.db, scope, (c) =>
      c.query<{ n: number }>('SELECT count(*)::int AS n FROM sessions WHERE student_id = $1 AND started_at >= $2', [studentId, since]),
    );
    return result.rows[0]?.n ?? 0;
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
            SET state = $3, step = $4, revision = $5, input_tokens = $6, output_tokens = $7, cost_usd = $8, updated_at = now(),
                ended_at = CASE WHEN $4 = 'summary' AND ended_at IS NULL THEN now() ELSE ended_at END
          WHERE id = $1 AND revision = $2`,
        [
          state.sessionId,
          state.revision,
          { ...state, revision: next },
          state.step,
          next,
          state.usage.inputTokens,
          state.usage.outputTokens,
          this.cost(state),
        ],
      ),
    );
    if (result.rowCount !== 1) throw new SessionConflictError();
  }

  async listForStudent(scope: StoreScope, studentId: string, limit: number): Promise<SessionSummary[]> {
    const result = await withIdentity(this.db, scope, (c) =>
      c.query<{ id: string; lesson_id: string; step: SessionState['step']; started_at: Date; ended_at: Date | null }>(
        'SELECT id, lesson_id, step, started_at, ended_at FROM sessions WHERE student_id = $1 ORDER BY started_at DESC LIMIT $2',
        [studentId, limit],
      ),
    );
    return result.rows.map((r) => ({
      sessionId: r.id,
      lessonId: r.lesson_id,
      step: r.step,
      startedAt: r.started_at.toISOString(),
      endedAt: r.ended_at ? r.ended_at.toISOString() : null,
    }));
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
