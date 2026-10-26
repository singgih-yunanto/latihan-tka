'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db, sqlite } from '@/db/client';
import { parentChildren, users } from '@/db/schema';
import { isRole, type Role } from '@/domain/access';
import { actionUser, destroyAllSessions, type SessionUser } from '@/lib/auth';
import {
  TEMP_PASSWORD_DAYS,
  generateTempPassword,
  hashPasswordAsync,
  tempPasswordExpiry,
  usernameFromName,
} from '@/lib/password';
import { AVATAR_COLORS } from '@/lib/ui';

/**
 * Account management. Admin only -- every account in the system is created
 * here, including the parents who go on to assign work to their own children.
 */

export type UserResult =
  | { ok: true; message?: string; credential?: { username: string; password: string } }
  | { ok: false; error: string };

async function requireAdmin(): Promise<SessionUser | null> {
  const me = await actionUser();
  return me && me.role === 'admin' ? me : null;
}

/** Shown once to the admin; the plain password is never stored. */
/** The answer to an action that issued a one-time password; the page shows it with copy buttons. */
function issued(prefix: string, username: string, password: string): UserResult {
  return {
    ok: true,
    message: `${prefix} Kata sandi sementara berlaku ${TEMP_PASSWORD_DAYS} hari dan wajib diganti saat pertama masuk. Catat sekarang: kata sandi ini tidak akan ditampilkan lagi.`,
    credential: { username, password },
  };
}

function refresh(): void {
  revalidatePath('/admin/users');
  revalidatePath('/admin');
  revalidatePath('/wali');
}

/** A login name that is free, derived from the full name when none is given. */
function resolveUsername(wanted: string, nama: string, exceptId?: number): string | null {
  const base = wanted.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '') || usernameFromName(nama);

  const taken = (candidate: string): boolean => {
    const row = sqlite
      .prepare('SELECT id FROM users WHERE lower(username) = ?')
      .get(candidate) as { id: number } | undefined;
    return Boolean(row && row.id !== exceptId);
  };

  if (!taken(base)) return base;
  if (wanted.trim()) return null; // An explicit choice that clashes is an error.

  for (let suffix = 2; suffix < 100; suffix += 1) {
    if (!taken(`${base}${suffix}`)) return `${base}${suffix}`;
  }
  return null;
}

export async function createUser(formData: FormData): Promise<UserResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Hanya admin yang boleh menambah akun.' };

  const nama = String(formData.get('nama') ?? '').trim();
  const roleRaw = String(formData.get('role') ?? 'student');
  if (!nama) return { ok: false, error: 'Nama belum diisi.' };
  if (!isRole(roleRaw)) return { ok: false, error: 'Peran tidak dikenal.' };

  const username = resolveUsername(String(formData.get('username') ?? ''), nama);
  if (!username) return { ok: false, error: 'Nama pengguna itu sudah dipakai.' };

  const jumlah = db.select({ n: sql<number>`COUNT(*)` }).from(users).get()?.n ?? 0;

  // Credentials are issued immediately, with a one-time password of its own
  // and the forced-change flag set, so a new account is usable straight away.
  const password = generateTempPassword();
  db.insert(users)
    .values({
      nama,
      role: roleRaw,
      username,
      passwordHash: await hashPasswordAsync(password),
      mustChangePassword: true,
      tempPasswordExpiresAt: tempPasswordExpiry(),
      avatarWarna: AVATAR_COLORS[Number(jumlah) % AVATAR_COLORS.length],
      createdBy: me.id,
    })
    .run();

  refresh();
  return issued('Akun dibuat.', username, password);
}

