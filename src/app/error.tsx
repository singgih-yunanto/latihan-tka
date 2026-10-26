'use client';

import Link from 'next/link';

/**
 * The last resort when a page throws. Pages answer a forbidden record with
 * notFound(), so this is for genuine failures; it still says nothing about what
 * went wrong, because a message could confirm that some other family's record
 * exists.
 */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-12">
      <div className="rounded-2xl border border-line bg-surface p-7 text-center">
        <h1 className="text-xl font-bold">Ada yang tidak beres</h1>
        <p className="mt-2 text-sm text-muted">
          Halaman ini tidak bisa ditampilkan. Coba muat ulang, atau kembali ke halaman utama.
        </p>

        <button
          type="button"
          onClick={reset}
          className="mt-5 w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white"
        >
          Muat ulang
        </button>

        <Link href="/" className="mt-4 inline-block text-sm text-muted underline underline-offset-4">
          Ke halaman utama
        </Link>
      </div>
    </main>
  );
}
