import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AttemptRunner } from '@/components/AttemptRunner';
import { loadAttemptView } from '@/lib/attempt';
import { startAttempt } from '@/actions/attempt';
import { requireUser } from '@/lib/auth';
import { closeIfExpired } from '@/lib/grading';
import { SUBJECT_LABEL, type Subject } from '@/domain/blueprint';
import { humanizeDuration, remainingSeconds } from '@/domain/timing';

export const dynamic = 'force-dynamic';

export default async function AttemptPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ n?: string }>;
}) {
  const murid = await requireUser('student');
  const { attemptId: attemptIdRaw } = await params;
  const { n } = await searchParams;

  const attemptId = Number(attemptIdRaw);
  if (!Number.isInteger(attemptId)) notFound();

  closeIfExpired(attemptId);

  const view = await loadAttemptView(attemptId);
  // Someone else's attempt is simply not found, which tells a prober nothing.
  if (!view || view.attempt.userId !== murid.id) notFound();

  if (view.attempt.status === 'selesai') {
    redirect(`/u/attempt/${attemptId}/hasil`);
  }

  if (view.attempt.status === 'belum_mulai') {
    async function mulai() {
      'use server';
      const result = await startAttempt(attemptId);
      // On failure (finished meanwhile, session gone) the page itself shows
      // the right state or sends the student to sign in.
      if (!result.ok) redirect(`/u?galat=${encodeURIComponent(result.error)}`);
      redirect(`/u/attempt/${attemptId}`);
    }

    const perMapel = new Map<Subject, number>();
    for (const question of view.questions) {
      perMapel.set(question.subject, (perMapel.get(question.subject) ?? 0) + 1);
    }

    return (
      <main className="mx-auto w-full max-w-lg px-4 py-6 sm:py-12">
        <div className="rounded-2xl border border-line bg-surface p-5 text-center sm:p-7">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand">Siap berlatih?</p>
          <h1 className="mt-2 text-2xl font-bold break-words">{view.assignment.judul}</h1>

          <dl className="mt-6 grid grid-cols-2 gap-3 text-left">
            <div className="rounded-xl bg-surface2 p-4">
              <dt className="text-xs text-muted">Jumlah soal</dt>
              <dd className="mt-1 text-xl font-bold">{view.questions.length}</dd>
            </div>
            <div className="rounded-xl bg-surface2 p-4">
              <dt className="text-xs text-muted">Waktu</dt>
              <dd className="mt-1 text-xl font-bold">
                {view.assignment.durationSeconds
                  ? humanizeDuration(view.assignment.durationSeconds)
                  : 'Bebas'}
              </dd>
            </div>
          </dl>

          <ul className="mt-4 space-y-1.5 text-left text-sm text-muted">
            {[...perMapel.entries()].map(([subject, jumlah]) => (
              <li key={subject} className="flex justify-between rounded-lg bg-surface2 px-3 py-2">
                <span>{SUBJECT_LABEL[subject]}</span>
                <span className="font-semibold">{jumlah} soal</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 rounded-xl bg-brandsoft p-4 text-left text-sm">
            <p className="font-semibold text-brand">Yang perlu kamu tahu</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink">
              <li>Kamu bebas maju-mundur ke soal mana pun dan mengubah jawaban.</li>
              <li>Jawaban tersimpan otomatis, jadi aman kalau halaman tertutup.</li>
              {view.assignment.durationSeconds ? (
                <li>Waktu mulai berjalan setelah kamu menekan tombol di bawah.</li>
              ) : (
                <li>Tidak ada batas waktu, kerjakan dengan tenang.</li>
              )}
            </ul>
          </div>

          <form action={mulai} className="mt-6">
            <button
              type="submit"
              className="w-full rounded-xl bg-brand px-6 py-4 text-lg font-bold text-white transition hover:opacity-90"
            >
              Mulai mengerjakan
            </button>
          </form>

          <Link
            href="/u"
            className="mt-4 inline-block text-sm text-muted underline underline-offset-4"
          >
            Kembali ke daftar tugas
          </Link>
        </div>
      </main>
    );
  }

  const startIndex = Math.max(0, Number(n ?? '1') - 1) || 0;

  return (
    <AttemptRunner
      attemptId={attemptId}
      judul={view.assignment.judul}
      questions={view.questions}
      initialResponses={view.responses}
      initialFlagged={view.flagged}
      remainingAtLoad={remainingSeconds(
        view.attempt.deadlineAt ? new Date(view.attempt.deadlineAt * 1000) : null,
      )}
      startIndex={startIndex}
    />
  );
}
