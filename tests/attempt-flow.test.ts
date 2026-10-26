import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The attempt lifecycle end to end, through the real Server Actions and the
 * real grading module, against a throwaway database file.
 *
 * The session layer is replaced by a stub, since there is no request here: the
 * point is what each action does once it knows who is calling, which is where
 * the authorization and input checks live.
 */

// Hoisted above the imports, so the database path is set before the client
// module reads it. Static imports are not available yet in here.
const state = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'tka-flow-'));
  process.env.TKA_DB_PATH = join(dir, 'test.db');
  return {
    dir,
    user: null as null | { id: number; nama: string; role: 'admin' | 'parent' | 'student'; mustChangePassword: boolean; username: string | null; avatarWarna: string },
  };
});

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock('@/lib/auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...real,
    currentUser: async () => state.user,
    actionUser: async () => (state.user && !state.user.mustChangePassword ? state.user : null),
  };
});

import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { sqlite } from '@/db/client';
import { createAssignment } from '@/actions/assignment';
import { resetAttempt, saveAnswer, setFlagged, startAttempt, submitAttempt } from '@/actions/attempt';
import { reportQuestion } from '@/actions/report';
import { setRankingEnabled, setRankingHidden } from '@/actions/ranking';
import { isRankingEnabled } from '@/domain/settings';
import { closeExpiredFor, gradeAndClose } from '@/lib/grading';
import { csvCell } from '@/lib/csv';
import { parseResponse } from '@/domain/question';
import { SAVE_GRACE_SECONDS } from '@/domain/timing';

let ids: { admin: number; ayah: number; dina: number; bayu: number };

function addUser(nama: string, role: 'admin' | 'parent' | 'student'): number {
  return Number(
    sqlite
      .prepare('INSERT INTO users (nama, role, username, must_change_password) VALUES (?, ?, ?, 0)')
      .run(nama, role, nama.toLowerCase()).lastInsertRowid,
  );
}

function as(id: number, role: 'admin' | 'parent' | 'student', mustChangePassword = false) {
  state.user = { id, nama: 'x', role, mustChangePassword, username: null, avatarWarna: 'biru' };
}

function addQuestion(id: string, correct = 'a') {
  sqlite
    .prepare(
      `INSERT INTO questions
         (id, subject, content_domain, competency, difficulty, type, stem_md,
          options_json, answer_json, explanation_md, fingerprint, batch)
       VALUES (?, 'matematika', 'bilangan', 'penalaran', 'sedang', 'pg', ?, ?, ?, 'p', ?, 'uji')`,
    )
    .run(
      id,
      `Soal ${id}`,
      JSON.stringify({ kind: 'choices', choices: ['a', 'b', 'c'].map((c) => ({ id: c, text: c })) }),
      JSON.stringify({ kind: 'single', correct }),
      id,
    );
}

async function newAttempt(userId = ids.dina, count = 3, extra: Record<string, unknown> = {}) {
  as(ids.admin, 'admin');
  const result = await createAssignment({
    judul: 'Uji',
    sections: [{ subject: 'matematika', jumlahSoal: count }],
    userIds: [userId],
    timingMode: 'proporsional',
    allowRepeat: false,
    ...extra,
  });
  if (!result.ok) throw new Error(result.error);
  const row = sqlite
    .prepare('SELECT id, question_order_json AS o FROM attempts WHERE assignment_id = ? AND user_id = ?')
    .get(result.assignmentId, userId) as { id: number; o: string };
  return { attemptId: row.id, order: JSON.parse(row.o) as string[] };
}

beforeAll(() => {
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve('src/db/migrations') });
  ids = {
    admin: addUser('Admin', 'admin'),
    ayah: addUser('Ayah', 'parent'),
    dina: addUser('Dina', 'student'),
    bayu: addUser('Bayu', 'student'),
  };
  sqlite.prepare('INSERT INTO parent_children (parent_id, student_id) VALUES (?, ?)').run(ids.ayah, ids.dina);
});

