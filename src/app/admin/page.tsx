import Link from 'next/link';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { assignments, attempts, questions, users } from '@/db/schema';
import { BLUEPRINT, SUBJECTS, SUBJECT_LABEL } from '@/domain/blueprint';
import { displayScore } from '@/domain/scoring';
import { formatDateTime, scoreTone } from '@/lib/ui';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  await requireUser('admin');

  const jumlahMurid = db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.aktif, true), eq(users.role, 'student')))
    .get()?.n ?? 0;

  const bankPerMapel = SUBJECTS.map((subject) => ({
    subject,
    label: SUBJECT_LABEL[subject],
    target: BLUEPRINT[subject].bankTarget,
    provisional: BLUEPRINT[subject].provisional,
    jumlah:
      db
        .select({ n: count() })
        .from(questions)
        .where(and(eq(questions.subject, subject), eq(questions.aktif, true)))
        .get()?.n ?? 0,
  }));

  const totalBank = bankPerMapel.reduce((sum, item) => sum + item.jumlah, 0);
  const totalTarget = bankPerMapel.reduce((sum, item) => sum + item.target, 0);

  const statistik = db
    .select({
      total: count(),
      selesai: sql<number>`SUM(CASE WHEN ${attempts.status} = 'selesai' THEN 1 ELSE 0 END)`,
      berjalan: sql<number>`SUM(CASE WHEN ${attempts.status} = 'berjalan' THEN 1 ELSE 0 END)`,
      belum: sql<number>`SUM(CASE WHEN ${attempts.status} = 'belum_mulai' THEN 1 ELSE 0 END)`,
      rata: sql<number>`AVG(${attempts.scorePercent})`,
    })
    .from(attempts)
    .get();

  const terbaru = db
    .select({ attempt: attempts, assignment: assignments, user: users })
    .from(attempts)
    .innerJoin(assignments, eq(attempts.assignmentId, assignments.id))
    .innerJoin(users, eq(attempts.userId, users.id))
    .where(eq(attempts.status, 'selesai'))
    .orderBy(desc(attempts.submittedAt))
    .limit(8)
    .all();

  const kartu = [
    { label: 'Murid aktif', value: String(jumlahMurid), href: '/admin/users' },
    { label: 'Soal di bank', value: `${totalBank}`, sub: `target ${totalTarget}`, href: '/admin/bank' },
    {
      label: 'Sedang dikerjakan',
      value: String(Number(statistik?.berjalan ?? 0)),
      sub: `${Number(statistik?.belum ?? 0)} belum dimulai`,
      href: '/admin/hasil',
    },
    {
      label: 'Rata-rata nilai',
      value: statistik?.rata ? displayScore(Math.round(Number(statistik.rata) * 10) / 10) : '-',
      sub: `${Number(statistik?.selesai ?? 0)} tugas selesai`,
      href: '/admin/analitik',
    },
  ];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Ringkasan latihan TKA.</p>
        </div>
        <Link
          href="/admin/penugasan/baru"
          className="rounded-xl bg-brand px-5 py-2.5 font-semibold text-white"
        >
          Buat penugasan
        </Link>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kartu.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="rounded-2xl border border-line bg-surface p-4 transition hover:border-brand sm:p-5"
          >
            <p className="text-xs uppercase tracking-wide text-muted">{item.label}</p>
            <p className="mt-2 text-3xl font-bold">{item.value}</p>
            {item.sub ? <p className="mt-1 text-xs text-muted">{item.sub}</p> : null}
          </Link>
        ))}
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Isi bank soal</h2>
          <Link href="/admin/bank" className="text-sm font-medium text-brand">
            Lihat bank soal
          </Link>
        </div>
        <ul className="space-y-4">
          {bankPerMapel.map((item) => {
            const persen = Math.min(100, Math.round((item.jumlah / item.target) * 100));
            return (
              <li key={item.subject}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {item.label}
                    {item.provisional ? (
                      <span className="ml-2 rounded bg-warnsoft px-1.5 py-0.5 text-[11px] text-warn">
                        provisional
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums text-muted">
                    {item.jumlah} / {item.target}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-surface2">
                  <div
                    className="h-full rounded-full bg-brand transition-all"
                    style={{ width: `${Math.max(persen, 2)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        {totalBank < totalTarget ? (
          <p className="mt-4 rounded-xl bg-surface2 p-3 text-sm text-muted">
            Bank soal belum penuh. Tambah file batch baru di <code className="rounded bg-surface px-1.5 py-0.5">content/bank/</code>, lalu jalankan{' '}
            <code className="rounded bg-surface px-1.5 py-0.5">npm run bank:sync</code>.
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Hasil terbaru</h2>
          <Link href="/admin/hasil" className="text-sm font-medium text-brand">
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
                  href={`/admin/hasil/${attempt.id}`}
                  className="flex items-center gap-3 py-3 transition hover:opacity-80"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{user.nama}</p>
                    <p className="truncate text-xs text-muted">
                      {assignment.judul} &middot; {formatDateTime(attempt.submittedAt)}
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
