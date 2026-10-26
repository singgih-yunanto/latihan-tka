import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  assignmentSections,
  assignments,
  attemptAnswers,
  attemptRuns,
  attempts,
  questions,
  stimuli,
  users,
} from '@/db/schema';
import { SUBJECT_LABEL, type Subject, type QuestionType } from '@/domain/blueprint';
import type { Figure } from '@/domain/figure';
import { purifySvg } from './svg-sanitize';
import { applyOrder } from '@/domain/shuffle';
import {
  effectiveItem,
  parseIdList,
  parseOptionOrders,
  parseResponse,
  parseSnapshots,
  type AnswerKey,
  type ItemSnapshot,
  type QuestionBody,
  type Response,
} from '@/domain/question';
import { renderInlineText, renderRichText } from './markdown';

/**
 * Prepare a full attempt, questions included, for rendering.
 *
 * Markdown, KaTeX and SVG sanitising all happen on the server, so the client
 * component receives ready-to-use HTML.
 */

export type PreparedFigure = { figure: Figure; safeSvg?: string };

export function prepareFigure(json: string | null): PreparedFigure | null {
  if (!json) return null;
  try {
    const figure = JSON.parse(json) as Figure;
    if (figure.kind === 'svg') return { figure, safeSvg: purifySvg(figure.svg) };
    return { figure };
  } catch {
    return null;
  }
}

export type RunnerChoice = {
  id: string;
  html: string;
  figure: PreparedFigure | null;
};

export type RunnerStimulus = {
  id: string;
  title: string;
  bodyHtml: string;
  figure: PreparedFigure | null;
};

export type RunnerQuestion = {
  id: string;
  subject: Subject;
  subjectLabel: string;
  domain: string;
  competency: string;
  type: QuestionType;
  stemHtml: string;
  figure: PreparedFigure | null;
  stimulus: RunnerStimulus | null;
  choices: RunnerChoice[] | null;
  statements: RunnerChoice[] | null;
  categories: { id: string; label: string }[] | null;
};

export type ReviewExtras = {
  answer: AnswerKey;
  explanationHtml: string;
  explanationFigure: PreparedFigure | null;
};

export type AttemptView = {
  attempt: typeof attempts.$inferSelect;
  assignment: typeof assignments.$inferSelect;
  user: typeof users.$inferSelect;
  sections: (typeof assignmentSections.$inferSelect)[];
  questions: RunnerQuestion[];
  responses: Record<string, Response>;
  /** Points awarded per item once graded (partial credit included). */
  points: Record<string, number | null>;
  flagged: string[];
};

function toRunnerChoice(
  item: { id: string; text: string; figure?: Figure },
): RunnerChoice {
  return {
    id: item.id,
    html: renderInlineText(item.text),
    figure: item.figure ? prepareFigure(JSON.stringify(item.figure)) : null,
  };
}

/**
 * Build one render-ready item using the stored option order. With a snapshot,
 * the options (and type) come from what was frozen when the item was drawn.
 */
export function buildRunnerQuestion(
  row: typeof questions.$inferSelect,
  stimulusRow: typeof stimuli.$inferSelect | null,
  optionOrder: string[] | undefined,
  snapshot?: ItemSnapshot,
): RunnerQuestion {
  const item = effectiveItem(row, snapshot);
  const body: QuestionBody = item.body ?? { kind: 'choices', choices: [] };

  const base = {
    id: row.id,
    subject: row.subject as Subject,
    subjectLabel: SUBJECT_LABEL[row.subject as Subject] ?? row.subject,
    domain: row.contentDomain,
    competency: row.competency,
    type: item.type as QuestionType,
    stemHtml: renderRichText(row.stemMd),
    figure: prepareFigure(row.figureJson),
    stimulus: stimulusRow
      ? {
          id: stimulusRow.id,
          title: stimulusRow.judul,
          bodyHtml: renderRichText(stimulusRow.bodyMd),
          figure: prepareFigure(stimulusRow.figureJson),
        }
      : null,
  };

  if (body.kind === 'choices') {
    return {
      ...base,
      choices: applyOrder(body.choices, optionOrder).map(toRunnerChoice),
      statements: null,
      categories: null,
    };
  }

  return {
    ...base,
    choices: null,
    // For pgk_kategori it is the statement order that was shuffled.
    statements: applyOrder(body.statements, optionOrder).map(toRunnerChoice),
    categories: body.categories,
  };
}

