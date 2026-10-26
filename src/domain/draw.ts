import type { Database } from 'better-sqlite3';
import {
  BLUEPRINT,
  DIFFICULTIES,
  DIFFICULTY_MIX,
  type Difficulty,
  type QuestionType,
  type Subject,
} from './blueprint';

/**
 * Drawing questions for an attempt.
 *
 * The core rule: a student may never receive an item they have already been
 * given, enforced through the user_question_history table. Because history rows
 * are written at draw time rather than at submit time, two assignments created
 * back to back for the same student are guaranteed not to overlap.
 *
 * "Already given" is judged by content fingerprint as well as by id, so an item
 * re-added to the bank under a new id still counts as seen.
 *
 * Written as direct SQL through better-sqlite3 so the whole draw, for every
 * student, fits inside a single synchronous transaction.
 */

export type SectionFilters = {
  domains?: string[];
  competencies?: string[];
  difficulties?: Difficulty[];
  types?: QuestionType[];
};

export type DrawSection = {
  subject: Subject;
  count: number;
  filters?: SectionFilters | null;
  /**
   * Draw like a real TKA paper: strands in proportion to the blueprint targets
   * and difficulty following DIFFICULTY_MIX, rather than uniformly at random.
   */
  blueprint?: boolean;
};

export class NotEnoughQuestionsError extends Error {
  constructor(
    readonly subject: Subject,
    readonly requested: number,
    readonly available: number,
  ) {
    super(
      `Not enough unseen ${subject} questions: ${requested} requested, ${available} available`,
    );
    this.name = 'NotEnoughQuestionsError';
  }
}

type PoolClause = { where: string; params: unknown[] };

function buildPoolClause(
  subject: Subject,
  filters: SectionFilters | null | undefined,
  exclude: readonly string[] = [],
): PoolClause {
  const where: string[] = ['q.subject = ?', 'q.aktif = 1', 'q.retired_by_admin = 0'];
  const params: unknown[] = [subject];

  const inList = (column: string, values: readonly string[] | undefined, negate = false) => {
    if (!values || values.length === 0) return;
    where.push(`${column} ${negate ? 'NOT IN' : 'IN'} (${values.map(() => '?').join(',')})`);
    params.push(...values);
  };

  inList('q.content_domain', filters?.domains);
  inList('q.competency', filters?.competencies);
  inList('q.difficulty', filters?.difficulties);
  inList('q.type', filters?.types);
  inList('q.id', exclude, true);

  return { where: where.join(' AND '), params };
}

/** Matches an item this student has seen, by id or by identical content. */
const SEEN = `EXISTS (
  SELECT 1 FROM user_question_history h
    JOIN questions s ON s.id = h.question_id
   WHERE h.user_id = ? AND (h.question_id = q.id OR s.fingerprint = q.fingerprint)
)`;

/** How many items are still unseen by this student and match the filters. */
export function countAvailable(
  sqlite: Database,
  userId: number,
  subject: Subject,
  filters?: SectionFilters | null,
): number {
  const pool = buildPoolClause(subject, filters);
  const row = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM questions q WHERE ${pool.where} AND NOT ${SEEN}`)
    .get(...pool.params, userId) as { n: number };
  return row.n;
}

/** Total active items matching the filters, ignoring student history. */
export function countPool(
  sqlite: Database,
  subject: Subject,
  filters?: SectionFilters | null,
): number {
  const pool = buildPoolClause(subject, filters);
  const row = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM questions q WHERE ${pool.where}`)
    .get(...pool.params) as { n: number };
  return row.n;
}

function drawFresh(
  sqlite: Database,
  userId: number,
  subject: Subject,
  filters: SectionFilters | null | undefined,
  count: number,
  exclude: readonly string[],
): string[] {
  if (count <= 0) return [];
  const pool = buildPoolClause(subject, filters, exclude);
  const rows = sqlite
    .prepare(
      `SELECT q.id FROM questions q
        WHERE ${pool.where} AND NOT ${SEEN}
        ORDER BY RANDOM()
        LIMIT ?`,
    )
    .all(...pool.params, userId, count) as { id: string }[];
  return rows.map((row) => row.id);
}

/**
 * Split `total` across weighted buckets with the largest-remainder method, so
 * the parts are whole numbers that add up exactly to `total`.
 */
export function apportion<K extends string>(total: number, weights: Record<K, number>): Record<K, number> {
  const keys = Object.keys(weights) as K[];
  const sum = keys.reduce((s, k) => s + weights[k], 0);
  const out = {} as Record<K, number>;
  if (sum <= 0 || total <= 0) {
    for (const k of keys) out[k] = 0;
    return out;
  }
  const exact = keys.map((k) => ({ k, v: (total * weights[k]) / sum }));
  let given = 0;
  for (const { k, v } of exact) {
    out[k] = Math.floor(v);
    given += out[k];
  }
  exact
    .sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)))
    .slice(0, total - given)
    .forEach(({ k }) => (out[k] += 1));
  return out;
}

