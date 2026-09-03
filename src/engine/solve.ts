import type { Board, Placement, Puzzle, Rule } from './types';
import { ruleHolds } from './validate';

export interface SearchOptions {
  /** Stop once this many solutions have been found. */
  limit?: number;
  /** Give up after this many search nodes; the result is then `aborted`. */
  maxNodes?: number;
}

export interface SearchResult {
  boards: Board[];
  nodes: number;
  /** True when the node budget ran out, so `boards` may be incomplete. */
  aborted: boolean;
}

const DEFAULT_MAX_NODES = 2_000_000;

/**
 * Exhaustive backtracking search over domino placements.
 *
 * At every step it takes the first uncovered cell in row-major order. All
 * cells before it are already covered, so the tile that covers it can only
 * extend right or down. Each region carries a running sum / value list so
 * that a branch dies the moment a region can no longer satisfy its rule.
 */
export function search(puzzle: Puzzle, options: SearchOptions = {}): SearchResult {
  const limit = options.limit ?? 2;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;

  const { rows, cols, dominoes } = puzzle;

  // --- board topology -----------------------------------------------------
  const id = new Int32Array(rows * cols).fill(-1);
  const cellR: number[] = [];
  const cellC: number[] = [];
  for (let r = 0; r < rows; r++) {
    const row = puzzle.cells[r];
    if (!row) continue;
    for (let c = 0; c < cols; c++) {
      if (!row[c]) continue;
      id[r * cols + c] = cellR.length;
      cellR.push(r);
      cellC.push(c);
    }
  }
  const n = cellR.length;

  const boards: Board[] = [];
  if (n === 0 || dominoes.length * 2 !== n) {
    // No arrangement can cover every cell with every tile.
    return { boards, nodes: 0, aborted: false };
  }

  const at = (r: number, c: number): number =>
    r < 0 || c < 0 || r >= rows || c >= cols ? -1 : (id[r * cols + c] as number);

  // nbr[i * 4 + k]: up, left, right, down neighbour cell ids (-1 when absent).
  const nbr = new Int32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const r = cellR[i] as number;
    const c = cellC[i] as number;
    nbr[i * 4] = at(r - 1, c);
    nbr[i * 4 + 1] = at(r, c - 1);
    nbr[i * 4 + 2] = at(r, c + 1);
    nbr[i * 4 + 3] = at(r + 1, c);
  }

  // --- region state -------------------------------------------------------
  const regionOf = new Int32Array(n).fill(-1);
  const rules: Rule[] = [];
  const regionValues: number[][] = [];
  const regionSum = new Int32Array(puzzle.regions.length);
  const regionLeft = new Int32Array(puzzle.regions.length);
  for (let g = 0; g < puzzle.regions.length; g++) {
    const region = puzzle.regions[g] as (typeof puzzle.regions)[number];
    rules.push(region.rule);
    regionValues.push([]);
    let size = 0;
    for (const cell of region.cells) {
      const i = at(cell.r, cell.c);
      if (i < 0) continue;
      regionOf[i] = g;
      size++;
    }
    regionLeft[g] = size;
  }

  // --- search state -------------------------------------------------------
  const covered = new Uint8Array(n);
  const used = new Uint8Array(dominoes.length);
  const stackTile = new Int32Array(dominoes.length);
  const stackCellA = new Int32Array(dominoes.length); // holds tile[0]
  const stackCellB = new Int32Array(dominoes.length); // holds tile[1]
  let depth = 0;
  let nodes = 0;
  let aborted = false;

  /** Add `v` to its region; returns false when the region can no longer hold. */
  const applyValue = (cell: number, v: number): boolean => {
    const g = regionOf[cell] as number;
    if (g < 0) return true;
    const values = regionValues[g] as number[];
    values.push(v);
    const sum = (regionSum[g] as number) + v;
    const left = (regionLeft[g] as number) - 1;
    regionSum[g] = sum;
    regionLeft[g] = left;
    const rule = rules[g] as Rule;
    switch (rule.kind) {
      case 'sum':
        // The sum only grows; 6 is the largest pip an unfilled cell can take.
        if (sum > rule.n || sum + left * 6 < rule.n) return false;
        break;
      case 'lt':
        if (sum >= rule.n) return false;
        break;
      case 'gt':
        if (sum + left * 6 <= rule.n) return false;
        break;
      case 'eq':
        if (v !== values[0]) return false;
        break;
      case 'neq':
        for (let k = 0; k < values.length - 1; k++) if (values[k] === v) return false;
        break;
      case 'none':
        break;
    }
    return left > 0 || ruleHolds(rule, values);
  };

  const undoValue = (cell: number): void => {
    const g = regionOf[cell] as number;
    if (g < 0) return;
    const values = regionValues[g] as number[];
    const v = values.pop() as number;
    regionSum[g] = (regionSum[g] as number) - v;
    regionLeft[g] = (regionLeft[g] as number) + 1;
  };

  /** True when some uncovered cell next to `a`/`b` has no uncovered neighbour left. */
  const strands = (a: number, b: number): boolean => {
    for (const x of [a, b]) {
      for (let k = 0; k < 4; k++) {
        const m = nbr[x * 4 + k] as number;
        if (m < 0 || covered[m]) continue;
        let free = 0;
        for (let q = 0; q < 4; q++) {
          const o = nbr[m * 4 + q] as number;
          if (o >= 0 && !covered[o]) free++;
        }
        if (free === 0) return true;
      }
    }
    return false;
  };

  const snapshot = (): Board => {
    const board: Placement[] = [];
    for (let i = 0; i < depth; i++) {
      const a = stackCellA[i] as number;
      const b = stackCellB[i] as number;
      board.push({
        domino: stackTile[i] as number,
        cells: [
          { r: cellR[a] as number, c: cellC[a] as number },
          { r: cellR[b] as number, c: cellC[b] as number },
        ],
      });
    }
    return board;
  };

  const dfs = (from: number): void => {
    if (++nodes > maxNodes) {
      aborted = true;
      return;
    }
    let cell = -1;
    for (let i = from; i < n; i++) {
      if (!covered[i]) {
        cell = i;
        break;
      }
    }
    if (cell < 0) {
      boards.push(snapshot());
      return;
    }

    // Only right (k=2) and down (k=3): up/left are lower ids, already covered.
    for (let k = 2; k < 4; k++) {
      const other = nbr[cell * 4 + k] as number;
      if (other < 0 || covered[other]) continue;
      covered[cell] = 1;
      covered[other] = 1;
      const dead = strands(cell, other);
      if (!dead) {
        for (let d = 0; d < dominoes.length; d++) {
          if (used[d]) continue;
          const tile = dominoes[d] as readonly [number, number];
          const [t0, t1] = tile;
          // Orientation 2 is redundant for a double.
          const orientations = t0 === t1 ? 1 : 2;
          for (let o = 0; o < orientations; o++) {
            const onCell = o === 0 ? t0 : t1;
            const onOther = o === 0 ? t1 : t0;
            if (applyValue(cell, onCell)) {
              if (applyValue(other, onOther)) {
                used[d] = 1;
                stackTile[depth] = d;
                stackCellA[depth] = o === 0 ? cell : other;
                stackCellB[depth] = o === 0 ? other : cell;
                depth++;
                dfs(cell + 1);
                depth--;
                used[d] = 0;
              }
              undoValue(other);
            }
            undoValue(cell);
            if (boards.length >= limit || aborted) {
              covered[cell] = 0;
              covered[other] = 0;
              return;
            }
          }
        }
      }
      covered[cell] = 0;
      covered[other] = 0;
    }
  };

  dfs(0);
  return { boards, nodes, aborted };
}

/** Up to `limit` complete arrangements of the hand that satisfy every region rule. */
export function solve(puzzle: Puzzle, limit = 2): Board[] {
  return search(puzzle, { limit }).boards;
}

/** How many solutions exist, counted up to `limit`. */
export function countSolutions(puzzle: Puzzle, limit = 2): number {
  return search(puzzle, { limit }).boards.length;
}
