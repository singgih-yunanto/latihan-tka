import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { MIN_RANKING_ITEMS, computeRanking, rankOf } from '../src/domain/ranking';
import { isRankingEnabled, setSetting, RANKING_ENABLED } from '../src/domain/settings';
import { addUser, makeTestDb } from './helpers/testDb';

type Part = { subject: string; points: number; max: number; count: number; correct?: number };

/** A finished attempt with the given per-subject results. */
function addFinished(
  sqlite: Database.Database,
  userId: number,
  parts: Part[],
  { status = 'selesai', submittedAt = Math.floor(Date.now() / 1000) } = {},
): void {
  const assignment = sqlite.prepare("INSERT INTO assignments (judul) VALUES ('x')").run();
  const points = parts.reduce((n, p) => n + p.points, 0);
  const max = parts.reduce((n, p) => n + p.max, 0);
  const breakdown = {
    bySubject: parts.map((p) => ({
      key: p.subject,
      points: p.points,
      pointsMax: p.max,
      count: p.count,
      correctCount: p.correct ?? Math.round(p.points),
      percent: p.max > 0 ? (p.points / p.max) * 100 : 0,
    })),
    byDomain: [],
    byCompetency: [],
  };
  sqlite
    .prepare(
      `INSERT INTO attempts
         (assignment_id, user_id, status, question_order_json, option_orders_json,
          submitted_at, score_points, score_max, score_percent, score_breakdown_json)
       VALUES (?, ?, ?, '[]', '{}', ?, ?, ?, ?, ?)`,
    )
    .run(
      assignment.lastInsertRowid,
      userId,
      status,
      submittedAt,
      points,
      max,
      max > 0 ? (points / max) * 100 : 0,
      JSON.stringify(breakdown),
    );
}

const mtk = (points: number, count = 20): Part => ({ subject: 'matematika', points, max: count, count });
const ipas = (points: number, count = 20): Part => ({ subject: 'ipas', points, max: count, count });

const all = { subject: null, since: null } as const;

