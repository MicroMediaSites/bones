import type { Difficulty, Puzzle } from './types';
import { fixturePuzzle } from './fixture';

/**
 * STUB — returns the fixture regardless of difficulty. The real generator
 * (random tiling → derived rules → solver-checked) replaces this file.
 */
export function generate(difficulty: Difficulty, seed: number = Date.now()): Puzzle {
  return { ...fixturePuzzle, difficulty, seed };
}
