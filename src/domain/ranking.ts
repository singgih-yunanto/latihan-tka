import type { Database } from 'better-sqlite3';
import type { Subject } from './blueprint';
import { parseIdList } from './question';
import { parseBreakdown } from './scoring';

/**
 * The shared ranking board.
 *
 * This is the one place where a student or parent reads about children outside
 * their own family, so it deliberately returns aggregates only: a name, an
 * avatar colour and pooled numbers. Never attempt ids, answers or anything a
 * page could link through to another child's work.
 *
 * A score is pooled -- total points over total possible points -- rather than
 * a mean of per-attempt percentages, so a five-question quiz weighs a fifth of a
 * 25-question one instead of the same.
 */

/** Fewer answered questions than this in a scope and a student is not ranked yet. */
export const MIN_RANKING_ITEMS = 20;

/** The "last N days" window offered on the board. */
export const RANKING_WINDOW_DAYS = 30;

/** Epoch seconds at which a "last N days" window starts. */
export function windowStart(days: number, nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000) - days * 86_400;
}

export type RankingRow = {
  studentId: number;
  nama: string;
  avatarWarna: string;
  /** 0-100. */
  percent: number;
  items: number;
  correct: number;
  attempts: number;
  /** Competition ranking (1, 1, 3); 0 for students not yet ranked. */
  rank: number;
};

export type Ranking = {
  ranked: RankingRow[];
  /** Students with some finished work, but below MIN_RANKING_ITEMS. */
  unqualified: RankingRow[];
};

export type RankingOptions = {
  /** null = every subject. */
  subject: Subject | null;
  /** Epoch seconds; only work submitted at or after this counts. null = all time. */
  since: number | null;
};

type AttemptRow = {
  user_id: number;
  nama: string;
  avatar_warna: string;
  score_points: number | null;
  score_max: number | null;
  score_breakdown_json: string | null;
  question_order_json: string;
};

type Tally = { points: number; max: number; items: number; correct: number; attempts: number };

export function computeRanking(sqlite: Database, { subject, since }: RankingOptions): Ranking {
  const rows = sqlite
    .prepare(
      `SELECT a.user_id, u.nama, u.avatar_warna, a.score_points, a.score_max,
              a.score_breakdown_json, a.question_order_json
         FROM attempts a
         JOIN users u ON u.id = a.user_id
        WHERE a.status = 'selesai'
          AND a.score_max > 0
          AND u.role = 'student' AND u.aktif = 1 AND u.ranking_hidden = 0
          AND (? IS NULL OR a.submitted_at >= ?)`,
    )
    .all(since, since) as AttemptRow[];

  const tallies = new Map<number, Tally & { nama: string; avatarWarna: string }>();
  for (const row of rows) {
    const contribution = contributionOf(row, subject);
    if (!contribution || contribution.max <= 0) continue;

    let tally = tallies.get(row.user_id);
    if (!tally) {
      tally = { nama: row.nama, avatarWarna: row.avatar_warna, points: 0, max: 0, items: 0, correct: 0, attempts: 0 };
      tallies.set(row.user_id, tally);
    }
    tally.points += contribution.points;
    tally.max += contribution.max;
    tally.items += contribution.items;
    tally.correct += contribution.correct;
    tally.attempts += 1;
  }

  const all: RankingRow[] = [...tallies].map(([studentId, t]) => ({
    studentId,
    nama: t.nama,
    avatarWarna: t.avatarWarna,
    percent: Math.round((t.points / t.max) * 1000) / 10,
    items: t.items,
    correct: t.correct,
    attempts: t.attempts,
    rank: 0,
  }));

  const ranked = all
    .filter((r) => r.items >= MIN_RANKING_ITEMS)
    .sort((a, b) => b.percent - a.percent || b.items - a.items || a.nama.localeCompare(b.nama, 'id'));
  ranked.forEach((row, i) => {
    const previous = ranked[i - 1];
    row.rank = previous && previous.percent === row.percent ? previous.rank : i + 1;
  });

  const unqualified = all
    .filter((r) => r.items < MIN_RANKING_ITEMS)
    .sort((a, b) => b.items - a.items || a.nama.localeCompare(b.nama, 'id'));

  return { ranked, unqualified };
}

/** What one attempt adds to a student's tally for this scope. */
function contributionOf(
  row: AttemptRow,
  subject: Subject | null,
): { points: number; max: number; items: number; correct: number } | null {
  const { bySubject } = parseBreakdown(row.score_breakdown_json);

  if (subject) {
    const entry = bySubject.find((b) => b.key === subject);
    if (!entry) return null;
    return { points: entry.points, max: entry.pointsMax, items: entry.count, correct: entry.correctCount };
  }

  // Overall: the attempt's own totals are authoritative; the breakdown only
  // supplies the counts, and an attempt without one still counts its items.
  const points = row.score_points ?? 0;
  const max = row.score_max ?? 0;
  if (bySubject.length > 0) {
    return {
      points,
      max,
      items: bySubject.reduce((n, b) => n + b.count, 0),
      correct: bySubject.reduce((n, b) => n + b.correctCount, 0),
    };
  }
  return { points, max, items: parseIdList(row.question_order_json).length, correct: 0 };
}

/** The board's 1-based position of a student, or null when they are not ranked. */
export function rankOf(ranking: Ranking, studentId: number): number | null {
  return ranking.ranked.find((r) => r.studentId === studentId)?.rank ?? null;
}
