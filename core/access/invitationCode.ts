import { createHash, randomBytes } from 'node:crypto';
import type { StudentIdentity } from './access';

/**
 * Invitation codes (decision 0003). A code is 130 random bits written as 26
 * Crockford base32 characters, shown in groups of four. Only its SHA-256 hash
 * is stored: the code itself is shown once to the person who hands it out.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 26;

export function generateInvitationCode(random: (n: number) => Buffer = randomBytes): { code: string; hash: Buffer } {
  const bytes = random(CODE_LENGTH);
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i++) raw += ALPHABET[(bytes[i] as number) % 32];
  return { code: raw.match(/.{1,4}/g)!.join('-'), hash: hashInvitationCode(raw) };
}

/**
 * What the student typed, reduced to the canonical code: case, spaces and
 * dashes ignored, and the letters people confuse with digits read as digits.
 * Returns null when it cannot be a code, so nothing is looked up.
 */
export function normalizeInvitationCode(typed: string): string | null {
  const canonical = typed
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (canonical.length !== CODE_LENGTH) return null;
  for (const ch of canonical) if (!ALPHABET.includes(ch)) return null;
  return canonical;
}

export function hashInvitationCode(canonical: string): Buffer {
  return createHash('sha256').update(canonical, 'utf8').digest();
}

export type SignInResult = { status: 'ok'; identity: StudentIdentity } | { status: 'invalid' } | { status: 'locked' };

/** Where invitations are looked up. The PostgreSQL one also limits failed attempts per client. */
export interface InvitationDirectory {
  signIn(codeHash: Buffer, client: string): Promise<SignInResult>;
}
