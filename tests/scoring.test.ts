import { describe, expect, it } from 'vitest';
import { scoreAttempt, scoreItem, type ScoredItem } from '../src/domain/scoring';
import type { AnswerKey, Response } from '../src/domain/question';

const single: AnswerKey = { kind: 'single', correct: 'b' };
const multi: AnswerKey = { kind: 'multi', correct: ['a', 'c'] };
const kategori: AnswerKey = {
  kind: 'kategori',
  correct: { s1: 'benar', s2: 'salah', s3: 'benar', s4: 'salah' },
};

describe('simple multiple choice', () => {
  it('awards 1 point for a correct answer', () => {
    const r: Response = { kind: 'single', choice: 'b' };
    expect(scoreItem('pg', single, r)).toMatchObject({ points: 1, isCorrect: true });
  });

  it('awards 0 points for a wrong answer', () => {
    const r: Response = { kind: 'single', choice: 'a' };
    expect(scoreItem('pg', single, r)).toMatchObject({ points: 0, isCorrect: false });
  });

  it('awards 0 points for an item left blank', () => {
    expect(scoreItem('pg', single, { kind: 'single', choice: null })).toMatchObject({ points: 0 });
    expect(scoreItem('pg', single, null)).toMatchObject({ points: 0 });
  });
});

describe('multi-answer complex choice', () => {
  it('awards full marks when every key is picked and nothing else', () => {
    const r: Response = { kind: 'multi', choices: ['a', 'c'] };
    expect(scoreItem('pgk_multi', multi, r)).toMatchObject({ points: 1, isCorrect: true });
  });

  it('gives partial credit for one key out of two', () => {
    const r: Response = { kind: 'multi', choices: ['a'] };
    expect(scoreItem('pgk_multi', multi, r)).toMatchObject({ points: 0.5, isCorrect: false });
  });

  it('deducts for wrong picks', () => {
    // 2 correct - 1 wrong = 1, divided by 2 keys = 0.5
    const r: Response = { kind: 'multi', choices: ['a', 'c', 'd'] };
    expect(scoreItem('pgk_multi', multi, r).points).toBeCloseTo(0.5);
  });

  it('clamps at 0 so ticking every option gains nothing', () => {
    const r: Response = { kind: 'multi', choices: ['a', 'b', 'c', 'd'] };
    expect(scoreItem('pgk_multi', multi, r).points).toBe(0);
  });

  it('awards 0 for an entirely wrong answer', () => {
    const r: Response = { kind: 'multi', choices: ['b', 'd'] };
    expect(scoreItem('pgk_multi', multi, r).points).toBe(0);
  });
});

describe('category complex choice', () => {
  it('awards 1/N of a point per correct statement', () => {
    const r: Response = {
      kind: 'kategori',
      picks: { s1: 'benar', s2: 'salah', s3: 'salah', s4: 'salah' },
    };
    expect(scoreItem('pgk_kategori', kategori, r).points).toBeCloseTo(0.75);
  });

  it('awards full marks when every statement is right', () => {
    const r: Response = {
      kind: 'kategori',
      picks: { s1: 'benar', s2: 'salah', s3: 'benar', s4: 'salah' },
    };
    expect(scoreItem('pgk_kategori', kategori, r)).toMatchObject({ points: 1, isCorrect: true });
  });

  it('awards 0 when nothing has been categorised', () => {
    expect(scoreItem('pgk_kategori', kategori, { kind: 'kategori', picks: {} }).points).toBe(0);
  });
});

describe('mismatched response shape', () => {
  it('is treated as unanswered rather than throwing', () => {
    const r: Response = { kind: 'multi', choices: ['a'] };
    expect(scoreItem('pg', single, r)).toMatchObject({ points: 0, isCorrect: false });
  });
});

describe('attempt score aggregation', () => {
  const items: ScoredItem[] = [
    { questionId: 'a1', subject: 'matematika', domain: 'bilangan', competency: 'penalaran', points: 1, pointsMax: 1, isCorrect: true },
    { questionId: 'a2', subject: 'matematika', domain: 'bilangan', competency: 'penalaran', points: 0, pointsMax: 1, isCorrect: false },
    { questionId: 'a3', subject: 'matematika', domain: 'data_peluang', competency: 'representasi', points: 0.5, pointsMax: 1, isCorrect: false },
    { questionId: 'b1', subject: 'bahasa_indonesia', domain: 'teks_fiksi', competency: 'inferensial', points: 1, pointsMax: 1, isCorrect: true },
  ];

  it('computes the total and the percentage', () => {
    const score = scoreAttempt(items);
    expect(score.points).toBe(2.5);
    expect(score.pointsMax).toBe(4);
    expect(score.percent).toBe(62.5);
  });

  it('breaks the score down by subject', () => {
    const score = scoreAttempt(items);
    const mtk = score.bySubject.find((b) => b.key === 'matematika');
    const bi = score.bySubject.find((b) => b.key === 'bahasa_indonesia');

    expect(mtk).toMatchObject({ points: 1.5, pointsMax: 3, count: 3, correctCount: 1 });
    expect(mtk!.percent).toBe(50);
    expect(bi).toMatchObject({ points: 1, pointsMax: 1, count: 1, correctCount: 1 });
    expect(bi!.percent).toBe(100);
  });

  it('breaks the score down by strand and competency', () => {
    const score = scoreAttempt(items);
    const bilangan = score.byDomain.find((b) => b.key === 'matematika:bilangan');
    expect(bilangan).toMatchObject({ count: 2, points: 1, percent: 50 });

    const inferensial = score.byCompetency.find((b) => b.key === 'bahasa_indonesia:inferensial');
    expect(inferensial).toMatchObject({ count: 1, percent: 100 });
  });

  it('handles an empty attempt without dividing by zero', () => {
    const score = scoreAttempt([]);
    expect(score).toMatchObject({ points: 0, pointsMax: 0, percent: 0 });
  });
});
