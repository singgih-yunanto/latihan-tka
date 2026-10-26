import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  NotEnoughQuestionsError,
  apportion,
  countAvailable,
  drawForUser,
  drawSection,
  recordHistory,
} from '../src/domain/draw';
import { addQuestion, addUser, makeTestDb, seedQuestions } from './helpers/testDb';

function setup(): { sqlite: Database.Database; userId: number } {
  const sqlite = makeTestDb();
  const userId = addUser(sqlite, 'Dina');
  return { sqlite, userId };
}

describe('no-repeat drawing', () => {
  it('never hands back an item the student has already received', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'matematika', 60);

    const first = drawForUser(sqlite, userId, [{ subject: 'matematika', count: 30 }]);
    recordHistory(sqlite, userId, first, null);
    expect(first).toHaveLength(30);

    const second = drawForUser(sqlite, userId, [{ subject: 'matematika', count: 30 }]);
    recordHistory(sqlite, userId, second, null);

    expect(second).toHaveLength(30);
    expect(second.filter((id) => first.includes(id))).toEqual([]);
    expect(new Set([...first, ...second]).size).toBe(60);
  });

  it('prevents duplicate items within a single attempt', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'ipas', 20);

    const drawn = drawForUser(sqlite, userId, [
      { subject: 'ipas', count: 5 },
      { subject: 'ipas', count: 5 },
    ]);

    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it('gives each student a different set on the same assignment', () => {
    const sqlite = makeTestDb();
    seedQuestions(sqlite, 'matematika', 90);
    const users = ['Adi', 'Bima', 'Citra'].map((nama) => addUser(sqlite, nama));

    const sets = users.map((userId) => {
      const drawn = drawForUser(sqlite, userId, [{ subject: 'matematika', count: 30 }]);
      recordHistory(sqlite, userId, drawn, null);
      return drawn;
    });

    for (const set of sets) expect(set).toHaveLength(30);
    // Each student draws from an independent pool, so the orders differ.
    expect(new Set(sets.map((s) => s.join(',')))).toHaveProperty('size', 3);
  });

  it('honours the per-subject counts on a multi-subject assignment', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'bahasa_indonesia', 30, 'bi');
    seedQuestions(sqlite, 'matematika', 30, 'mtk');
    seedQuestions(sqlite, 'ipas', 30, 'ipas');

    const drawn = drawForUser(sqlite, userId, [
      { subject: 'bahasa_indonesia', count: 10 },
      { subject: 'matematika', count: 15 },
      { subject: 'ipas', count: 5 },
    ]);

    expect(drawn).toHaveLength(30);
    expect(drawn.filter((id) => id.startsWith('bi-'))).toHaveLength(10);
    expect(drawn.filter((id) => id.startsWith('mtk-'))).toHaveLength(15);
    expect(drawn.filter((id) => id.startsWith('ipas-'))).toHaveLength(5);
    // Questions stay grouped by subject in section order, not interleaved.
    expect(drawn.slice(0, 10).every((id) => id.startsWith('bi-'))).toBe(true);
    expect(drawn.slice(10, 25).every((id) => id.startsWith('mtk-'))).toBe(true);
  });

  it('honours the strand filter', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'matematika', 10, 'bil');
    for (let i = 0; i < 10; i++) {
      sqlite
        .prepare('UPDATE questions SET content_domain = ? WHERE id = ?')
        .run('geometri_pengukuran', `bil-${String(i).padStart(3, '0')}`);
    }
    seedQuestions(sqlite, 'matematika', 10, 'lain');

    const drawn = drawSection(sqlite, userId, {
      subject: 'matematika',
      count: 5,
      filters: { domains: ['geometri_pengukuran'] },
    });

    expect(drawn).toHaveLength(5);
    expect(drawn.every((id) => id.startsWith('bil-'))).toBe(true);
  });
});

