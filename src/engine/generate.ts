import type { Cell, Difficulty, Domino, Puzzle, Region, Rule } from './types';
import { makeRng, weightedIndex, type Rng } from './rng';
import { search } from './solve';

type RuleKind = Rule['kind'];

export interface Preset {
  minDominoes: number;
  maxDominoes: number;
  /** The tiling grows inside a box of this many rows and columns. */
  box: number;
  /** Target region size range. Leftover cells can still form a smaller region. */
  minRegion: number;
  maxRegion: number;
  /** How many `none` regions the board may carry. */
  maxNone: number;
  /** Easy grows compactly (near-rectangular); the rest grow irregular arms. */
  compact: boolean;
  /** Allow lone cells to stand as their own region (a revealed pip). */
  singletonClues: boolean;
  /** How many region carvings to try before settling for an ambiguous board. */
  carveAttempts: number;
  /** How many clues a carving may give up chasing a unique solution. */
  tightenAttempts: number;
  /** Relative weight of each rule kind, used only where the kind is legal. */
  weights: Record<RuleKind, number>;
}

export const PRESETS: Record<Difficulty, Preset> = {
  easy: {
    minDominoes: 4,
    maxDominoes: 6,
    box: 5,
    minRegion: 2,
    maxRegion: 3,
    maxNone: 1,
    compact: true,
    singletonClues: true,
    carveAttempts: 10,
    tightenAttempts: 3,
    weights: { sum: 10, eq: 14, neq: 0, lt: 0, gt: 0, none: 3 },
  },
  medium: {
    minDominoes: 7,
    maxDominoes: 10,
    box: 6,
    minRegion: 2,
    maxRegion: 4,
    maxNone: 2,
    compact: false,
    singletonClues: false,
    carveAttempts: 4,
    tightenAttempts: 4,
    weights: { sum: 10, eq: 7, neq: 7, lt: 5, gt: 5, none: 5 },
  },
  hard: {
    minDominoes: 11,
    maxDominoes: 16,
    box: 7,
    minRegion: 2,
    maxRegion: 5,
    maxNone: 4,
    compact: false,
    singletonClues: false,
    carveAttempts: 2,
    tightenAttempts: 4,
    weights: { sum: 5, eq: 6, neq: 7, lt: 6, gt: 6, none: 7 },
  },
};

/** Node budget for the uniqueness checks the generator runs on itself. */
const TIGHTEN_NODE_BUDGET = 120_000;
const SHAPE_ATTEMPTS = 20;
/** Hard stop on tightening; by then every region is a single revealed pip. */
const MAX_TIGHTEN = 40;
const DEAL_ATTEMPTS = 14;

/** The 28 tiles of a double-six set, [a, b] with a <= b. */
function doubleSixSet(): Domino[] {
  const tiles: Domino[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) tiles.push([a, b]);
  return tiles;
}

const DR = [-1, 0, 0, 1];
const DC = [0, -1, 1, 0];

/**
 * Grow a random domino tiling inside a `box` x `box` grid. The tiling is both
 * the board shape and a guaranteed solution, so the puzzle is solvable by
 * construction. Returns pairs of [r, c] cell coordinates, one pair per tile.
 */
function growTiling(rng: Rng, preset: Preset, target: number): Array<[Cell, Cell]> {
  const { box } = preset;
  const filled: boolean[] = new Array(box * box).fill(false);
  const inBox = (r: number, c: number): boolean => r >= 0 && c >= 0 && r < box && c < box;
  const isFilled = (r: number, c: number): boolean => inBox(r, c) && filled[r * box + c] === true;

  const tiles: Array<[Cell, Cell]> = [];
  const place = (a: Cell, b: Cell): void => {
    filled[a.r * box + a.c] = true;
    filled[b.r * box + b.c] = true;
    tiles.push([a, b]);
  };

  const mid = Math.floor(box / 2);
  const startR = mid - rng.int(2);
  const startC = mid - rng.int(2);
  const horizontal = rng.next() < 0.5;
  place(
    { r: startR, c: startC },
    horizontal ? { r: startR, c: startC + 1 } : { r: startR + 1, c: startC },
  );

  const filledNeighbours = (r: number, c: number): number => {
    let count = 0;
    for (let k = 0; k < 4; k++) if (isFilled(r + (DR[k] as number), c + (DC[k] as number))) count++;
    return count;
  };

  while (tiles.length < target) {
    // Every empty adjacent pair with at least one cell touching the shape.
    // Scanning right/down from each cell yields each unordered pair once.
    const candidates: Array<[Cell, Cell]> = [];
    for (let r = 0; r < box; r++) {
      for (let c = 0; c < box; c++) {
        if (isFilled(r, c)) continue;
        for (let k = 2; k < 4; k++) {
          const nr = r + (DR[k] as number);
          const nc = c + (DC[k] as number);
          if (!inBox(nr, nc) || isFilled(nr, nc)) continue;
          if (filledNeighbours(r, c) === 0 && filledNeighbours(nr, nc) === 0) continue;
          candidates.push([{ r, c }, { r: nr, c: nc }]);
        }
      }
    }
    if (candidates.length === 0) break;

    let chosen: [Cell, Cell];
    if (preset.compact) {
      // Hug the existing shape so easy boards stay near-rectangular.
      let best = -1;
      let bestOnes: Array<[Cell, Cell]> = [];
      for (const pair of candidates) {
        const score = filledNeighbours(pair[0].r, pair[0].c) + filledNeighbours(pair[1].r, pair[1].c);
        if (score > best) {
          best = score;
          bestOnes = [pair];
        } else if (score === best) {
          bestOnes.push(pair);
        }
      }
      chosen = rng.pick(bestOnes);
    } else {
      chosen = rng.pick(candidates);
    }
    place(chosen[0], chosen[1]);
  }

  return tiles;
}

