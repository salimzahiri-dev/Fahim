/**
 * Daily session limit per student (VISION "Controlled cost", ARCHITECTURE "Quotas and costs").
 * "Per day" is the calendar day in the pilot's time zone (owner decision, 2026-11-15):
 * the count starts again at midnight in Morocco, which is what a student expects.
 */

export const QUOTA_TIME_ZONE = 'Africa/Casablanca';

export class DailyLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Daily session limit of ${limit} reached`);
  }
}

/** Throws when starting one more session would exceed the limit. A limit of 0 or less means no limit. */
export function assertWithinDailyLimit(startedToday: number, limit: number): void {
  if (limit > 0 && startedToday >= limit) throw new DailyLimitError(limit);
}

/** Offset of `timeZone` from UTC at instant `t`, in milliseconds (local = UTC + offset). */
function offsetAt(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/**
 * The instant local midnight began, on the calendar day that contains `now` in
 * `timeZone`. Follows the zone's offset changes (Morocco moves to UTC+0 during Ramadan).
 */
export function startOfLocalDay(now: Date, timeZone: string = QUOTA_TIME_ZONE): Date {
  const t = now.getTime();
  const local = new Date(t + offsetAt(t, timeZone));
  const midnightAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  // First guess with the current offset, then correct with the offset in force at that midnight.
  let start = midnightAsUtc - offsetAt(t, timeZone);
  start = midnightAsUtc - offsetAt(start, timeZone);
  return new Date(start);
}