/**
 * A blueprint-shaped draw: strand quotas from the bank targets, difficulty
 * quotas within each strand from DIFFICULTY_MIX. A cell that runs short is
 * filled first from the same strand at any difficulty, then from the subject
 * as a whole, so the paper is as close to the blueprint as the bank allows.
 */
function drawBlueprint(
  sqlite: Database,
  userId: number,
  section: DrawSection,
  exclude: readonly string[],
): string[] {
  const filters = section.filters ?? {};
  const allowedDomains = BLUEPRINT[section.subject].domains.filter(
    (d) => !filters.domains?.length || filters.domains.includes(d.key),
  );
  const domainQuota = apportion(
    section.count,
    Object.fromEntries(allowedDomains.map((d) => [d.key, d.target])) as Record<string, number>,
  );

  const allowedDifficulties = DIFFICULTIES.filter(
    (d) => !filters.difficulties?.length || filters.difficulties.includes(d),
  );
  const difficultyWeights = Object.fromEntries(
    allowedDifficulties.map((d) => [d, DIFFICULTY_MIX[d]]),
  ) as Record<Difficulty, number>;

  const picked: string[] = [];
  const taken = () => [...exclude, ...picked];

  for (const [domain, quota] of Object.entries(domainQuota)) {
    if (quota <= 0) continue;
    const perDifficulty = apportion(quota, difficultyWeights);
    let gotInDomain = 0;
    for (const [difficulty, n] of Object.entries(perDifficulty) as [Difficulty, number][]) {
      const ids = drawFresh(
        sqlite,
        userId,
        section.subject,
        { ...filters, domains: [domain], difficulties: [difficulty] },
        n,
        taken(),
      );
      picked.push(...ids);
      gotInDomain += ids.length;
    }
    if (gotInDomain < quota) {
      picked.push(
        ...drawFresh(
          sqlite,
          userId,
          section.subject,
          { ...filters, domains: [domain] },
          quota - gotInDomain,
          taken(),
        ),
      );
    }
  }

  if (picked.length < section.count) {
    picked.push(
      ...drawFresh(sqlite, userId, section.subject, filters, section.count - picked.length, taken()),
    );
  }
  return picked;
}

/**
 * Draw items for one section.
 *
 * `exclude` holds ids already drawn for this student earlier in the same
 * attempt, so a subject that appears in two sections never yields duplicates.
 *
 * When `allowRepeat` is on and unseen stock falls short, the gap is filled from
 * previously seen items: ones the student got wrong first (that is the useful
 * kind of repeat), then the least recently seen.
 */
export function drawSection(
  sqlite: Database,
  userId: number,
  section: DrawSection,
  allowRepeat = false,
  exclude: readonly string[] = [],
): string[] {
  if (section.count <= 0) return [];

  const picked = section.blueprint
    ? drawBlueprint(sqlite, userId, section, exclude)
    : drawFresh(sqlite, userId, section.subject, section.filters, section.count, exclude);
  if (picked.length >= section.count) return picked;

  if (!allowRepeat) {
    throw new NotEnoughQuestionsError(section.subject, section.count, picked.length);
  }

  const shortfall = section.count - picked.length;
  const pool = buildPoolClause(section.subject, section.filters, [...exclude, ...picked]);
  const repeats = sqlite
    .prepare(
      `SELECT q.id
         FROM questions q
         JOIN user_question_history h ON h.question_id = q.id AND h.user_id = ?
        WHERE ${pool.where}
        ORDER BY
          EXISTS (
            SELECT 1 FROM attempt_answers aa
              JOIN attempts a ON a.id = aa.attempt_id
             WHERE a.user_id = h.user_id AND aa.question_id = q.id AND aa.is_correct = 0
          ) DESC,
          h.seen_at ASC,
          RANDOM()
        LIMIT ?`,
    )
    .all(userId, ...pool.params, shortfall) as { id: string }[];

  const all = picked.concat(repeats.map((row) => row.id));
  if (all.length < section.count) {
    throw new NotEnoughQuestionsError(section.subject, section.count, all.length);
  }
  return all;
}

/**
 * Draw every section for one student, in the order the admin arranged them.
 * Questions stay grouped by subject, mirroring a real TKA sitting.
 */
export function drawForUser(
  sqlite: Database,
  userId: number,
  sections: readonly DrawSection[],
  allowRepeat = false,
): string[] {
  const out: string[] = [];
  for (const section of sections) {
    out.push(...drawSection(sqlite, userId, section, allowRepeat, out));
  }
  return out;
}

/**
 * Record the items a student has received so they never come back.
 *
 * A repeat refreshes `seen_at`, so the least-recently-seen ordering above keeps
 * rotating through the pool instead of serving the same oldest items forever.
 */
export function recordHistory(
  sqlite: Database,
  userId: number,
  questionIds: readonly string[],
  attemptId: number | null,
): void {
  const stmt = sqlite.prepare(
    `INSERT INTO user_question_history (user_id, question_id, attempt_id, seen_at)
     VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(user_id, question_id) DO UPDATE SET
       seen_at = excluded.seen_at,
       attempt_id = excluded.attempt_id`,
  );
  for (const questionId of questionIds) {
    stmt.run(userId, questionId, attemptId);
  }
}
