import { describe, expect, it } from 'vitest';
import {
  assignableStudentIds,
  canAccessAttempt,
  canAccessStudent,
  canManageAssignment,
  canWorkOnAttempt,
  isRole,
  parentsOfStudent,
  visibleStudentIds,
  type Actor,
} from '../src/domain/access';
import {
  MIN_PASSWORD_LENGTH,
  generateTempPassword,
  hashPassword,
  hashPasswordAsync,
  passwordProblem,
  usernameFromName,
  verifyPassword,
  verifyPasswordAsync,
} from '../src/lib/password';
import { safeNextPath } from '../src/lib/redirect';
import { backfillCredentials } from '../src/db/backfill';
import { addUser, linkParent, makeTestDb } from './helpers/testDb';
import type Database from 'better-sqlite3';

/**
 * The authorization rules, exercised against a real schema.
 *
 * These are the tests that matter most in the whole suite: a mistake here does
 * not break a feature, it quietly shows one family another family's data.
 */

function actor(id: number, role: Actor['role'], nama = 'X'): Actor {
  return { id, nama, role, mustChangePassword: false };
}

function addAttempt(sqlite: Database.Database, userId: number, assignmentId = 1): number {
  const info = sqlite
    .prepare(
      `INSERT INTO attempts (assignment_id, user_id, status, question_order_json, option_orders_json)
       VALUES (?, ?, 'belum_mulai', '[]', '{}')`,
    )
    .run(assignmentId, userId);
  return Number(info.lastInsertRowid);
}

function addAssignment(sqlite: Database.Database, createdBy: number | null): number {
  const info = sqlite
    .prepare(
      `INSERT INTO assignments (judul, selection_mode, timing_mode, allow_repeat, created_by)
       VALUES ('Tugas', 'random', 'proporsional', 0, ?)`,
    )
    .run(createdBy);
  return Number(info.lastInsertRowid);
}

/** Two parents, two children, one link each -- the shape that must not leak. */
function twoFamilies(sqlite: Database.Database) {
  const ayahA = addUser(sqlite, 'Ayah A', 'parent');
  const ayahB = addUser(sqlite, 'Ayah B', 'parent');
  const anakA = addUser(sqlite, 'Anak A', 'student');
  const anakB = addUser(sqlite, 'Anak B', 'student');
  linkParent(sqlite, ayahA, anakA);
  linkParent(sqlite, ayahB, anakB);
  return { ayahA, ayahB, anakA, anakB };
}