/** Shift a tiling so its bounding box starts at (0, 0), and report its size. */
function trim(tiles: Array<[Cell, Cell]>): { tiles: Array<[Cell, Cell]>; rows: number; cols: number } {
  let minR = Infinity;
  let minC = Infinity;
  let maxR = -Infinity;
  let maxC = -Infinity;
  for (const pair of tiles) {
    for (const cell of pair) {
      minR = Math.min(minR, cell.r);
      minC = Math.min(minC, cell.c);
      maxR = Math.max(maxR, cell.r);
      maxC = Math.max(maxC, cell.c);
    }
  }
  const shifted = tiles.map(
    (pair): [Cell, Cell] => [
      { r: pair[0].r - minR, c: pair[0].c - minC },
      { r: pair[1].r - minR, c: pair[1].c - minC },
    ],
  );
  return { tiles: shifted, rows: maxR - minR + 1, cols: maxC - minC + 1 };
}

interface Shape {
  rows: number;
  cols: number;
  cells: boolean[][];
  /** Solved pip value per playable cell, -1 elsewhere. */
  values: number[][];
  dominoes: Domino[];
}

/** Deal a hand from the double-six set onto the tiling to get a solved grid. */
function dealHand(rng: Rng, tiles: Array<[Cell, Cell]>, rows: number, cols: number): Shape {
  const hand = rng.shuffle(doubleSixSet()).slice(0, tiles.length);
  const cells: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const values: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(-1));
  tiles.forEach((pair, i) => {
    const tile = hand[i] as Domino;
    const flip = rng.next() < 0.5;
    const [a, b] = pair;
    (cells[a.r] as boolean[])[a.c] = true;
    (cells[b.r] as boolean[])[b.c] = true;
    (values[a.r] as number[])[a.c] = flip ? tile[1] : tile[0];
    (values[b.r] as number[])[b.c] = flip ? tile[0] : tile[1];
  });
  return { rows, cols, cells, values, dominoes: hand };
}

/**
 * Partition the playable cells into random connected regions. Regions cross
 * domino boundaries freely — that crossing is what makes the board a puzzle
 * rather than a lookup.
 */
function carveRegions(rng: Rng, shape: Shape, preset: Preset): Cell[][] {
  const { rows, cols, cells } = shape;
  const playable: Cell[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) if ((cells[r] as boolean[])[c]) playable.push({ r, c });

  const owner = new Map<string, number>();
  const groups: Cell[][] = [];
  const key = (r: number, c: number): string => `${r},${c}`;
  const free = (r: number, c: number): boolean =>
    r >= 0 && c >= 0 && r < rows && c < cols && (cells[r] as boolean[])[c] === true && !owner.has(key(r, c));

  const order = rng.shuffle([...playable]);
  for (const seed of order) {
    if (owner.has(key(seed.r, seed.c))) continue;
    const size = preset.minRegion + rng.int(preset.maxRegion - preset.minRegion + 1);
    const group: Cell[] = [];
    const frontier: Cell[] = [seed];
    while (group.length < size && frontier.length > 0) {
      const pick = frontier.splice(rng.int(frontier.length), 1)[0] as Cell;
      if (owner.has(key(pick.r, pick.c))) continue;
      owner.set(key(pick.r, pick.c), groups.length);
      group.push(pick);
      for (let k = 0; k < 4; k++) {
        const nr = pick.r + (DR[k] as number);
        const nc = pick.c + (DC[k] as number);
        if (free(nr, nc)) frontier.push({ r: nr, c: nc });
      }
    }
    groups.push(group);
  }

  if (!preset.singletonClues) mergeSingletons(rng, groups, owner, preset);
  return groups.filter((g) => g.length > 0);
}

