'use server';

import { randomInt } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, sqlite } from '@/db/client';
import { assignmentSections, assignments, attempts, questions, users } from '@/db/schema';
import {
  NotEnoughQuestionsError,
  countAvailable,
  drawForUser,
  recordHistory,
  type DrawSection,
} from '@/domain/draw';
import { assignableStudentIds, canManageAssignment } from '@/domain/access';
import { actionUser, type SessionUser } from '@/lib/auth';
import {
  TIMING_MODES,
  customMinutesProblem,
  resolveDurationSeconds,
} from '@/domain/timing';
import { makeRng, shuffleOptionIds } from '@/domain/shuffle';
import {
  parseAnswerKey,
  parseQuestionBody,
  shufflableIds,
  type ItemSnapshot,
  type QuestionType,
} from '@/domain/question';
import { DIFFICULTIES, QUESTION_TYPES, SUBJECTS } from '@/domain/blueprint';

/**
 * Assignment creation by the admin.
 *
 * One assignment holds several sections, one per subject, each with a question
 * count chosen by the admin. Every student gets their own attempt with its own
 * draw, so two children on the same assignment never receive an identical set.
 *
 * Both admins and parents create assignments; a parent may only name their own
 * children. That is enforced here rather than in the form, because the form is
 * a suggestion and this action is the actual gate. For the same reason every
 * input is parsed with zod: the TypeScript types below bind the form, not an
 * attacker calling the action endpoint directly.
 */

const MAX_TOTAL_QUESTIONS = 200;

const filtersSchema = z
  .object({
    domains: z.array(z.string().max(64)).max(20).optional(),
    competencies: z.array(z.string().max(64)).max(20).optional(),
    difficulties: z.array(z.enum(DIFFICULTIES)).max(3).optional(),
    types: z.array(z.enum(QUESTION_TYPES)).max(3).optional(),
  })
  .strict();

const sectionSchema = z.object({
  subject: z.enum(SUBJECTS),
  jumlahSoal: z.number().int().min(0).max(MAX_TOTAL_QUESTIONS),
  filters: filtersSchema.nullish(),
  blueprint: z.boolean().optional(),
});

const userIdsSchema = z.array(z.number().int().positive()).max(500);

const createSchema = z.object({
  judul: z.string().max(120),
  sections: z.array(sectionSchema).min(1).max(10),
  userIds: userIdsSchema,
  timingMode: z.enum(TIMING_MODES),
  customMinutes: z.number().nullish(),
  allowRepeat: z.boolean(),
  /** "YYYY-MM-DD", the last day to finish. Optional. */
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});

export type SectionInput = z.infer<typeof sectionSchema>;
export type CreateAssignmentInput = z.infer<typeof createSchema>;

export type CreateResult =
  | { ok: true; assignmentId: number; jumlahAttempt: number }
  | { ok: false; error: string };

const BAD_INPUT = { ok: false, error: 'Data penugasan tidak valid.' } as const;

/**
 * Narrows a requested list of students to the ones this actor may assign to.
 *
 * Returns an error rather than silently dropping the strangers: quietly
 * creating an assignment for a subset of what was asked for would look like
 * success while doing something else.
 */
function scopeUserIds(
  actor: SessionUser,
  userIds: number[],
): { ok: true; ids: number[] } | { ok: false; error: string } {
  const allowed = new Set(assignableStudentIds(sqlite, actor));
  const unique = [...new Set(userIds)];
  if (unique.some((id) => !allowed.has(id))) {
    return { ok: false, error: 'Ada murid di luar daftar yang boleh kamu tugaskan.' };
  }
  return { ok: true, ids: unique };
}

/** End of the given day in the app's timezone, as epoch seconds. */
function endOfDay(date: string): number {
  // Asia/Jakarta has no daylight saving, so a fixed +07:00 offset is exact.
  return Math.floor(new Date(`${date}T23:59:59+07:00`).getTime() / 1000);
}

/** Unseen question availability per student per subject, for the preview. */
export async function checkAvailability(
  sectionsRaw: unknown,
  userIdsRaw: unknown,
): Promise<{ userId: number; nama: string; perSection: { subject: (typeof SUBJECTS)[number]; diminta: number; tersedia: number }[] }[]> {
  const sections = z.array(sectionSchema).max(10).safeParse(sectionsRaw);
  const userIds = userIdsSchema.safeParse(userIdsRaw);
  if (!sections.success || !userIds.success || userIds.data.length === 0) return [];

  const actor = await actionUser();
  if (!actor || actor.role === 'student') return [];

  const scoped = scopeUserIds(actor, userIds.data);
  if (!scoped.ok) return [];

  const daftar = db
    .select({ id: users.id, nama: users.nama })
    .from(users)
    .where(inArray(users.id, scoped.ids))
    .all();

  return daftar.map((murid) => ({
    userId: murid.id,
    nama: murid.nama,
    perSection: sections.data
      .filter((section) => section.jumlahSoal > 0)
      .map((section) => ({
        subject: section.subject,
        diminta: section.jumlahSoal,
        tersedia: countAvailable(sqlite, murid.id, section.subject, section.filters),
      })),
  }));
}

