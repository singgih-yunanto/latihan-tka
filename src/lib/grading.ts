import { eq, inArray } from 'drizzle-orm';
import { db, sqlite } from '@/db/client';
import { attemptAnswers, attempts, questions } from '@/db/schema';
import { isPastGrace } from '@/domain/timing';
import { scoreAttempt, scoreItem, type ScoredItem } from '@/domain/scoring';
import {
  effectiveItem,
  parseIdList,
  parseResponse,
  parseSnapshots,
  type Response,
} from '@/domain/question';
import type { Subject } from '@/domain/blueprint';

/**
 * The core of attempt grading.
 *
 * Deliberately a plain module rather than a Server Action: closing an expired
 * attempt is also called while a page renders, and calling revalidatePath from
 * a render path can make the page ask to re-render indefinitely. The wrapper in
 * src/actions/attempt.ts handles revalidation for the interactive path.
 *
 * Grading must never throw. It runs during render, so an exception here would
 * leave the attempt open forever and the student's pages broken. Anything
 * unreadable -- a malformed response, a corrupt answer key -- scores zero.
 */

export type GradeOutcome = { graded: boolean; userId: number };

export function gradeAndClose(attemptId: number): GradeOutcome | null {
  const attempt = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  if (!attempt) return null;
  if (attempt.status === 'selesai') return { graded: false, userId: attempt.userId };

  const order = parseIdList(attempt.questionOrderJson);
  const rows = order.length
    ? db.select().from(questions).where(inArray(questions.id, order)).all()
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const snapshots = parseSnapshots(attempt.itemSnapshotJson);

  const answerRows = db
    .select()
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId))
    .all();

  // An unreadable or malformed response is treated as unanswered.
  const responseById = new Map<string, Response>();
  for (const row of answerRows) {
    const response = parseResponse(row.responseJson);
    if (response) responseById.set(row.questionId, response);
  }

  const updateAnswer = sqlite.prepare(
    `INSERT INTO attempt_answers
       (attempt_id, question_id, response_json, is_correct, points, points_max, answered_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(attempt_id, question_id) DO UPDATE SET
       is_correct = excluded.is_correct,
       points = excluded.points,
       points_max = excluded.points_max`,
  );

  // The status guard makes a second, concurrent grade of the same attempt a
  // no-op instead of a double write.
  const closeAttempt = sqlite.prepare(
    `UPDATE attempts
        SET status = 'selesai', submitted_at = ?, elapsed_seconds = ?,
            score_points = ?, score_max = ?, score_percent = ?, score_breakdown_json = ?
      WHERE id = ? AND status <> 'selesai'`,
  );

  const run = sqlite.transaction(() => {
    const scored: ScoredItem[] = [];

    for (const questionId of order) {
      const row = byId.get(questionId);
      if (!row) continue;

      const item = effectiveItem(row, snapshots[questionId]);
      const response = responseById.get(questionId) ?? null;
      const result = item.answer
        ? scoreItem(item.type, item.answer, response)
        : { points: 0, pointsMax: 1, isCorrect: false };

      scored.push({
        questionId,
        subject: row.subject as Subject,
        domain: row.contentDomain,
        competency: row.competency,
        points: result.points,
        pointsMax: result.pointsMax,
        isCorrect: result.isCorrect,
      });

      updateAnswer.run(
        attemptId,
        questionId,
        JSON.stringify(response ?? null),
        result.isCorrect ? 1 : 0,
        result.points,
        result.pointsMax,
      );
    }

    const total = scoreAttempt(scored);

    // An attempt closed lazily, long after its deadline, finished at the
    // deadline -- not whenever somebody next happened to open a page.
    const now = Math.floor(Date.now() / 1000);
    const submittedAt = attempt.deadlineAt ? Math.min(now, attempt.deadlineAt) : now;
    const elapsed = attempt.startedAt ? Math.max(0, submittedAt - attempt.startedAt) : null;

    closeAttempt.run(
      submittedAt,
      elapsed,
      total.points,
      total.pointsMax,
      total.percent,
      JSON.stringify({
        bySubject: total.bySubject,
        byDomain: total.byDomain,
        byCompetency: total.byCompetency,
      }),
      attemptId,
    );
  });

  run();
  return { graded: true, userId: attempt.userId };
}

/**
 * Close an attempt whose time budget has run out. Safe to call during render
 * because it never touches the Next cache.
 *
 * Waits out the save grace window, so an answer sent in the last second is
 * stored before the attempt is graded.
 */
export function closeIfExpired(attemptId: number): boolean {
  const attempt = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  if (!attempt || attempt.status !== 'berjalan' || !attempt.deadlineAt) return false;
  if (!isPastGrace(new Date(attempt.deadlineAt * 1000))) return false;

  gradeAndClose(attemptId);
  return true;
}

/**
 * Close every expired attempt among the given students, or among everyone when
 * `userIds` is null. Supervisor pages call this so results and analytics never
 * show an attempt as still in progress hours after its time ran out.
 */
export function closeExpiredFor(userIds: readonly number[] | null): number {
  if (userIds !== null && userIds.length === 0) return 0;
  const cutoff = Math.floor(Date.now() / 1000);
  const where = userIds === null ? '' : `AND user_id IN (${userIds.map(() => '?').join(',')})`;
  const expired = sqlite
    .prepare(
      `SELECT id FROM attempts
        WHERE status = 'berjalan' AND deadline_at IS NOT NULL AND deadline_at < ? ${where}`,
    )
    .all(cutoff, ...(userIds ?? [])) as { id: number }[];

  let closed = 0;
  for (const { id } of expired) if (closeIfExpired(id)) closed += 1;
  return closed;
}
