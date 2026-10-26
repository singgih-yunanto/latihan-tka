import { describe, expect, it } from 'vitest';
import {
  SECONDS_PER_QUESTION,
  deadlineFrom,
  formatDuration,
  humanizeDuration,
  isExpired,
  proportionalSeconds,
  remainingSeconds,
  resolveDurationSeconds,
} from '../src/domain/timing';

describe('proportional timing', () => {
  it('matches the real exam: 30 questions = 75 minutes', () => {
    expect(SECONDS_PER_QUESTION).toBe(150);
    expect(proportionalSeconds(30)).toBe(4500);
    expect(proportionalSeconds(30) / 60).toBe(75);
  });

  it('is computed from the TOTAL question count, not per subject', () => {
    // A mix of BI 10 + MTK 15 + IPAS 5 = 30 questions still gets 75 minutes.
    const total = 10 + 15 + 5;
    expect(resolveDurationSeconds('proporsional', total)).toBe(4500);
  });

  it('computes the full TKA preset: 90 questions = 225 minutes', () => {
    expect(resolveDurationSeconds('proporsional', 90)).toBe(13500);
    expect(13500 / 60).toBe(225);
  });

  it('handles a zero question count', () => {
    expect(proportionalSeconds(0)).toBe(0);
    expect(proportionalSeconds(-5)).toBe(0);
  });
});

describe('timing modes', () => {
  it('custom mode uses the minutes entered by the admin', () => {
    expect(resolveDurationSeconds('custom', 30, 40)).toBe(2400);
    expect(resolveDurationSeconds('custom', 30, 1)).toBe(60);
  });

  it('a nonsensical custom value is treated as untimed', () => {
    expect(resolveDurationSeconds('custom', 30, 0)).toBeNull();
    expect(resolveDurationSeconds('custom', 30, -3)).toBeNull();
    expect(resolveDurationSeconds('custom', 30, null)).toBeNull();
  });

  it('untimed mode returns null', () => {
    expect(resolveDurationSeconds('tanpa_batas', 90)).toBeNull();
  });
});

describe('deadlines and remaining time', () => {
  const start = new Date('2026-09-19T08:00:00Z');

  it('computes the deadline from the start time', () => {
    const deadline = deadlineFrom(start, 4500);
    expect(deadline?.toISOString()).toBe('2026-09-19T09:15:00.000Z');
  });

  it('an untimed attempt has no deadline', () => {
    expect(deadlineFrom(start, null)).toBeNull();
    expect(remainingSeconds(null)).toBeNull();
    expect(isExpired(null)).toBe(false);
  });

  it('remaining time never goes negative', () => {
    const deadline = deadlineFrom(start, 600)!;
    const lewat = new Date(start.getTime() + 900 * 1000);
    expect(remainingSeconds(deadline, lewat)).toBe(0);
  });

  it('detects an attempt past its deadline', () => {
    const deadline = deadlineFrom(start, 600)!;
    expect(isExpired(deadline, new Date(start.getTime() + 599_000))).toBe(false);
    expect(isExpired(deadline, new Date(start.getTime() + 601_000))).toBe(true);
  });
});

describe('display formatting', () => {
  it('shows mm:ss for durations under an hour', () => {
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('switches to h:mm:ss once past an hour', () => {
    expect(formatDuration(4500)).toBe('1:15:00');
    expect(formatDuration(13500)).toBe('3:45:00');
  });

  it('writes durations in everyday Indonesian', () => {
    expect(humanizeDuration(4500)).toBe('1 jam 15 menit');
    expect(humanizeDuration(1800)).toBe('30 menit');
    expect(humanizeDuration(7200)).toBe('2 jam');
  });
});
