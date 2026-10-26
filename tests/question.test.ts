import { describe, expect, it } from 'vitest';
import { bankQuestionSchema, numericValueOf } from '../src/domain/question';

describe('numeric value of an option', () => {
  it('reads Indonesian-style numbers', () => {
    expect(numericValueOf('$0{,}35$')).toBeCloseTo(0.35);
    expect(numericValueOf('$3{,}5$')).toBeCloseTo(3.5);
    expect(numericValueOf('Rp250.000,00')).toBe(250000);
    expect(numericValueOf('$37{,}5\\%$')).toBeCloseTo(37.5);
  });

  it('treats numbers differing only by trailing zeros as equal', () => {
    expect(numericValueOf('$0{,}72$')).toBe(numericValueOf('$0{,}720$'));
  });

  it('ignores options that are not purely a number', () => {
    expect(numericValueOf('$\\frac{3}{4}$')).toBeNull();
    expect(numericValueOf('12 bingkisan')).toBeNull();
    expect(numericValueOf('Selasa ke Rabu')).toBeNull();
  });

  it('reads numbers carrying a simple unit', () => {
    expect(numericValueOf('20 km')).toBe(20);
    expect(numericValueOf('119 kg')).toBe(119);
  });
});

const base = {
  id: 'uji-0001',
  subject: 'matematika' as const,
  domain: 'bilangan',
  competency: 'penalaran',
  difficulty: 'sedang' as const,
  type: 'pg' as const,
  stem: 'Berapakah hasilnya?',
  explanation: 'Karena begitu hitungannya.',
};

describe('question item validation', () => {
  it('rejects two options with the same value but different spelling', () => {
    const hasil = bankQuestionSchema.safeParse({
      ...base,
      choices: [
        { id: 'a', text: '$0{,}35$' },
        { id: 'b', text: '$0{,}72$' },
        { id: 'c', text: '$0{,}720$' },
        { id: 'd', text: '$3{,}5$' },
      ],
      answer: 'a',
    });
    expect(hasil.success).toBe(false);
    if (!hasil.success) {
      expect(hasil.error.issues.map((i) => i.message).join(' ')).toMatch(/same value/);
    }
  });

  it('accepts numeric options that are all distinct', () => {
    const hasil = bankQuestionSchema.safeParse({
      ...base,
      choices: [
        { id: 'a', text: '$0{,}35$' },
        { id: 'b', text: '$3{,}5$' },
        { id: 'c', text: '$0{,}035$' },
        { id: 'd', text: '$2{,}86$' },
      ],
      answer: 'a',
    });
    expect(hasil.success).toBe(true);
  });

  it('rejects an answer key that is not among the options', () => {
    const hasil = bankQuestionSchema.safeParse({
      ...base,
      choices: [
        { id: 'a', text: '10' },
        { id: 'b', text: '20' },
        { id: 'c', text: '30' },
      ],
      answer: 'z',
    });
    expect(hasil.success).toBe(false);
  });

  it('rejects a strand the blueprint does not know', () => {
    const hasil = bankQuestionSchema.safeParse({
      ...base,
      domain: 'trigonometri',
      choices: [
        { id: 'a', text: '10' },
        { id: 'b', text: '20' },
        { id: 'c', text: '30' },
      ],
      answer: 'a',
    });
    expect(hasil.success).toBe(false);
  });

  it('rejects a pgk_multi key covering every option', () => {
    const hasil = bankQuestionSchema.safeParse({
      ...base,
      type: 'pgk_multi',
      choices: [
        { id: 'a', text: 'Satu' },
        { id: 'b', text: 'Dua' },
        { id: 'c', text: 'Tiga' },
      ],
      answer: ['a', 'b', 'c'],
    });
    expect(hasil.success).toBe(false);
  });

  it('rejects a pgk_kategori statement with no key', () => {
    const hasil = bankQuestionSchema.safeParse({
      ...base,
      type: 'pgk_kategori',
      statements: [
        { id: 's1', text: 'Pernyataan satu' },
        { id: 's2', text: 'Pernyataan dua' },
      ],
      categories: [
        { id: 'benar', text: 'Benar', label: 'Benar' },
        { id: 'salah', text: 'Salah', label: 'Salah' },
      ],
      answer: { s1: 'benar' },
    });
    expect(hasil.success).toBe(false);
  });
});
