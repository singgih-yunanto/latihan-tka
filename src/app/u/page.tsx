import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { db, sqlite } from '@/db/client';
import { assignmentSections } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { countQuestionsInAttempt, listAttemptsForUser } from '@/lib/attempt';
import { closeIfExpired } from '@/lib/grading';
import { SUBJECT_SHORT, type Subject } from '@/domain/blueprint';
import { displayScore } from '@/domain/scoring';
import { isRankingEnabled } from '@/domain/settings';
import { humanizeDuration } from '@/domain/timing';
import {
  STATUS_CLASS,
  STATUS_LABEL,
  avatarClass,
  formatDate,
  formatDateTime,
  initials,
  isOverdue,
  scoreTone,
} from '@/lib/ui';

export const dynamic = 'force-dynamic';

/**
 * A student's assignment list, grouped by status.
 *
 * The student comes from the session, not the URL. That is the whole reason
 * this route no longer has a `[userId]` segment: there is no id to tamper with.
 */
export default async function DaftarTugasPage({
  searchParams,
}: {
  searchParams: Promise<{ galat?: string }>;
}) {
  const { galat } = await searchParams;
  const murid = await requireUser('student');
  const userId = murid.id;

  const semua = listAttemptsForUser(userId);

  // Assignments whose time ran out while the student was away still get graded.
  for (const { attempt } of semua) {
    if (attempt.status === 'berjalan') closeIfExpired(attempt.id);
  }
  const daftar = listAttemptsForUser(userId);

  const sectionsByAssignment = new Map<number, (typeof assignmentSections.$inferSelect)[]>();
  for (const { assignment } of daftar) {
    if (sectionsByAssignment.has(assignment.id)) continue;
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

  const aktif = daftar.filter(({ attempt }) => attempt.status !== 'selesai');
  const selesai = daftar.filter(({ attempt }) => attempt.status === 'selesai').reverse();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center gap-4">
        <span
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white ${avatarClass(murid.avatarWarna)}`}
          aria-hidden="true"
        >
          {initials(murid.nama)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold sm:text-2xl">Halo, {murid.nama}!</h1>
          <p className="text-sm text-muted">
            {aktif.length > 0 ? `${aktif.length} tugas menunggu dikerjakan` : 'Tidak ada tugas baru'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-sm">
          {isRankingEnabled(sqlite) ? (
            <Link href="/u/peringkat" className="font-medium text-brand underline underline-offset-4">
              Peringkat
            </Link>
          ) : null}
          <Link href="/akun" className="text-muted underline underline-offset-4">
            Akun
          </Link>
          <Link href="/keluar" className="text-muted underline underline-offset-4">
            Keluar
          </Link>
        </div>
      </header>

      {galat ? (
        <p role="alert" className="mb-4 rounded-xl bg-badsoft px-4 py-2.5 text-sm font-medium text-bad">
          {galat.slice(0, 200)}
        </p>
      ) : null}

      {daftar.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-8 text-center">
          <p className="font-medium">Belum ada tugas latihan.</p>
          <p className="mt-1 text-sm text-muted">Tunggu guru atau orang tuamu membuat penugasan.</p>
        </div>
      ) : null}

      {aktif.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Perlu dikerjakan
          </h2>
          <ul className="space-y-3">
            {aktif.map(({ attempt, assignment }) => {
              const sections = sectionsByAssignment.get(assignment.id) ?? [];
              const jumlah = countQuestionsInAttempt(attempt);
              return (
                <li key={attempt.id}>
                  <Link
                    href={`/u/attempt/${attempt.id}`}
                    className="block rounded-2xl border border-line bg-surface p-5 transition hover:border-brand hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold">{assignment.judul}</h3>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[attempt.status]}`}
                      >
                        {STATUS_LABEL[attempt.status]}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted">
                      {jumlah} soal &middot;{' '}
                      {assignment.durationSeconds
                        ? humanizeDuration(assignment.durationSeconds)
                        : 'tanpa batas waktu'}
                    </p>
                    {assignment.dueAt ? (
                      <p
                        className={`mt-1 text-sm font-medium ${
                          isOverdue(assignment.dueAt) ? 'text-bad' : 'text-warn'
                        }`}
                      >
                        {isOverdue(assignment.dueAt) ? 'Terlambat · tenggat ' : 'Tenggat '}
                        {formatDate(assignment.dueAt)}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {sections.map((section) => (
                        <span
                          key={section.id}
                          className="rounded-md bg-surface2 px-2 py-1 text-xs text-muted"
                        >
                          {SUBJECT_SHORT[section.subject as Subject]} {section.jumlahSoal}
                        </span>
                      ))}
                    </div>
                    <p className="mt-4 text-sm font-semibold text-brand">
                      {attempt.status === 'berjalan' ? 'Lanjutkan mengerjakan →' : 'Mulai mengerjakan →'}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {selesai.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Sudah selesai
          </h2>
          <ul className="space-y-3">
            {selesai.map(({ attempt, assignment }) => (
              <li key={attempt.id}>
                <Link
                  href={`/u/attempt/${attempt.id}/hasil`}
                  className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 transition hover:border-brand"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{assignment.judul}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {formatDateTime(attempt.submittedAt)} &middot;{' '}
                      {attempt.elapsedSeconds ? humanizeDuration(attempt.elapsedSeconds) : '-'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-2xl font-bold ${scoreTone(attempt.scorePercent ?? 0)}`}>
                      {displayScore(attempt.scorePercent ?? 0)}
                    </p>
                    <p className="text-xs text-muted">nilai</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
