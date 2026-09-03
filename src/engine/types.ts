// The engine contract. Both the generator/solver and the UI build against
// this file; change it deliberately.

export interface Cell {
  r: number;
  c: number;
}

/** Constraint on the pip values inside one region. */
export type Rule =
  | { kind: 'sum'; n: number } // pips in the region add up to exactly n
  | { kind: 'eq' } // every pip in the region is the same value
  | { kind: 'neq' } // every pip in the region is a different value
  | { kind: 'lt'; n: number } // pips in the region add up to less than n
  | { kind: 'gt'; n: number } // pips in the region add up to more than n
  | { kind: 'none' }; // no constraint (a "free" region)

export interface Region {
  id: number;
  rule: Rule;
  cells: Cell[];
}

/** A domino tile: two pip values, each 0..6. Index into Puzzle.dominoes is the tile id. */
export type Domino = readonly [number, number];

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Puzzle {
  rows: number;
  cols: number;
  /** cells[r][c] === true when the cell is part of the board. */
  cells: boolean[][];
  /** Regions partition the playable cells exactly. */
  regions: Region[];
  /** The hand of tiles. Every tile must be placed to finish. */
  dominoes: Domino[];
  difficulty: Difficulty;
  seed: number;
}

/**
 * One tile on the board. dominoes[domino][0] sits on cells[0] and
 * dominoes[domino][1] sits on cells[1]. The two cells must be orthogonally
 * adjacent. Flipping a tile = swapping the two cells.
 */
export interface Placement {
  domino: number;
  cells: [Cell, Cell];
}

export type Board = Placement[];

export type RegionStatus = 'ok' | 'bad' | 'incomplete';

export interface Validation {
  /** Every cell is covered and every region rule holds. */
  solved: boolean;
  /** Keyed by Region.id. */
  regions: Record<number, RegionStatus>;
}
