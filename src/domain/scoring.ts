import { z } from 'zod';
import type { AnswerKey, Response } from './question';
import type { QuestionType, Subject } from './blueprint';

/**
 * Scoring for the three TKA question formats.
 *
 * - pg            : 1 for correct, 0 otherwise
 * - pgk_multi     : partial credit, (correct picked - wrong picked) / number of
 *                   keys, clamped at 0 so ticking everything gains nothing
 * - pgk_kategori  : 1/N of a point per statement placed in the right category
 *
 * Every item is worth at most 1 point, so the formats carry equal weight.
 */

export type ItemScore = {
  points: number;
  pointsMax: number;
  /** True only when the item is answered perfectly. */
  isCorrect: boolean;
};

const EPSILON = 1e-9;

export function scoreItem(
  type: QuestionType,
  answer: AnswerKey,
  response: Response | null,
): ItemScore {
  const pointsMax = 1;
  if (!response) return { points: 0, pointsMax, isCorrect: false };

  if (type === 'pg' && answer.kind === 'single' && response.kind === 'single') {
    const correct = response.choice !== null && response.choice === answer.correct;
    return { points: correct ? 1 : 0, pointsMax, isCorrect: correct };
  }

  // Grading runs during page render, so a malformed stored response must never
  // throw here -- it is simply worth nothing.
  if (
    type === 'pgk_multi' &&
    answer.kind === 'multi' &&
    response.kind === 'multi' &&
    Array.isArray(response.choices)
  ) {
    const key = new Set(answer.correct);
    const picked = new Set(response.choices);
    let hit = 0;
    let miss = 0;
    for (const id of picked) {
      if (key.has(id)) hit += 1;
      else miss += 1;
    }
    const raw = key.size === 0 ? 0 : (hit - miss) / key.size;
    const points = Math.min(1, Math.max(0, raw));
    const isCorrect = hit === key.size && miss === 0;
    return { points, pointsMax, isCorrect };
  }

  if (
    type === 'pgk_kategori' &&
    answer.kind === 'kategori' &&
    response.kind === 'kategori' &&
    typeof response.picks === 'object' &&
    response.picks !== null
  ) {
    const entries = Object.entries(answer.correct);
    if (entries.length === 0) return { points: 0, pointsMax, isCorrect: false };
    let hit = 0;
    for (const [statementId, categoryId] of entries) {
      if (response.picks[statementId] === categoryId) hit += 1;
    }
    const points = hit / entries.length;
    return { points, pointsMax, isCorrect: hit === entries.length };
  }

  // The response shape does not match the question type -- treat as unanswered.
  return { points: 0, pointsMax, isCorrect: false };
}

export type ScoredItem = {
  questionId: string;
  subject: Subject;
  domain: string;
  competency: string;
  points: number;
  pointsMax: number;
  isCorrect: boolean;
};

export type Breakdown = {
  key: string;
  label?: string;
  points: number;
  pointsMax: number;
  count: number;
  correctCount: number;
  percent: number;
};

export type AttemptScore = {
  points: number;
  pointsMax: number;
  percent: number;
  bySubject: Breakdown[];
  byDomain: Breakdown[];
  byCompetency: Breakdown[];
};

function percentOf(points: number, pointsMax: number): number {
  if (pointsMax <= EPSILON) return 0;
  return Math.round((points / pointsMax) * 1000) / 10;
}

function group(
  items: readonly ScoredItem[],
  keyOf: (item: ScoredItem) => string,
): Breakdown[] {
  const map = new Map<string, Breakdown>();
  for (const item of items) {
    const key = keyOf(item);
    const entry = map.get(key) ?? {
      key,
      points: 0,
      pointsMax: 0,
      count: 0,
      correctCount: 0,
      percent: 0,
    };
    entry.points += item.points;
    entry.pointsMax += item.pointsMax;
    entry.count += 1;
    if (item.isCorrect) entry.correctCount += 1;
    map.set(key, entry);
  }
  return [...map.values()].map((entry) => ({
    ...entry,
    points: Math.round(entry.points * 1000) / 1000,
    percent: percentOf(entry.points, entry.pointsMax),
  }));
}

/** Aggregate one attempt: overall, per subject, per strand, per competency. */
export function scoreAttempt(items: readonly ScoredItem[]): AttemptScore {
  const points = items.reduce((sum, item) => sum + item.points, 0);
  const pointsMax = items.reduce((sum, item) => sum + item.pointsMax, 0);
  return {
    points: Math.round(points * 1000) / 1000,
    pointsMax,
    percent: percentOf(points, pointsMax),
    bySubject: group(items, (item) => item.subject),
    byDomain: group(items, (item) => `${item.subject}:${item.domain}`),
    byCompetency: group(items, (item) => `${item.subject}:${item.competency}`),
  };
}

/** What score_breakdown_json holds: the three groupings of one attempt. */
export type StoredBreakdown = Pick<AttemptScore, 'bySubject' | 'byDomain' | 'byCompetency'>;

const breakdownSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  points: z.number(),
  pointsMax: z.number(),
  count: z.number(),
  correctCount: z.number(),
  percent: z.number(),
});

const storedBreakdownSchema = z.object({
  bySubject: z.array(breakdownSchema).default([]),
  byDomain: z.array(breakdownSchema).default([]),
  byCompetency: z.array(breakdownSchema).default([]),
});

export const EMPTY_BREAKDOWN: StoredBreakdown = { bySubject: [], byDomain: [], byCompetency: [] };

/** Read score_breakdown_json, falling back to an empty breakdown. */
export function parseBreakdown(json: string | null | undefined): StoredBreakdown {
  if (!json) return EMPTY_BREAKDOWN;
  try {
    const parsed = storedBreakdownSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : EMPTY_BREAKDOWN;
  } catch {
    return EMPTY_BREAKDOWN;
  }
}

/** A 0-100 score rounded to one decimal, for display to the student. */
export function displayScore(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}
