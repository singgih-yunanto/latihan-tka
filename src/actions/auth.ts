'use server';

import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, sqlite } from '@/db/client';
import { users } from '@/db/schema';
import { ROLE_HOME } from '@/domain/access';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  currentUser,
  destroyAllSessions,
  destroySession,
  markSignedIn,
  setSessionCookie,
} from '@/lib/auth';
import { hashPasswordAsync, passwordProblem, verifyPasswordAsync } from '@/lib/password';
import { safeNextPath } from '@/lib/redirect';

/**
 * Sign in, sign out, change own password.
 *
 * These are the only actions reachable without a session, so they carry their
 * own rate-limit and take care never to reveal whether a username exists.
 */

export type AuthState = { error?: string };

/**
 * A crude in-memory throttle, per process, keyed two ways.
 *
 * Per username alone does nothing against spraying one guess across many
 * guessable first-name usernames, so failures are also counted per client IP.
 * The IP limit is the looser one, because a whole class may sit behind one
 * school router. Nginx's limit_req on /masuk (deploy/nginx-tka.conf) is the
 * coarse outer layer; this one also covers a direct hit on the action.
 */
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_USER = 10;
const MAX_ATTEMPTS_PER_IP = 30;
const failures = new Map<string, { count: number; first: number }>();

function throttled(key: string, max: number): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > ATTEMPT_WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= max;
}

function recordFailure(key: string): void {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > ATTEMPT_WINDOW_MS) {
    failures.set(key, { count: 1, first: Date.now() });
    return;
  }
  entry.count += 1;
}

/** The client address as Nginx reports it; the app itself listens on loopback only. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get('x-real-ip')?.trim() ||
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'local'
  );
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const username = String(formData.get('username') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const next = safeNextPath(formData.get('lanjut'));

  if (!username || !password || username.length > 64 || password.length > 256) {
    return { error: 'Nama pengguna dan kata sandi harus diisi.' };
  }
  const userKey = `u:${username}`;
  const ipKey = `ip:${await clientIp()}`;
  if (throttled(userKey, MAX_ATTEMPTS_PER_USER) || throttled(ipKey, MAX_ATTEMPTS_PER_IP)) {
    return { error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' };
  }

  const row = sqlite
    .prepare(
      `SELECT id, role, password_hash AS passwordHash, must_change_password AS mustChange, aktif,
              temp_password_expires_at AS tempExpiresAt
         FROM users WHERE lower(username) = ?`,
    )
    .get(username) as
    | {
        id: number;
        role: string;
        passwordHash: string | null;
        mustChange: number;
        aktif: number;
        tempExpiresAt: number | null;
      }
    | undefined;

  // One message for every failure: a wrong username and a wrong password must
  // be indistinguishable, or the form becomes a way to enumerate accounts. The
  // hash is checked even when the user is missing (against a dummy), so the
  // response time does not tell them apart either.
  const passwordOk = await verifyPasswordAsync(password, row?.passwordHash);
  if (!row || !row.aktif || !passwordOk) {
    recordFailure(userKey);
    recordFailure(ipKey);
    return { error: 'Nama pengguna atau kata sandi salah.' };
  }

  // Only reached with the right password, so it reveals nothing to a guesser.
  if (row.mustChange && row.tempExpiresAt && row.tempExpiresAt < Date.now() / 1000) {
    return { error: 'Kata sandi sementara sudah kedaluwarsa. Minta admin membuat yang baru.' };
  }

  failures.delete(userKey);
  const { token, expiresAt } = createSession(row.id);
  await setSessionCookie(token, expiresAt);
  markSignedIn(row.id);

  if (row.mustChange) redirect('/akun');
  const home = ROLE_HOME[row.role as keyof typeof ROLE_HOME] ?? '/';
  redirect(next ?? home);
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  await clearSessionCookie();
  redirect('/masuk');
}

export async function changePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const me = await currentUser();
  if (!me) redirect('/masuk');

  const current = String(formData.get('sandiLama') ?? '');
  const next = String(formData.get('sandiBaru') ?? '');
  const confirm = String(formData.get('sandiUlang') ?? '');

  const stored = sqlite
    .prepare('SELECT password_hash AS passwordHash FROM users WHERE id = ?')
    .get(me.id) as { passwordHash: string | null } | undefined;

  if (!(await verifyPasswordAsync(current, stored?.passwordHash))) {
    return { error: 'Kata sandi lama salah.' };
  }
  const problem = passwordProblem(next, me.username);
  if (problem) return { error: problem };
  if (next !== confirm) return { error: 'Kata sandi baru tidak sama dengan ulangannya.' };
  if (next === current) return { error: 'Kata sandi baru harus berbeda dari yang lama.' };

  db.update(users)
    .set({
      passwordHash: await hashPasswordAsync(next),
      mustChangePassword: false,
      tempPasswordExpiresAt: null,
    })
    .where(eq(users.id, me.id))
    .run();

  // Every other device holding a session for this account is signed out, then
  // this one gets a fresh session so the change does not log the user out.
  destroyAllSessions(me.id);
  const { token, expiresAt } = createSession(me.id);
  await setSessionCookie(token, expiresAt);

  redirect(`${ROLE_HOME[me.role]}?sandi=ok`);
}
