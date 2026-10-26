import { describe, expect, it } from 'vitest';
import { allQuestions, validateBank } from '../scripts/bank-lib';
import { BLUEPRINT, SUBJECTS } from '../src/domain/blueprint';
import { fingerprintOf } from '../src/domain/fingerprint';

/**
 * Runs the question bank checks as part of npm test, so a new batch can never
 * slip through in a broken state.
 */

const { files, issues } = validateBank();
const questions = allQuestions(files).map(({ question }) => question);

describe('question bank files', () => {
  it('pass every schema and cross-file check', () => {
    const summary = issues.map((i) => `${i.file} [${i.where}] ${i.message}`);
    expect(summary).toEqual([]);
  });

  it('contain at least one question', () => {
    expect(questions.length).toBeGreaterThan(0);
  });

  it('never reuse a question id', () => {
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contain no duplicated content', () => {
    const prints = questions.map(fingerprintOf);
    expect(new Set(prints).size).toBe(prints.length);
  });

  it('only use strands and competencies the blueprint knows', () => {
    for (const q of questions) {
      const spec = BLUEPRINT[q.subject];
      expect(spec.domains.map((d) => d.key)).toContain(q.domain);
      expect(spec.competencies.map((c) => c.key)).toContain(q.competency);
    }
  });

  it('always attach Bahasa Indonesia items to a reading passage', () => {
    const withoutStimulus = questions
      .filter((q) => q.subject === 'bahasa_indonesia' && !q.stimulusId)
      .map((q) => q.id);
    expect(withoutStimulus).toEqual([]);
  });

  it('give every Geometri & Pengukuran and Data & Peluang item a figure', () => {
    const mustHaveFigure = questions.filter(
      (q) =>
        q.subject === 'matematika' &&
        (q.domain === 'geometri_pengukuran' || q.domain === 'data_peluang'),
    );
    const withoutFigure = mustHaveFigure
      .filter((q) => !q.figure && !q.choices?.some((c) => c.figure))
      .map((q) => q.id);
    expect(withoutFigure).toEqual([]);
  });
});

describe('question bank spread', () => {
  it.each(SUBJECTS)('%s uses more than one question format', (subject) => {
    const mine = questions.filter((q) => q.subject === subject);
    if (mine.length === 0) return;
    expect(new Set(mine.map((q) => q.type)).size).toBeGreaterThanOrEqual(2);
  });
});
