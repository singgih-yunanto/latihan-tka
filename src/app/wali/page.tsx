import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { assignments, attempts, users } from '@/db/schema';
import { countQuestionsInAttempt } from '@/lib/attempt';
import { displayScore } from '@/domain/scoring';
import { humanizeDuration } from '@/domain/timing';
import { requireUser, studentsVisibleTo } from '@/lib/auth';
import { STATUS_CLASS, STATUS_LABEL, avatarClass, formatDateTime, initials, scoreTone } from '@/lib/ui';

export const dynamic = 'force-dynamic';

/** What each of this parent's children is working on, and how it is going. */
export default async function WaliDashboardPage() {
  const me = await requireUser('parent');
  const anakIds = studentsVisibleTo(me);

  if (anakIds.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-8 text-center">
        <h1 className="text-xl font-bold">Belum ada anak yang terhubung</h1>
        <p className="mt-2 text-sm text-muted">
          Minta admin menghubungkan akunmu dengan akun anakmu. Setelah itu kamu bisa memberi tugas
          dan memantau hasilnya di sini.
        </p>
      </div>
    );
  }

  const anak = db.select().from(users).where(inArray(users.id, anakIds)).orderBy(users.nama).all();

  const semua = db
    .select({ attempt: attempts, assignment: assignments })
    .from(attempts)
    .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
    .where(inArray(attempts.userId, anakIds))
    .orderBy(desc(attempts.id))
    .all();

  const terbaru = db
    .select({ attempt: attempts, assignment: assignments, user: users })
    .from(attempts)
    .innerJoin(assignments, eq(assignments.id, attempts.assignmentId))
    .innerJoin(users, eq(users.id, attempts.userId))
    .where(and(inArray(attempts.userId, anakIds), eq(attempts.status, 'selesai')))
    .orderBy(desc(attempts.submittedAt))
    .limit(8)
    .all();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Ringkasan</h1>
          <p className="mt-1 text-sm text-muted">
            {anak.length === 1 ? 'Perkembangan anakmu.' : `Perkembangan ${anak.length} anak.`}
          </p>
        </div>
        <Link
          href="/wali/penugasan/baru"
          className="rounded-xl bg-brand px-5 py-2.5 font-semibold text-white"
        >
          Beri tugas
        </Link>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {anak.map((murid) => {
          const miliknya = semua.filter(({ attempt }) => attempt.userId === murid.id);
          const selesai = miliknya.filter(({ attempt }) => attempt.status === 'selesai');
          const menunggu = miliknya.filter(({ attempt }) => attempt.status !== 'selesai');
          const rata =
            selesai.length > 0
              ? selesai.reduce((sum, { attempt }) => sum + (attempt.scorePercent ?? 0), 0) /
                selesai.length
              : null;

          return (
            <li key={murid.id} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-bold text-white ${avatarClass(murid.avatarWarna)}`}
                  aria-hidden="true"
                >
                  {initials(murid.nama)}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-bold">{murid.nama}</h2>
                  <p className="text-sm text-muted">
                    {selesai.length} tugas selesai
                    {rata !== null ? ` · rata-rata ${Math.round(rata * 10) / 10}` : ''}
                  </p>
                </div>
                <Link
                  href={`/wali/hasil?murid=${murid.id}`}
                  className="shrink-0 text-sm font-medium text-brand underline underline-offset-4"
                >
                  Hasil
                </Link>
              </div>

              {menunggu.length > 0 ? (
                <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                  {menunggu.slice(0, 3).map(({ attempt, assignment }) => (
                    <li key={attempt.id} className="flex items-center gap-2 text-sm">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[attempt.status]}`}
                      >
                        {STATUS_LABEL[attempt.status]}
                      </span>
                      <span className="min-w-0 truncate">{assignment.judul}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted">
                        {countQuestionsInAttempt(attempt)} soal
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
                  Tidak ada tugas yang menunggu.
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Hasil terbaru</h2>
          <Link href="/wali/hasil" className="text-sm font-medium text-brand">
            Semua hasil
          </Link>
        </div>

        {terbaru.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Belum ada tugas yang diselesaikan.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {terbaru.map(({ attempt, assignment, user }) => (
              <li key={attempt.id}>
                <Link
                  href={`/wali/hasil/${attempt.id}`}
                  className="flex items-center gap-3 py-3 transition hover:opacity-80"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{user.nama}</p>
                    <p className="truncate text-xs text-muted">
                      {assignment.judul} &middot; {formatDateTime(attempt.submittedAt)}
                      {attempt.elapsedSeconds
                        ? ` · ${humanizeDuration(attempt.elapsedSeconds)}`
                        : ''}
                    </p>
                  </div>
                  <span className={`text-lg font-bold ${scoreTone(attempt.scorePercent ?? 0)}`}>
                    {displayScore(attempt.scorePercent ?? 0)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
