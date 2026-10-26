'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, sqlite } from '@/db/client';
import { assignments, attempts } from '@/db/schema';
import { canAccessAttempt, canWorkOnAttempt } from '@/domain/access';
import { actionUser, type SessionUser } from '@/lib/auth';
import {
  SAVE_GRACE_SECONDS,
  TIMEUP_TOLERANCE_SECONDS,
  deadlineFrom,
  remainingSeconds,
} from '@/domain/timing';
import { gradeAndClose } from '@/lib/grading';
import { parseIdList, responseSchema } from '@/domain/question';

/**
 * Mutations for the student working flow.
 *
 * Timing is server-authoritative: the deadline is stored in the database when
 * the student presses start, and the server rejects answers that arrive after
 * it (plus a short grace for saves already in flight). Closing the tab or
 * reloading the page does not give the time back.
 *
 * Grading itself lives in src/lib/grading.ts so it can also be called from a
 * page render path without touching the Next cache.
 *
 * Every argument is parsed at runtime: these functions are public endpoints and
 * their TypeScript signatures bind only our own client code.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };
export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string; remainingSeconds?: number };

const DENIED = { ok: false, error: 'Tidak berwenang atas penugasan ini.' } as const;
const NO_SESSION = { ok: false, error: 'Sesi berakhir. Silakan masuk lagi.' } as const;
const BAD_INPUT = { ok: false, error: 'Data tidak valid.' } as const;

const idSchema = z.number().int().positive();
const questionIdSchema = z.string().min(1).max(64);

/**
 * Resolves the caller and checks they may *work on* this attempt.
 *
 * Every mutation below goes through here. Server Actions are publicly callable
 * HTTP endpoints, so the guard on the page that renders the button protects
 * nothing -- the check has to happen inside the action itself.
 *
 * Working is student-only and own-attempt-only: an admin or parent watching a
 * child's screen must not be able to answer on their behalf.
 */
async function actorForWork(
  attemptIdRaw: unknown,
): Promise<{ ok: true; user: SessionUser; attemptId: number } | { ok: false; error: string }> {
  const attemptId = idSchema.safeParse(attemptIdRaw);
  if (!attemptId.success) return BAD_INPUT;
  const user = await actionUser();
  if (!user) return NO_SESSION;
  if (!canWorkOnAttempt(sqlite, user, attemptId.data)) return DENIED;
  return { ok: true, user, attemptId: attemptId.data };
}

export async function startAttempt(attemptIdRaw: unknown): Promise<ActionResult> {
  const actor = await actorForWork(attemptIdRaw);
  if (!actor.ok) return actor;
  const { attemptId } = actor;

  const attempt = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  if (!attempt) return { ok: false, error: 'Penugasan tidak ditemukan.' };
  if (attempt.status === 'selesai') return { ok: false, error: 'Penugasan sudah diselesaikan.' };
  if (attempt.status === 'berjalan') return { ok: true };

  const assignment = db
    .select()
    .from(assignments)
    .where(eq(assignments.id, attempt.assignmentId))
    .get();
  if (!assignment) return { ok: false, error: 'Data penugasan tidak lengkap.' };

  const startedAt = new Date();
  const deadline = deadlineFrom(startedAt, assignment.durationSeconds ?? null);

  // The status guard makes a double press start the clock only once.
  sqlite
    .prepare(
      `UPDATE attempts SET status = 'berjalan', started_at = ?, deadline_at = ?
        WHERE id = ? AND status = 'belum_mulai'`,
    )
    .run(
      Math.floor(startedAt.getTime() / 1000),
      deadline ? Math.floor(deadline.getTime() / 1000) : null,
      attemptId,
    );

  revalidatePath('/u');
  return { ok: true };
}

/** Reject changes once the attempt is finished or past its deadline. */
function guardOpen(
  attemptId: number,
): { ok: true; attempt: typeof attempts.$inferSelect } | { ok: false; error: string } {
  const attempt = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
  if (!attempt) return { ok: false, error: 'Penugasan tidak ditemukan.' };
  if (attempt.status === 'selesai') return { ok: false, error: 'Penugasan sudah diselesaikan.' };
  if (attempt.status !== 'berjalan') return { ok: false, error: 'Penugasan belum dimulai.' };

  const nowSec = Date.now() / 1000;
  if (attempt.deadlineAt && nowSec > attempt.deadlineAt + SAVE_GRACE_SECONDS) {
    return { ok: false, error: 'Waktu pengerjaan sudah habis.' };
  }

  return { ok: true, attempt };
}

export async function saveAnswer(
  attemptIdRaw: unknown,
  questionIdRaw: unknown,
  responseRaw: unknown,
): Promise<ActionResult> {
  const actor = await actorForWork(attemptIdRaw);
  if (!actor.ok) return actor;

  const questionId = questionIdSchema.safeParse(questionIdRaw);
  const response = responseSchema.safeParse(responseRaw);
  if (!questionId.success || !response.success) return BAD_INPUT;

  const guard = guardOpen(actor.attemptId);
  if (!guard.ok) return guard;

  // Only items actually drawn for this student may be saved.
  const ids = parseIdList(guard.attempt.questionOrderJson);
  if (!ids.includes(questionId.data)) {
    return { ok: false, error: 'Soal tidak ada dalam penugasan ini.' };
  }

  sqlite
    .prepare(
      `INSERT INTO attempt_answers (attempt_id, question_id, response_json, answered_at)
       VALUES (?, ?, ?, unixepoch())
       ON CONFLICT(attempt_id, question_id) DO UPDATE SET
         response_json = excluded.response_json,
         answered_at = excluded.answered_at`,
    )
    .run(actor.attemptId, questionId.data, JSON.stringify(response.data));

  return { ok: true };
}

