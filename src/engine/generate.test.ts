import { describe, expect, test } from 'bun:test';
import { PRESETS, generate } from './generate';
import { tileShape } from './shapes';
import { makeRng } from './rng';
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
        expect(region.cells.length).toBeGreaterThanOrEqual(2);
        expect(region.cells.length).toBeLessThanOrEqual(preset.maxRegion + 2);
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

describe('board shapes', () => {
  // Sixty fixed seeds per difficulty, generated once and shared by the tests
  // below. Bounds are measured (see the numbers in each test) with margin, so
  // these are regression checks on the shape families, not statistical ones.
  const SEEDS = Array.from({ length: 60 }, (_, i) => 2000 + i);
  const cache = new Map<Difficulty, Puzzle[]>();
  const boardsFor = (difficulty: Difficulty): Puzzle[] => {
    const found = cache.get(difficulty);
    if (found) return found;
    const made = SEEDS.map((seed) => generate(difficulty, seed));
    cache.set(difficulty, made);
    return made;
  };

  /** The board silhouette, rows joined — two boards match only if identical. */
  const silhouette = (puzzle: Puzzle): string =>
    puzzle.cells.map((row) => row.map((cell) => (cell ? '#' : '.')).join('')).join('/');
  const distinct = (difficulty: Difficulty): number =>
    new Set(boardsFor(difficulty).map(silhouette)).size;

  /** An empty cell the border cannot reach through other empty cells. */
  const hasInteriorHole = (puzzle: Puzzle): boolean => {
    const { rows, cols } = puzzle;
    const outside = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
    const stack: Array<[number, number]> = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const onBorder = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
        if (!onBorder || puzzle.cells[r]?.[c] || outside[r]?.[c]) continue;
        (outside[r] as boolean[])[c] = true;
        stack.push([r, c]);
      }
    }
    while (stack.length > 0) {
      const [r, c] = stack.pop() as [number, number];
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        if (puzzle.cells[nr]?.[nc] || outside[nr]?.[nc]) continue;
        (outside[nr] as boolean[])[nc] = true;
        stack.push([nr, nc]);
      }
    }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) if (!puzzle.cells[r]?.[c] && !outside[r]?.[c]) return true;
    return false;
  };
  const holeShare = (difficulty: Difficulty): number =>
    boardsFor(difficulty).filter(hasInteriorHole).length / SEEDS.length;

  test('easy boards come in many different silhouettes', () => {
    // Measured 2026-09-02: 32 of 60 (blob growth alone gave 29).
    expect(distinct('easy')).toBeGreaterThanOrEqual(25);
  }, 60_000);

  test('medium and hard boards come in many different silhouettes', () => {
    // Measured 2026-09-02: medium 50 of 60, hard 60 of 60.
    expect(distinct('medium')).toBeGreaterThanOrEqual(40);
    expect(distinct('hard')).toBeGreaterThanOrEqual(40);
  }, 300_000);

  test('a good share of medium and hard boards have a hole in the middle', () => {
    // A hole in the middle of the layout is what makes a board interesting to
    // look at and to solve. Measured 2026-09-02: medium 0.53, hard 0.57
    // (blob growth alone: medium 0.00, hard 0.02).
    expect(holeShare('medium')).toBeGreaterThanOrEqual(0.3);
    expect(holeShare('hard')).toBeGreaterThanOrEqual(0.3);
  }, 300_000);

  test('no playable cell has only one playable neighbour', () => {
    // A cell whose only neighbour is its own domino partner pins that tile
    // inside one region, where it flips for free and doubles the solutions.
    for (const difficulty of DIFFICULTIES) {
      for (const puzzle of boardsFor(difficulty)) {
        for (let r = 0; r < puzzle.rows; r++) {
          for (let c = 0; c < puzzle.cols; c++) {
            if (!puzzle.cells[r]?.[c]) continue;
            let degree = 0;
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
              if (puzzle.cells[r + dr]?.[c + dc]) degree++;
            expect(degree).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
  }, 300_000);
});

describe('tileShape', () => {
  const ring = [
    [0, 0], [0, 1], [0, 2], [0, 3],
    [1, 0], [1, 3],
    [2, 0], [2, 3],
    [3, 0], [3, 1], [3, 2], [3, 3],
  ].map(([r, c]) => ({ r: r as number, c: c as number }));

  test('tiles a ring, and tiles it differently on different seeds', () => {
    const layouts = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const tiles = tileShape(ring, makeRng(seed));
      expect(tiles).not.toBeNull();
      const covered = new Set<string>();
      for (const [a, b] of tiles as Array<[typeof ring[0], typeof ring[0]]>) {
        expect(Math.abs(a.r - b.r) + Math.abs(a.c - b.c)).toBe(1);
        covered.add(`${a.r},${a.c}`);
        covered.add(`${b.r},${b.c}`);
      }
      expect(covered.size).toBe(ring.length);
      layouts.add(
        (tiles as Array<[typeof ring[0], typeof ring[0]]>)
          .map(([a, b]) => `${a.r},${a.c}-${b.r},${b.c}`)
          .sort()
          .join('|'),
      );
    }
    // A ring of twelve cells has exactly two tilings; both should turn up.
    expect(layouts.size).toBe(2);
  });

  test('reports a shape that cannot be tiled', () => {
    // Three cells in an L: odd, so no perfect matching exists.
    const odd = [
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 1, c: 0 },
    ];
    expect(tileShape(odd, makeRng(1))).toBeNull();
  });
});
