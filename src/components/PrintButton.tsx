'use client';

/** Prints the current page; the layout hides navigation in print styles. */
export function PrintButton({ label = 'Cetak' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold transition hover:border-brand"
    >
      {label}
    </button>
  );
}
