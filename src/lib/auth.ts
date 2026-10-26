import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db, sqlite } from '@/db/client';
import { sessions, users } from '@/db/schema';
import { eq, lt } from 'drizzle-orm';
import { SESSION_COOKIE } from './session-cookie';
import { ROLE_HOME, isRole, visibleStudentIds, type Actor, type Role } from '@/domain/access';

/**
 * Sign-in sessions and the guards that protect pages and Server Actions.
 *
 * Server Actions are publicly callable HTTP endpoints, so protecting a page
 * does nothing for the actions it renders. Every action must call `actionUser`
 * (or `requireUser` from a page) and then an ownership assert of its own.
 */

export { SESSION_COOKIE };
const SESSION_DAYS = 30;
/** A session nobody has used for this long stops working, e.g. on a shared family tablet. */
const IDLE_DAYS = 7;
const LAST_SEEN_RESOLUTION_SECONDS = 60 * 60;

/** The cookie carries a random token; only its digest is stored. */
function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookieIsSecure(): boolean {
  return (process.env.APP_ORIGIN ?? '').startsWith('https://');
}

export function createSession(userId: number): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;

  db.insert(sessions)
    .values({ id: digest(token), userId, expiresAt, lastSeenAt: Math.floor(Date.now() / 1000) })
    .run();

  // Opportunistic cleanup; cheap on a table this small.
  db.delete(sessions).where(lt(sessions.expiresAt, Math.floor(Date.now() / 1000))).run();

  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: number): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieIsSecure(),
    path: '/',
    expires: new Date(expiresAt * 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export function destroySession(token: string): void {
  db.delete(sessions).where(eq(sessions.id, digest(token))).run();
}

/** Ends every session belonging to a user, e.g. after a password change. */
export function destroyAllSessions(userId: number): void {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export type SessionUser = Actor & {
  username: string | null;
  avatarWarna: string;
};

/**
 * Resolves the cookie to a user, or null.
 *
 * Returns null for an expired session, an unknown token, or a deactivated
 * account -- so deactivating someone takes effect on their very next request.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = sqlite
    .prepare(
      `SELECT u.id, u.nama, u.role, u.username, u.avatar_warna AS avatarWarna,
              u.must_change_password AS mustChange, s.expires_at AS expiresAt,
              s.last_seen_at AS lastSeenAt
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND u.aktif = 1`,
    )
    .get(digest(token)) as
    | {
        id: number;
        nama: string;
        role: string;
        username: string | null;
        avatarWarna: string;
        mustChange: number;
        expiresAt: number;
        lastSeenAt: number | null;
      }
    | undefined;

  if (!row) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (row.expiresAt <= nowSec) return null;
  const lastSeen = row.lastSeenAt ?? nowSec;
  if (nowSec - lastSeen > IDLE_DAYS * 24 * 60 * 60) return null;
  if (!isRole(row.role)) return null;

  // Coarse on purpose: one write an hour per session, not one per request.
  if (row.lastSeenAt === null || nowSec - row.lastSeenAt > LAST_SEEN_RESOLUTION_SECONDS) {
    sqlite.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowSec, digest(token));
  }

  return {
    id: row.id,
    nama: row.nama,
    role: row.role,
    username: row.username,
    avatarWarna: row.avatarWarna,
    mustChangePassword: Boolean(row.mustChange),
  };
}

/**
 * The authoritative gate for pages and actions.
 *
 * Redirects to sign-in when there is no session, to the account page while a
 * password change is outstanding, and to the actor's own home when the role is
 * wrong. `redirect` throws, so callers can treat the return value as present.
 */
export async function requireUser(roles?: Role | Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/masuk');

  if (user.mustChangePassword) redirect('/akun');

  if (roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    if (!allowed.includes(user.role)) redirect(ROLE_HOME[user.role]);
  }
  return user;
}

/**
 * The gate for Server Actions: the signed-in user, or null.
 *
 * Unlike `requireUser` it never redirects, so an action can answer with an
 * error object. An account still on an admin-issued password counts as signed
 * out here -- until it picks its own password it may do nothing but change it.
 */
export async function actionUser(): Promise<SessionUser | null> {
  const user = await currentUser();
  if (!user || user.mustChangePassword) return null;
  return user;
}

/** Like requireUser but tolerated while the password change is outstanding. */
export async function requireUserAllowingPasswordChange(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/masuk');
  return user;
}

export function studentsVisibleTo(user: SessionUser): number[] {
  return visibleStudentIds(sqlite, user);
}

/** Records a successful sign-in. */
export function markSignedIn(userId: number): void {
  db.update(users)
    .set({ lastLoginAt: Math.floor(Date.now() / 1000) })
    .where(eq(users.id, userId))
    .run();
}