export async function createAssignment(raw: unknown): Promise<CreateResult> {
  const actor = await actionUser();
  if (!actor) return { ok: false, error: 'Sesi berakhir. Silakan masuk lagi.' };
  if (actor.role === 'student') return { ok: false, error: 'Tidak berwenang membuat penugasan.' };

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return BAD_INPUT;
  const input = parsed.data;

  const judul = input.judul.trim();
  if (!judul) return { ok: false, error: 'Judul penugasan belum diisi.' };

  const sections = input.sections.filter((section) => section.jumlahSoal > 0);
  if (sections.length === 0) {
    return { ok: false, error: 'Tentukan jumlah soal untuk setidaknya satu mata pelajaran.' };
  }
  if (input.userIds.length === 0) {
    return { ok: false, error: 'Pilih setidaknya satu murid.' };
  }

  const scoped = scopeUserIds(actor, input.userIds);
  if (!scoped.ok) return scoped;

  const totalSoal = sections.reduce((sum, section) => sum + section.jumlahSoal, 0);
  if (totalSoal > MAX_TOTAL_QUESTIONS) {
    return {
      ok: false,
      error: `Jumlah soal terlalu banyak untuk satu penugasan (maksimal ${MAX_TOTAL_QUESTIONS}).`,
    };
  }

  if (input.timingMode === 'custom') {
    const problem = customMinutesProblem(input.customMinutes);
    if (problem) return { ok: false, error: problem };
  }
  const durationSeconds = resolveDurationSeconds(
    input.timingMode,
    totalSoal,
    input.customMinutes ?? null,
  );

  const dueAt = input.dueDate ? endOfDay(input.dueDate) : null;
  if (dueAt !== null && (!Number.isFinite(dueAt) || dueAt < Date.now() / 1000)) {
    return { ok: false, error: 'Tenggat harus hari ini atau sesudahnya.' };
  }

  const drawSections: DrawSection[] = sections.map((section) => ({
    subject: section.subject,
    count: section.jumlahSoal,
    filters: section.filters ?? null,
    blueprint: section.blueprint ?? false,
  }));

  // Option order is shuffled once and then stored, so reloading never
  // reshuffles it and the results page shows the same order. The type, options
  // and key are frozen alongside it, so later bank edits never regrade this
  // attempt behind anyone's back.
  const prepareItems = (questionIds: string[]) => {
    const orders: Record<string, string[]> = {};
    const snapshot: Record<string, ItemSnapshot> = {};
    if (questionIds.length === 0) return { orders, snapshot };

    const rows = db.select().from(questions).where(inArray(questions.id, questionIds)).all();
    const rng = makeRng(randomInt(0, 2 ** 31));
    for (const row of rows) {
      const body = parseQuestionBody(row.optionsJson);
      const answer = parseAnswerKey(row.answerJson);
      if (!body || !answer) continue;
      orders[row.id] = shuffleOptionIds(shufflableIds(body), rng);
      snapshot[row.id] = { type: row.type as QuestionType, body, answer };
    }
    return { orders, snapshot };
  };

  let assignmentId = 0;
  let dibuat = 0;

  try {
    const run = sqlite.transaction(() => {
      const created = db
        .insert(assignments)
        .values({
          judul,
          selectionMode: 'random',
          timingMode: input.timingMode,
          durationSeconds,
          allowRepeat: input.allowRepeat,
          dueAt,
          createdBy: actor.id,
        })
        .returning({ id: assignments.id })
        .get();

      assignmentId = created.id;

      sections.forEach((section, i) => {
        db.insert(assignmentSections)
          .values({
            assignmentId,
            urutan: i,
            subject: section.subject,
            jumlahSoal: section.jumlahSoal,
            filtersJson:
              section.filters || section.blueprint
                ? JSON.stringify({ ...(section.filters ?? {}), blueprint: section.blueprint ?? false })
                : null,
          })
          .run();
      });

      for (const userId of scoped.ids) {
        const drawn = drawForUser(sqlite, userId, drawSections, input.allowRepeat);
        const { orders, snapshot } = prepareItems(drawn);

        const attempt = db
          .insert(attempts)
          .values({
            assignmentId,
            userId,
            status: 'belum_mulai',
            questionOrderJson: JSON.stringify(drawn),
            optionOrdersJson: JSON.stringify(orders),
            itemSnapshotJson: JSON.stringify(snapshot),
          })
          .returning({ id: attempts.id })
          .get();

        // History is recorded at draw time, not at submit time, so two
        // assignments created back to back cannot overlap.
        recordHistory(sqlite, userId, drawn, attempt.id);
        dibuat += 1;
      }
    });

    run();
  } catch (error) {
    if (error instanceof NotEnoughQuestionsError) {
      return {
        ok: false,
        error: `${error.message}. Kurangi jumlah soal, longgarkan filter, tambah soal ke bank, atau izinkan pengulangan.`,
      };
    }
    // The raw message can carry SQL details; keep it in the server log only.
    console.error('createAssignment failed', error);
    return { ok: false, error: 'Gagal membuat penugasan. Coba lagi.' };
  }

  revalidatePath('/admin/penugasan');
  revalidatePath('/admin/hasil');
  revalidatePath('/wali');
  revalidatePath('/u');
  return { ok: true, assignmentId, jumlahAttempt: dibuat };
}

export async function deleteAssignment(
  assignmentIdRaw: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await actionUser();
  if (!actor) return { ok: false, error: 'Sesi berakhir. Silakan masuk lagi.' };

  const assignmentId = z.number().int().positive().safeParse(assignmentIdRaw);
  if (!assignmentId.success || !canManageAssignment(sqlite, actor, assignmentId.data)) {
    return { ok: false, error: 'Tidak berwenang atas penugasan ini.' };
  }

  // Question history is deliberately NOT removed: items a student has already
  // seen stay marked as used so they never reappear later.
  db.delete(assignments).where(eq(assignments.id, assignmentId.data)).run();

  revalidatePath('/admin/penugasan');
  revalidatePath('/admin/hasil');
  revalidatePath('/wali');
  revalidatePath('/u');
  return { ok: true };
}
