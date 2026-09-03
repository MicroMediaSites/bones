// DEV ONLY. A hand-drawn 7x7 layout for checking the board and tray at the size
// a hard puzzle will reach. It is NOT solvable and `generate()` never returns
// it; open it with the `#dev` hash.

import type { Domino, Puzzle, Region, Rule } from '../engine';

const MAP = [
  '.ABBBB.',
  'AACCDBB',
  'AEECDDF',
  'GEHHIFF',
  'GGHJIIK',
  'LLMJJKK',
  '.LMMNNN',
];

const RULES: Record<string, Rule> = {
  A: { kind: 'sum', n: 10 },
  B: { kind: 'neq' },
  C: { kind: 'eq' },
  D: { kind: 'sum', n: 9 },
  E: { kind: 'lt', n: 6 },
  F: { kind: 'gt', n: 11 },
  G: { kind: 'none' },
  H: { kind: 'sum', n: 7 },
  I: { kind: 'eq' },
  J: { kind: 'neq' },
  K: { kind: 'gt', n: 8 },
  L: { kind: 'sum', n: 4 },
  M: { kind: 'lt', n: 9 },
  N: { kind: 'none' },
};

const HAND: Domino[] = [
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
  [2, 2], [2, 3], [2, 4], [2, 5], [2, 6],
  [3, 3], [3, 4], [3, 5], [3, 6],
  [4, 4],
];

function build(): Puzzle {
  const rows = MAP.length;
  const cols = MAP[0]?.length ?? 0;
  const cells: boolean[][] = [];
  const byLetter = new Map<string, Region>();
  const regions: Region[] = [];

  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < cols; c++) {
      const letter = MAP[r]?.[c] ?? '.';
      row.push(letter !== '.');
      if (letter === '.') continue;
      let region = byLetter.get(letter);
      if (!region) {
        region = { id: regions.length, rule: RULES[letter] ?? { kind: 'none' }, cells: [] };
        byLetter.set(letter, region);
        regions.push(region);
      }
      region.cells.push({ r, c });
    }
    cells.push(row);
  }

  return { rows, cols, cells, regions, dominoes: HAND, difficulty: 'hard', seed: 0 };
}

export const devPuzzle: Puzzle = build();
