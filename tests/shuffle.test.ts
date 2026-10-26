import { describe, expect, it } from 'vitest';
import { applyOrder, makeRng, shuffleOptionIds, shuffled } from '../src/domain/shuffle';
import type { Choice } from '../src/domain/question';

const choices: Choice[] = [
  { id: 'a', text: 'Trapesium' },
  { id: 'b', text: 'Jajargenjang' },
  { id: 'c', text: 'Belah ketupat' },
  { id: 'd', text: 'Layang-layang' },
];

describe('shuffling', () => {
  it('keeps every member, losing and duplicating none', () => {
    const ids = choices.map((c) => c.id);
    const result = shuffleOptionIds(ids, makeRng(42));
    expect(result).toHaveLength(ids.length);
    expect([...result].sort()).toEqual([...ids].sort());
  });

  it('leaves the input array untouched', () => {
    const ids = ['a', 'b', 'c', 'd'];
    shuffleOptionIds(ids, makeRng(7));
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('actually changes the order for most seeds', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const berbeda = Array.from({ length: 20 }, (_, seed) =>
      shuffleOptionIds(ids, makeRng(seed)).join(''),
    ).filter((s) => s !== 'abcdef');
    expect(berbeda.length).toBeGreaterThan(15);
  });

  it('is deterministic for the same seed', () => {
    expect(shuffled(choices, makeRng(99))).toEqual(shuffled(choices, makeRng(99)));
  });
});

describe('applying a stored order', () => {
  it('arranges options exactly in the stored order', () => {
    const order = ['c', 'a', 'd', 'b'];
    expect(applyOrder(choices, order).map((c) => c.id)).toEqual(order);
  });

  it('is stable: repeated reads give the same order', () => {
    const order = shuffleOptionIds(choices.map((c) => c.id), makeRng(5));
    const first = applyOrder(choices, order).map((c) => c.id);
    const second = applyOrder(choices, order).map((c) => c.id);
    expect(first).toEqual(second);
  });

  it('the answer key still points at the same option after shuffling', () => {
    const kunci = 'c';
    const order = shuffleOptionIds(choices.map((c) => c.id), makeRng(13));
    const tampil = applyOrder(choices, order);

    const posisi = tampil.findIndex((c) => c.id === kunci);
    expect(posisi).toBeGreaterThanOrEqual(0);
    expect(tampil[posisi].text).toBe('Belah ketupat');
  });

  it('an illustrated option moves together with its figure', () => {
    const bergambar: Choice[] = [
      { id: 'a', text: 'Bangun 1', figure: { kind: 'svg', svg: '<svg viewBox="0 0 10 10"/>', alt: 'Persegi sisi 4 cm' } },
      { id: 'b', text: 'Bangun 2', figure: { kind: 'svg', svg: '<svg viewBox="0 0 20 10"/>', alt: 'Persegi panjang 8x4 cm' } },
      { id: 'c', text: 'Bangun 3' },
    ];

    const tampil = applyOrder(bergambar, ['c', 'b', 'a']);
    expect(tampil.map((c) => c.id)).toEqual(['c', 'b', 'a']);
    expect(tampil[1].figure?.alt).toBe('Persegi panjang 8x4 cm');
    expect(tampil[2].figure?.alt).toBe('Persegi sisi 4 cm');
  });

  it('still shows new options missing from the stored order', () => {
    // Protects existing attempts if the bank is edited after they were made.
    const tampil = applyOrder(choices, ['b', 'a']);
    expect(tampil.map((c) => c.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('ignores an empty order', () => {
    expect(applyOrder(choices, []).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(applyOrder(choices, null).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