beforeEach(() => {
  // A fresh bank every test, so draws never run dry.
  const n = (sqlite.prepare('SELECT COUNT(*) AS n FROM questions').get() as { n: number }).n;
  for (let i = 0; i < 6; i++) addQuestion(`q-${n + i}`);
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(state.dir, { recursive: true, force: true });
});

describe('createAssignment input and scope', () => {
  it('refuses a parent naming a child that is not theirs', async () => {
    as(ids.ayah, 'parent');
    const result = await createAssignment({
      judul: 'x',
      sections: [{ subject: 'matematika', jumlahSoal: 1 }],
      userIds: [ids.bayu],
      timingMode: 'proporsional',
      allowRepeat: false,
    });
    expect(result.ok).toBe(false);
  });

  it.each([
    ['a string count', { jumlahSoal: '5' }],
    ['an unknown subject', { subject: 'kimia' }],
    ['a fractional count', { jumlahSoal: 1.5 }],
  ])('rejects %s', async (_label, patch) => {
    as(ids.admin, 'admin');
    const result = await createAssignment({
      judul: 'x',
      sections: [{ subject: 'matematika', jumlahSoal: 1, ...patch }],
      userIds: [ids.dina],
      timingMode: 'proporsional',
      allowRepeat: false,
    });
    expect(result).toEqual({ ok: false, error: 'Data penugasan tidak valid.' });
  });

  it('rejects a non-string title without throwing', async () => {
    as(ids.admin, 'admin');
    await expect(createAssignment({ judul: 42 })).resolves.toMatchObject({ ok: false });
  });

  it('treats an unusable custom time limit as an error, not as untimed', async () => {
    as(ids.admin, 'admin');
    const result = await createAssignment({
      judul: 'x',
      sections: [{ subject: 'matematika', jumlahSoal: 1 }],
      userIds: [ids.dina],
      timingMode: 'custom',
      customMinutes: 0,
      allowRepeat: false,
    });
    expect(result.ok).toBe(false);
  });

  it('ignores a manual question list smuggled into the payload', async () => {
    as(ids.admin, 'admin');
    const result = await createAssignment({
      judul: 'x',
      sections: [{ subject: 'matematika', jumlahSoal: 1, manualQuestionIds: ['tidak-ada'] }],
      userIds: [ids.dina],
      timingMode: 'proporsional',
      allowRepeat: false,
      selectionMode: 'manual',
    });
    // Unknown keys are stripped by the schema, so this is a normal random draw.
    expect(result.ok).toBe(true);
  });

  it('refuses an account still on its one-time password', async () => {
    as(ids.admin, 'admin', true);
    const result = await createAssignment({
      judul: 'x',
      sections: [{ subject: 'matematika', jumlahSoal: 1 }],
      userIds: [ids.dina],
      timingMode: 'proporsional',
      allowRepeat: false,
    });
    expect(result.ok).toBe(false);
  });
});

