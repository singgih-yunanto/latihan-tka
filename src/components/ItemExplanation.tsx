import { Figure } from '@/components/Figure';
import { ReportQuestionButton } from '@/components/ReportQuestionButton';
import type { ReviewExtras, RunnerQuestion } from '@/lib/attempt';
import type { AnswerKey, Response } from '@/domain/question';
import { SUBJECT_BADGE } from '@/lib/ui';

/**
 * One reviewed item: stem, figure, the options marked with key and pick, and
 * the explanation. Shared by the student's results page and the supervisor's
 * review, which differ only in wording ("Jawabanmu" vs "Jawaban murid").
 */

/** Whether an option is part of the answer key. */
function isKey(answer: AnswerKey, choiceId: string): boolean {
  if (answer.kind === 'single') return answer.correct === choiceId;
  if (answer.kind === 'multi') return answer.correct.includes(choiceId);
  return false;
}

/** Whether the student picked that option. */
function isPicked(response: Response | undefined, choiceId: string): boolean {
  if (!response) return false;
  if (response.kind === 'single') return response.choice === choiceId;
  if (response.kind === 'multi') return response.choices.includes(choiceId);
  return false;
}

type Props = {
  number: number;
  question: RunnerQuestion;
  extra: ReviewExtras | undefined;
  response: Response | undefined;
  points?: number | null;
  /** "Jawabanmu" for the student, "Jawaban murid" for a supervisor. */
  pickedLabel: string;
  attemptId: number;
};

export function ItemExplanation({
  number,
  question,
  extra,
  response,
  points,
  pickedLabel,
  attemptId,
}: Props) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">Soal {number}</span>
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-semibold ${SUBJECT_BADGE[question.subject]}`}
        >
          {question.subjectLabel}
        </span>
        {!response ? (
          <span className="rounded-md bg-surface2 px-2 py-0.5 text-xs text-muted">Tidak dijawab</span>
        ) : null}
        {points !== undefined && points !== null ? (
          <span className="ml-auto text-xs font-semibold text-muted">
            {Math.round(points * 100) / 100} poin
          </span>
        ) : null}
      </div>

      {question.stimulus ? (
        <details className="mb-3 rounded-xl bg-surface2 p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Teks bacaan: {question.stimulus.title}
          </summary>
          <div
            className="prose-soal mt-3 text-sm"
            dangerouslySetInnerHTML={{ __html: question.stimulus.bodyHtml }}
          />
        </details>
      ) : null}

      <div
        className="prose-soal text-[15px]"
        dangerouslySetInnerHTML={{ __html: question.stemHtml }}
      />
      {question.figure ? (
        <Figure figure={question.figure.figure} safeSvg={question.figure.safeSvg} className="mt-3" />
      ) : null}

      {question.choices && extra ? (
        <ul className="mt-4 space-y-2">
          {question.choices.map((choice, ci) => {
            const kunci = isKey(extra.answer, choice.id);
            const dipilih = isPicked(response, choice.id);
            return (
              <li
                key={choice.id}
                className={`flex items-start gap-3 rounded-xl border p-3 ${
                  kunci ? 'border-ok bg-oksoft' : dipilih ? 'border-bad bg-badsoft' : 'border-line'
                }`}
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface2 text-xs font-bold">
                  {String.fromCharCode(65 + ci)}
                </span>
                <span className="min-w-0 flex-1">
                  {choice.figure ? (
                    <Figure
                      figure={choice.figure.figure}
                      safeSvg={choice.figure.safeSvg}
                      className="mb-2 max-w-[12rem]"
                    />
                  ) : null}
                  <span
                    className="prose-soal block text-sm"
                    dangerouslySetInnerHTML={{ __html: choice.html }}
                  />
                </span>
                <span className="shrink-0 text-xs font-semibold">
                  {kunci ? <span className="text-ok">Kunci</span> : null}
                  {dipilih && !kunci ? <span className="text-bad">{pickedLabel}</span> : null}
                  {dipilih && kunci ? <span className="text-ok"> · dipilih</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {question.statements && question.categories && extra?.answer.kind === 'kategori' ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[20rem] border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-line p-2 text-left">Pernyataan</th>
                <th className="border-b border-line p-2 text-center">{pickedLabel}</th>
                <th className="border-b border-line p-2 text-center">Kunci</th>
              </tr>
            </thead>
            <tbody>
              {question.statements.map((statement) => {
                const kunci =
                  extra.answer.kind === 'kategori' ? extra.answer.correct[statement.id] : undefined;
                const pilih = response?.kind === 'kategori' ? response.picks[statement.id] : undefined;
                const labelOf = (id?: string) =>
                  question.categories?.find((c) => c.id === id)?.label ?? '-';
                return (
                  <tr key={statement.id}>
                    <td className="border-b border-line p-2">
                      <span dangerouslySetInnerHTML={{ __html: statement.html }} />
                    </td>
                    <td
                      className={`border-b border-line p-2 text-center font-semibold ${
                        kunci === pilih ? 'text-ok' : 'text-bad'
                      }`}
                    >
                      {labelOf(pilih)}
                    </td>
                    <td className="border-b border-line p-2 text-center font-semibold text-ok">
                      {labelOf(kunci)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {extra ? (
        <div className="mt-4 rounded-xl bg-brandsoft p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand">Pembahasan</p>
          <div
            className="prose-soal text-sm"
            dangerouslySetInnerHTML={{ __html: extra.explanationHtml }}
          />
          {extra.explanationFigure ? (
            <Figure
              figure={extra.explanationFigure.figure}
              safeSvg={extra.explanationFigure.safeSvg}
              className="mt-3"
            />
          ) : null}
        </div>
      ) : null}

      <ReportQuestionButton attemptId={attemptId} questionId={question.id} />
    </li>
  );
}
