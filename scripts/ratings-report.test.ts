import { describe, expect, test } from 'bun:test';

import { generate } from '../src/engine/index';
import type { Puzzle } from '../src/engine/index';
import { isRating, ratingId, type Rating } from '../src/ui/ratings';
import { computeMetrics, loadRecords, shapeMetrics } from './ratings-report';

function ratingFor(puzzle: Puzzle, over: Partial<Rating> = {}): Rating {
  return {
    id: ratingId(puzzle),
    at: '2026-09-02T12:00:00.000Z',
    verdict: 'good',
    note: '',
    regions: [],
    solved: false,
    puzzle,
    ...over,
  };
}

describe('shapeMetrics', () => {
  test('counts cells, regions and rule kinds off a real puzzle', () => {
    const puzzle = generate('easy', 1234);
    const m = shapeMetrics(puzzle);

    const playable = puzzle.cells.flat().filter(Boolean).length;
    expect(m.cells).toBe(playable);
    expect(m.dominoes).toBe(puzzle.dominoes.length);
    expect(m.regions).toBe(puzzle.regions.length);
    // Regions partition the playable cells, so mean size follows exactly.
    expect(m.meanRegionSize).toBeCloseTo(playable / puzzle.regions.length, 10);

    const kindTotal = Object.values(m.ruleKinds).reduce((a, b) => a + b, 0);
    expect(kindTotal).toBe(puzzle.regions.length);
    expect(m.noneRegions).toBe(puzzle.regions.filter((r) => r.rule.kind === 'none').length);
  });

  test('revealed cells are singleton sum regions, as a percentage', () => {
    const puzzle: Puzzle = {
      rows: 1,
      cols: 4,
      cells: [[true, true, true, true]],
      regions: [
        { id: 0, rule: { kind: 'sum', n: 3 }, cells: [{ r: 0, c: 0 }] },
        { id: 1, rule: { kind: 'eq' }, cells: [{ r: 0, c: 1 }] },
        {
          id: 2,
          rule: { kind: 'none' },
          cells: [
            { r: 0, c: 2 },
            { r: 0, c: 3 },
          ],
        },
      ],
      dominoes: [
        [3, 3],
        [1, 2],
      ],
      difficulty: 'easy',
      seed: 7,
    };
    const m = shapeMetrics(puzzle);
    expect(m.cells).toBe(4);
    expect(m.singletons).toBe(2);
    // Only region 0 is a singleton with a sum rule: 1 of 4 cells.
    expect(m.revealedPct).toBeCloseTo(25, 10);
    expect(m.noneRegions).toBe(1);
  });
});

describe('computeMetrics', () => {
  test('caps the solution count', () => {
    const puzzle = generate('easy', 99);
    expect(computeMetrics(puzzle, 3).solutions).toBeLessThanOrEqual(3);
    // A generated puzzle is checked for a solution before it is served.
    expect(computeMetrics(puzzle, 3).solutions).toBeGreaterThan(0);
  });
});

describe('isRating', () => {
  test('accepts a well-formed record and rejects junk', () => {
    const good = ratingFor(generate('easy', 5));
    expect(isRating(good)).toBe(true);
    expect(isRating({ ...good, verdict: 'meh' })).toBe(false);
    expect(isRating({ ...good, regions: ['1'] })).toBe(false);
    expect(isRating({ ...good, puzzle: null })).toBe(false);
    expect(isRating(null)).toBe(false);
    expect(isRating('nope')).toBe(false);
  });
});

describe('loadRecords', () => {
  test('dedupes by id keeping the newest, and counts junk it drops', async () => {
    const puzzle = generate('easy', 42);
    const older = ratingFor(puzzle, { at: '2026-09-01T00:00:00.000Z', note: 'older' });
    const newer = ratingFor(puzzle, { at: '2026-09-02T00:00:00.000Z', note: 'newer' });
    const other = ratingFor(generate('medium', 43), { verdict: 'bad' });

    const dir = `${import.meta.dir}/.tmp-loadrecords-${Date.now()}`;
    await Bun.write(`${dir}/a.json`, JSON.stringify([older, other, { nope: true }]));
    await Bun.write(`${dir}/b.json`, JSON.stringify([newer]));

    try {
      const { ratings, skipped } = loadRecords([`${dir}/a.json`, `${dir}/b.json`]);
      expect(skipped).toBe(1);
      expect(ratings).toHaveLength(2);
      expect(ratings.find((r) => r.id === older.id)?.note).toBe('newer');
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