/** Fold lone cells into a neighbouring region so single-cell clues stay rare. */
function mergeSingletons(rng: Rng, groups: Cell[][], owner: Map<string, number>, preset: Preset): void {
  const key = (r: number, c: number): string => `${r},${c}`;
  for (const index of rng.shuffle(groups.map((_, i) => i))) {
    const group = groups[index] as Cell[];
    if (group.length !== 1) continue;
    const cell = group[0] as Cell;
    for (const k of rng.shuffle([0, 1, 2, 3])) {
      const target = owner.get(key(cell.r + (DR[k] as number), cell.c + (DC[k] as number)));
      if (target === undefined || target === index) continue;
      const into = groups[target] as Cell[];
      if (into.length >= preset.maxRegion) continue;
      into.push(cell);
      owner.set(key(cell.r, cell.c), target);
      groups[index] = [];
      break;
    }
  }
}

/** Pick a rule that holds for `values`, weighted by the preset. */
function chooseRule(rng: Rng, values: number[], preset: Preset, noneBudget: number): Rule {
  const sum = values.reduce((a, b) => a + b, 0);
  const w = preset.weights;
  const options: Rule[] = [];
  const weights: number[] = [];
  const offer = (rule: Rule, weight: number): void => {
    if (weight <= 0) return;
    options.push(rule);
    weights.push(weight);
  };

  if (values.length === 1) {
    // A single-cell `sum` just reveals the pip: a fine starter clue on easy,
    // but it should stay rare once the board gets bigger.
    offer({ kind: 'sum', n: sum }, preset.singletonClues ? w.sum : 2);
    offer({ kind: 'none' }, noneBudget > 0 ? w.none : 0);
  } else {
    offer({ kind: 'sum', n: sum }, w.sum);
    if (values.every((v) => v === values[0])) offer({ kind: 'eq' }, w.eq);
    if (new Set(values).size === values.length) offer({ kind: 'neq' }, w.neq);
    offer({ kind: 'lt', n: sum + 1 + rng.int(4) }, w.lt);
    if (sum >= 1) offer({ kind: 'gt', n: sum - (1 + rng.int(Math.min(4, sum))) }, w.gt);
    offer({ kind: 'none' }, noneBudget > 0 ? w.none : 0);
  }

  return options[weightedIndex(rng, weights)] as Rule;
}

function valuesOf(shape: Shape, cells: Cell[]): number[] {
  return cells.map((cell) => (shape.values[cell.r] as number[])[cell.c] as number);
}

/** Split a region's cells into two connected halves, or null if it won't split. */
function splitCells(rng: Rng, cells: Cell[]): [Cell[], Cell[]] | null {
  if (cells.length < 2) return null;
  const key = (c: Cell): string => `${c.r},${c.c}`;
  const inRegion = new Map(cells.map((c) => [key(c), c]));

  for (let attempt = 0; attempt < 6; attempt++) {
    const size = 1 + rng.int(cells.length - 1);
    const taken = new Map<string, Cell>();
    const frontier: Cell[] = [rng.pick(cells)];
    while (taken.size < size && frontier.length > 0) {
      const pick = frontier.splice(rng.int(frontier.length), 1)[0] as Cell;
      if (taken.has(key(pick))) continue;
      taken.set(key(pick), pick);
      for (let k = 0; k < 4; k++) {
        const next = inRegion.get(`${pick.r + (DR[k] as number)},${pick.c + (DC[k] as number)}`);
        if (next && !taken.has(key(next))) frontier.push(next);
      }
    }
    const rest = cells.filter((c) => !taken.has(key(c)));
    if (taken.size === 0 || rest.length === 0) continue;
    if (!isConnected(rest)) continue;
    return [[...taken.values()], rest];
  }
  return null;
}

function isConnected(cells: Cell[]): boolean {
  const key = (c: Cell): string => `${c.r},${c.c}`;
  const remaining = new Map(cells.map((c) => [key(c), c]));
  const stack: Cell[] = [cells[0] as Cell];
  remaining.delete(key(cells[0] as Cell));
  let count = 1;
  while (stack.length > 0) {
    const cell = stack.pop() as Cell;
    for (let k = 0; k < 4; k++) {
      const found = remaining.get(`${cell.r + (DR[k] as number)},${cell.c + (DC[k] as number)}`);
      if (!found) continue;
      remaining.delete(key(found));
      stack.push(found);
      count++;
    }
  }
  return count === cells.length;
}

/**
 * Nudge a puzzle toward a single solution by one step, cheapest first: pin a
 * free region, then a loose bound, then cut a region in two. Every rule is
 * read off the known solved grid, so the tiling stays a solution however
 * often we tighten. Returns false when nothing is left to tighten — by then
 * every region is a single cell with its pip spelled out.
 */
