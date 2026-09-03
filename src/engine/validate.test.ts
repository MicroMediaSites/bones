import { describe, expect, test } from 'bun:test';
import { fixturePuzzle, fixtureSolution } from './fixture';
import { ruleHolds, validate } from './validate';

describe('validate', () => {
  test('fixture solution solves the fixture puzzle', () => {
    const v = validate(fixturePuzzle, fixtureSolution);
    expect(v.solved).toBe(true);
    expect(Object.values(v.regions).every((s) => s === 'ok')).toBe(true);
  });

  test('empty board is incomplete everywhere', () => {
    const v = validate(fixturePuzzle, []);
    expect(v.solved).toBe(false);
    expect(v.regions[0]).toBe('incomplete');
  });

  test('a flipped tile breaks a sum region', () => {
    const board = fixtureSolution.map((p) => ({ ...p }));
    board[0] = { domino: 0, cells: [{ r: 0, c: 1 }, { r: 0, c: 0 }] };
    const v = validate(fixturePuzzle, board);
    expect(v.solved).toBe(false);
    expect(v.regions[0]).toBe('bad');
    expect(v.regions[2]).toBe('ok');
  });
});

describe('ruleHolds', () => {
  test('each rule kind', () => {
    expect(ruleHolds({ kind: 'sum', n: 6 }, [1, 5])).toBe(true);
    expect(ruleHolds({ kind: 'sum', n: 6 }, [1, 4])).toBe(false);
    expect(ruleHolds({ kind: 'eq' }, [4, 4, 4])).toBe(true);
    expect(ruleHolds({ kind: 'eq' }, [4, 3])).toBe(false);
    expect(ruleHolds({ kind: 'neq' }, [1, 2, 3])).toBe(true);
    expect(ruleHolds({ kind: 'neq' }, [1, 1])).toBe(false);
    expect(ruleHolds({ kind: 'lt', n: 5 }, [2, 2])).toBe(true);
    expect(ruleHolds({ kind: 'gt', n: 5 }, [2, 2])).toBe(false);
    expect(ruleHolds({ kind: 'none' }, [6, 6])).toBe(true);
  });
});
