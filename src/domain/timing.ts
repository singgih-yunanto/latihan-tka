/**
 * Assignment time allowances.
 *
 * The real TKA gives 75 minutes for 30 items per subject, so the base rate is
 * 150 seconds per item. The budget covers the WHOLE assignment, not each item
 * and not each subject: students divide the time themselves and move between
 * questions freely.
 */

export const SECONDS_PER_QUESTION = 150;

export const TIMING_MODES = ['proporsional', 'custom', 'tanpa_batas'] as const;
export type TimingMode = (typeof TIMING_MODES)[number];

export const TIMING_MODE_LABEL: Record<TimingMode, string> = {
  proporsional: 'Proporsional TKA',
  custom: 'Atur sendiri',
  tanpa_batas: 'Tanpa batas waktu',
};

/** Proportional duration for a given number of items, in seconds. */
export function proportionalSeconds(totalQuestions: number): number {
  return Math.max(0, Math.trunc(totalQuestions)) * SECONDS_PER_QUESTION;
}

/**
 * Final duration of an assignment in seconds, or null when untimed.
 * `customMinutes` only applies in 'custom' mode.
 */
export function resolveDurationSeconds(
  mode: TimingMode,
  totalQuestions: number,
  customMinutes?: number | null,
): number | null {
  switch (mode) {
    case 'tanpa_batas':
      return null;
    case 'custom': {
      // An unusable custom limit yields null here so the form preview can
      // render while it is being typed. It is an input error, not a request
      // for an untimed assignment: the action rejects it via
      // customMinutesProblem before ever calling this.
      const minutes = Number(customMinutes);
      if (!Number.isFinite(minutes) || minutes <= 0) return null;
      return Math.round(minutes * 60);
    }
    case 'proporsional':
    default:
      return proportionalSeconds(totalQuestions);
  }
}

export const MAX_CUSTOM_MINUTES = 600;

/** Why a custom time limit is unusable, or null when it is fine. */
export function customMinutesProblem(customMinutes: unknown): string | null {
  const minutes = Number(customMinutes);
  if (customMinutes === null || customMinutes === undefined || customMinutes === '') {
    return 'Isi batas waktu dalam menit.';
  }
  if (!Number.isFinite(minutes) || minutes <= 0) return 'Batas waktu harus lebih dari 0 menit.';
  if (minutes > MAX_CUSTOM_MINUTES) return `Batas waktu maksimal ${MAX_CUSTOM_MINUTES} menit.`;
  return null;
}

/**
 * Answers already in flight when the deadline passes still count if they reach
 * the server within this window, and an expired attempt is only closed once it
 * has passed. Without it a save sent at 0:01 can lose the race against the
 * grader by a few hundred milliseconds.
 */
export const SAVE_GRACE_SECONDS = 10;

/**
 * How early a client's "time is up" submit may arrive and still be honoured.
 * Anything earlier means the device clock or the countdown is wrong.
 */
export const TIMEUP_TOLERANCE_SECONDS = 3;

/** True once the deadline plus the save grace has passed. */
export function isPastGrace(deadline: Date | null, now: Date = new Date()): boolean {
  if (deadline === null) return false;
  return now.getTime() >= deadline.getTime() + SAVE_GRACE_SECONDS * 1000;
}

/** Absolute deadline for an attempt, or null when untimed. */
export function deadlineFrom(startedAt: Date, durationSeconds: number | null): Date | null {
  if (durationSeconds === null) return null;
  return new Date(startedAt.getTime() + durationSeconds * 1000);
}

/** Seconds left until the deadline; null means untimed. Never negative. */
export function remainingSeconds(deadline: Date | null, now: Date = new Date()): number | null {
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000));
}

export function isExpired(deadline: Date | null, now: Date = new Date()): boolean {
  if (deadline === null) return false;
  return now.getTime() >= deadline.getTime();
}

/** "59:59", or "1:15:00" once past an hour. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.trunc(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/** "1 jam 15 menit" -- shown in the admin form and on assignment cards. */
export function humanizeDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.trunc(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.round((s % 3600) / 60);
  if (hours === 0) return `${minutes} menit`;
  if (minutes === 0) return `${hours} jam`;
  return `${hours} jam ${minutes} menit`;
}