describe('working on an attempt', () => {
  it('freezes the answer key so a later bank edit does not regrade it', async () => {
    const { attemptId, order } = await newAttempt();
    as(ids.dina, 'student');
    await startAttempt(attemptId);
    await saveAnswer(attemptId, order[0], { kind: 'single', choice: 'a' });

    // The bank's key changes after the draw.
    sqlite.prepare(`UPDATE questions SET answer_json = ? WHERE id = ?`).run(
      JSON.stringify({ kind: 'single', correct: 'b' }),
      order[0],
    );

    expect(await submitAttempt(attemptId)).toEqual({ ok: true });
    const row = sqlite.prepare('SELECT score_points AS p FROM attempts WHERE id = ?').get(attemptId) as { p: number };
    expect(row.p).toBe(1);
  });

  it('only lets the owning student answer', async () => {
    const { attemptId, order } = await newAttempt();
    as(ids.dina, 'student');
    await startAttempt(attemptId);

    as(ids.bayu, 'student');
    expect((await saveAnswer(attemptId, order[0], { kind: 'single', choice: 'a' })).ok).toBe(false);
    as(ids.ayah, 'parent');
    expect((await saveAnswer(attemptId, order[0], { kind: 'single', choice: 'a' })).ok).toBe(false);
  });

  it.each([
    ['wrong shape', { kind: 'multi', choices: 5 }],
    ['missing picks', { kind: 'kategori' }],
    ['unknown kind', { kind: 'essay', text: 'x' }],
    ['oversized id', { kind: 'single', choice: 'x'.repeat(5000) }],
  ])('rejects a malformed response (%s)', async (_label, response) => {
    const { attemptId, order } = await newAttempt();
    as(ids.dina, 'student');
    await startAttempt(attemptId);
    expect(await saveAnswer(attemptId, order[0], response)).toEqual({ ok: false, error: 'Data tidak valid.' });
  });

  it('keeps only own question ids in the flag list', async () => {
    const { attemptId, order } = await newAttempt();
    as(ids.dina, 'student');
    await startAttempt(attemptId);
    await setFlagged(attemptId, [order[1], 'bukan-milik', order[1]]);
    const row = sqlite.prepare('SELECT flagged_json AS f FROM attempts WHERE id = ?').get(attemptId) as { f: string };
    expect(JSON.parse(row.f)).toEqual([order[1]]);
  });

  it('refuses a time-up submit that arrives well before the deadline', async () => {
    const { attemptId } = await newAttempt();
    as(ids.dina, 'student');
    await startAttempt(attemptId);

    const result = await submitAttempt(attemptId, { timeUp: true });
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('remainingSeconds');
    const row = sqlite.prepare('SELECT status FROM attempts WHERE id = ?').get(attemptId) as { status: string };
    expect(row.status).toBe('berjalan');
  });

  it('accepts a save inside the grace window, and refuses one after it', async () => {
    const { attemptId, order } = await newAttempt();
    as(ids.dina, 'student');
    await startAttempt(attemptId);
    const now = Math.floor(Date.now() / 1000);

    sqlite.prepare('UPDATE attempts SET deadline_at = ? WHERE id = ?').run(now - 2, attemptId);
    expect((await saveAnswer(attemptId, order[0], { kind: 'single', choice: 'a' })).ok).toBe(true);

    sqlite.prepare('UPDATE attempts SET deadline_at = ? WHERE id = ?').run(now - SAVE_GRACE_SECONDS - 5, attemptId);
    expect((await saveAnswer(attemptId, order[1], { kind: 'single', choice: 'a' })).ok).toBe(false);
  });
});

describe('grading', () => {
  it('survives a malformed stored response instead of bricking the attempt', async () => {
    const { attemptId, order } = await newAttempt();
    as(ids.dina, 'student');
    await startAttempt(attemptId);
    // Written straight to the table, as an older build or a bug could have.
    sqlite
      .prepare('INSERT INTO attempt_answers (attempt_id, question_id, response_json) VALUES (?, ?, ?)')
      .run(attemptId, order[0], JSON.stringify({ kind: 'multi', choices: 5 }));

    expect(() => gradeAndClose(attemptId)).not.toThrow();
    const row = sqlite.prepare('SELECT status, score_points AS p FROM attempts WHERE id = ?').get(attemptId) as {
      status: string;
      p: number;
    };
    expect(row).toEqual({ status: 'selesai', p: 0 });
  });

  it('closes expired attempts for supervisors, timed at the deadline', async () => {
    const { attemptId } = await newAttempt();
    as(ids.dina, 'student');
    await startAttempt(attemptId);
    const hourAgo = Math.floor(Date.now() / 1000) - 3600;
    sqlite
      .prepare('UPDATE attempts SET started_at = ?, deadline_at = ? WHERE id = ?')
      .run(hourAgo - 600, hourAgo, attemptId);

    expect(closeExpiredFor([ids.dina])).toBeGreaterThanOrEqual(1);
    const row = sqlite
      .prepare('SELECT status, submitted_at AS s, elapsed_seconds AS e FROM attempts WHERE id = ?')
      .get(attemptId) as { status: string; s: number; e: number };
    expect(row.status).toBe('selesai');
    expect(row.s).toBe(hourAgo);
    expect(row.e).toBe(600);
  });
});

