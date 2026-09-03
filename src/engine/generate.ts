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
  /** How many region carvings to try before settling for an ambiguous board. */
  carveAttempts: number;
  /** How many clues a carving may give up chasing a unique solution. */
  tightenAttempts: number;
  /** Chance a growing region follows a neighbour with the same pip value. */
  followEqual: number;
  /** Share of regions that stop at two cells. */
  pairShare: number;
  /** Chance each dealt tile is chosen to sit next to equal pips (see dealHand). */
  clusterBias: number;
  /** Free cells (no requirement) per board, min and max. They are never given a rule. */
  freeCells: [number, number];
  /** Whole builds tried per seed; the tightest wins. */
  rolls: number;
  /** A build with this many solutions or fewer is accepted without another roll. */
  targetSolutions: number;
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
    carveAttempts: 10,
    tightenAttempts: 5,
    followEqual: 0.5,
    pairShare: 0.6,
    clusterBias: 0.6,
    freeCells: [1, 2],
    rolls: 3,
    targetSolutions: 2,
    weights: { sum: 10, eq: 14, neq: 0, lt: 0, gt: 0, none: 2 },
  },
  medium: {
    minDominoes: 7,
    maxDominoes: 10,
    box: 6,
    minRegion: 2,
    maxRegion: 4,
    maxNone: 1,
    compact: false,
    carveAttempts: 5,
    tightenAttempts: 8,
    followEqual: 0.8,
    pairShare: 0.75,
    clusterBias: 0.85,
    freeCells: [1, 3],
    rolls: 3,
    targetSolutions: 3,
    weights: { sum: 10, eq: 14, neq: 0, lt: 2, gt: 2, none: 3 },
  },
  hard: {
    minDominoes: 9,
    maxDominoes: 12,
    box: 7,
    minRegion: 2,
    maxRegion: 3,
    maxNone: 1,
    compact: false,
    carveAttempts: 5,
    tightenAttempts: 12,
    followEqual: 0.9,
    pairShare: 0.7,
    clusterBias: 0.9,
    freeCells: [2, 4],
    rolls: 5,
    targetSolutions: 3,
    weights: { sum: 10, eq: 16, neq: 0, lt: 2, gt: 2, none: 3 },
  },
};

/** Node budget for the uniqueness checks the generator runs on itself. */
const TIGHTEN_NODE_BUDGET = 120_000;
/**
 * Solution counts are taken at rising caps so that clues can still be compared
 * on a very loose board; past the last cap a board is simply "loose".
 */
const LOOSENESS_CAPS = [12, 60];
/** Candidate clues scored per tightening step; the rest are left for the next step. */
const MOVES_PER_STEP = 24;
const SHAPE_ATTEMPTS = 20;
/** Hard stop on tightening; by then every region is a single revealed pip. */
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
    // Every empty adjacent pair touching the shape. Prefer pairs where BOTH
    // cells touch it: a cell whose only neighbour is its own partner is a dead
    // end, and a dead-end domino sits in one region where it flips for free.
    // Scanning right/down from each cell yields each unordered pair once.
    const snug: Array<[Cell, Cell]> = [];
    const loose: Array<[Cell, Cell]> = [];
    for (let r = 0; r < box; r++) {
      for (let c = 0; c < box; c++) {
        if (isFilled(r, c)) continue;
        for (let k = 2; k < 4; k++) {
          const nr = r + (DR[k] as number);
          const nc = c + (DC[k] as number);
          if (!inBox(nr, nc) || isFilled(nr, nc)) continue;
          const touch = (filledNeighbours(r, c) > 0 ? 1 : 0) + (filledNeighbours(nr, nc) > 0 ? 1 : 0);
          if (touch === 2) snug.push([{ r, c }, { r: nr, c: nc }]);
          else if (touch === 1) loose.push([{ r, c }, { r: nr, c: nc }]);
        }
      }
    }
    const candidates = snug.length > 0 ? snug : loose;
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
  /** "r,c" of the other half of each cell's domino in the solution. */
  partner: Map<string, string>;
}