export async function setFlagged(attemptIdRaw: unknown, flaggedRaw: unknown): Promise<ActionResult> {
  const actor = await actorForWork(attemptIdRaw);
  if (!actor.ok) return actor;

  const flagged = z.array(questionIdSchema).max(500).safeParse(flaggedRaw);
  if (!flagged.success) return BAD_INPUT;

  const guard = guardOpen(actor.attemptId);
  if (!guard.ok) return guard;

  // Keep only ids that belong to this attempt, each once.
  const own = new Set(parseIdList(guard.attempt.questionOrderJson));
  const clean = [...new Set(flagged.data)].filter((id) => own.has(id));

  db.update(attempts)
    .set({ flaggedJson: JSON.stringify(clean) })
    .where(eq(attempts.id, actor.attemptId))
    .run();

  return { ok: true };
}

/**
 * Grade every item and close the attempt. Used both when the student presses
 * finish and when time runs out; either way it grades what is there, with no
 * extra penalty for unanswered items.
 *
 * A `timeUp` submit comes from the client's countdown. If the server's clock
 * says the deadline is still ahead, the device clock or countdown is wrong, so
 * the attempt stays open and the client is told how much time is really left.
 */
export async function submitAttempt(
  attemptIdRaw: unknown,
  optionsRaw?: unknown,
): Promise<SubmitResult> {
  const actor = await actorForWork(attemptIdRaw);
  if (!actor.ok) return actor;

  const options = z.object({ timeUp: z.boolean().optional() }).optional().safeParse(optionsRaw);
  if (!options.success) return BAD_INPUT;

  if (options.data?.timeUp) {
    const attempt = db.select().from(attempts).where(eq(attempts.id, actor.attemptId)).get();
    if (attempt?.status === 'berjalan' && attempt.deadlineAt) {
      const left = remainingSeconds(new Date(attempt.deadlineAt * 1000)) ?? 0;
      if (left > TIMEUP_TOLERANCE_SECONDS) {
        return { ok: false, error: 'Waktu belum habis.', remainingSeconds: left };
      }
    }
  }

  const outcome = gradeAndClose(actor.attemptId);
  if (!outcome) return { ok: false, error: 'Penugasan tidak ditemukan.' };

  revalidatePath('/u');
  revalidatePath('/admin/hasil');
  revalidatePath('/wali/hasil');
  return { ok: true };
}

/**
 * Wipes an attempt back to its unstarted state so it can be worked again.
 *
 * Unlike the actions above this one is for supervisors, not the student: an
 * admin, or a parent acting on their own child. The draw is kept, so the same
 * questions come back rather than burning fresh ones from the bank.
 *
 * A finished run is archived into attempt_runs first. The first score is the
 * only one taken before the child saw the answer key, so it must survive.
 */
export async function resetAttempt(attemptIdRaw: unknown): Promise<ActionResult> {
  const attemptId = idSchema.safeParse(attemptIdRaw);
  if (!attemptId.success) return BAD_INPUT;
  const user = await actionUser();
  if (!user) return NO_SESSION;
  if (user.role === 'student' || !canAccessAttempt(sqlite, user, attemptId.data)) return DENIED;

  const attempt = db.select().from(attempts).where(eq(attempts.id, attemptId.data)).get();
  if (!attempt) return { ok: false, error: 'Penugasan tidak ditemukan.' };

  sqlite.transaction(() => {
    if (attempt.status === 'selesai') {
      const answers = sqlite
        .prepare(
          `SELECT question_id AS questionId, response_json AS responseJson,
                  points, is_correct AS isCorrect
             FROM attempt_answers WHERE attempt_id = ?`,
        )
        .all(attempt.id) as {
        questionId: string;
        responseJson: string;
        points: number | null;
        isCorrect: number | null;
      }[];
      const runNo =
        ((sqlite
          .prepare('SELECT MAX(run_no) AS n FROM attempt_runs WHERE attempt_id = ?')
          .get(attempt.id) as { n: number | null }).n ?? 0) + 1;

      sqlite
        .prepare(
          `INSERT INTO attempt_runs
             (attempt_id, run_no, started_at, submitted_at, elapsed_seconds, score_points,
              score_max, score_percent, score_breakdown_json, answers_json, archived_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          attempt.id,
          runNo,
          attempt.startedAt,
          attempt.submittedAt,
          attempt.elapsedSeconds,
          attempt.scorePoints,
          attempt.scoreMax,
          attempt.scorePercent,
          attempt.scoreBreakdownJson,
          JSON.stringify(
            Object.fromEntries(
              answers.map((a) => [
                a.questionId,
                { response: a.responseJson, points: a.points, isCorrect: Boolean(a.isCorrect) },
              ]),
            ),
          ),
          user.id,
        );
    }

    sqlite.prepare('DELETE FROM attempt_answers WHERE attempt_id = ?').run(attempt.id);
    sqlite
      .prepare(
        `UPDATE attempts
            SET status = 'belum_mulai', started_at = NULL, deadline_at = NULL,
                submitted_at = NULL, elapsed_seconds = NULL, score_points = NULL,
                score_max = NULL, score_percent = NULL, score_breakdown_json = NULL,
                flagged_json = NULL
          WHERE id = ?`,
      )
      .run(attempt.id);
  })();

  revalidatePath('/u');
  revalidatePath('/admin/hasil');
  revalidatePath('/wali/hasil');
  return { ok: true };
}
