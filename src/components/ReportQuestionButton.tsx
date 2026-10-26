'use client';

import { useState, useTransition } from 'react';
import { reportQuestion } from '@/actions/report';

/**
 * "Something is wrong with this question": a wrong key, a typo, a figure that
 * does not match. Reports land on the admin's question bank page.
 */
export function ReportQuestionButton({
  attemptId,
  questionId,
}: {
  attemptId: number;
  questionId: string;
}) {
  const [open, setOpen] = useState(false);
  const [pesan, setPesan] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (status?.ok) {
    return <p className="mt-3 text-xs font-medium text-ok">{status.text}</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-xs text-muted underline underline-offset-4 hover:text-brand"
      >
        Laporkan soal ini
      </button>
    );
  }

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          try {
            const result = await reportQuestion(attemptId, questionId, pesan);
            setStatus(
              result.ok
                ? { ok: true, text: 'Terima kasih, laporanmu sudah dikirim ke admin.' }
                : { ok: false, text: result.error },
            );
          } catch {
            setStatus({ ok: false, text: 'Gagal mengirim. Coba lagi.' });
          }
        });
      }}
    >
      <label className="block text-xs font-medium text-muted" htmlFor={`lapor-${questionId}`}>
        Apa yang salah? (kunci keliru, salah ketik, gambar tidak sesuai, ...)
      </label>
      <textarea
        id={`lapor-${questionId}`}
        value={pesan}
        onChange={(event) => setPesan(event.target.value)}
        maxLength={500}
        rows={2}
        required
        className="w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || pesan.trim().length < 3}
          className="min-h-9 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? 'Mengirim…' : 'Kirim laporan'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-9 rounded-lg border border-line px-3 py-2 text-xs"
        >
          Batal
        </button>
      </div>
      {status && !status.ok ? (
        <p role="alert" className="text-xs font-medium text-bad">
          {status.text}
        </p>
      ) : null}
    </form>
  );
}