function tighten(rng: Rng, regions: Region[], shape: Shape): boolean {
  const exactSum = (cells: Cell[]): Rule => ({
    kind: 'sum',
    n: valuesOf(shape, cells).reduce((a, b) => a + b, 0),
  });

  for (const kinds of [['none'], ['lt', 'gt']] as RuleKind[][]) {
    const candidates = regions.filter((r) => kinds.includes(r.rule.kind));
    if (candidates.length === 0) continue;
    const region = rng.pick(candidates);
    region.rule = exactSum(region.cells);
    return true;
  }

  // Cut the biggest regions first — they carry the most ambiguity.
  for (const minSize of [3, 2]) {
    for (const region of rng.shuffle(regions.filter((r) => r.cells.length >= minSize))) {
      const parts = splitCells(rng, region.cells);
      if (!parts) continue;
      region.cells = parts[0];
      region.rule = exactSum(parts[0]);
      regions.push({ id: regions.length, rule: exactSum(parts[1]), cells: parts[1] });
      return true;
    }
  }
  return false;
}

/**
 * True when the shape has exactly one tiling that uses this hand, given every
 * pip value. No rule set can make the puzzle unique unless this holds, so a
 * hand that fails it is re-dealt before any region work happens.
 */
function hasUniqueTiling(shape: Shape, difficulty: Difficulty, seed: number): boolean {
  const regions: Region[] = [];
  for (let r = 0; r < shape.rows; r++) {
    for (let c = 0; c < shape.cols; c++) {
      if (!(shape.cells[r] as boolean[])[c]) continue;
      regions.push({
        id: regions.length,
        rule: { kind: 'sum', n: (shape.values[r] as number[])[c] as number },
        cells: [{ r, c }],
      });
    }
  }
  const pinned: Puzzle = { ...shape, regions, difficulty, seed };
  const result = search(pinned, { limit: 2, maxNodes: TIGHTEN_NODE_BUDGET });
  return !result.aborted && result.boards.length === 1;
}

/**
 * Build a puzzle: grow a random domino tiling (shape + guaranteed solution),
 * deal a hand from the double-six set onto it, carve connected regions over
 * the solved grid, give each region a rule that holds, then tighten toward a
 * unique solution. The hand is shuffled last so its order leaks nothing.
 */
export function generate(difficulty: Difficulty, seed: number = Date.now()): Puzzle {
  const preset = PRESETS[difficulty];
  const rng = makeRng(seed);
  const span = preset.maxDominoes - preset.minDominoes + 1;

  let grown = growTiling(rng, preset, preset.minDominoes + rng.int(span));
  for (let attempt = 1; attempt < SHAPE_ATTEMPTS && grown.length < preset.minDominoes; attempt++) {
    grown = growTiling(rng, preset, preset.minDominoes + rng.int(span));
  }
  const { tiles, rows, cols } = trim(grown);

  let shape = dealHand(rng, tiles, rows, cols);
  for (let deal = 1; deal < DEAL_ATTEMPTS && !hasUniqueTiling(shape, difficulty, seed); deal++) {
    shape = dealHand(rng, tiles, rows, cols);
  }

  const carve = (): Puzzle => {
    let noneBudget = preset.maxNone;
    return {
      rows,
      cols,
      cells: shape.cells,
      regions: carveRegions(rng, shape, preset).map((cells, id) => {
        const rule = chooseRule(rng, valuesOf(shape, cells), preset, noneBudget);
        if (rule.kind === 'none') noneBudget--;
        return { id, rule, cells };
      }),
      dominoes: rng.shuffle([...shape.dominoes]),
      difficulty,
      seed,
    };
  };

  // Prefer a carving that is unique on its own merits. Tightening always gets
  // there eventually, but every tightening step spends a clue, so we re-carve
  // a few times before spending many of them.
  let puzzle = carve();
  for (let round = 0; round < preset.carveAttempts; round++) {
    if (round > 0) puzzle = carve();
    if (settle(rng, puzzle, shape, preset)) break;
  }

  puzzle.regions.forEach((region, id) => {
    region.id = id;
  });
  return puzzle;
}

/**
 * Tighten a carving in place until it has one solution, or until the clue
 * budget runs out. An ambiguous puzzle is still winnable — the game checks
 * rules, not one blessed arrangement — but a puzzle the solver can't finish
 * inside its node budget is a bad board, so those keep tightening past the
 * budget. Returns whether the puzzle ended up with a unique solution.
 */
function settle(rng: Rng, puzzle: Puzzle, shape: Shape, preset: Preset): boolean {
  for (let step = 0; step < MAX_TIGHTEN; step++) {
    const result = search(puzzle, { limit: 2, maxNodes: TIGHTEN_NODE_BUDGET });
    if (!result.aborted && result.boards.length === 1) return true;
    if (step >= preset.tightenAttempts && !result.aborted) return false;
    if (!tighten(rng, puzzle.regions, shape)) return false;
  }
  return false;
}
