'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { sqlite } from '@/db/client';
import { canAccessAttempt } from '@/domain/access';
import { parseIdList } from '@/domain/question';
import { actionUser } from '@/lib/auth';

/**
 * Question reports: anyone who may see an attempt may flag one of its items.
 *
 * Tying a report to an attempt, rather than accepting any question id, means a
 * report can only be filed about an item the reporter has actually been shown.
 */

type Result = { ok: true } | { ok: false; error: string };

const MAX_OPEN_REPORTS_PER_USER = 50;

const inputSchema = z.object({
  attemptId: z.number().int().positive(),
  questionId: z.string().min(1).max(64),
  pesan: z.string().trim().min(3).max(500),
});

export async function reportQuestion(
  attemptId: unknown,
  questionId: unknown,
  pesan: unknown,
): Promise<Result> {
  const user = await actionUser();
  if (!user) return { ok: false, error: 'Sesi berakhir. Silakan masuk lagi.' };

  const input = inputSchema.safeParse({ attemptId, questionId, pesan });
  if (!input.success) return { ok: false, error: 'Tulis laporan minimal 3 karakter.' };
  const { attemptId: aid, questionId: qid, pesan: text } = input.data;

  if (!canAccessAttempt(sqlite, user, aid)) {
    return { ok: false, error: 'Tidak berwenang atas penugasan ini.' };
  }
  const attempt = sqlite
    .prepare('SELECT question_order_json AS orderJson FROM attempts WHERE id = ?')
    .get(aid) as { orderJson: string } | undefined;
  if (!attempt || !parseIdList(attempt.orderJson).includes(qid)) {
    return { ok: false, error: 'Soal tidak ada dalam penugasan ini.' };
  }

  // A cheap guard against one account flooding the admin's list.
  const open = sqlite
    .prepare('SELECT COUNT(*) AS n FROM question_reports WHERE user_id = ? AND resolved_at IS NULL')
    .get(user.id) as { n: number };
  if (open.n >= MAX_OPEN_REPORTS_PER_USER) {
    return { ok: false, error: 'Terlalu banyak laporan yang belum ditinjau admin.' };
  }

  sqlite
    .prepare(
      'INSERT INTO question_reports (question_id, user_id, attempt_id, pesan) VALUES (?, ?, ?, ?)',
    )
    .run(qid, user.id, aid, text);

  revalidatePath('/admin/bank');
  return { ok: true };
}

/** Admin only: mark a report as dealt with. */
export async function resolveReport(formData: FormData): Promise<Result> {
  const user = await actionUser();
  if (!user || user.role !== 'admin') return { ok: false, error: 'Hanya admin.' };

  const id = z.coerce.number().int().positive().safeParse(formData.get('id'));
  if (!id.success) return { ok: false, error: 'Laporan tidak ditemukan.' };

  sqlite
    .prepare('UPDATE question_reports SET resolved_at = unixepoch() WHERE id = ? AND resolved_at IS NULL')
    .run(id.data);

  revalidatePath('/admin/bank');
  return { ok: true };
}
