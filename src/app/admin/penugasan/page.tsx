import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { assignmentSections, assignments, attempts } from '@/db/schema';
import { deleteAssignment } from '@/actions/assignment';
import { SUBJECT_SHORT, type Subject } from '@/domain/blueprint';
import { TIMING_MODE_LABEL, humanizeDuration, type TimingMode } from '@/domain/timing';
import { formatDateTime, sectionDrawLabel } from '@/lib/ui';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function DaftarPenugasanPage() {
  await requireUser('admin');

  const daftar = db
    .select({
      assignment: assignments,
      total: sql<number>`COUNT(${attempts.id})`,
      selesai: sql<number>`SUM(CASE WHEN ${attempts.status} = 'selesai' THEN 1 ELSE 0 END)`,
      rata: sql<number>`AVG(${attempts.scorePercent})`,
    })
    .from(assignments)
    .leftJoin(attempts, eq(attempts.assignmentId, assignments.id))
    .groupBy(assignments.id)
    .orderBy(desc(assignments.id))
    .all();

  const sectionsByAssignment = new Map<number, (typeof assignmentSections.$inferSelect)[]>();
  for (const { assignment } of daftar) {
    sectionsByAssignment.set(
      assignment.id,
      db
        .select()
        .from(assignmentSections)
        .where(eq(assignmentSections.assignmentId, assignment.id))
        .orderBy(assignmentSections.urutan)
        .all(),
    );
  }

  async function hapus(formData: FormData) {
    'use server';
    const id = Number(formData.get('id'));
    if (Number.isInteger(id)) {
      await deleteAssignment(id);
      revalidatePath('/admin/penugasan');
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Penugasan</h1>
          <p className="mt-1 text-sm text-muted">{daftar.length} penugasan pernah dibuat.</p>
        </div>
        <Link
          href="/admin/penugasan/baru"
          className="rounded-xl bg-brand px-5 py-2.5 font-semibold text-white"
        >
          Buat penugasan
        </Link>
      </div>

      {daftar.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center">
          <p className="font-medium">Belum ada penugasan.</p>
          <p className="mt-1 text-sm text-muted">
            Buat penugasan pertama untuk mulai memberi latihan.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {daftar.map(({ assignment, total, selesai, rata }) => {
            const sections = sectionsByAssignment.get(assignment.id) ?? [];
            const totalSoal = sections.reduce((sum, section) => sum + section.jumlahSoal, 0);
            return (
              <li key={assignment.id} className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold">{assignment.judul}</h2>
                    <p className="mt-1 text-sm text-muted">
                      {formatDateTime(assignment.createdAt)} &middot; {totalSoal} soal &middot;{' '}
                      {assignment.durationSeconds
                        ? humanizeDuration(assignment.durationSeconds)
                        : TIMING_MODE_LABEL.tanpa_batas}
                      {assignment.timingMode !== 'tanpa_batas'
                        ? ` (${TIMING_MODE_LABEL[assignment.timingMode as TimingMode]})`
                        : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {sections.map((section) => (
                        <span
                          key={section.id}
                          className="rounded-md bg-surface2 px-2 py-1 text-xs text-muted"
                        >
                          {SUBJECT_SHORT[section.subject as Subject]} {section.jumlahSoal}
                          {sectionDrawLabel(section.filtersJson)}
                        </span>
                      ))}
                      {assignment.allowRepeat ? (
                        <span className="rounded-md bg-warnsoft px-2 py-1 text-xs text-warn">
                          pengulangan diizinkan
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-semibold">
                        {Number(selesai ?? 0)}/{Number(total ?? 0)} selesai
                      </p>
                      <p className="text-xs text-muted">
                        {rata !== null && rata !== undefined
                          ? `rata-rata ${Math.round(Number(rata) * 10) / 10}`
                          : 'belum ada nilai'}
                      </p>
                    </div>
                    <Link
                      href={`/admin/hasil?penugasan=${assignment.id}`}
                      className="rounded-lg border border-line px-3 py-2 text-sm font-medium transition hover:border-brand"
                    >
                      Lihat hasil
                    </Link>
                    <form action={hapus}>
                      <input type="hidden" name="id" value={assignment.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-bad transition hover:border-bad"
                      >
                        Hapus
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
