import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ItemExplanation } from '@/components/ItemExplanation';
import { listAttemptRuns, loadAttemptView, loadReviewExtras } from '@/lib/attempt';
import { resetAttempt } from '@/actions/attempt';
import {
  SUBJECT_LABEL,
  competencyLabel,
  domainLabel,
  type Subject,
} from '@/domain/blueprint';
import { displayScore, parseBreakdown } from '@/domain/scoring';
import { humanizeDuration } from '@/domain/timing';
import { STATUS_LABEL, formatDateTime, scoreTone } from '@/lib/ui';
import { isAnswered, type AnswerKey, type Response } from '@/domain/question';

/**
 * One student's finished work, item by item.
 *
 * Shared by the admin panel and the parent area; `basePath` decides where the
 * back link and the post-reset redirect point. The caller is responsible for
 * having checked that this viewer may see this attempt.
 */

function ringkasJawaban(
  response: Response | undefined,
  answer: AnswerKey | undefined,
  labelOf: (id: string) => string,
): { murid: string; kunci: string } {
  if (!answer) return { murid: '-', kunci: '-' };

  if (answer.kind === 'single') {
    const murid = response?.kind === 'single' && response.choice ? labelOf(response.choice) : '-';
    return { murid, kunci: labelOf(answer.correct) };
  }
  if (answer.kind === 'multi') {
    const murid =
      response?.kind === 'multi' && response.choices.length
        ? response.choices.map(labelOf).join(', ')
        : '-';
    return { murid, kunci: answer.correct.map(labelOf).join(', ') };
  }
  const picks = response?.kind === 'kategori' ? response.picks : {};
  const murid = Object.keys(answer.correct)
    .map((sid) => `${sid}:${picks[sid] ?? '-'}`)
    .join(' ');
  const kunci = Object.entries(answer.correct)
    .map(([sid, cid]) => `${sid}:${cid}`)
    .join(' ');
  return { murid, kunci };
}

type Props = {
  attemptId: number;
  basePath: string;
  canReset?: boolean;
  /** A message passed back from a failed reset. */
  error?: string;
};