describe('password hashing', () => {
  it('accepts the right password and rejects a wrong one', () => {
    const stored = hashPassword('rahasia123');
    expect(verifyPassword('rahasia123', stored)).toBe(true);
    expect(verifyPassword('rahasia124', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('salts every hash, so the same password stores differently twice', () => {
    const a = hashPassword('samapersis');
    const b = hashPassword('samapersis');
    expect(a).not.toBe(b);
    expect(verifyPassword('samapersis', a)).toBe(true);
    expect(verifyPassword('samapersis', b)).toBe(true);
  });

  it('never verifies against a missing or malformed hash', () => {
    // This is what keeps an account with no credentials issued closed rather
    // than open to anyone who submits an empty password.
    expect(verifyPassword('apa pun', null)).toBe(false);
    expect(verifyPassword('apa pun', undefined)).toBe(false);
    expect(verifyPassword('apa pun', '')).toBe(false);
    expect(verifyPassword('apa pun', 'bukan-hash')).toBe(false);
    expect(verifyPassword('apa pun', 'scrypt$x$y$z$aa$bb')).toBe(false);
  });

  it('normalises unicode so the same typed password matches', () => {
    // "é" composed vs decomposed: the same key press on different keyboards.
    const stored = hashPassword('cafésandi');
    expect(verifyPassword('cafésandi', stored)).toBe(true);
  });

  it('rejects passwords that are too short, trivial, or the username', () => {
    expect(passwordProblem('kucing7')).toBeNull();
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH - 1))).not.toBeNull();
    expect(passwordProblem('a'.repeat(MIN_PASSWORD_LENGTH))).not.toBeNull();
    expect(passwordProblem('123456')).not.toBeNull();
    expect(passwordProblem('dinadina', 'dinadina')).not.toBeNull();
    expect(passwordProblem('dinadina', 'bayu')).toBeNull();
  });

  it('issues distinct, unambiguous one-time passwords', () => {
    const issued = new Set(Array.from({ length: 200 }, () => generateTempPassword()));
    expect(issued.size).toBe(200);
    for (const password of issued) {
      expect(password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
      expect(password).not.toMatch(/[01ilo]/);
    }
  });

  it('async hashing interoperates with the sync verifier, and the reverse', async () => {
    const asyncHash = await hashPasswordAsync('rahasia123');
    expect(verifyPassword('rahasia123', asyncHash)).toBe(true);
    expect(await verifyPasswordAsync('rahasia123', hashPassword('rahasia123'))).toBe(true);
    expect(await verifyPasswordAsync('salah', asyncHash)).toBe(false);
  });

  it('never accepts a missing hash, even though it does the scrypt work', async () => {
    expect(await verifyPasswordAsync('apa pun', null)).toBe(false);
    expect(await verifyPasswordAsync('apa pun', undefined)).toBe(false);
    expect(await verifyPasswordAsync('', 'bukan-hash')).toBe(false);
  });

  it('derives a login name from a full name', () => {
    expect(usernameFromName('Dina Maharani')).toBe('dina');
    expect(usernameFromName('  BAYU  Pratama ')).toBe('bayu');
    expect(usernameFromName('!!!')).toBe('murid');
  });
});

describe('visibleStudentIds', () => {
  it('gives an admin every student and nobody else', () => {
    const sqlite = makeTestDb();
    const { anakA, anakB } = twoFamilies(sqlite);
    const admin = addUser(sqlite, 'Admin', 'admin');

    const seen = visibleStudentIds(sqlite, actor(admin, 'admin'));
    expect(seen.sort()).toEqual([anakA, anakB].sort());
  });

  it('gives a parent only their own children', () => {
    const sqlite = makeTestDb();
    const { ayahA, anakA, anakB } = twoFamilies(sqlite);

    const seen = visibleStudentIds(sqlite, actor(ayahA, 'parent'));
    expect(seen).toEqual([anakA]);
    expect(seen).not.toContain(anakB);
  });

  it('gives a parent both children when two are linked', () => {
    const sqlite = makeTestDb();
    const ayah = addUser(sqlite, 'Ayah', 'parent');
    const satu = addUser(sqlite, 'Anak Satu', 'student');
    const dua = addUser(sqlite, 'Anak Dua', 'student');
    linkParent(sqlite, ayah, satu);
    linkParent(sqlite, ayah, dua);

    expect(visibleStudentIds(sqlite, actor(ayah, 'parent')).sort()).toEqual([satu, dua].sort());
  });

  it('lets both parents of one child see that child', () => {
    const sqlite = makeTestDb();
    const ayah = addUser(sqlite, 'Ayah', 'parent');
    const ibu = addUser(sqlite, 'Ibu', 'parent');
    const anak = addUser(sqlite, 'Anak', 'student');
    linkParent(sqlite, ayah, anak);
    linkParent(sqlite, ibu, anak);

    expect(visibleStudentIds(sqlite, actor(ayah, 'parent'))).toEqual([anak]);
    expect(visibleStudentIds(sqlite, actor(ibu, 'parent'))).toEqual([anak]);
    expect(parentsOfStudent(sqlite, anak).map((p) => p.id).sort()).toEqual([ayah, ibu].sort());
  });

  it('gives a student only themselves', () => {
    const sqlite = makeTestDb();
    const { anakA, anakB } = twoFamilies(sqlite);

    expect(visibleStudentIds(sqlite, actor(anakA, 'student'))).toEqual([anakA]);
    expect(canAccessStudent(sqlite, actor(anakA, 'student'), anakB)).toBe(false);
  });
});

describe('attempt access', () => {
  it('refuses a parent reaching an unlinked child, by id', () => {
    const sqlite = makeTestDb();
    const { ayahA, anakB } = twoFamilies(sqlite);
    addAssignment(sqlite, null);
    const attemptB = addAttempt(sqlite, anakB);

    // Guessing the id must be refused outright, not merely left out of a list.
    expect(canAccessAttempt(sqlite, actor(ayahA, 'parent'), attemptB)).toBe(false);
  });

  it('allows a parent to read their own child', () => {
    const sqlite = makeTestDb();
    const { ayahA, anakA } = twoFamilies(sqlite);
    addAssignment(sqlite, null);
    const attemptA = addAttempt(sqlite, anakA);

    expect(canAccessAttempt(sqlite, actor(ayahA, 'parent'), attemptA)).toBe(true);
  });

  it('refuses a student reaching another student', () => {
    const sqlite = makeTestDb();
    const { anakA, anakB } = twoFamilies(sqlite);
    addAssignment(sqlite, null);
    const attemptB = addAttempt(sqlite, anakB);

    expect(canAccessAttempt(sqlite, actor(anakA, 'student'), attemptB)).toBe(false);
  });

  it('treats an attempt that does not exist as inaccessible to everyone', () => {
    const sqlite = makeTestDb();
    const admin = addUser(sqlite, 'Admin', 'admin');
    expect(canAccessAttempt(sqlite, actor(admin, 'admin'), 999)).toBe(false);
  });

  it('lets only the owning student work on an attempt', () => {
    const sqlite = makeTestDb();
    const { ayahA, anakA } = twoFamilies(sqlite);
    const admin = addUser(sqlite, 'Admin', 'admin');
    addAssignment(sqlite, null);
    const attemptA = addAttempt(sqlite, anakA);

    expect(canWorkOnAttempt(sqlite, actor(anakA, 'student'), attemptA)).toBe(true);
    // An observer may read the work but must never be able to answer for them.
    expect(canWorkOnAttempt(sqlite, actor(ayahA, 'parent'), attemptA)).toBe(false);
    expect(canWorkOnAttempt(sqlite, actor(admin, 'admin'), attemptA)).toBe(false);
  });
});

describe('assignment management', () => {
  it('lets an admin manage any assignment', () => {
    const sqlite = makeTestDb();
    const { ayahA } = twoFamilies(sqlite);
    const admin = addUser(sqlite, 'Admin', 'admin');
    const milikAyah = addAssignment(sqlite, ayahA);

    expect(canManageAssignment(sqlite, actor(admin, 'admin'), milikAyah)).toBe(true);
  });

  it('lets a parent manage only what they created', () => {
    const sqlite = makeTestDb();
    const { ayahA, ayahB } = twoFamilies(sqlite);
    const milikA = addAssignment(sqlite, ayahA);
    const milikB = addAssignment(sqlite, ayahB);

    expect(canManageAssignment(sqlite, actor(ayahA, 'parent'), milikA)).toBe(true);
    expect(canManageAssignment(sqlite, actor(ayahA, 'parent'), milikB)).toBe(false);
  });

  it('never lets a student manage an assignment', () => {
    const sqlite = makeTestDb();
    const { anakA } = twoFamilies(sqlite);
    const tugas = addAssignment(sqlite, null);

    expect(canManageAssignment(sqlite, actor(anakA, 'student'), tugas)).toBe(false);
  });

  it('refuses an assignment created before created_by existed, for a parent', () => {
    const sqlite = makeTestDb();
    const { ayahA } = twoFamilies(sqlite);
    const lama = addAssignment(sqlite, null);

    expect(canManageAssignment(sqlite, actor(ayahA, 'parent'), lama)).toBe(false);
  });
});

describe('role parsing', () => {
  it('accepts the three known roles and nothing else', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('parent')).toBe(true);
    expect(isRole('student')).toBe(true);
    expect(isRole('superuser')).toBe(false);
    expect(isRole('')).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});

describe('credential backfill', () => {
  /** A user row as it looked before the authentication system existed. */
  function addLegacyUser(sqlite: Database.Database, nama: string): number {
    const info = sqlite.prepare('INSERT INTO users (nama) VALUES (?)').run(nama);
    return Number(info.lastInsertRowid);
  }

  function credentialsOf(sqlite: Database.Database, id: number) {
    return sqlite
      .prepare(
        `SELECT username, password_hash AS hash, must_change_password AS mustChange, role
           FROM users WHERE id = ?`,
      )
      .get(id) as { username: string; hash: string; mustChange: number; role: string };
  }

  it('issues a derived username and a one-time password of its own', () => {
    const sqlite = makeTestDb();
    const dina = addLegacyUser(sqlite, 'Dina Maharani');
    const bayu = addLegacyUser(sqlite, 'Bayu Pratama');

    const created = backfillCredentials(sqlite);
    expect(created.map(({ nama, username }) => ({ nama, username }))).toEqual([
      { nama: 'Dina Maharani', username: 'dina' },
      { nama: 'Bayu Pratama', username: 'bayu' },
    ]);
    // No shared default: each account's password is different.
    expect(created[0].password).not.toBe(created[1].password);

    const row = credentialsOf(sqlite, dina);
    expect(row.username).toBe('dina');
    expect(row.role).toBe('student');
    expect(row.mustChange).toBe(1);
    expect(verifyPassword(created[0].password, row.hash)).toBe(true);
    expect(verifyPassword(created[1].password, row.hash)).toBe(false);
    expect(verifyPassword(created[1].password, credentialsOf(sqlite, bayu).hash)).toBe(true);

    const expiry = sqlite
      .prepare('SELECT temp_password_expires_at AS t FROM users WHERE id = ?')
      .get(dina) as { t: number };
    expect(expiry.t).toBeGreaterThan(Date.now() / 1000);
  });

  it('derives distinct usernames for two students sharing a first name', () => {
    const sqlite = makeTestDb();
    const satu = addLegacyUser(sqlite, 'Dina Maharani');
    const dua = addLegacyUser(sqlite, 'Dina Kusuma');

    backfillCredentials(sqlite);

    expect(credentialsOf(sqlite, satu).username).toBe('dina');
    expect(credentialsOf(sqlite, dua).username).toBe('dina2');
  });

  it('does not collide with a username that already exists', () => {
    const sqlite = makeTestDb();
    addUser(sqlite, 'Dina', 'parent'); // already holds the username "dina"
    const anak = addLegacyUser(sqlite, 'Dina Maharani');

    backfillCredentials(sqlite);
    expect(credentialsOf(sqlite, anak).username).toBe('dina2');
  });

  it('is idempotent: a second run leaves a chosen password untouched', () => {
    const sqlite = makeTestDb();
    const dina = addLegacyUser(sqlite, 'Dina Maharani');
    const [first] = backfillCredentials(sqlite);

    // The student signs in and picks their own password.
    sqlite
      .prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(hashPassword('sandibaru'), dina);

    const again = backfillCredentials(sqlite);
    expect(again).toEqual([]);

    const row = credentialsOf(sqlite, dina);
    expect(row.mustChange).toBe(0);
    expect(verifyPassword('sandibaru', row.hash)).toBe(true);
    expect(verifyPassword(first.password, row.hash)).toBe(false);
  });

  it('leaves an account with credentials alone entirely', () => {
    const sqlite = makeTestDb();
    const admin = addUser(sqlite, 'Admin', 'admin');
    sqlite
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(hashPassword('sandiadmin'), admin);

    expect(backfillCredentials(sqlite)).toEqual([]);
    expect(credentialsOf(sqlite, admin).role).toBe('admin');
  });
});

describe('assignableStudentIds', () => {
  it('leaves deactivated students out of new work but keeps them readable', () => {
    const sqlite = makeTestDb();
    const { ayahA, anakA } = twoFamilies(sqlite);
    sqlite.prepare('UPDATE users SET aktif = 0 WHERE id = ?').run(anakA);

    const parent = actor(ayahA, 'parent');
    expect(visibleStudentIds(sqlite, parent)).toEqual([anakA]);
    expect(assignableStudentIds(sqlite, parent)).toEqual([]);
  });

  it('gives a student nobody to assign to', () => {
    const sqlite = makeTestDb();
    const { anakA } = twoFamilies(sqlite);
    expect(assignableStudentIds(sqlite, actor(anakA, 'student'))).toEqual([]);
  });
});

describe('safeNextPath', () => {
  it('keeps an ordinary same-site path', () => {
    expect(safeNextPath('/wali/hasil?murid=3')).toBe('/wali/hasil?murid=3');
  });

  it.each([
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/ok\nSet-Cookie: x=1',
    '',
    42,
  ])('refuses %j', (value) => {
    expect(safeNextPath(value)).toBeNull();
  });
});
