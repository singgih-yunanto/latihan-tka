'use client';

import { useState } from 'react';

/**
 * Copies a value to the clipboard and says so for a moment.
 *
 * `navigator.clipboard` exists only in a secure context, so a server reached
 * over plain http on the home network falls back to a hidden textarea and
 * `execCommand('copy')`, which every browser still honours on a click.
 */

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused: try the fallback below.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'fixed -left-[9999px] top-0 opacity-0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

type Props = { value: string; label: string; className?: string };

export function CopyButton({ value, label, className }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function onClick() {
    setState((await copyText(value)) ? 'copied' : 'failed');
    setTimeout(() => setState('idle'), 2000);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-live="polite"
      className={`rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium transition hover:border-brand ${className ?? ''}`}
    >
      {state === 'copied' ? 'Tersalin ✓' : state === 'failed' ? 'Gagal, salin manual' : label}
    </button>
  );
}
