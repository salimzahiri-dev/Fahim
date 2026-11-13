import { createHmac, timingSafeEqual } from 'node:crypto';
import type { StudentIdentity } from './access';

/**
 * Signed cookie that carries the student identity between requests.
 *
 * The value is `<base64url payload>.<base64url HMAC-SHA256>`. The browser can
 * read nothing useful from it (it is http-only) and cannot forge it without the
 * server secret, so the identity of a request always comes from the server.
 */

export const STUDENT_COOKIE = 'fahim_student';
export const STUDENT_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;

interface Payload {
  o: string;
  s: string;
  /** Issued at, in seconds. */
  iat: number;
}

const b64 = (data: Buffer | string): string => Buffer.from(data).toString('base64url');

function mac(secret: string, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

export function signStudentCookie(identity: StudentIdentity, secret: string, nowMs = Date.now()): string {
  const payload: Payload = { o: identity.orgId, s: identity.studentId, iat: Math.floor(nowMs / 1000) };
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(mac(secret, body))}`;
}

export function verifyStudentCookie(value: string | undefined, secret: string, nowMs = Date.now()): StudentIdentity | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts as [string, string];
  const expected = mac(secret, body);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const { o, s, iat } = payload as Partial<Payload>;
  if (typeof o !== 'string' || typeof s !== 'string' || typeof iat !== 'number' || o === '' || s === '') return null;
  const ageS = nowMs / 1000 - iat;
  if (ageS < 0 || ageS > STUDENT_COOKIE_MAX_AGE_S) return null;
  return { role: 'student', orgId: o, studentId: s };
}

/** Reads one cookie from a Cookie request header. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export function studentCookieHeader(value: string, secure: boolean): string {
  return [
    `${STUDENT_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${STUDENT_COOKIE_MAX_AGE_S}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
