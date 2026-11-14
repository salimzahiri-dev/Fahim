import { verifyStudentCookie } from '../../core/access/studentCookie';
import { listForReview, sessionForReview, transcriptLines, type ReviewDeps, type ReviewSessionRow, type TranscriptLine } from '../../core/review/service';

/**
 * Server side of the owner's review pages (backlog D3). Takes the raw cookie
 * value; returns null whenever the page must answer 404 (no sign-in, not the
 * owner, unknown session), so the page reveals nothing.
 */
export function createReviewHandlers(deps: ReviewDeps & { cookieSecret: string }) {
  const identify = (cookie: string | undefined) => verifyStudentCookie(cookie, deps.cookieSecret);
  return {
    async list(cookie: string | undefined): Promise<ReviewSessionRow[] | null> {
      const identity = identify(cookie);
      return identity ? listForReview(identity, deps) : null;
    },
    async detail(cookie: string | undefined, sessionId: string): Promise<{ session: ReviewSessionRow; lines: TranscriptLine[] } | null> {
      const identity = identify(cookie);
      if (!identity) return null;
      const detail = await sessionForReview(identity, sessionId, deps);
      return detail ? { session: detail.session, lines: transcriptLines(detail.transcript) } : null;
    },
  };
}

export type ReviewHandlers = ReturnType<typeof createReviewHandlers>;
