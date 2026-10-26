'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Figure, FigureZoomButton } from './Figure';
import { saveAnswer, setFlagged, submitAttempt } from '@/actions/attempt';
import { emptyResponse, isAnswered, type Response } from '@/domain/question';
import { formatDuration } from '@/domain/timing';
import type { RunnerQuestion } from '@/lib/attempt';
import { SUBJECT_BADGE } from '@/lib/ui';

/**
 * The question-working screen.
 *
 * Navigation is entirely free: students may move back and forth, jump to any
 * number through the navigator, cross subject boundaries, and change answers
 * they have already given until they press finish. There is no one-way lock and
 * no per-item time limit -- a single budget runs for the whole assignment.
 */

type Props = {
  attemptId: number;
  judul: string;
  questions: RunnerQuestion[];
  initialResponses: Record<string, Response>;
  initialFlagged: string[];
  /**
   * Seconds left according to the server when the page was rendered; null when
   * untimed. The countdown runs from this rather than from a deadline compared
   * with the device clock, so a tablet whose clock is wrong still gets exactly
   * the time it is owed.
   */
  remainingAtLoad: number | null;
  startIndex: number;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** How long to wait after the last change before saving, and between retries. */
const SAVE_DEBOUNCE_MS = 400;
const RETRY_MS = 5000;

/** Moments, in seconds left, when the remaining time is read out to screen readers. */
const ANNOUNCE_AT = [300, 60];

export function AttemptRunner({
  attemptId,
  judul,
  questions,
  initialResponses,
  initialFlagged,
  remainingAtLoad,
  startIndex,
}: Props) {
  const router = useRouter();
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(startIndex, 0), Math.max(questions.length - 1, 0)),
  );
  const [responses, setResponses] = useState<Record<string, Response>>(initialResponses);
  const [flagged, setFlaggedState] = useState<Set<string>>(new Set(initialFlagged));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [remaining, setRemaining] = useState<number | null>(remainingAtLoad);
  const [announcement, setAnnouncement] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Reading passages the student opened in full on a phone, by stimulus id.
  const [openPassages, setOpenPassages] = useState<Set<string>>(new Set());
  const [unsaved, setUnsaved] = useState(0);

  // Answers changed locally but not yet confirmed by the server. An entry is
  // only removed once its save succeeds, so nothing is lost to a dropped
  // connection: it is retried, and flushed before the attempt is submitted.
  const dirty = useRef<Map<string, Response>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const submittedRef = useRef(false);
  const flushing = useRef<Promise<boolean> | null>(null);

  // performance.now() is monotonic: it cannot jump when the device clock is
  // corrected mid-exam.
  const deadlineMono = useRef<number | null>(null);

  const current = questions[index];

  const syncUnsaved = useCallback(() => setUnsaved(dirty.current.size), []);

  const saveOne = useCallback(
    async (questionId: string): Promise<boolean> => {
      const response = dirty.current.get(questionId);
      if (!response) return true;
      try {
        const result = await saveAnswer(attemptId, questionId, response);
        // Only clear it if no newer change arrived while this save was out.
        if (result.ok && dirty.current.get(questionId) === response) {
          dirty.current.delete(questionId);
        }
        return result.ok;
      } catch {
        return false;
      } finally {
        syncUnsaved();
      }
    },
    [attemptId, syncUnsaved],
  );

  /** Save everything outstanding. Resolves true when nothing is left unsaved. */
  const flush = useCallback((): Promise<boolean> => {
    if (flushing.current) return flushing.current;
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();

    const run = (async () => {
      if (dirty.current.size === 0) return true;
      setSaveState('saving');
      let allOk = true;
      // One at a time: Next runs a client's Server Actions sequentially anyway.
      for (const questionId of [...dirty.current.keys()]) {
        if (!(await saveOne(questionId))) allOk = false;
      }
      const ok = allOk && dirty.current.size === 0;
      setSaveState(ok ? 'saved' : 'error');
      return ok;
    })();
    flushing.current = run.finally(() => {
      flushing.current = null;
    });
    return flushing.current;
  }, [saveOne]);

  const finish = useCallback(
    async (timeUp = false) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      setSubmitError(null);

      // Every pending answer is saved before the attempt closes. When time is
      // up we submit regardless -- the server grace window still accepts the
      // saves that made it -- but a voluntary finish waits until they land.
      const saved = await flush();
      if (!saved && !timeUp) {
        submittedRef.current = false;
        setSubmitting(false);
        setSubmitError('Ada jawaban yang belum tersimpan. Periksa koneksi lalu coba lagi.');
        return;
      }

      try {
        const result = await submitAttempt(attemptId, { timeUp });
        if (!result.ok) {
          submittedRef.current = false;
          setSubmitting(false);
          if (result.remainingSeconds !== undefined) {
            // The server says time is not up yet: resynchronise and carry on.
            deadlineMono.current = performance.now() + result.remainingSeconds * 1000;
            setRemaining(result.remainingSeconds);
            return;
          }
          setSubmitError(result.error);
          return;
        }
      } catch {
        submittedRef.current = false;
        setSubmitting(false);
        setSubmitError('Gagal mengirim. Periksa koneksi lalu coba lagi.');
        return;
      }
      router.push(`/u/attempt/${attemptId}/hasil`);
    },
    [attemptId, flush, router],
  );

  // The countdown calls finish through a ref so the interval never restarts,
  // which would reset the monotonic deadline.
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  // A single countdown covering the whole assignment.
  useEffect(() => {
    if (remainingAtLoad === null) return;
    deadlineMono.current ??= performance.now() + remainingAtLoad * 1000;
    const announced = new Set<number>();
    const tick = () => {
      if (deadlineMono.current === null) return;
      const left = Math.max(0, Math.ceil((deadlineMono.current - performance.now()) / 1000));
      setRemaining(left);
      for (const mark of ANNOUNCE_AT) {
        if (left <= mark && left > mark - 5 && !announced.has(mark)) {
          announced.add(mark);
          setAnnouncement(`Sisa waktu ${Math.round(mark / 60)} menit.`);
        }
      }
      if (left <= 0) void finishRef.current(true);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [remainingAtLoad]);

  // Retry failed saves periodically, and as soon as the connection returns.
  useEffect(() => {
    const retry = () => {
      if (dirty.current.size > 0 && !submittedRef.current && timers.current.size === 0) {
        void flush();
      }
    };
    const id = setInterval(retry, RETRY_MS);
    window.addEventListener('online', retry);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', retry);
    };
  }, [flush]);

  // Warn before closing the tab with answers the server has not confirmed.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current.size > 0 && !submittedRef.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('n', String(index + 1));
    window.history.replaceState(null, '', url.toString());
  }, [index]);

  // When the page re-renders with a different ?n= (for example following a link
  // to a specific number while the runner is already open), follow the URL.
  // Without this the old state persists and the effect above rewrites the URL.
  const lastStart = useRef(startIndex);
  useEffect(() => {
    if (startIndex === lastStart.current) return;
    lastStart.current = startIndex;
    setIndex(Math.min(Math.max(startIndex, 0), Math.max(questions.length - 1, 0)));
  }, [startIndex, questions.length]);

  const persist = useCallback(
    (questionId: string, response: Response) => {
      dirty.current.set(questionId, response);
      syncUnsaved();
      const existing = timers.current.get(questionId);
      if (existing) clearTimeout(existing);

      setSaveState('saving');
      const timer = setTimeout(async () => {
        timers.current.delete(questionId);
        const ok = await saveOne(questionId);
        setSaveState(ok ? (dirty.current.size === 0 ? 'saved' : 'saving') : 'error');
      }, SAVE_DEBOUNCE_MS);
      timers.current.set(questionId, timer);
    },
    [syncUnsaved, saveOne],
  );

  const update = useCallback(
    (response: Response) => {
      if (!current) return;
      setResponses((prev) => ({ ...prev, [current.id]: response }));
      persist(current.id, response);
    },
    [current, persist],
  );

  const responseFor = useCallback(
    (question: RunnerQuestion): Response =>
      responses[question.id] ?? emptyResponse(question.type),
    [responses],
  );

  // The server call happens outside the state updater: updaters must be pure,
  // and StrictMode runs them twice.
  const toggleFlag = useCallback(() => {
    if (!current) return;
    const next = new Set(flagged);
    if (next.has(current.id)) next.delete(current.id);
    else next.add(current.id);
    setFlaggedState(next);
    void setFlagged(attemptId, [...next]).catch(() => setSaveState('error'));
  }, [attemptId, current, flagged]);

  const go = useCallback(
    (to: number) => setIndex(Math.min(Math.max(to, 0), questions.length - 1)),
    [questions.length],
  );

  // Keyboard shortcuts for students working on a laptop.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (confirming) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

      if (event.key === 'ArrowLeft') go(index - 1);
      else if (event.key === 'ArrowRight') go(index + 1);
      else if (event.key.toLowerCase() === 'f') toggleFlag();
      else if (/^[1-9]$/.test(event.key) && current?.type === 'pg' && current.choices) {
        const choice = current.choices[Number(event.key) - 1];
        if (choice) update({ kind: 'single', choice: choice.id });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, current, go, index, toggleFlag, update]);

  const groups = useMemo(() => {
    const out: { subject: string; label: string; items: { q: RunnerQuestion; i: number }[] }[] = [];
    questions.forEach((q, i) => {
      const last = out[out.length - 1];
      if (last && last.subject === q.subject) last.items.push({ q, i });
      else out.push({ subject: q.subject, label: q.subjectLabel, items: [{ q, i }] });
    });
    return out;
  }, [questions]);

  const kosong = questions.filter((q) => !isAnswered(responseFor(q)));
  const ditandai = questions.filter((q) => flagged.has(q.id));

  if (!current) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="font-medium">Penugasan ini tidak memuat soal.</p>
      </main>
    );
  }

  const urgent = remaining !== null && remaining <= 300;

  return (
    <div className="min-h-dvh pb-6 lg:pb-10">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5 sm:gap-3 sm:py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{judul}</p>
            <p className="truncate text-xs text-muted">
              Soal {index + 1} dari {questions.length}
              {saveState === 'saving' ? ' · menyimpan…' : null}
              {saveState === 'saved' ? ' · tersimpan' : null}
              {saveState === 'error' ? ' · gagal menyimpan, mencoba lagi…' : null}
            </p>
          </div>

          {remaining === null ? (
            <span className="shrink-0 rounded-lg bg-surface2 px-3 py-1.5 text-sm font-medium text-muted">
              <span className="sm:hidden">Bebas waktu</span>
              <span className="hidden sm:inline">Tanpa batas waktu</span>
            </span>
          ) : (
            <span
              className={`shrink-0 rounded-lg px-3 py-1.5 font-mono text-base font-bold tabular-nums ${
                urgent ? 'bg-badsoft text-bad' : 'bg-brandsoft text-brand'
              }`}
              aria-live="off"
              aria-label={`Sisa waktu ${formatDuration(remaining)}`}
            >
              {formatDuration(remaining)}
            </span>
          )}
          <span className="sr-only" aria-live="assertive">
            {announcement}
          </span>

          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white"
          >
            Selesai
          </button>
        </div>
        <div className="h-1 bg-surface2">
          <div
            className="h-full bg-brand transition-all"
            style={{ width: `${((index + 1) / questions.length) * 100}%` }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4 sm:py-6">
        <div className={current.stimulus ? 'gap-6 lg:grid lg:grid-cols-2' : ''}>
          {current.stimulus ? (
            <aside className="mb-4 sm:mb-6 lg:mb-0">
              <div className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
                {/* On a phone a long passage would push the question far below
                    the fold, so it starts capped with its own scroll. */}
                <div
                  className={`rounded-2xl border border-line bg-surface p-4 sm:p-5 ${
                    openPassages.has(current.stimulus.id)
                      ? ''
                      : 'max-h-[45vh] overflow-y-auto lg:max-h-none lg:overflow-visible'
                  }`}
                >
                  <h2 className="mb-3 text-base font-bold">{current.stimulus.title}</h2>
                  {current.stimulus.figure ? (
                    <Figure
                      figure={current.stimulus.figure.figure}
                      safeSvg={current.stimulus.figure.safeSvg}
                      className="mb-3"
                    />
                  ) : null}
                  <div
                    className="prose-soal text-[15px]"
                    dangerouslySetInnerHTML={{ __html: current.stimulus.bodyHtml }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const id = current.stimulus!.id;
                    setOpenPassages((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  }}
                  className="mt-1 min-h-10 rounded-lg px-3 py-2 text-sm font-medium text-brand lg:hidden"
                >
                  {openPassages.has(current.stimulus.id) ? 'Ringkas bacaan' : 'Tampilkan bacaan penuh'}
                </button>
              </div>
            </aside>
          ) : null}

          <section>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md px-2 py-1 text-xs font-semibold ${SUBJECT_BADGE[current.subject]}`}
              >
                {current.subjectLabel}
              </span>
              <span className="hidden text-xs text-muted sm:inline">Soal nomor {index + 1}</span>
              <button
                type="button"
                onClick={toggleFlag}
                className={`ml-auto min-h-10 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                  flagged.has(current.id)
                    ? 'border-warn bg-warnsoft text-warn'
                    : 'border-line text-muted hover:border-brand hover:text-brand'
                }`}
              >
                {flagged.has(current.id) ? 'Ditandai ragu-ragu' : 'Tandai ragu-ragu'}
              </button>
            </div>

            <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
              <div
                className="prose-soal text-[15px] sm:text-base"
                dangerouslySetInnerHTML={{ __html: current.stemHtml }}
              />
              {current.figure ? (
                <Figure
                  figure={current.figure.figure}
                  safeSvg={current.figure.safeSvg}
                  className="mt-4"
                />
              ) : null}

              <div className="mt-5">
                <QuestionInput
                  question={current}
                  response={responseFor(current)}
                  onChange={update}
                />
              </div>
            </div>

            {/* Below lg the buttons ride along at the bottom of the screen, so a
                long question never needs a scroll back down to move on. */}
            <nav className="sticky bottom-0 z-20 -mx-4 mt-4 flex items-center gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:gap-3 lg:static lg:mx-0 lg:mt-5 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <button
                type="button"
                onClick={() => go(index - 1)}
                disabled={index === 0}
                className="flex-1 whitespace-nowrap rounded-xl border border-line bg-surface px-3 py-3 font-semibold transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-40 sm:px-4"
              >
                ← <span className="sm:hidden">Kembali</span>
                <span className="hidden sm:inline">Sebelumnya</span>
              </button>
              <a
                href="#daftar-soal"
                aria-label="Buka daftar soal"
                className="flex shrink-0 items-center justify-center rounded-xl border border-line bg-surface px-3 py-3 text-sm font-semibold tabular-nums lg:hidden"
              >
                {index + 1}/{questions.length}
              </a>
              <button
                type="button"
                onClick={() => go(index + 1)}
                disabled={index === questions.length - 1}
                className="flex-1 whitespace-nowrap rounded-xl bg-brand px-3 py-3 font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4"
              >
                <span className="sm:hidden">Lanjut</span>
                <span className="hidden sm:inline">Berikutnya</span> →
              </button>
            </nav>
          </section>
        </div>

        <section
          id="daftar-soal"
          className="mt-6 scroll-mt-20 rounded-2xl border border-line bg-surface p-4 sm:mt-8 sm:p-5"
        >
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Daftar soal
          </h2>
          <div className="space-y-4">
            {groups.map((group, gi) => (
              <div key={`${group.subject}-${gi}`}>
                <p className="mb-2 text-xs font-semibold text-muted">{group.label}</p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-2 sm:flex sm:flex-wrap">
                  {group.items.map(({ q, i }) => {
                    const dijawab = isAnswered(responseFor(q));
                    const ragu = flagged.has(q.id);
                    const aktif = i === index;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => go(i)}
                        aria-current={aktif ? 'true' : undefined}
                        className={[
                          'h-11 rounded-lg border text-sm font-semibold transition sm:w-11',
                          aktif ? 'ring-2 ring-brand ring-offset-2 ring-offset-[var(--surface)]' : '',
                          ragu
                            ? 'border-warn bg-warnsoft text-warn'
                            : dijawab
                              ? 'border-transparent bg-brand text-white'
                              : 'border-line bg-surface2 text-muted hover:border-brand',
                        ].join(' ')}
                      >
                        {i + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted">
            Kamu bebas berpindah ke soal mana saja dan mengubah jawaban sampai menekan Selesai.
          </p>
        </section>
      </main>

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface p-5 sm:p-6">
            <h2 className="text-lg font-bold">Selesaikan penugasan?</h2>

            <div className="mt-4 space-y-2 text-sm">
              <p className={kosong.length > 0 ? 'text-bad' : 'text-ok'}>
                {kosong.length > 0
                  ? `${kosong.length} soal belum dijawab`
                  : 'Semua soal sudah dijawab'}
              </p>
              {ditandai.length > 0 ? (
                <p className="text-warn">{ditandai.length} soal ditandai ragu-ragu</p>
              ) : null}
              {unsaved > 0 ? (
                <p className="text-bad">{unsaved} jawaban belum tersimpan ke server</p>
              ) : null}
              {submitError ? (
                <p role="alert" className="font-medium text-bad">
                  {submitError}
                </p>
              ) : null}
            </div>

            {kosong.length > 0 || ditandai.length > 0 ? (
              <div className="mt-4 rounded-xl bg-surface2 p-3">
                <p className="mb-2 text-xs font-semibold text-muted">Loncat ke soal:</p>
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  {questions.map((q, i) =>
                    !isAnswered(responseFor(q)) || flagged.has(q.id) ? (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => {
                          go(i);
                          setConfirming(false);
                        }}
                        className={`h-10 w-10 rounded-md border text-sm font-semibold ${
                          flagged.has(q.id)
                            ? 'border-warn bg-warnsoft text-warn'
                            : 'border-line bg-surface text-muted'
                        }`}
                      >
                        {i + 1}
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-xl border border-line px-4 py-3 font-semibold"
              >
                Periksa lagi
              </button>
              <button
                type="button"
                onClick={() => void finish()}
                disabled={submitting}
                className="flex-1 rounded-xl bg-brand px-4 py-3 font-semibold text-white disabled:opacity-60"
              >
                {submitting ? 'Mengirim…' : 'Ya, selesai'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The answer input, matching the question format. */
function QuestionInput({
  question,
  response,
  onChange,
}: {
  question: RunnerQuestion;
  response: Response;
  onChange: (response: Response) => void;
}) {
  if (question.type === 'pgk_kategori' && question.statements && question.categories) {
    const picks = response.kind === 'kategori' ? response.picks : {};
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm sm:min-w-[22rem]">
          <thead>
            <tr>
              <th className="border-b border-line p-1.5 text-left font-semibold sm:p-2">Pernyataan</th>
              {question.categories.map((category) => (
                <th
                  key={category.id}
                  className="w-16 border-b border-line p-1.5 text-center font-semibold sm:w-24 sm:p-2"
                >
                  {category.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {question.statements.map((statement) => (
              <tr key={statement.id}>
                <td className="border-b border-line p-1.5 align-middle break-words sm:p-2">
                  <span dangerouslySetInnerHTML={{ __html: statement.html }} />
                </td>
                {question.categories!.map((category) => (
                  <td key={category.id} className="border-b border-line p-0 text-center">
                    {/* The whole cell is the tap target, not just the 20px dot. */}
                    <label className="flex min-h-11 cursor-pointer items-center justify-center p-1.5 sm:p-2">
                      <input
                        type="radio"
                        name={`${question.id}-${statement.id}`}
                        checked={picks[statement.id] === category.id}
                        onChange={() =>
                          onChange({
                            kind: 'kategori',
                            picks: { ...picks, [statement.id]: category.id },
                          })
                        }
                        className="h-5 w-5 accent-[var(--brand)]"
                        aria-label={`${category.label} untuk pernyataan ini`}
                      />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!question.choices) return null;

  const bergambar = question.choices.some((choice) => choice.figure);
  const multi = question.type === 'pgk_multi';
  const selected = new Set(
    response.kind === 'multi'
      ? response.choices
      : response.kind === 'single' && response.choice
        ? [response.choice]
        : [],
  );

  const toggle = (choiceId: string) => {
    if (!multi) {
      onChange({ kind: 'single', choice: choiceId });
      return;
    }
    const next = new Set(selected);
    if (next.has(choiceId)) next.delete(choiceId);
    else next.add(choiceId);
    onChange({ kind: 'multi', choices: [...next] });
  };

  return (
    <div>
      {multi ? (
        <p className="mb-3 text-sm font-medium text-muted">Pilih semua jawaban yang benar.</p>
      ) : null}
      <ul className={bergambar ? 'grid gap-3 min-[420px]:grid-cols-2' : 'space-y-2.5'}>
        {question.choices.map((choice, i) => {
          const aktif = selected.has(choice.id);
          return (
            <li key={choice.id} className="relative">
              <button
                type="button"
                onClick={() => toggle(choice.id)}
                aria-pressed={aktif}
                className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
                  aktif
                    ? 'border-brand bg-brandsoft'
                    : 'border-line bg-surface hover:border-brand/60'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center text-sm font-bold ${
                    multi ? 'rounded-md' : 'rounded-full'
                  } ${aktif ? 'bg-brand text-white' : 'bg-surface2 text-muted'}`}
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="min-w-0 flex-1">
                  {choice.figure ? (
                    // Not interactive inside the choice: a button cannot hold
                    // another button. Zooming has its own control beside it.
                    <Figure
                      figure={choice.figure.figure}
                      safeSvg={choice.figure.safeSvg}
                      interactive={false}
                      className="mb-2"
                    />
                  ) : null}
                  <span
                    className="prose-soal block text-[15px]"
                    dangerouslySetInnerHTML={{ __html: choice.html }}
                  />
                </span>
              </button>
              {choice.figure ? (
                <FigureZoomButton
                  figure={choice.figure.figure}
                  safeSvg={choice.figure.safeSvg}
                  className="absolute right-2 top-2"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
