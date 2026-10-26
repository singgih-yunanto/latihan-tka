'use client';

import { useEffect, useState } from 'react';
import type { Figure as FigureData } from '@/domain/figure';

/**
 * Renders a question figure.
 *
 * SVG is inlined (already sanitised on the server) so it inherits the text
 * colour and follows dark mode. Figures can be tapped to zoom, which matters
 * because children often work on a phone and the detail in a shape or chart
 * needs to be legible.
 *
 * Inside another control -- an answer choice is itself a button -- pass
 * `interactive={false}` and place a `FigureZoomButton` beside it instead, since
 * a button may not contain another button.
 */

type Props = {
  figure: FigureData;
  /** SVG markup already sanitised on the server. Without it an SVG is not drawn. */
  safeSvg?: string;
  className?: string;
  interactive?: boolean;
};

function FigureContent({ figure, safeSvg }: { figure: FigureData; safeSvg?: string }) {
  if (figure.kind === 'svg') {
    // Never fall back to the raw bank markup: only the sanitised copy is inlined.
    return safeSvg ? (
      <div
        className="figure-svg w-full"
        aria-label={figure.alt}
        role="img"
        dangerouslySetInnerHTML={{ __html: safeSvg }}
      />
    ) : (
      <p className="text-sm text-muted">{figure.alt}</p>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/bank-assets/${figure.src}`} alt={figure.alt} className="block h-auto w-full" />
  );
}

const ZOOM_LEVELS = [1, 2, 3] as const;

function ZoomDialog({
  figure,
  safeSvg,
  onClose,
}: {
  figure: FigureData;
  safeSvg?: string;
  onClose: () => void;
}) {
  // A phone shows the dialog at screen width, about the size of the inline
  // figure, so real magnification means a wider figure panned inside the box.
  const [zoom, setZoom] = useState<(typeof ZOOM_LEVELS)[number]>(1);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={figure.alt}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-surface"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line p-2">
          <div className="flex gap-1" role="group" aria-label="Perbesaran">
            {ZOOM_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setZoom(level)}
                aria-pressed={zoom === level}
                className={`h-10 min-w-10 rounded-lg px-2 text-sm font-semibold ${
                  zoom === level ? 'bg-brand text-white' : 'border border-line text-muted'
                }`}
              >
                {level}×
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto h-10 rounded-lg bg-brand px-5 text-sm font-semibold text-white"
          >
            Tutup
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3 sm:p-4">
          <div style={{ width: `${zoom * 100}%` }}>
            <FigureContent figure={figure} safeSvg={safeSvg} />
          </div>
        </div>
        <p className="border-t border-line p-2 text-center text-sm text-muted">{figure.alt}</p>
      </div>
    </div>
  );
}

export function Figure({ figure, safeSvg, className, interactive = true }: Props) {
  const [zoomed, setZoomed] = useState(false);

  return (
    <>
      <figure className={className}>
        {interactive ? (
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className="block w-full cursor-zoom-in rounded-xl border border-line bg-surface p-3 transition hover:border-brand"
            aria-label={`Perbesar gambar: ${figure.alt}`}
          >
            <div className="mx-auto max-w-md">
              <FigureContent figure={figure} safeSvg={safeSvg} />
            </div>
          </button>
        ) : (
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="mx-auto max-w-md">
              <FigureContent figure={figure} safeSvg={safeSvg} />
            </div>
          </div>
        )}
        {figure.caption ? (
          <figcaption className="mt-1.5 text-center text-xs text-muted">{figure.caption}</figcaption>
        ) : null}
      </figure>

      {zoomed ? (
        <ZoomDialog figure={figure} safeSvg={safeSvg} onClose={() => setZoomed(false)} />
      ) : null}
    </>
  );
}

/** A small standalone zoom control for a figure rendered with interactive={false}. */
export function FigureZoomButton({
  figure,
  safeSvg,
  className,
}: {
  figure: FigureData;
  safeSvg?: string;
  className?: string;
}) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setZoomed(true)}
        className={`flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface text-muted shadow-sm hover:border-brand hover:text-brand ${className ?? ''}`}
        aria-label={`Perbesar gambar: ${figure.alt}`}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="M13 13l4.5 4.5M8.5 6v5M6 8.5h5" />
        </svg>
      </button>
      {zoomed ? (
        <ZoomDialog figure={figure} safeSvg={safeSvg} onClose={() => setZoomed(false)} />
      ) : null}
    </>
  );
}
