import type { Database } from 'better-sqlite3';

/**
 * Who may see whose data.
 *
 * Written as direct SQL against better-sqlite3, like src/domain/draw.ts, so the
 * rules can be exercised in tests against an in-memory database without any
 * Next.js request context.
 *
 * Every rule funnels through `visibleStudentIds`. Keeping one source of truth
 * matters more here than anywhere else in the codebase: if a page and an action
 * disagree about who a parent may see, the action wins and the page is a lie.
 */

export const ROLES = ['admin', 'parent', 'student'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  parent: 'Orang tua',
  student: 'Murid',
};

/** The home page each role lands on after signing in. */
export const ROLE_HOME: Record<Role, string> = {
  admin: '/admin',
  parent: '/wali',
  student: '/u',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export type Actor = {
  id: number;
  nama: string;
  role: Role;
  mustChangePassword: boolean;
};

/**
 * The student ids this actor may read.
 *
 * Deactivated students are included: their past results stay readable.
 * Use `assignableStudentIds` when handing out new work.
 *
 * admin   -> every student
 * parent  -> only the children linked to them
 * student -> only themselves
 */
export function visibleStudentIds(sqlite: Database, actor: Actor): number[] {
  if (actor.role === 'student') return [actor.id];

  if (actor.role === 'admin') {
    const rows = sqlite
      .prepare("SELECT id FROM users WHERE role = 'student' ORDER BY nama")
      .all() as { id: number }[];
    return rows.map((r) => r.id);
  }

  const rows = sqlite
    .prepare(
      `SELECT u.id
         FROM parent_children pc
         JOIN users u ON u.id = pc.student_id
        WHERE pc.parent_id = ? AND u.role = 'student'
        ORDER BY u.nama`,
    )
    .all(actor.id) as { id: number }[];
  return rows.map((r) => r.id);
}

/** The students this actor may give new work to: visible and still active. */
export function assignableStudentIds(sqlite: Database, actor: Actor): number[] {
  if (actor.role === 'student') return [];
  const visible = visibleStudentIds(sqlite, actor);
  if (visible.length === 0) return [];
  const active = new Set(
    (
      sqlite
        .prepare(`SELECT id FROM users WHERE aktif = 1 AND id IN (${visible.map(() => '?').join(',')})`)
        .all(...visible) as { id: number }[]
    ).map((r) => r.id),
  );
  return visible.filter((id) => active.has(id));
}

export function canAccessStudent(sqlite: Database, actor: Actor, studentId: number): boolean {
  if (actor.role === 'admin') return true;
  if (actor.role === 'student') return actor.id === studentId;

  const row = sqlite
    .prepare('SELECT 1 AS ok FROM parent_children WHERE parent_id = ? AND student_id = ?')
    .get(actor.id, studentId) as { ok: number } | undefined;
  return Boolean(row);
}

/** The owner of an attempt, or null when the attempt does not exist. */
export function attemptOwner(sqlite: Database, attemptId: number): number | null {
  const row = sqlite.prepare('SELECT user_id FROM attempts WHERE id = ?').get(attemptId) as
    | { user_id: number }
    | undefined;
  return row ? row.user_id : null;
}

export function canAccessAttempt(sqlite: Database, actor: Actor, attemptId: number): boolean {
  const owner = attemptOwner(sqlite, attemptId);
  if (owner === null) return false;
  return canAccessStudent(sqlite, actor, owner);
}

/**
 * Only the student themselves may answer. An admin or parent looking at a
 * child's work must not be able to alter it.
 */
export function canWorkOnAttempt(sqlite: Database, actor: Actor, attemptId: number): boolean {
  if (actor.role !== 'student') return false;
  return attemptOwner(sqlite, attemptId) === actor.id;
}

/** Admins may touch any assignment; a parent only the ones they created. */
export function canManageAssignment(
  sqlite: Database,
  actor: Actor,
  assignmentId: number,
): boolean {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'parent') return false;

  const row = sqlite.prepare('SELECT created_by FROM assignments WHERE id = ?').get(assignmentId) as
    | { created_by: number | null }
    | undefined;
  return Boolean(row && row.created_by === actor.id);
}

/** The parents linked to a student, for display in the admin panel. */
export function parentsOfStudent(sqlite: Database, studentId: number): { id: number; nama: string }[] {
  return sqlite
    .prepare(
      `SELECT u.id, u.nama
         FROM parent_children pc
         JOIN users u ON u.id = pc.parent_id
        WHERE pc.student_id = ?
        ORDER BY u.nama`,
    )
    .all(studentId) as { id: number; nama: string }[];
}