describe('computeRanking', () => {
  it('pools points across attempts rather than averaging percentages', () => {
    const sqlite = makeTestDb();
    const dina = addUser(sqlite, 'Dina');
    // 5/5 on a tiny quiz and 10/20 on a real paper: 15/25 = 60, not (100+50)/2 = 75.
    addFinished(sqlite, dina, [mtk(5, 5)]);
    addFinished(sqlite, dina, [mtk(10, 20)]);

    const { ranked } = computeRanking(sqlite, all);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ studentId: dina, percent: 60, items: 25, attempts: 2, rank: 1 });
  });

  it('ranks a subject tab from the breakdown only', () => {
    const sqlite = makeTestDb();
    const dina = addUser(sqlite, 'Dina');
    const bayu = addUser(sqlite, 'Bayu');
    addFinished(sqlite, dina, [mtk(18), ipas(5)]);
    addFinished(sqlite, bayu, [mtk(10), ipas(19)]);

    const matematika = computeRanking(sqlite, { subject: 'matematika', since: null });
    expect(matematika.ranked.map((r) => r.studentId)).toEqual([dina, bayu]);
    expect(matematika.ranked[0].percent).toBe(90);

    const science = computeRanking(sqlite, { subject: 'ipas', since: null });
    expect(science.ranked.map((r) => r.studentId)).toEqual([bayu, dina]);

    // Bahasa Indonesia: nobody has any, so nobody appears at all.
    const bahasa = computeRanking(sqlite, { subject: 'bahasa_indonesia', since: null });
    expect(bahasa.ranked).toEqual([]);
    expect(bahasa.unqualified).toEqual([]);
  });

  it(`holds back students with fewer than ${MIN_RANKING_ITEMS} questions`, () => {
    const sqlite = makeTestDb();
    const dina = addUser(sqlite, 'Dina');
    const bayu = addUser(sqlite, 'Bayu');
    addFinished(sqlite, dina, [mtk(MIN_RANKING_ITEMS - 1, MIN_RANKING_ITEMS - 1)]);
    addFinished(sqlite, bayu, [mtk(5)]);

    const ranking = computeRanking(sqlite, all);
    expect(ranking.ranked.map((r) => r.studentId)).toEqual([bayu]);
    expect(ranking.unqualified).toMatchObject([{ studentId: dina, rank: 0, items: MIN_RANKING_ITEMS - 1 }]);
    expect(rankOf(ranking, dina)).toBeNull();
    expect(rankOf(ranking, bayu)).toBe(1);
  });

  it('gives tied students the same place and skips the next', () => {
    const sqlite = makeTestDb();
    const a = addUser(sqlite, 'Ana');
    const b = addUser(sqlite, 'Budi');
    const c = addUser(sqlite, 'Citra');
    addFinished(sqlite, a, [mtk(16)]);
    addFinished(sqlite, b, [mtk(16)]);
    addFinished(sqlite, c, [mtk(10)]);

    const { ranked } = computeRanking(sqlite, all);
    expect(ranked.map((r) => [r.nama, r.rank])).toEqual([
      ['Ana', 1],
      ['Budi', 1],
      ['Citra', 3],
    ]);
  });

  it('leaves out hidden, inactive and non-student accounts, and unfinished or empty work', () => {
    const sqlite = makeTestDb();
    const shown = addUser(sqlite, 'Tampil');
    const hidden = addUser(sqlite, 'Sembunyi');
    const inactive = addUser(sqlite, 'Nonaktif');
    const admin = addUser(sqlite, 'Admin', 'admin');
    const running = addUser(sqlite, 'Berjalan');
    const empty = addUser(sqlite, 'Kosong');
    sqlite.prepare('UPDATE users SET ranking_hidden = 1 WHERE id = ?').run(hidden);
    sqlite.prepare('UPDATE users SET aktif = 0 WHERE id = ?').run(inactive);

    for (const id of [shown, hidden, inactive, admin]) addFinished(sqlite, id, [mtk(15)]);
    addFinished(sqlite, running, [mtk(15)], { status: 'berjalan' });
    addFinished(sqlite, empty, [{ subject: 'matematika', points: 0, max: 0, count: 25 }]);

    const ranking = computeRanking(sqlite, all);
    expect(ranking.ranked.map((r) => r.studentId)).toEqual([shown]);
    expect(ranking.unqualified).toEqual([]);
  });

  it('counts only work inside the time window', () => {
    const sqlite = makeTestDb();
    const dina = addUser(sqlite, 'Dina');
    const now = Math.floor(Date.now() / 1000);
    addFinished(sqlite, dina, [mtk(20)], { submittedAt: now - 60 * 86_400 });
    addFinished(sqlite, dina, [mtk(10)], { submittedAt: now - 86_400 });

    expect(computeRanking(sqlite, all).ranked[0].percent).toBe(75);
    const recent = computeRanking(sqlite, { subject: null, since: now - 30 * 86_400 });
    expect(recent.ranked[0]).toMatchObject({ percent: 50, attempts: 1 });
  });

  it('survives a corrupt breakdown by falling back to the attempt totals', () => {
    const sqlite = makeTestDb();
    const dina = addUser(sqlite, 'Dina');
    addFinished(sqlite, dina, [mtk(15)]);
    sqlite
      .prepare("UPDATE attempts SET score_breakdown_json = '{oops', question_order_json = ? WHERE user_id = ?")
      .run(JSON.stringify(Array.from({ length: 20 }, (_, i) => `q${i}`)), dina);

    expect(computeRanking(sqlite, all).ranked[0]).toMatchObject({ percent: 75, items: 20 });
    expect(computeRanking(sqlite, { subject: 'matematika', since: null }).ranked).toEqual([]);
  });
});

describe('ranking switch', () => {
  it('is on until an admin turns it off', () => {
    const sqlite = makeTestDb();
    expect(isRankingEnabled(sqlite)).toBe(true);
    setSetting(sqlite, RANKING_ENABLED, '0');
    expect(isRankingEnabled(sqlite)).toBe(false);
    setSetting(sqlite, RANKING_ENABLED, '1');
    expect(isRankingEnabled(sqlite)).toBe(true);
  });
});
