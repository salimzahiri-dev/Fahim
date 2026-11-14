import type { PlatformAdminIdentity } from '../../core/access/access';
import type { AccountDirectory, ReviewDetail, ReviewSessionRow, ReviewStore } from '../../core/review/service';
import type { SessionState } from '../../core/session/types';
import { withIdentity, type Db, type DbClient } from './db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  student_id: string;
  display_name: string;
  lesson_id: string;
  step: SessionState['step'];
  started_at: Date;
  ended_at: Date | null;
  cost_usd: string;
  input_tokens: string;
  output_tokens: string;
}

const COLUMNS = `s.id, s.student_id, u.display_name, s.lesson_id, s.step, s.started_at, s.ended_at, s.cost_usd, s.input_tokens, s.output_tokens`;

const toRow = (r: Row): ReviewSessionRow => ({
  sessionId: r.id,
  studentId: r.student_id,
  studentName: r.display_name,
  lessonId: r.lesson_id,
  step: r.step,
  startedAt: r.started_at.toISOString(),
  endedAt: r.ended_at ? r.ended_at.toISOString() : null,
  costUsd: Number(r.cost_usd),
  inputTokens: Number(r.input_tokens),
  outputTokens: Number(r.output_tokens),
});

async function logAccess(c: DbClient, admin: PlatformAdminIdentity, studentId: string | null, action: string): Promise<void> {
  await c.query('INSERT INTO access_log (org_id, actor_id, student_id, action) VALUES ($1, $2, $3, $4)', [
    admin.orgId,
    admin.userId,
    studentId,
    action,
  ]);
}

/** Reads and access-log writes share one transaction: if the log cannot be written, nothing is shown. */
export class PostgresReviewStore implements ReviewStore {
  constructor(private readonly db: Db) {}

  async listSessions(admin: PlatformAdminIdentity, limit: number): Promise<ReviewSessionRow[]> {
    return withIdentity(this.db, { orgId: admin.orgId, userId: admin.userId }, async (c) => {
      const result = await c.query<Row>(
        `SELECT ${COLUMNS} FROM sessions s JOIN users u ON u.id = s.student_id ORDER BY s.started_at DESC LIMIT $1`,
        [limit],
      );
      await logAccess(c, admin, null, 'review_list_sessions');
      return result.rows.map(toRow);
    });
  }

  async getSession(admin: PlatformAdminIdentity, sessionId: string): Promise<ReviewDetail | null> {
    if (!UUID.test(sessionId)) return null;
    return withIdentity(this.db, { orgId: admin.orgId, userId: admin.userId }, async (c) => {
      const result = await c.query<Row & { state: SessionState }>(
        `SELECT ${COLUMNS}, s.state FROM sessions s JOIN users u ON u.id = s.student_id WHERE s.id = $1`,
        [sessionId],
      );
      const row = result.rows[0];
      if (!row) return null;
      await logAccess(c, admin, row.student_id, 'review_view_transcript');
      return { session: toRow(row), transcript: row.state.transcript };
    });
  }
}

export class PostgresAccountDirectory implements AccountDirectory {
  constructor(private readonly db: Db) {}

  async roles(orgId: string, userId: string): Promise<string[]> {
    const result = await withIdentity(this.db, { orgId, userId }, (c) =>
      c.query<{ role: string }>('SELECT role FROM memberships WHERE user_id = $1', [userId]),
    );
    return result.rows.map((r) => r.role);
  }
}
