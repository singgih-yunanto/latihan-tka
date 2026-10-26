import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ItemExplanation } from '@/components/ItemExplanation';
import { loadAttemptView, loadReviewExtras } from '@/lib/attempt';
import { requireUser } from '@/lib/auth';
import {
  SUBJECT_LABEL,
  competencyLabel,
  domainLabel,
  type Subject,
} from '@/domain/blueprint';
import { displayScore, parseBreakdown, type Breakdown } from '@/domain/scoring';
import { humanizeDuration } from '@/domain/timing';
import { scoreTone } from '@/lib/ui';

export const dynamic = 'force-dynamic';

function BreakdownList({ items, title }: { items: Breakdown[]; title: string }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{item.label ?? item.key}</span>
              <span className="shrink-0 font-semibold tabular-nums">
                {item.correctCount}/{item.count}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface2">
              <div
                className={`h-full rounded-full ${
                  item.percent >= 80 ? 'bg-ok' : item.percent >= 60 ? 'bg-warn' : 'bg-bad'
                }`}
                style={{ width: `${Math.max(item.percent, 2)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function HasilPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const murid = await requireUser('student');
  const { attemptId: attemptIdRaw } = await params;
  const attemptId = Number(attemptIdRaw);
  if (!Number.isInteger(attemptId)) notFound();

  const view = await loadAttemptView(attemptId);
  if (!view || view.attempt.userId !== murid.id) notFound();
  if (view.attempt.status !== 'selesai') redirect(`/u/attempt/${attemptId}`);

  const extras = loadReviewExtras(
    view.questions.map((q) => q.id),
    view.attempt.itemSnapshotJson,
  );
  const persen = view.attempt.scorePercent ?? 0;

  // A corrupt breakdown comes back empty and must not stop the score showing.
  const breakdown = parseBreakdown(view.attempt.scoreBreakdownJson);

  const labeled = (items: Breakdown[], kind: 'domain' | 'competency'): Breakdown[] =>
    items.map((item) => {
      const [subject, key] = item.key.split(':') as [Subject, string];
      return {
        ...item,
        label: `${kind === 'domain' ? domainLabel(subject, key) : competencyLabel(subject, key)}`,
      };
    });

  // Taken from the breakdown stored at grading time so it covers all three
  // question formats, not just simple multiple choice.
  const benar = breakdown.bySubject.reduce((sum, item) => sum + item.correctCount, 0);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-6 rounded-2xl border border-line bg-surface p-6 text-center">
        <p className="text-sm text-muted">{view.assignment.judul}</p>
        <p className={`mt-2 text-5xl font-bold ${scoreTone(persen)}`}>{displayScore(persen)}</p>
        <p className="mt-1 text-sm text-muted">
          dari 100 &middot; {view.questions.length} soal &middot;{' '}
          {view.attempt.elapsedSeconds ? humanizeDuration(view.attempt.elapsedSeconds) : '-'}
        </p>
        <p className="mt-1 text-xs text-muted">
          {benar} soal dijawab tepat sepenuhnya
        </p>
      </header>

      {breakdown.bySubject.length > 1 ? (
        <section className="mb-6 grid gap-3 sm:grid-cols-3">
          {breakdown.bySubject.map((item) => (
            <div key={item.key} className="rounded-2xl border border-line bg-surface p-4 text-center">
              <p className="text-xs text-muted">{SUBJECT_LABEL[item.key as Subject] ?? item.key}</p>
              <p className={`mt-1 text-2xl font-bold ${scoreTone(item.percent)}`}>
                {displayScore(item.percent)}
              </p>
              <p className="text-xs text-muted">
                {item.correctCount} benar dari {item.count}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="mb-8 grid gap-4 sm:grid-cols-2">
        <BreakdownList items={labeled(breakdown.byDomain, 'domain')} title="Per materi" />
        <BreakdownList
          items={labeled(breakdown.byCompetency, 'competency')}
          title="Per kemampuan"
        />
      </section>

      <h2 className="mb-3 text-lg font-bold">Pembahasan</h2>
      <ol className="space-y-4">
        {view.questions.map((question, i) => (
          <ItemExplanation
            key={question.id}
            number={i + 1}
            question={question}
            extra={extras[question.id]}
            response={view.responses[question.id]}
            points={view.points[question.id]}
            pickedLabel="Jawabanmu"
            attemptId={attemptId}
          />
        ))}
      </ol>

      <div className="mt-8 text-center">
        <Link
          href="/u"
          className="inline-block rounded-xl bg-brand px-6 py-3 font-semibold text-white"
        >
          Kembali ke daftar tugas
        </Link>
      </div>
    </main>
  );
}
