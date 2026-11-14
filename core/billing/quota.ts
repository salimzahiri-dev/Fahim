/**
 * Daily session limit per student (VISION "Controlled cost", ARCHITECTURE "Quotas and costs").
 * "Per day" is a sliding window of 24 hours: simple to explain and the same in every time zone.
 */

export const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

export class DailyLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Daily session limit of ${limit} reached`);
  }
}

/** Throws when starting one more session would exceed the limit. A limit of 0 or less means no limit. */
export function assertWithinDailyLimit(startedInWindow: number, limit: number): void {
  if (limit > 0 && startedInWindow >= limit) throw new DailyLimitError(limit);
}
