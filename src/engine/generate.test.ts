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

/** Solutions found, counted up to `cap`; an aborted search counts as the cap. */
function solutions(puzzle: Puzzle, cap: number): number {
  const result = search(puzzle, { limit: cap, maxNodes: 600_000 });
  return result.aborted ? cap : result.boards.length;
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
        // No single-cell regions: a lone cell with a rule is a revealed pip,
        // and a board of revealed pips is a lookup, not a puzzle. Carving may
        // run a region past the cap rather than leave a cell alone.
        // The only single-cell regions are free cells (no rule): a lone cell
        // with a rule would be a revealed pip.
        if (region.cells.length === 1) expect(region.rule.kind).toBe('none');
        expect(region.cells.length).toBeLessThanOrEqual(preset.maxRegion + 3);
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

describe('free cells', () => {
  test.each(DIFFICULTIES)('%s boards carry the preset number of free cells and no ≠', (difficulty) => {
    const [, max] = PRESETS[difficulty].freeCells;
    let total = 0;
    for (let seed = 0; seed < 15; seed++) {
      const puzzle = generate(difficulty, 300 + seed);
      const free = puzzle.regions.filter((r) => r.cells.length === 1 && r.rule.kind === 'none').length;
      // Free cells are detached from regions of three or more cells, so a
      // board of pairs can end up with none; on average there is at least one.
      expect(free).toBeLessThanOrEqual(max);
      expect(puzzle.regions.some((r) => r.rule.kind === 'neq')).toBe(false);
      total += free;
    }
    expect(total / 15).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

describe('rule mix', () => {
  test('easy uses no lt/gt and at most one free region', () => {
    for (let seed = 0; seed < 20; seed++) {
      const puzzle = generate('easy', seed);
      const kinds = puzzle.regions.map((r) => r.rule.kind);
      expect(kinds).not.toContain('lt');
      expect(kinds).not.toContain('gt');
      // Free cells are single-cell `none` regions and are budgeted separately.
      const freeRegions = puzzle.regions.filter((r) => r.rule.kind === 'none' && r.cells.length > 1).length;
      expect(freeRegions).toBeLessThanOrEqual(PRESETS.easy.maxNone);
    }
  });
});

describe('tightness', () => {
  // Seeds are fixed, so these are exact regression checks on the generator,
  // not statistical ones. Measured on 2026-09-02 over seeds 500..529: easy
  // 29/30, medium 11/30, hard ~12/30 boards at three solutions or fewer, and
  // medium never past 12 solutions. The bounds leave margin.
  const seeds = Array.from({ length: 30 }, (_, i) => 500 + i);
  const tightShare = (difficulty: Difficulty): number =>
    seeds.filter((s) => solutions(generate(difficulty, s), 4) <= 3).length / seeds.length;

  test('most easy puzzles have three solutions or fewer', () => {
    expect(tightShare('easy')).toBeGreaterThanOrEqual(0.7);
  }, 60_000);

  test('a good share of medium and hard puzzles have three solutions or fewer', () => {
    expect(tightShare('medium')).toBeGreaterThanOrEqual(0.25);
    expect(tightShare('hard')).toBeGreaterThanOrEqual(0.25);
  }, 240_000);

  test('easy and medium are never wide open', () => {
    for (const difficulty of ['easy', 'medium'] as Difficulty[]) {
      const loose = seeds.slice(0, 12).filter((s) => solutions(generate(difficulty, s), 60) >= 60).length;
      expect(loose).toBe(0);
    }
  }, 120_000);
});

describe('performance', () => {
  test('hard puzzles generate within budget', () => {
    const start = performance.now();
    for (let seed = 0; seed < 8; seed++) generate('hard', seed);
    expect(performance.now() - start).toBeLessThan(40_000);
  }, 60_000);
});
