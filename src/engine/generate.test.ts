import { describe, expect, test } from 'bun:test';
import { PRESETS, generate } from './generate';
import { countSolutions, search } from './solve';
import { validate } from './validate';
import type { Difficulty, Puzzle } from './types';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

function playableCount(puzzle: Puzzle): number {
  let count = 0;
  for (const row of puzzle.cells) for (const cell of row) if (cell) count++;
  return count;
}

/** Provably unique = exactly one solution found without hitting the node cap. */
function provablyUnique(puzzle: Puzzle): boolean {
  const result = search(puzzle, { limit: 2, maxNodes: 400_000 });
  return !result.aborted && result.boards.length === 1;
}

describe.each(DIFFICULTIES)('generate(%s)', (difficulty) => {
  const preset = PRESETS[difficulty];
  const puzzles = Array.from({ length: 20 }, (_, i) => generate(difficulty, 1000 + i));

  test('honours the preset domino count and bounding box', () => {
    for (const puzzle of puzzles) {
      expect(puzzle.difficulty).toBe(difficulty);
      expect(puzzle.dominoes.length).toBeGreaterThanOrEqual(preset.minDominoes);
      expect(puzzle.dominoes.length).toBeLessThanOrEqual(preset.maxDominoes);
      expect(puzzle.rows).toBeLessThanOrEqual(preset.box);
      expect(puzzle.cols).toBeLessThanOrEqual(preset.box);
      expect(puzzle.cells).toHaveLength(puzzle.rows);
      for (const row of puzzle.cells) expect(row).toHaveLength(puzzle.cols);
    }
  });

  test('the hand is distinct tiles from the double-six set covering every cell', () => {
    for (const puzzle of puzzles) {
      const seen = new Set<string>();
      for (const [a, b] of puzzle.dominoes) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(6);
        expect(a).toBeLessThanOrEqual(b);
        const key = `${a}-${b}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      expect(puzzle.dominoes.length * 2).toBe(playableCount(puzzle));
    }
  });

  test('regions partition the playable cells exactly', () => {
    for (const puzzle of puzzles) {
      const owned = new Set<string>();
      for (const region of puzzle.regions) {
        expect(region.cells.length).toBeGreaterThanOrEqual(1);
        expect(region.cells.length).toBeLessThanOrEqual(preset.maxRegion);
        for (const cell of region.cells) {
          const key = `${cell.r},${cell.c}`;
          expect(owned.has(key)).toBe(false);
          owned.add(key);
          expect(puzzle.cells[cell.r]?.[cell.c]).toBe(true);
        }
      }
      expect(owned.size).toBe(playableCount(puzzle));
      expect(new Set(puzzle.regions.map((r) => r.id)).size).toBe(puzzle.regions.length);
    }
  });

  test('every puzzle is solvable and the solution validates', () => {
    for (const puzzle of puzzles) {
      expect(countSolutions(puzzle, 1)).toBe(1);
      const board = search(puzzle, { limit: 1 }).boards[0];
      expect(board).toBeDefined();
      expect(validate(puzzle, board!).solved).toBe(true);
    }
  });

  test('is deterministic for a given seed', () => {
    expect(generate(difficulty, 4242)).toEqual(generate(difficulty, 4242));
  });
});

describe('rule mix', () => {
  test('easy uses no lt/gt and at most one free region', () => {
    for (let seed = 0; seed < 20; seed++) {
      const puzzle = generate('easy', seed);
      const kinds = puzzle.regions.map((r) => r.rule.kind);
      expect(kinds).not.toContain('lt');
      expect(kinds).not.toContain('gt');
      expect(kinds.filter((k) => k === 'none').length).toBeLessThanOrEqual(PRESETS.easy.maxNone);
    }
  });
});

describe('uniqueness', () => {
  test('most easy puzzles are provably unique', () => {
    const seeds = Array.from({ length: 30 }, (_, i) => 500 + i);
    const unique = seeds.filter((s) => provablyUnique(generate('easy', s))).length;
    expect(unique / seeds.length).toBeGreaterThanOrEqual(0.7);
  });
});

describe('performance', () => {
  test('hard puzzles generate within budget', () => {
    const start = performance.now();
    for (let seed = 0; seed < 10; seed++) generate('hard', seed);
    expect(performance.now() - start).toBeLessThan(10_000);
  });
});