export async function AttemptReview({ attemptId, basePath, canReset = true, error }: Props) {
  const view = await loadAttemptView(attemptId);
  if (!view) notFound();

  const extras = loadReviewExtras(
    view.questions.map((q) => q.id),
    view.attempt.itemSnapshotJson,
  );

  // A corrupt breakdown comes back empty and does not stop the rest rendering.
  const breakdown = parseBreakdown(view.attempt.scoreBreakdownJson);
  const runs = listAttemptRuns(attemptId);

  async function ulangi() {
    'use server';
    // resetAttempt re-checks the caller: a student cannot call it at all, and a
    // parent only for their own child.
    const result = await resetAttempt(attemptId);
    redirect(
      result.ok
        ? `${basePath}/${attemptId}`
        : `${basePath}/${attemptId}?galat=${encodeURIComponent(result.error)}`,
    );
  }

  const persen = view.attempt.scorePercent ?? 0;
  const dijawab = view.questions.filter((q) => {
    const response = view.responses[q.id];
    return response ? isAnswered(response) : false;
  }).length;

  return (
    <div>
      <Link href={basePath} className="text-sm text-muted underline underline-offset-4">
        ← Kembali ke daftar hasil
      </Link>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-badsoft px-4 py-2.5 text-sm font-medium text-bad">
          {error.slice(0, 200)}
        </p>
      ) : null}

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-line bg-surface p-5">
        <div>
          <h1 className="text-xl font-bold">{view.user.nama}</h1>
          <p className="mt-1 text-sm text-muted">{view.assignment.judul}</p>
          <p className="mt-2 text-sm text-muted">
            {STATUS_LABEL[view.attempt.status]} &middot; {view.questions.length} soal &middot;{' '}
            {dijawab} dijawab
          </p>
          <p className="text-sm text-muted">
            Mulai {formatDateTime(view.attempt.startedAt)} &middot; selesai{' '}
            {formatDateTime(view.attempt.submittedAt)}
            {view.attempt.elapsedSeconds
              ? ` · ${humanizeDuration(view.attempt.elapsedSeconds)}`
              : ''}
          </p>
        </div>

        <div className="text-right">
          <p className={`text-4xl font-bold ${scoreTone(persen)}`}>
            {view.attempt.status === 'selesai' ? displayScore(persen) : '-'}
          </p>
          <p className="text-xs text-muted">
            {view.attempt.scorePoints ?? 0} dari {view.attempt.scoreMax ?? view.questions.length} poin
          </p>
          {canReset ? (
            <form action={ulangi} className="mt-3" title="Nilai saat ini disimpan di riwayat sebelum dikosongkan">
              <button
                type="submit"
                className="rounded-lg border border-line px-3 py-2 text-xs font-medium transition hover:border-bad hover:text-bad"
              >
                Kosongkan &amp; ulangi
              </button>
            </form>
          ) : null}
        </div>
      </header>

      {runs.length > 0 ? (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Riwayat pengerjaan sebelumnya
          </h2>
          <p className="mb-3 text-xs text-muted">
            Pengerjaan pertama adalah yang paling mencerminkan kemampuan, karena sesudahnya murid sudah
            melihat kunci dan pembahasan.
          </p>
          <ul className="space-y-1.5 text-sm">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Pengerjaan ke-{run.runNo} &middot; selesai {formatDateTime(run.submittedAt)}
                </span>
                <span className={`font-semibold ${scoreTone(run.scorePercent ?? 0)}`}>
                  {displayScore(run.scorePercent ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {breakdown.bySubject.length > 0 ? (
        <section className="mt-5 grid gap-3 sm:grid-cols-3">
          {breakdown.bySubject.map((item) => (
            <div key={item.key} className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-xs text-muted">{SUBJECT_LABEL[item.key as Subject] ?? item.key}</p>
              <p className={`mt-1 text-2xl font-bold ${scoreTone(item.percent)}`}>
                {displayScore(item.percent)}
              </p>
              <p className="text-xs text-muted">
                {item.correctCount} benar dari {item.count} soal
              </p>
            </div>
          ))}
        </section>
      ) : null}

      {breakdown.byDomain.length > 0 ? (
        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          {(
            [
              ['Per materi', breakdown.byDomain, 'domain'],
              ['Per kemampuan', breakdown.byCompetency, 'competency'],
            ] as const
          ).map(([judul, items, kind]) => (
            <div key={judul} className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                {judul}
              </h2>
              <ul className="space-y-2 text-sm">
                {items.map((item) => {
                  const [subject, key] = item.key.split(':') as [Subject, string];
                  const label =
                    kind === 'domain' ? domainLabel(subject, key) : competencyLabel(subject, key);
                  return (
                    <li key={item.key} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate">{label}</span>
                      <span className={`shrink-0 font-semibold ${scoreTone(item.percent)}`}>
                        {item.correctCount}/{item.count}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <h2 className="mt-8 mb-3 text-lg font-bold">Jawaban per butir</h2>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="p-3 font-semibold">No</th>
              <th className="p-3 font-semibold">Soal</th>
              <th className="p-3 font-semibold">Materi</th>
              <th className="p-3 font-semibold">Jawaban murid</th>
              <th className="p-3 font-semibold">Kunci</th>
              <th className="p-3 text-right font-semibold">Poin</th>
            </tr>
          </thead>
          <tbody>
            {view.questions.map((question, i) => {
              const extra = extras[question.id];
              const labelOf = (id: string) => {
                const list = question.choices ?? question.statements ?? [];
                const index = list.findIndex((item) => item.id === id);
                return index >= 0 ? String.fromCharCode(65 + index) : id;
              };
              const { murid, kunci } = ringkasJawaban(
                view.responses[question.id],
                extra?.answer,
                labelOf,
              );
              const poin = view.points[question.id];
              const tepat = poin !== undefined && poin !== null ? poin >= 1 : murid !== '-' && murid === kunci;

              return (
                <tr key={question.id} className="border-b border-line align-top last:border-0">
                  <td className="p-3 font-semibold">{i + 1}</td>
                  <td className="max-w-[18rem] p-3">
                    <span className="text-xs text-muted">{question.id}</span>
                    <div
                      className="prose-soal mt-1 line-clamp-2 text-sm"
                      dangerouslySetInnerHTML={{ __html: question.stemHtml }}
                    />
                  </td>
                  <td className="p-3 text-xs text-muted">
                    {SUBJECT_LABEL[question.subject]}
                    <br />
                    {domainLabel(question.subject, question.domain)}
                  </td>
                  <td className={`p-3 font-mono text-xs ${tepat ? 'text-ok' : 'text-bad'}`}>
                    {murid}
                  </td>
                  <td className="p-3 font-mono text-xs text-ok">{kunci}</td>
                  <td className="p-3 text-right font-semibold">
                    {view.attempt.status === 'selesai'
                      ? poin === undefined || poin === null
                        ? '0'
                        : String(Math.round(poin * 100) / 100)
                      : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <summary className="cursor-pointer font-semibold">
          Lihat seluruh soal beserta gambarnya
        </summary>
        <ol className="mt-4 space-y-4">
          {view.questions.map((question, i) => (
            <ItemExplanation
              key={question.id}
              number={i + 1}
              question={question}
              extra={extras[question.id]}
              response={view.responses[question.id]}
              points={view.attempt.status === 'selesai' ? view.points[question.id] : undefined}
              pickedLabel="Jawaban murid"
              attemptId={attemptId}
            />
          ))}
        </ol>
      </details>
    </div>
  );
}