/** Deal a hand from the double-six set onto the tiling to get a solved grid. */
function hasDeadEnd({ tiles, rows, cols }: { tiles: Array<[Cell, Cell]>; rows: number; cols: number }): boolean {
  const filled = new Set(tiles.flatMap(([a, b]) => [`${a.r},${a.c}`, `${b.r},${b.c}`]));
  const degree = (cell: Cell, other: Cell): number => {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const r = cell.r + (DR[k] as number);
      const c = cell.c + (DC[k] as number);
      if (r === other.r && c === other.c) continue;
      if (r >= 0 && c >= 0 && r < rows && c < cols && filled.has(`${r},${c}`)) n++;
    }
    return n;
  };
  return tiles.some(([a, b]) => degree(a, b) === 0 || degree(b, a) === 0);
}

/**
 * Deal a hand from the double-six set onto the tiling. Tiles are placed one at
 * a time, and with probability `preset.clusterBias` the tile and orientation
 * chosen is the one that puts the most equal pips next to each other across
 * domino boundaries. Equal neighbours are what make `eq` regions possible, and
 * an `eq` region is the strongest clue on the board — a random hand almost
 * never offers one.
 */
function dealHand(rng: Rng, tiles: Array<[Cell, Cell]>, rows: number, cols: number, preset: Preset): Shape {
  const pool = rng.shuffle(doubleSixSet());
  const cells: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const values: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(-1));
  const partner = new Map<string, string>();
  for (const [a, b] of tiles) {
    (cells[a.r] as boolean[])[a.c] = true;
    (cells[b.r] as boolean[])[b.c] = true;
    partner.set(`${a.r},${a.c}`, `${b.r},${b.c}`);
    partner.set(`${b.r},${b.c}`, `${a.r},${a.c}`);
  }
  const at = (r: number, c: number): number =>
    r >= 0 && c >= 0 && r < rows && c < cols ? ((values[r] as number[])[c] as number) : -1;
  const equalNeighbours = (cell: Cell, other: Cell, v: number): number => {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const r = cell.r + (DR[k] as number);
      const c = cell.c + (DC[k] as number);
      if ((r === other.r && c === other.c) || at(r, c) !== v) continue;
      n++;
    }
    return n;
  };

  const hand: Domino[] = new Array<Domino>(tiles.length);
  for (const i of rng.shuffle(tiles.map((_, i) => i))) {
    const [a, b] = tiles[i] as [Cell, Cell];
    let pick = { index: rng.int(pool.length), flip: rng.next() < 0.5 };
    if (rng.next() < preset.clusterBias) {
      let best = -1;
      const ties: Array<{ index: number; flip: boolean }> = [];
      pool.forEach((tile, index) => {
        for (const flip of [false, true]) {
          const va = flip ? tile[1] : tile[0];
          const vb = flip ? tile[0] : tile[1];
          const score = equalNeighbours(a, b, va) + equalNeighbours(b, a, vb);
          if (score > best) {
            best = score;
            ties.length = 0;
          }
          if (score === best) ties.push({ index, flip });
        }
      });
      pick = rng.pick(ties);
    }
    const tile = pool.splice(pick.index, 1)[0] as Domino;
    hand[i] = tile;
    (values[a.r] as number[])[a.c] = pick.flip ? tile[1] : tile[0];
    (values[b.r] as number[])[b.c] = pick.flip ? tile[0] : tile[1];
  }
  return { rows, cols, cells, values, dominoes: hand, partner };
}

/**
 * Partition the playable cells into connected regions, pairing cells across
 * domino boundaries first. A region never holds both halves of one domino
 * when it can be avoided: a tile inside a single sum region can be flipped for
 * free, and every such tile doubles the solution count. Cutting every domino
 * is what makes the board a puzzle rather than a lookup, and it also leaves no
 * lone cells behind — a single-cell region is a revealed pip.
 */