describe('retakes', () => {
  it('archives the finished score before wiping the attempt', async () => {
    const { attemptId, order } = await newAttempt();
    as(ids.dina, 'student');
    await startAttempt(attemptId);
    await saveAnswer(attemptId, order[0], { kind: 'single', choice: 'a' });
    await submitAttempt(attemptId);

    as(ids.dina, 'student');
    expect((await resetAttempt(attemptId)).ok).toBe(false); // students may not reset

    as(ids.ayah, 'parent');
    expect(await resetAttempt(attemptId)).toEqual({ ok: true });

    const runs = sqlite
      .prepare('SELECT run_no AS n, score_points AS p FROM attempt_runs WHERE attempt_id = ?')
      .all(attemptId);
    expect(runs).toEqual([{ n: 1, p: 1 }]);
    const row = sqlite.prepare('SELECT status FROM attempts WHERE id = ?').get(attemptId) as { status: string };
    expect(row.status).toBe('belum_mulai');
  });
});

describe('question reports', () => {
  it('accepts a report about an item the reporter was shown, and nothing else', async () => {
    const { attemptId, order } = await newAttempt();
    as(ids.dina, 'student');
    expect(await reportQuestion(attemptId, order[0], 'Kuncinya salah')).toEqual({ ok: true });
    expect((await reportQuestion(attemptId, 'q-lain', 'Kuncinya salah')).ok).toBe(false);

    as(ids.bayu, 'student');
    expect((await reportQuestion(attemptId, order[0], 'Kuncinya salah')).ok).toBe(false);
  });
});

describe('small parsers', () => {
  it('neutralises spreadsheet formulas in CSV cells', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+62 812')).toBe(`'+62 812`);
    expect(csvCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('baris\rbaru')).toBe('"baris\rbaru"');
    expect(csvCell('Latihan biasa')).toBe('Latihan biasa');
  });

  it('reads stored responses defensively', () => {
    expect(parseResponse('{"kind":"single","choice":"a"}')).toEqual({ kind: 'single', choice: 'a' });
    expect(parseResponse('null')).toBeNull();
    expect(parseResponse('{oops')).toBeNull();
    expect(parseResponse('{"kind":"multi","choices":5}')).toBeNull();
  });
});


describe('ranking controls', () => {
  const form = (fields: Record<string, string | number>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, String(value));
    return data;
  };
  const hiddenOf = (id: number) =>
    (sqlite.prepare('SELECT ranking_hidden AS h FROM users WHERE id = ?').get(id) as { h: number }).h;

  it('lets only an admin switch the board or hide a student', async () => {
    as(ids.ayah, 'parent');
    expect((await setRankingEnabled(form({ enabled: '0' }))).ok).toBe(false);
    expect((await setRankingHidden(form({ id: ids.dina, hidden: '1' }))).ok).toBe(false);
    as(ids.dina, 'student');
    expect((await setRankingHidden(form({ id: ids.dina, hidden: '1' }))).ok).toBe(false);
    expect(hiddenOf(ids.dina)).toBe(0);
    expect(isRankingEnabled(sqlite)).toBe(true);

    as(ids.admin, 'admin');
    expect(await setRankingEnabled(form({ enabled: '0' }))).toEqual({ ok: true });
    expect(isRankingEnabled(sqlite)).toBe(false);
    expect(await setRankingEnabled(form({ enabled: '1' }))).toEqual({ ok: true });
    expect(isRankingEnabled(sqlite)).toBe(true);

    expect(await setRankingHidden(form({ id: ids.dina, hidden: '1' }))).toEqual({ ok: true });
    expect(hiddenOf(ids.dina)).toBe(1);
    await setRankingHidden(form({ id: ids.dina, hidden: '0' }));
    expect(hiddenOf(ids.dina)).toBe(0);
  });

  it('refuses to hide a non-student or to take a malformed value', async () => {
    as(ids.admin, 'admin');
    expect((await setRankingHidden(form({ id: ids.ayah, hidden: '1' }))).ok).toBe(false);
    expect(hiddenOf(ids.ayah)).toBe(0);
    expect((await setRankingHidden(form({ id: 'x', hidden: '1' }))).ok).toBe(false);
    expect((await setRankingEnabled(form({ enabled: 'yes' }))).ok).toBe(false);
  });
});
