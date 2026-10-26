import { randomBytes, randomInt, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing with scrypt from node:crypto.
 *
 * Deliberately no bcrypt or argon2 dependency: both need a native build on the
 * server, and scrypt is memory-hard and already in the standard library.
 *
 * Stored format is `scrypt$N$r$p$saltHex$hashHex`, so the cost parameters
 * travel with the hash and can be raised later without invalidating existing
 * passwords.
 *
 * The server uses the async variants: a sync scrypt blocks the one Node event
 * loop for ~50 ms, so a burst of sign-ins would stall every child's answer
 * saves. The sync ones remain for command line scripts.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(plain.normalize('NFKC'), salt, KEY_LENGTH, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('hex'), derived.toString('hex')].join('$');
}

export async function hashPasswordAsync(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(plain.normalize('NFKC'), salt, KEY_LENGTH, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('hex'), derived.toString('hex')].join('$');
}

type ParsedHash = { n: number; r: number; p: number; salt: Buffer; expected: Buffer };

function parseHash(stored: string | null | undefined): ParsedHash | null {
  if (!stored) return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length === 0) return null;
  return { n, r, p, salt: Buffer.from(saltHex, 'hex'), expected };
}

/**
 * A fixed hash to verify against when the username does not exist, so an
 * unknown name costs the same scrypt time as a wrong password and the response
 * time does not reveal which accounts exist.
 */
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

export async function verifyPasswordAsync(
  plain: string,
  stored: string | null | undefined,
): Promise<boolean> {
  const parsed = parseHash(stored) ?? parseHash(DUMMY_HASH)!;
  let actual: Buffer;
  try {
    actual = await scryptAsync(plain.normalize('NFKC'), parsed.salt, parsed.expected.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
    });
  } catch {
    return false;
  }
  const match = parsed.expected.length === actual.length && timingSafeEqual(parsed.expected, actual);
  // A missing or malformed hash never matches, even though the work was done.
  return match && parseHash(stored) !== null;
}

/**
 * Checks a password against a stored hash.
 *
 * A null or malformed hash always fails, which is what makes an account with no
 * credentials issued yet un-signinable rather than open.
 */
export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
    actual = scryptSync(plain.normalize('NFKC'), Buffer.from(saltHex, 'hex'), expected.length, {
      N: n,
      r,
      p,
    });
  } catch {
    return false;
  }

  if (expected.length === 0 || expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * A one-time password for a new or reset account.
 *
 * Every account gets its own: a shared default, combined with usernames
 * derived from first names, let anyone sign in to any account nobody had used
 * yet. Short and unambiguous (no 0/o, 1/l/i) because a child types it once
 * from a printed slip.
 */
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function generateTempPassword(): string {
  const pick = () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join('');
  return `${group()}-${group()}`;
}

/** How long a one-time password works before an admin has to issue a new one. */
export const TEMP_PASSWORD_DAYS = 7;

export function tempPasswordExpiry(now = Date.now()): number {
  return Math.floor(now / 1000) + TEMP_PASSWORD_DAYS * 24 * 60 * 60;
}

export const MIN_PASSWORD_LENGTH = 6;

/** Returns a reason the password is unusable, or null when it is fine. */
export function passwordProblem(plain: string, username?: string | null): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  }
  if (plain.trim().length === 0) return 'Kata sandi tidak boleh kosong.';
  if (username && plain.trim().toLowerCase() === username.toLowerCase()) {
    return 'Kata sandi tidak boleh sama dengan nama pengguna.';
  }
  if (/^(.)\1+$/.test(plain) || ['123456', '1234567', '12345678', 'password', 'qwerty'].includes(plain)) {
    return 'Kata sandi terlalu mudah ditebak.';
  }
  return null;
}

/**
 * Turns a full name into a login name: first word, lowercased, letters and
 * digits only. Callers add a numeric suffix when the result is already taken.
 */
export function usernameFromName(nama: string): string {
  const first = nama.trim().split(/\s+/)[0] ?? '';
  const slug = first
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '');
  return slug || 'murid';
}