export async function loadAttemptView(attemptId: number): Promise<AttemptView | null> {
  const attempt = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  if (!attempt) return null;

  const assignment = db
    .select()
    .from(assignments)
    .where(eq(assignments.id, attempt.assignmentId))
    .get();
  const user = db.select().from(users).where(eq(users.id, attempt.userId)).get();
  if (!assignment || !user) return null;

  const sections = db
    .select()
    .from(assignmentSections)
    .where(eq(assignmentSections.assignmentId, assignment.id))
    .orderBy(assignmentSections.urutan)
    .all();

  const order = parseIdList(attempt.questionOrderJson);
  const optionOrders = parseOptionOrders(attempt.optionOrdersJson);
  const snapshots = parseSnapshots(attempt.itemSnapshotJson);

  const rows = order.length
    ? db.select().from(questions).where(inArray(questions.id, order)).all()
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));

  const stimulusIds = [...new Set(rows.map((r) => r.stimulusId).filter((id): id is string => !!id))];
  const stimulusRows = stimulusIds.length
    ? db.select().from(stimuli).where(inArray(stimuli.id, stimulusIds)).all()
    : [];
  const stimulusById = new Map(stimulusRows.map((row) => [row.id, row]));

  const prepared = order
    .map((id) => byId.get(id))
    .filter((row): row is typeof questions.$inferSelect => Boolean(row))
    .map((row) =>
      buildRunnerQuestion(
        row,
        row.stimulusId ? stimulusById.get(row.stimulusId) ?? null : null,
        optionOrders[row.id],
        snapshots[row.id],
      ),
    );

  const answerRows = db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId))
    .all();

  // A corrupt or malformed answer row is skipped so the rest still opens.
  const responses: Record<string, Response> = {};
  const points: Record<string, number | null> = {};
  for (const row of answerRows) {
    const response = parseResponse(row.responseJson);
    if (response) responses[row.questionId] = response;
    points[row.questionId] = row.points;
  }

  const flagged = parseIdList(attempt.flaggedJson);

  return { attempt, assignment, user, sections, questions: prepared, responses, points, flagged };
}

/**
 * Answer keys and explanations, used only on the results page. The key comes
 * from the attempt's frozen snapshot when there is one, so the review always
 * agrees with the score that was given.
 */
export function loadReviewExtras(
  questionIds: readonly string[],
  snapshotJson?: string | null,
): Record<string, ReviewExtras> {
  if (questionIds.length === 0) return {};
  const snapshots = parseSnapshots(snapshotJson);
  const rows = db
    .select()
    .from(questions)
    .where(inArray(questions.id, [...questionIds]))
    .all();

  const out: Record<string, ReviewExtras> = {};
  for (const row of rows) {
    const answer = effectiveItem(row, snapshots[row.id]).answer;
    if (!answer) continue;
    out[row.id] = {
      answer: answer as AnswerKey,
      explanationHtml: renderRichText(row.explanationMd),
      explanationFigure: prepareFigure(row.explanationFigureJson),
    };
  }
  return out;
}

/** A student's attempts, for the assignment list on their page. */
export function listAttemptsForUser(userId: number) {
  return db
    .select({
      attempt: attempts,
      assignment: assignments,
    })
    .from(attempts)
    .innerJoin(assignments, eq(attempts.assignmentId, assignments.id))
    .where(eq(attempts.userId, userId))
    .orderBy(attempts.id)
    .all();
}

export function countQuestionsInAttempt(attempt: typeof attempts.$inferSelect): number {
  return parseIdList(attempt.questionOrderJson).length;
}

export function findAttempt(attemptId: number, userId: number) {
  return db
    .select()
    .from(attempts)
    .where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId)))
    .get();
}

/** Earlier finished runs of an attempt that was reset, oldest first. */
export function listAttemptRuns(attemptId: number) {
  return db
    .select()
    .from(attemptRuns)
    .where(eq(attemptRuns.attemptId, attemptId))
    .orderBy(attemptRuns.runNo)
    .all();
}
