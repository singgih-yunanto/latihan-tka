/**
 * Answer option shuffling.
 *
 * The order is shuffled once when the attempt is created and then STORED in the
 * database, so reloading the page never reshuffles it and the results page
 * shows exactly the order the student worked through.
 */

/** Deterministic PRNG (mulberry32) so shuffles are reproducible in tests. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates. Returns a new array; the input is left untouched. */
export function shuffled<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Display order for a question's options: the shuffled list of option ids.
 * For pgk_kategori it is the statement order that gets shuffled.
 */
export function shuffleOptionIds(
  optionIds: readonly string[],
  rng: () => number = Math.random,
): string[] {
  return shuffled(optionIds, rng);
}

/**
 * Reorder a list of options to match the stored id order.
 * Options whose id is missing from `order` are appended in their original
 * order, so a question still renders in full if the bank is edited after the
 * attempt was created.
 */
export function applyOrder<T extends { id: string }>(
  options: readonly T[],
  order: readonly string[] | null | undefined,
): T[] {
  if (!order || order.length === 0) return options.slice();
  const byId = new Map(options.map((o) => [o.id, o]));
  const out: T[] = [];
  for (const id of order) {
    const found = byId.get(id);
    if (found) {
      out.push(found);
      byId.delete(id);
    }
  }
  for (const leftover of options) {
    if (byId.has(leftover.id)) out.push(leftover);
  }
  return out;
}