export async function updateUser(formData: FormData): Promise<UserResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Hanya admin yang boleh mengubah akun.' };

  const id = Number(formData.get('id'));
  const nama = String(formData.get('nama') ?? '').trim();
  const roleRaw = String(formData.get('role') ?? '');
  if (!Number.isInteger(id) || !nama) return { ok: false, error: 'Data tidak lengkap.' };

  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return { ok: false, error: 'Akun tidak ditemukan.' };

  const wantedUsername = String(formData.get('username') ?? '').trim();
  const username = wantedUsername ? resolveUsername(wantedUsername, nama, id) : target.username;
  if (!username) return { ok: false, error: 'Nama pengguna itu sudah dipakai.' };

  // An admin demoting themselves could leave the system with no admin at all.
  const role: Role = isRole(roleRaw) && id !== me.id ? roleRaw : (target.role as Role);

  db.update(users).set({ nama, username, role }).where(eq(users.id, id)).run();

  // A former student keeps their attempts but should no longer be treated as
  // somebody else's child, and a former parent should no longer hold links.
  if (role !== target.role) {
    if (role !== 'student') {
      db.delete(parentChildren).where(eq(parentChildren.studentId, id)).run();
    }
    if (role !== 'parent') {
      db.delete(parentChildren).where(eq(parentChildren.parentId, id)).run();
    }
  }

  refresh();
  return { ok: true };
}

export async function setUserActive(formData: FormData): Promise<UserResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Hanya admin yang boleh mengubah akun.' };

  const id = Number(formData.get('id'));
  const aktif = String(formData.get('aktif')) === '1';
  if (!Number.isInteger(id)) return { ok: false, error: 'Akun tidak ditemukan.' };
  if (id === me.id) return { ok: false, error: 'Kamu tidak bisa menonaktifkan akunmu sendiri.' };

  db.update(users).set({ aktif }).where(eq(users.id, id)).run();

  // Deactivating ends the session now rather than at its natural expiry.
  if (!aktif) destroyAllSessions(id);

  refresh();
  return { ok: true };
}

/**
 * Issues a fresh one-time password with the change flag set.
 *
 * For the "they forgot it" case. Existing sessions are ended, so a forgotten
 * password cannot be worked around by a device that is still signed in.
 */
export async function resetUserPassword(formData: FormData): Promise<UserResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Hanya admin yang boleh mengatur ulang kata sandi.' };

  const id = Number(formData.get('id'));
  if (!Number.isInteger(id)) return { ok: false, error: 'Akun tidak ditemukan.' };

  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return { ok: false, error: 'Akun tidak ditemukan.' };

  let username = target.username;
  if (!username) {
    username = resolveUsername('', target.nama, id);
    if (!username) return { ok: false, error: 'Tidak bisa menentukan nama pengguna.' };
  }

  const password = generateTempPassword();
  db.update(users)
    .set({
      username,
      passwordHash: await hashPasswordAsync(password),
      mustChangePassword: true,
      tempPasswordExpiresAt: tempPasswordExpiry(),
    })
    .where(eq(users.id, id))
    .run();

  destroyAllSessions(id);
  refresh();
  return issued('Kata sandi diatur ulang.', username, password);
}

export async function linkChild(formData: FormData): Promise<UserResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Hanya admin yang boleh menghubungkan akun.' };

  const parentId = Number(formData.get('parentId'));
  const studentId = Number(formData.get('studentId'));
  if (!Number.isInteger(parentId) || !Number.isInteger(studentId)) {
    return { ok: false, error: 'Pilih orang tua dan murid.' };
  }

  const parent = db.select().from(users).where(eq(users.id, parentId)).get();
  const student = db.select().from(users).where(eq(users.id, studentId)).get();
  if (parent?.role !== 'parent') return { ok: false, error: 'Akun itu bukan orang tua.' };
  if (student?.role !== 'student') return { ok: false, error: 'Akun itu bukan murid.' };

  // Re-linking an existing pair is a no-op rather than an error.
  sqlite
    .prepare(
      `INSERT INTO parent_children (parent_id, student_id, created_at)
       VALUES (?, ?, unixepoch())
       ON CONFLICT(parent_id, student_id) DO NOTHING`,
    )
    .run(parentId, studentId);

  refresh();
  return { ok: true };
}

export async function unlinkChild(formData: FormData): Promise<UserResult> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Hanya admin yang boleh memutus hubungan akun.' };

  const parentId = Number(formData.get('parentId'));
  const studentId = Number(formData.get('studentId'));
  if (!Number.isInteger(parentId) || !Number.isInteger(studentId)) {
    return { ok: false, error: 'Data tidak lengkap.' };
  }

  db.delete(parentChildren)
    .where(and(eq(parentChildren.parentId, parentId), eq(parentChildren.studentId, studentId)))
    .run();

  refresh();
  return { ok: true };
}