describe('running out of questions', () => {
  it('throws when there are not enough unseen questions', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'matematika', 10);

    expect(() => drawForUser(sqlite, userId, [{ subject: 'matematika', count: 20 }])).toThrow(
      NotEnoughQuestionsError,
    );
  });

  it('fills the gap from older items when allowRepeat is on', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'matematika', 10);

    const drawn = drawForUser(sqlite, userId, [{ subject: 'matematika', count: 10 }]);
    recordHistory(sqlite, userId, drawn, null);
    expect(countAvailable(sqlite, userId, 'matematika')).toBe(0);

    const repeated = drawForUser(sqlite, userId, [{ subject: 'matematika', count: 6 }], true);
    expect(repeated).toHaveLength(6);
    expect(new Set(repeated).size).toBe(6);
  });

  it('countAvailable shrinks as the student history grows', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'ipas', 25);

    expect(countAvailable(sqlite, userId, 'ipas')).toBe(25);
    const drawn = drawForUser(sqlite, userId, [{ subject: 'ipas', count: 10 }]);
    recordHistory(sqlite, userId, drawn, null);
    expect(countAvailable(sqlite, userId, 'ipas')).toBe(15);
  });

  it('one student history does not affect another student', () => {
    const sqlite = makeTestDb();
    const dina = addUser(sqlite, 'Dina');
    const eka = addUser(sqlite, 'Eka');
    seedQuestions(sqlite, 'matematika', 30);

    const drawn = drawForUser(sqlite, dina, [{ subject: 'matematika', count: 30 }]);
    recordHistory(sqlite, dina, drawn, null);

    expect(countAvailable(sqlite, dina, 'matematika')).toBe(0);
    expect(countAvailable(sqlite, eka, 'matematika')).toBe(30);
  });
});

describe('content fingerprints', () => {
  it('treats an item re-added under a new id as already seen', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'matematika', 5);

    const first = drawForUser(sqlite, userId, [{ subject: 'matematika', count: 5 }]);
    recordHistory(sqlite, userId, first, null);

    // The same question, copied into the bank under a fresh id.
    addQuestion(sqlite, { id: 'mtk-baru-001', subject: 'matematika' });
    sqlite
      .prepare('UPDATE questions SET fingerprint = (SELECT fingerprint FROM questions WHERE id = ?) WHERE id = ?')
      .run(first[0], 'mtk-baru-001');

    expect(countAvailable(sqlite, userId, 'matematika')).toBe(0);
    expect(() => drawForUser(sqlite, userId, [{ subject: 'matematika', count: 1 }])).toThrow(
      NotEnoughQuestionsError,
    );
  });
});

describe('retired items', () => {
  it('never draws an item an admin has withdrawn', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'ipas', 10);
    sqlite.prepare("UPDATE questions SET retired_by_admin = 1 WHERE id = 'ipas-000'").run();

    const drawn = drawForUser(sqlite, userId, [{ subject: 'ipas', count: 9 }]);
    expect(drawn).not.toContain('ipas-000');
    expect(countAvailable(sqlite, userId, 'ipas')).toBe(9);
  });
});

describe('the same subject in two sections', () => {
  it('returns every requested item with no duplicates', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'ipas', 10);

    const drawn = drawForUser(sqlite, userId, [
      { subject: 'ipas', count: 5 },
      { subject: 'ipas', count: 5 },
    ]);

    expect(drawn).toHaveLength(10);
    expect(new Set(drawn).size).toBe(10);
  });

  it('fails loudly rather than returning a short paper', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'ipas', 8);

    expect(() =>
      drawForUser(sqlite, userId, [
        { subject: 'ipas', count: 5 },
        { subject: 'ipas', count: 5 },
      ]),
    ).toThrow(NotEnoughQuestionsError);
  });
});

