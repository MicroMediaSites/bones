import { describe, expect, test } from 'bun:test';
import { fixturePuzzle } from './fixture';
import { countSolutions, search, solve } from './solve';
import { validate } from './validate';
import type { Puzzle } from './types';

describe('solve', () => {
  test('finds a valid solution for the fixture', () => {
    const boards = solve(fixturePuzzle);
    expect(boards.length).toBeGreaterThanOrEqual(1);
    for (const board of boards) {
      expect(board).toHaveLength(fixturePuzzle.dominoes.length);
      expect(validate(fixturePuzzle, board).solved).toBe(true);
    }
  });

  test('countSolutions honours the limit', () => {
    expect(countSolutions(fixturePuzzle, 1)).toBe(1);
    expect(countSolutions(fixturePuzzle, 2)).toBeLessThanOrEqual(2);
  });

  test('returns nothing when the hand cannot cover the board', () => {
    const short: Puzzle = { ...fixturePuzzle, dominoes: fixturePuzzle.dominoes.slice(0, 3) };
    expect(solve(short)).toHaveLength(0);
  });

  test('an unsatisfiable rule yields no solution', () => {
    const impossible: Puzzle = {
      ...fixturePuzzle,
      regions: fixturePuzzle.regions.map((r) =>
        r.id === 0 ? { ...r, rule: { kind: 'sum' as const, n: 99 } } : r,
      ),
    };
    expect(solve(impossible)).toHaveLength(0);
  });

  test('reports abort when the node budget runs out', () => {
    const result = search(fixturePuzzle, { limit: 2, maxNodes: 1 });
    expect(result.aborted).toBe(true);
  });
});