function carveRegions(rng: Rng, shape: Shape, preset: Preset): Cell[][] {
  const { rows, cols, cells } = shape;
  const key = (cell: Cell): string => `${cell.r},${cell.c}`;
  const playable: Cell[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) if ((cells[r] as boolean[])[c]) playable.push({ r, c });

  const owner = new Map<string, number>();
  const groups: Cell[][] = [];
  const valueAt = (cell: Cell): number => (shape.values[cell.r] as number[])[cell.c] as number;
  const partnerOf = (cell: Cell): string => shape.partner.get(key(cell)) as string;
  const holdsPartner = (group: Cell[], cell: Cell): boolean => group.some((g) => key(g) === partnerOf(cell));
  const neighbours = (cell: Cell): Cell[] => {
    const out: Cell[] = [];
    for (let k = 0; k < 4; k++) {
      const r = cell.r + (DR[k] as number);
      const c = cell.c + (DC[k] as number);
      if (r >= 0 && c >= 0 && r < rows && c < cols && (cells[r] as boolean[])[c] === true) out.push({ r, c });
    }
    return out;
  };
  // Regions that follow equal pips make the strong `eq` rule available, so
  // lean that way when the preset asks for it and such a neighbour exists.
  const choose = (pool: Cell[], value: number): Cell => {
    const alike = pool.filter((n) => valueAt(n) === value);
    const from = alike.length > 0 && rng.next() < preset.followEqual ? alike : pool;
    return from[rng.int(from.length)] as Cell;
  };

  // Reserve the free cells first: single-cell regions that will carry no
  // rule. Spread them out (never two adjacent) so they read as gaps in the
  // clues rather than a blank patch, and never on a cell whose partner is
  // also free — the tile between two free cells would be unconstrained.
  const [minFree, maxFree] = preset.freeCells;
  const wanted = minFree + rng.int(maxFree - minFree + 1);
  const freeKeys = new Set<string>();
  for (const cell of rng.shuffle([...playable])) {
    if (freeKeys.size >= wanted) break;
    if (neighbours(cell).some((n) => freeKeys.has(key(n)))) continue;
    if (freeKeys.has(partnerOf(cell))) continue;
    freeKeys.add(key(cell));
    owner.set(key(cell), groups.length);
    groups.push([cell]);
  }

  for (const seed of rng.shuffle(playable)) {
    if (owner.has(key(seed))) continue;
    const free = neighbours(seed).filter((n) => !owner.has(key(n)) && key(n) !== partnerOf(seed));

    if (free.length > 0) {
      const id = groups.length;
      const group = [seed, choose(free, valueAt(seed))];
      groups.push(group);
      for (const cell of group) owner.set(key(cell), id);
      // Two-cell regions carry the most constraint per clue; bigger ones add
      // variety. pairShare says how often a region stops at two.
      const size = rng.next() < preset.pairShare ? 2 : 3 + rng.int(preset.maxRegion - 2);
      while (group.length < size) {
        const seen = new Set<string>();
        const frontier = group
          .flatMap(neighbours)
          .filter((n) => !owner.has(key(n)) && !holdsPartner(group, n) && !seen.has(key(n)) && seen.add(key(n)));
        if (frontier.length === 0) break;
        const pick = choose(frontier, valueAt(seed));
        group.push(pick);
        owner.set(key(pick), id);
      }
      continue;
    }

    // Every free neighbour is gone: join the smallest adjacent region that does
    // not hold this cell's partner, or any adjacent region as a last resort.
    const adjacent = [...new Set(neighbours(seed).flatMap((n) => (owner.has(key(n)) ? [owner.get(key(n)) as number] : [])))].filter(
      (id) => !freeKeys.has(key((groups[id] as Cell[])[0] as Cell)) || (groups[id] as Cell[]).length > 1,
    );
    const bySize = (a: number, b: number): number => (groups[a] as Cell[]).length - (groups[b] as Cell[]).length;
    const safe = adjacent.filter((id) => !holdsPartner(groups[id] as Cell[], seed)).sort(bySize);
    const target = safe[0] ?? adjacent.sort(bySize)[0];
    if (target === undefined) {
      owner.set(key(seed), groups.length);
      groups.push([seed]);
      continue;
    }
    (groups[target] as Cell[]).push(seed);
    owner.set(key(seed), target);
  }
  return groups;
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
    // A lone cell is a free cell by construction (see carveRegions); a rule
    // on it would just reveal the pip.
    return { kind: 'none' };
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

/** Split a region into two connected parts of at least `MIN_PART` cells each. */
const MIN_PART = 2;

function splitCells(rng: Rng, cells: Cell[]): [Cell[], Cell[]] | null {
  if (cells.length < 2 * MIN_PART) return null;
  const key = (c: Cell): string => `${c.r},${c.c}`;
  const inRegion = new Map(cells.map((c) => [key(c), c]));

  for (let attempt = 0; attempt < 6; attempt++) {
    const size = MIN_PART + rng.int(cells.length - 2 * MIN_PART + 1);
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
    if (taken.size < MIN_PART || rest.length < MIN_PART) continue;
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
 * How many solutions a board has, counted up to the caps in LOOSENESS_CAPS.
 * A board past the last cap, or one the solver cannot finish, scores worst.
 */
function looseness(puzzle: Puzzle): number {
  const last = LOOSENESS_CAPS[LOOSENESS_CAPS.length - 1] as number;
  for (const limit of LOOSENESS_CAPS) {
    const result = search(puzzle, { limit, maxNodes: TIGHTEN_NODE_BUDGET });
    if (result.aborted) return last + 1;
    if (result.boards.length < limit) return result.boards.length;
  }
  return last + 1;
}

interface Move {
  apply(): void;
  undo(): void;
}

/**
 * Every clue-spending move available on a board. Each one keeps every region
 * at MIN_PART cells or more — a lone cell with a rule on it is a revealed pip,
 * and that is what turns a puzzle into a grid of answers.
 */
function moves(rng: Rng, puzzle: Puzzle, shape: Shape): Move[] {
  const out: Move[] = [];
  for (const region of puzzle.regions) {
    // A free cell stays free: it is a deliberate "no requirement" square, not
    // an unspent clue. (Pips has these; they are part of the look.)
    if (region.cells.length === 1) continue;
    const values = valuesOf(shape, region.cells);
    const sum = values.reduce((a, b) => a + b, 0);
    const before = region.rule;
    const alternatives: Rule[] = [];
    if (before.kind !== 'sum') alternatives.push({ kind: 'sum', n: sum });
    if (before.kind !== 'eq' && values.length > 1 && values.every((v) => v === values[0])) alternatives.push({ kind: 'eq' });
    for (const after of alternatives) {
      out.push({
        apply: () => {
          region.rule = after;
        },
        undo: () => {
          region.rule = before;
        },
      });
    }
    for (const shift of shiftMoves(puzzle, shape, region)) out.push(shift);
    const parts = region.cells.length >= 2 * MIN_PART ? splitCells(rng, region.cells) : null;
    if (parts) {
      const [a, b] = parts;
      const cells = region.cells;
      const added: Region = { id: puzzle.regions.length, rule: { kind: 'sum', n: valuesOf(shape, b).reduce((x, y) => x + y, 0) }, cells: b };
      out.push({
        apply: () => {
          region.cells = a;
          region.rule = { kind: 'sum', n: valuesOf(shape, a).reduce((x, y) => x + y, 0) };
          puzzle.regions.push(added);
        },
        undo: () => {
          region.cells = cells;
          region.rule = before;
          puzzle.regions.pop();
        },
      });
    }
  }
  return out;
}

/** A rule of the same kind for new values, if it still holds; otherwise the exact sum. */
function rekey(rule: Rule, values: number[]): Rule {
  const sum = values.reduce((a, b) => a + b, 0);
  switch (rule.kind) {
    case 'none':
      return rule;
    case 'eq':
      return values.every((v) => v === values[0]) ? rule : { kind: 'sum', n: sum };
    case 'neq':
      return new Set(values).size === values.length ? rule : { kind: 'sum', n: sum };
    case 'lt':
      return sum < rule.n ? rule : { kind: 'sum', n: sum };
    case 'gt':
      return sum > rule.n ? rule : { kind: 'sum', n: sum };
    case 'sum':
      return { kind: 'sum', n: sum };
  }
}

/**
 * Moves that hand one edge cell of `from` to a neighbouring region. Region
 * boundaries decide what a sum can see, so shifting one is often the most
 * informative clue on a loose board. `from` keeps at least MIN_PART cells and
 * stays connected; the receiving region may grow one past the size cap.
 */
function shiftMoves(puzzle: Puzzle, shape: Shape, from: Region): Move[] {
  if (from.cells.length <= MIN_PART) return [];
  const isFree = (r: Region): boolean => r.cells.length === 1 && r.rule.kind === 'none';
  const out: Move[] = [];
  const owner = new Map<string, Region>();
  for (const region of puzzle.regions) for (const cell of region.cells) owner.set(`${cell.r},${cell.c}`, region);
  const cap = PRESETS[puzzle.difficulty].maxRegion + 1;

  for (const cell of from.cells) {
    const rest = from.cells.filter((c) => c !== cell);
    if (!isConnected(rest)) continue;
    const seen = new Set<Region>();
    for (let k = 0; k < 4; k++) {
      const to = owner.get(`${cell.r + (DR[k] as number)},${cell.c + (DC[k] as number)}`);
      if (!to || to === from || seen.has(to) || to.cells.length >= cap || isFree(to)) continue;
      if (owner.get(shape.partner.get(`${cell.r},${cell.c}`) as string) === to) continue;
      seen.add(to);
      const fromBefore = { cells: from.cells, rule: from.rule };
      const toBefore = { cells: to.cells, rule: to.rule };
      out.push({
        apply: () => {
          from.cells = rest;
          from.rule = rekey(fromBefore.rule, valuesOf(shape, rest));
          to.cells = [...toBefore.cells, cell];
          to.rule = rekey(toBefore.rule, valuesOf(shape, to.cells));
        },
        undo: () => {
          from.cells = fromBefore.cells;
          from.rule = fromBefore.rule;
          to.cells = toBefore.cells;
          to.rule = toBefore.rule;
        },
      });
    }
  }
  return out;
}

/**
 * Spend up to `preset.tightenAttempts` clues on the move that shrinks the
 * solution count the most each time. Stops early at one solution, or when no
 * move helps. Returns the final looseness.
 */
function settle(rng: Rng, puzzle: Puzzle, shape: Shape, preset: Preset): number {
  let current = looseness(puzzle);
  for (let step = 0; step < preset.tightenAttempts && current > 1; step++) {
    let best: { move: Move; score: number } | null = null;
    for (const move of rng.shuffle(moves(rng, puzzle, shape)).slice(0, MOVES_PER_STEP)) {
      move.apply();
      const score = looseness(puzzle);
      move.undo();
      if (score < current && (!best || score < best.score)) best = { move, score };
      if (score === 1) break;
    }
    if (!best) break;
    best.move.apply();
    current = best.score;
  }
  return current;
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
 * the solved grid, give each region a rule that holds, then spend a small
 * clue budget on the most informative tightenings. The carving with the
 * fewest solutions wins. The hand is shuffled last so its order leaks nothing.
 */
export function generate(difficulty: Difficulty, seed: number = Date.now()): Puzzle {
  const preset = PRESETS[difficulty];
  let best: { puzzle: Puzzle; score: number } | null = null;
  for (let roll = 0; roll < preset.rolls; roll++) {
    const candidate = generateOnce(difficulty, seed, (seed + roll * 0x9e3779b1) | 0, preset);
    if (!best || candidate.score < best.score) best = candidate;
    if (best.score <= preset.targetSolutions) break;
  }
  return (best as { puzzle: Puzzle; score: number }).puzzle;
}

/** One full build from a derived seed; `seed` is what the puzzle reports. */
function generateOnce(
  difficulty: Difficulty,
  seed: number,
  derived: number,
  preset: Preset,
): { puzzle: Puzzle; score: number } {
  const rng = makeRng(derived);
  const span = preset.maxDominoes - preset.minDominoes + 1;

  // A cell whose only neighbour is its own partner forces that domino into a
  // single region, where it flips for free; grow again rather than keep one.
  let shaped = trim(growTiling(rng, preset, preset.minDominoes + rng.int(span)));
  for (let attempt = 1; attempt < SHAPE_ATTEMPTS && (shaped.tiles.length < preset.minDominoes || hasDeadEnd(shaped)); attempt++) {
    shaped = trim(growTiling(rng, preset, preset.minDominoes + rng.int(span)));
  }
  const { tiles, rows, cols } = shaped;

  let shape = dealHand(rng, tiles, rows, cols, preset);
  for (let deal = 1; deal < DEAL_ATTEMPTS && !hasUniqueTiling(shape, difficulty, seed); deal++) {
    shape = dealHand(rng, tiles, rows, cols, preset);
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

  let best: { puzzle: Puzzle; score: number } | null = null;
  for (let round = 0; round < preset.carveAttempts; round++) {
    const puzzle = carve();
    const score = settle(rng, puzzle, shape, preset);
    if (!best || score < best.score) best = { puzzle, score };
    if (score === 1) break;
  }
  const puzzle = (best as { puzzle: Puzzle; score: number }).puzzle;

  puzzle.regions.forEach((region, id) => {
    region.id = id;
  });
  return best as { puzzle: Puzzle; score: number };
}
