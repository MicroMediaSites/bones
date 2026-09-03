import type { Board, Puzzle } from './types';

/** A hand-built easy puzzle for UI work and tests. */
export const fixturePuzzle: Puzzle = {
  rows: 2,
  cols: 4,
  cells: [
    [true, true, true, true],
    [true, true, true, true],
  ],
  regions: [
    { id: 0, rule: { kind: 'sum', n: 1 }, cells: [{ r: 0, c: 0 }, { r: 1, c: 0 }] },
    { id: 1, rule: { kind: 'sum', n: 7 }, cells: [{ r: 0, c: 1 }, { r: 1, c: 1 }] },
    { id: 2, rule: { kind: 'eq' }, cells: [{ r: 0, c: 2 }, { r: 0, c: 3 }] },
    { id: 3, rule: { kind: 'sum', n: 7 }, cells: [{ r: 1, c: 2 }, { r: 1, c: 3 }] },
  ],
  dominoes: [
    [1, 2],
    [3, 3],
    [0, 5],
    [6, 1],
  ],
  difficulty: 'easy',
  seed: 1,
};

export const fixtureSolution: Board = [
  { domino: 0, cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }] },
  { domino: 1, cells: [{ r: 0, c: 2 }, { r: 0, c: 3 }] },
  { domino: 2, cells: [{ r: 1, c: 0 }, { r: 1, c: 1 }] },
  { domino: 3, cells: [{ r: 1, c: 2 }, { r: 1, c: 3 }] },
];