describe('blueprint-shaped draws', () => {
  it('splits a paper across strands like the blueprint targets', () => {
    const { sqlite, userId } = setup();
    // Plenty of every Matematika strand and difficulty.
    let n = 0;
    for (const domain of ['bilangan', 'geometri_pengukuran', 'data_peluang']) {
      for (const difficulty of ['mudah', 'sedang', 'sulit']) {
        for (let i = 0; i < 12; i++) {
          addQuestion(sqlite, { id: `m-${n++}`, subject: 'matematika', domain, difficulty });
        }
      }
    }

    const drawn = drawSection(sqlite, userId, { subject: 'matematika', count: 30, blueprint: true });
    expect(drawn).toHaveLength(30);

    const domainOf = sqlite.prepare('SELECT content_domain AS d, difficulty AS k FROM questions WHERE id = ?');
    const counts: Record<string, number> = {};
    const levels: Record<string, number> = {};
    for (const id of drawn) {
      const row = domainOf.get(id) as { d: string; k: string };
      counts[row.d] = (counts[row.d] ?? 0) + 1;
      levels[row.k] = (levels[row.k] ?? 0) + 1;
    }
    // Targets 48 : 42 : 30 of 120 -> 12 : 10.5 : 7.5 of 30.
    expect(counts.bilangan).toBe(12);
    expect(counts.geometri_pengukuran! + counts.data_peluang!).toBe(18);
    expect(Math.abs(counts.geometri_pengukuran! - 10.5)).toBeLessThanOrEqual(0.5);
    // 30 / 50 / 20 percent within each strand, give or take rounding.
    expect(levels.sedang).toBeGreaterThanOrEqual(14);
    expect(levels.sedang).toBeLessThanOrEqual(16);
  });

  it('fills a thin cell from the rest of the subject instead of failing', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'matematika', 20); // all bilangan, all sedang

    const drawn = drawSection(sqlite, userId, { subject: 'matematika', count: 15, blueprint: true });
    expect(drawn).toHaveLength(15);
    expect(new Set(drawn).size).toBe(15);
  });

  it('apportions exactly, with largest remainders', () => {
    expect(apportion(30, { a: 48, b: 42, c: 30 })).toEqual({ a: 12, b: 11, c: 7 });
    expect(apportion(7, { a: 1, b: 1 })).toEqual({ a: 4, b: 3 });
    expect(apportion(0, { a: 1 })).toEqual({ a: 0 });
  });
});


describe('repeats when the bank runs dry', () => {
  it('rotates through the pool instead of serving the same oldest items', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'matematika', 6);
    const all = drawForUser(sqlite, userId, [{ subject: 'matematika', count: 6 }]);
    recordHistory(sqlite, userId, all, null);
    // Make the order of first sight explicit.
    all.forEach((id, i) =>
      sqlite.prepare('UPDATE user_question_history SET seen_at = ? WHERE question_id = ?').run(1000 + i, id),
    );

    const round1 = drawForUser(sqlite, userId, [{ subject: 'matematika', count: 3 }], true);
    expect(round1.sort()).toEqual(all.slice(0, 3).sort());
    recordHistory(sqlite, userId, round1, null);

    // Those three were just seen again, so the next repeat takes the other three.
    const round2 = drawForUser(sqlite, userId, [{ subject: 'matematika', count: 3 }], true);
    expect(round2.sort()).toEqual(all.slice(3).sort());
  });

  it('repeats items the student got wrong before ones they got right', () => {
    const { sqlite, userId } = setup();
    seedQuestions(sqlite, 'ipas', 4);
    const all = drawForUser(sqlite, userId, [{ subject: 'ipas', count: 4 }]);

    const assignment = sqlite.prepare("INSERT INTO assignments (judul) VALUES ('x')").run();
    const attempt = sqlite
      .prepare(
        `INSERT INTO attempts (assignment_id, user_id, status, question_order_json, option_orders_json)
         VALUES (?, ?, 'selesai', ?, '{}')`,
      )
      .run(assignment.lastInsertRowid, userId, JSON.stringify(all));
    recordHistory(sqlite, userId, all, Number(attempt.lastInsertRowid));
    const wrong = all[3];
    for (const id of all) {
      sqlite
        .prepare(
          `INSERT INTO attempt_answers (attempt_id, question_id, response_json, is_correct)
           VALUES (?, ?, 'null', ?)`,
        )
        .run(attempt.lastInsertRowid, id, id === wrong ? 0 : 1);
    }

    const repeat = drawForUser(sqlite, userId, [{ subject: 'ipas', count: 1 }], true);
    expect(repeat).toEqual([wrong]);
  });
});
