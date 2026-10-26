import type { Subject } from '@/domain/blueprint';

/** Small presentation helpers shared across pages. */

export const AVATAR_COLORS = [
  'biru',
  'hijau',
  'jingga',
  'ungu',
  'merah',
  'tosca',
  'kuning',
  'merahmuda',
] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export const AVATAR_CLASS: Record<string, string> = {
  biru: 'bg-sky-500',
  hijau: 'bg-emerald-500',
  jingga: 'bg-orange-500',
  ungu: 'bg-violet-500',
  merah: 'bg-rose-500',
  tosca: 'bg-teal-500',
  kuning: 'bg-amber-500',
  merahmuda: 'bg-pink-500',
};

export function avatarClass(color: string): string {
  return AVATAR_CLASS[color] ?? AVATAR_CLASS.biru;
}

export function initials(nama: string): string {
  const parts = nama.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

export const SUBJECT_BADGE: Record<Subject, string> = {
  bahasa_indonesia: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  matematika: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  ipas: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
};

export const STATUS_LABEL: Record<string, string> = {
  belum_mulai: 'Belum dikerjakan',
  berjalan: 'Sedang dikerjakan',
  selesai: 'Selesai',
};

export const STATUS_CLASS: Record<string, string> = {
  belum_mulai: 'bg-surface2 text-muted',
  berjalan: 'bg-warnsoft text-warn',
  selesai: 'bg-oksoft text-ok',
};

/** Score colouring for quick reading: green good, amber fair, red needs work. */
export function scoreTone(percent: number): string {
  if (percent >= 80) return 'text-ok';
  if (percent >= 60) return 'text-warn';
  return 'text-bad';
}

/**
 * Every date the app shows is in this zone, whatever the server's own TZ is.
 * Without it a server on UTC shows WIB users times seven hours off.
 */
export const APP_TIMEZONE = process.env.NEXT_PUBLIC_TKA_TIMEZONE || 'Asia/Jakarta';

export function formatDateTime(epochSeconds: number | null): string {
  if (!epochSeconds) return '-';
  return new Date(epochSeconds * 1000).toLocaleString('id-ID', {
    timeZone: APP_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(epochSeconds: number | null): string {
  if (!epochSeconds) return '-';
  return new Date(epochSeconds * 1000).toLocaleDateString('id-ID', {
    timeZone: APP_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function isOverdue(dueAt: number | null, now = Date.now()): boolean {
  return dueAt !== null && dueAt * 1000 < now;
}

/**
 * What a section's filters_json says, for its badge: real filters, and/or the
 * blueprint-shaped draw (stored as `blueprint: true` alongside the filters).
 */
export function sectionDrawLabel(filtersJson: string | null): string {
  if (!filtersJson) return '';
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(filtersJson) as Record<string, unknown>;
  } catch {
    return '';
  }
  const filtered = ['domains', 'competencies', 'difficulties', 'types'].some(
    (key) => Array.isArray(parsed[key]) && (parsed[key] as unknown[]).length > 0,
  );
  const labels = [parsed.blueprint === true ? 'kisi TKA' : '', filtered ? 'difilter' : ''].filter(Boolean);
  return labels.length ? ` (${labels.join(', ')})` : '';
}
