import { canAccessStudent, canReviewSessions, type Actor, type PlatformAdminIdentity, type StudentIdentity } from '../access/access';
import type { Message } from '../../providers/model/ModelProvider';
import type { Step } from '../session/types';

/**
 * The owner's daily review of the pilot (backlog D3): sessions with the step
 * reached, the cost and the transcript. Only the platform admin may see it, and
 * every view is written to the access log by the store, in the same transaction
 * as the read.
 */

export interface ReviewSessionRow {
  sessionId: string;
  studentId: string;
  studentName: string;
  lessonId: string;
  step: Step;
  startedAt: string;
  endedAt: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ReviewDetail {
  session: ReviewSessionRow;
  transcript: Message[];
}

export interface ReviewStore {
  /** The organization's sessions, most recent first. Writes one access_log line, in the same transaction. */
  listSessions(admin: PlatformAdminIdentity, limit: number): Promise<ReviewSessionRow[]>;
  /** One session and its transcript, or null. Writes one access_log line naming the student, in the same transaction. */
  getSession(admin: PlatformAdminIdentity, sessionId: string): Promise<ReviewDetail | null>;
}

/** Roles of a signed-in person in their organization, read from the database on every request. */
export interface AccountDirectory {
  roles(orgId: string, userId: string): Promise<string[]>;
}

/** Turns a verified cookie identity into an actor, with the role the database grants. */
export async function resolveActor(identity: StudentIdentity, accounts: AccountDirectory): Promise<Actor> {
  const roles = await accounts.roles(identity.orgId, identity.studentId);
  return roles.includes('platform_admin')
    ? { role: 'platform_admin', orgId: identity.orgId, userId: identity.studentId }
    : identity;
}

export interface ReviewDeps {
  accounts: AccountDirectory;
  review: ReviewStore;
}

/** Null when the actor may not review: the page then answers 404 and nothing is logged. */
export async function listForReview(identity: StudentIdentity, deps: ReviewDeps): Promise<ReviewSessionRow[] | null> {
  const actor = await resolveActor(identity, deps.accounts);
  if (!canReviewSessions(actor)) return null;
  return deps.review.listSessions(actor, 200);
}

export async function sessionForReview(identity: StudentIdentity, sessionId: string, deps: ReviewDeps): Promise<ReviewDetail | null> {
  const actor = await resolveActor(identity, deps.accounts);
  if (!canReviewSessions(actor)) return null;
  const detail = await deps.review.getSession(actor, sessionId);
  if (!detail || !canAccessStudent(actor, { orgId: actor.orgId, studentId: detail.session.studentId })) return null;
  return detail;
}

export interface TranscriptLine {
  who: 'student' | 'tutor' | 'server' | 'tool_call' | 'tool_result';
  text: string;
}

/**
 * The stored transcript as lines a person can read. Server markers (the
 * "(The student opens the session.)" kind) and tool traffic are kept, labelled,
 * because the review is also about what the model did.
 */
export function transcriptLines(transcript: Message[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const message of transcript) {
    for (const block of message.content) {
      if (block.type === 'text') {
        const marker = message.role === 'user' && /^\(.*\)$/s.test(block.text.trim());
        lines.push({ who: message.role === 'assistant' ? 'tutor' : marker ? 'server' : 'student', text: block.text });
      } else if (block.type === 'tool_use') {
        lines.push({ who: 'tool_call', text: `${block.name} ${JSON.stringify(block.input)}` });
      } else {
        lines.push({ who: 'tool_result', text: `${block.isError ? 'error: ' : ''}${block.content}` });
      }
    }
  }
  return lines;
}
