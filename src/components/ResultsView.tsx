import Link from 'next/link';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { assignments, attempts, users } from '@/db/schema';
import { countQuestionsInAttempt } from '@/lib/attempt';
import { closeExpiredFor } from '@/lib/grading';
import { PrintButton } from '@/components/PrintButton';
import { displayScore } from '@/domain/scoring';
import { humanizeDuration } from '@/domain/timing';
import { STATUS_CLASS, STATUS_LABEL, formatDateTime, scoreTone } from '@/lib/ui';

/**
 * The results table, shared by the admin panel and the parent area.
 *
 * `scope` is the list of student ids the viewer is allowed to see, or null for
 * an admin who may see everyone. It is applied to the query here rather than
 * being left to the caller, so a page cannot forget it.
 */

type Props = {
  scope: number[] | null;
  basePath: string;
  penugasan?: string;
  murid?: string;
  showExport?: boolean;
};

export function ResultsView({ scope, basePath, penugasan, murid, showExport = true }: Props) {
  // An attempt whose time ran out while the child was away is graded now, so
  // it does not sit here as "in progress" until the child next signs in.
  closeExpiredFor(scope);

  // Scoped in SQL, and only the user columns the table shows: never the
  // password hash.
  const semua =
    scope !== null && scope.length === 0
      ? []
      : db
          .select({
            attempt: attempts,
            assignment: assignments,
            user: { id: users.id, nama: users.nama },
          })
          .from(attempts)
          .innerJoin(assignments, eq(attempts.assignmentId, assignments.id))
          .innerJoin(users, eq(attempts.userId, users.id))
          .where(scope === null ? undefined : inArray(attempts.userId, scope))
          .orderBy(desc(attempts.id))
          .all();

  const filterPenugasan = penugasan ? Number(penugasan) : null;
  const filterMurid = murid ? Number(murid) : null;

  const baris = semua.filter(
    ({ assignment, user }) =>
      (filterPenugasan === null || assignment.id === filterPenugasan) &&
      (filterMurid === null || user.id === filterMurid),
  );

  const selesai = baris.filter(({ attempt }) => attempt.status === 'selesai');
  const rata =
    selesai.length > 0
      ? selesai.reduce((sum, { attempt }) => sum + (attempt.scorePercent ?? 0), 0) / selesai.length
      : null;

  const daftarPenugasan = [
    ...new Map(semua.map((row) => [row.assignment.id, row.assignment])).values(),
  ];
  const daftarMurid = [...new Map(semua.map((row) => [row.user.id, row.user])).values()];

  const csvHref = `${basePath}/ekspor${penugasan ? `?penugasan=${penugasan}` : ''}`;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Hasil pengerjaan</h1>
          <p className="mt-1 text-sm text-muted">
            {baris.length} baris &middot; {selesai.length} selesai
            {rata !== null ? ` · rata-rata ${Math.round(rata * 10) / 10}` : ''}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <PrintButton />
          {showExport ? (
            <a
              href={csvHref}
              className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold transition hover:border-brand"
            >
              Ekspor CSV
            </a>
          ) : null}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <Link
          href={basePath}
          className={`rounded-lg border px-3 py-1.5 text-sm ${
            !penugasan && !murid ? 'border-brand bg-brandsoft text-brand' : 'border-line text-muted'
          }`}
        >
          Semua
        </Link>
        {daftarMurid.map((user) => (
          <Link
            key={user.id}
            href={`${basePath}?murid=${user.id}`}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              filterMurid === user.id
                ? 'border-brand bg-brandsoft text-brand'
                : 'border-line text-muted'
            }`}
          >
            {user.nama}
          </Link>
        ))}
      </div>

      {filterPenugasan !== null ? (
        <p className="mb-4 rounded-xl bg-brandsoft px-4 py-2.5 text-sm text-brand">
          Disaring untuk penugasan:{' '}
          <strong>
            {daftarPenugasan.find((a) => a.id === filterPenugasan)?.judul ?? filterPenugasan}
          </strong>
        </p>
      ) : null}

      {baris.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-10 text-center text-muted">
          Belum ada hasil untuk ditampilkan.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="p-3 font-semibold">Murid</th>
                <th className="p-3 font-semibold">Penugasan</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 text-right font-semibold">Nilai</th>
                <th className="p-3 text-right font-semibold">Waktu</th>
                <th className="p-3 font-semibold">Selesai</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {baris.map(({ attempt, assignment, user }) => (
                <tr key={attempt.id} className="border-b border-line last:border-0">
                  <td className="p-3 font-medium">{user.nama}</td>
                  <td className="p-3">
                    <span className="block max-w-[16rem] truncate">{assignment.judul}</span>
                    <span className="text-xs text-muted">
                      {countQuestionsInAttempt(attempt)} soal
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[attempt.status]}`}
                    >
                      {STATUS_LABEL[attempt.status]}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {attempt.status === 'selesai' ? (
                      <span className={`font-bold ${scoreTone(attempt.scorePercent ?? 0)}`}>
                        {displayScore(attempt.scorePercent ?? 0)}
                      </span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className="p-3 text-right text-muted">
                    {attempt.elapsedSeconds ? humanizeDuration(attempt.elapsedSeconds) : '-'}
                  </td>
                  <td className="p-3 text-muted">{formatDateTime(attempt.submittedAt)}</td>
                  <td className="p-3 text-right">
                    <Link
                      href={`${basePath}/${attempt.id}`}
                      className="font-medium text-brand underline underline-offset-4"
                    >
                      Detail
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
