/**
 * Deterministic PRNG (mulberry32). The generator draws every random choice
 * from here so that `generate(difficulty, seed)` is reproducible.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, n). `n` must be >= 1. */
  int(n: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates, in place; returns the same array. */
  shuffle<T>(items: T[]): T[];
}

export function makeRng(seed: number): Rng {
  // Mix the seed so that nearby seeds (e.g. 1, 2, 3) diverge immediately.
  let state = (seed ^ 0x9e3779b9) >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (n: number): number => Math.floor(next() * n);

  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      return items[int(items.length)] as T;
    },
    shuffle<T>(items: T[]): T[] {
      for (let i = items.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const a = items[i] as T;
        items[i] = items[j] as T;
        items[j] = a;
      }
      return items;
    },
  };
}

/** Pick an index from `weights` proportional to its value. Weights must sum > 0. */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w;
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i] as number;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}
