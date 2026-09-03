import type { Cell } from './types';
import { weightedIndex, type Rng } from './rng';

/**
 * Board shapes. The generator needs a set of playable cells together with a
 * perfect domino tiling of it — the tiling is the puzzle's solution by
 * construction. Growing one domino at a time (the `blob` family) only ever
 * makes rounded lumps, so every board looked alike. The families here draw a
 * shape first (rings with a hole in the middle, punched blobs, staircases,
 * lobes, crosses, notched rectangles) and tile it afterwards.
 *
 * Every shape handed back satisfies the board invariants: connected, even cell
 * count inside the preset's range, inside the preset's box, and no cell with
 * fewer than two playable neighbours (a cell whose only neighbour is its own
 * domino partner pins that tile inside one region, where it flips for free).
 */

export type ShapeFamily = 'blob' | 'ring' | 'punched' | 'staircase' | 'lobes' | 'cross' | 'notched';

/** What the shape builder needs from a difficulty preset. */
export interface ShapeSpec {
  /** Shapes are built inside a `box` x `box` grid. */
  box: number;
  minDominoes: number;
  maxDominoes: number;
  /** Blob growth hugs the existing shape, keeping easy boards near-rectangular. */
  compact: boolean;
  /** Relative weight of each family. A zero weight never gets drawn. */
  shapeWeights: Record<ShapeFamily, number>;
}

const FAMILIES: ShapeFamily[] = ['blob', 'ring', 'punched', 'staircase', 'lobes', 'cross', 'notched'];

/** Family draws before giving up and falling back to a blob. */
const FAMILY_ATTEMPTS = 6;
/** Tries inside the families that build by rejection rather than enumeration. */
const DRAW_ATTEMPTS = 12;

const DR = [-1, 0, 0, 1];
const DC = [0, -1, 1, 0];

// Cells live in a `box` x `box` grid packed into one integer. STRIDE must be
// larger than any preset box, so that a negative column can never alias a
// real cell on the row above.
const STRIDE = 16;
const key = (r: number, c: number): number => r * STRIDE + c;
const rowOf = (k: number): number => Math.floor(k / STRIDE);
const colOf = (k: number): number => k % STRIDE;

function cellsOf(set: Set<number>): Cell[] {
  return [...set].map((k) => ({ r: rowOf(k), c: colOf(k) }));
}

function degreeIn(set: Set<number>, k: number): number {
  let n = 0;
  const r = rowOf(k);
  const c = colOf(k);
  for (let i = 0; i < 4; i++) if (set.has(key(r + (DR[i] as number), c + (DC[i] as number)))) n++;
  return n;
}

/** Grid colour, 0 or 1. Every domino covers one cell of each. */
function colourOf(k: number): number {
  return (rowOf(k) + colOf(k)) % 2;
}

function adjacent(a: number, b: number): boolean {
  return Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b)) === 1;
}

function isConnected(set: Set<number>): boolean {
  const first = set.values().next().value;
  if (first === undefined) return false;
  const seen = new Set<number>([first]);
  const stack = [first];
  while (stack.length > 0) {
    const k = stack.pop() as number;
    const r = rowOf(k);
    const c = colOf(k);
    for (let i = 0; i < 4; i++) {
      const next = key(r + (DR[i] as number), c + (DC[i] as number));
      if (!set.has(next) || seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen.size === set.size;
}

/**
 * A maximum matching of the grid graph over `cells`, as domino pairs. The grid
 * is bipartite by cell colour, so Kuhn's augmenting-path algorithm is exact;
 * shuffling both the scan order and each cell's neighbours makes the same
 * shape tile differently on different seeds.
 */
function maxMatching(cells: Cell[], rng: Rng): Array<[Cell, Cell]> {
  const index = new Map<number, number>();
  cells.forEach((cell, i) => index.set(key(cell.r, cell.c), i));
  const adjacency = cells.map((cell) => {
    const out: number[] = [];
    for (let i = 0; i < 4; i++) {
      const found = index.get(key(cell.r + (DR[i] as number), cell.c + (DC[i] as number)));
      if (found !== undefined) out.push(found);
    }
    return rng.shuffle(out);
  });

  const match = new Int32Array(cells.length).fill(-1);
  const seen = new Uint8Array(cells.length);
  const augment = (i: number): boolean => {
    for (const j of adjacency[i] as number[]) {
      if (seen[j] === 1) continue;
      seen[j] = 1;
      const held = match[j] as number;
      if (held === -1 || augment(held)) {
        match[j] = i;
        match[i] = j;
        return true;
      }
    }
    return false;
  };

  const dark = cells.flatMap((cell, i) => ((cell.r + cell.c) % 2 === 0 ? [i] : []));
  for (const i of rng.shuffle(dark)) {
    seen.fill(0);
    augment(i);
  }

  const tiles: Array<[Cell, Cell]> = [];
  for (const i of dark) {
    const j = match[i] as number;
    if (j !== -1) tiles.push([cells[i] as Cell, cells[j] as Cell]);
  }
  return tiles;
}

/** A perfect tiling of `cells`, or null when the shape has no perfect matching. */
export function tileShape(cells: Cell[], rng: Rng): Array<[Cell, Cell]> | null {
  const tiles = maxMatching(cells, rng);
  return tiles.length * 2 === cells.length ? tiles : null;
}

/**
 * Grow a blob one domino at a time inside `win`, preferring placements where
 * both new cells already touch the shape: a cell whose only neighbour is its
 * own partner is a dead end. `compact` hugs the shape hardest, which keeps
 * easy boards near-rectangular. Growing in pairs keeps the cell count even and
 * guarantees the blob can be tiled.
 */
function growBlob(rng: Rng, win: Window, target: number, compact: boolean): Set<number> {
  const inWin = (r: number, c: number): boolean => r >= win.r0 && c >= win.c0 && r <= win.r1 && c <= win.c1;

  const set = new Set<number>();
  const r0 = win.r0 + rng.int(win.r1 - win.r0);
  const c0 = win.c0 + rng.int(win.c1 - win.c0);
  set.add(key(r0, c0));
  set.add(rng.next() < 0.5 ? key(r0, c0 + 1) : key(r0 + 1, c0));

  while (set.size < target) {
    // Each unordered empty pair is seen once by scanning right and down only.
    const snug: number[][] = [];
    const loose: number[][] = [];
    for (let r = win.r0; r <= win.r1; r++) {
      for (let c = win.c0; c <= win.c1; c++) {
        if (set.has(key(r, c))) continue;
        for (const [dr, dc] of [
          [0, 1],
          [1, 0],
        ] as const) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inWin(nr, nc) || set.has(key(nr, nc))) continue;
          const a = degreeIn(set, key(r, c));
          const b = degreeIn(set, key(nr, nc));
          const touching = (a > 0 ? 1 : 0) + (b > 0 ? 1 : 0);
          if (touching === 2) snug.push([key(r, c), key(nr, nc), a + b]);
          else if (touching === 1) loose.push([key(r, c), key(nr, nc), a + b]);
        }
      }
    }
    const candidates = snug.length > 0 ? snug : loose;
    if (candidates.length === 0) break;

    let chosen = rng.pick(candidates);
    if (compact) {
      const best = Math.max(...candidates.map((pair) => pair[2] as number));
      chosen = rng.pick(candidates.filter((pair) => pair[2] === best));
    }
    set.add(chosen[0] as number);
    set.add(chosen[1] as number);
  }
  return set;
}

interface Window {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** The shape budget a difficulty allows: box size, cell count, blob style. */
interface Limits {
  box: number;
  min: number;
  max: number;
  compact: boolean;
}

/** A random even cell count inside the preset's range. */
function evenTarget(rng: Rng, limits: Limits): number {
  return limits.min + 2 * rng.int((limits.max - limits.min) / 2 + 1);
}

function rectCells(r0: number, c0: number, h: number, w: number): Set<number> {
  const set = new Set<number>();
  for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) set.add(key(r, c));
  return set;
}

/** Pick uniformly from a stream of options without collecting them. */
function reservoir<T>(rng: Rng): { offer(option: T): void; chosen: T | null } {
  let seen = 0;
  const state = {
    chosen: null as T | null,
    offer(option: T): void {
      seen++;
      if (rng.int(seen) === 0) state.chosen = option;
    },
  };
  return state;
}

/** A rectangle with a rectangular hole punched out of its middle. */
function buildRing(rng: Rng, limits: Limits): Set<number> | null {
  const pick = reservoir<{ h: number; w: number; hr: number; hc: number; hh: number; hw: number }>(rng);
  for (let h = 3; h <= limits.box; h++) {
    for (let w = 3; w <= limits.box; w++) {
      for (let hh = 1; hh <= h - 2; hh++) {
        for (let hw = 1; hw <= w - 2; hw++) {
          const count = h * w - hh * hw;
          if (count % 2 !== 0 || count < limits.min || count > limits.max) continue;
          for (let hr = 1; hr <= h - 1 - hh; hr++)
            for (let hc = 1; hc <= w - 1 - hw; hc++) pick.offer({ h, w, hr, hc, hh, hw });
        }
      }
    }
  }
  if (!pick.chosen) return null;
  const { h, w, hr, hc, hh, hw } = pick.chosen;
  const set = rectCells(0, 0, h, w);
  for (const k of rectCells(hr, hc, hh, hw)) set.delete(k);
  return set;
}

/**
 * A vertical bar and a horizontal bar, each 2 or 3 cells thick. Centred bars
 * give a plus; offset ones give T, L and cross-with-uneven-arms shapes.
 */
function buildCross(rng: Rng, limits: Limits): Set<number> | null {
  const pick = reservoir<{ h: number; w: number; t: number; barCol: number; barRow: number }>(rng);
  for (let h = 3; h <= limits.box; h++) {
    for (let w = 3; w <= limits.box; w++) {
      for (let t = 2; t <= 3; t++) {
        // Bars as tall/wide as the box would just be a rectangle.
        if (h <= t || w <= t) continue;
        const count = t * h + t * w - t * t;
        if (count % 2 !== 0 || count < limits.min || count > limits.max) continue;
        for (let barCol = 0; barCol <= w - t; barCol++)
          for (let barRow = 0; barRow <= h - t; barRow++) pick.offer({ h, w, t, barCol, barRow });
      }
    }
  }
  if (!pick.chosen) return null;
  const { h, w, t, barCol, barRow } = pick.chosen;
  const set = rectCells(0, barCol, h, t);
  for (const k of rectCells(barRow, 0, t, w)) set.add(k);
  return set;
}

const BITES: Array<[number, number]> = [
  [2, 2],
  [2, 1],
  [1, 2],
  [1, 1],
];

/** A rectangle with a bite taken out of one or more corners. */
function buildNotched(rng: Rng, limits: Limits): Set<number> | null {
  for (let attempt = 0; attempt < DRAW_ATTEMPTS; attempt++) {
    const h = 3 + rng.int(limits.box - 2);
    const w = 3 + rng.int(limits.box - 2);
    let owed = h * w - evenTarget(rng, limits);
    if (owed < 1 || owed > 8) continue;

    const set = rectCells(0, 0, h, w);
    for (const corner of rng.shuffle([0, 1, 2, 3])) {
      const bite = rng.shuffle([...BITES]).find(([bh, bw]) => bh * bw <= owed && bh < h - 1 && bw < w - 1);
      if (!bite) continue;
      const [bh, bw] = bite;
      const r0 = corner < 2 ? 0 : h - bh;
      const c0 = corner % 2 === 0 ? 0 : w - bw;
      for (const k of rectCells(r0, c0, bh, bw)) set.delete(k);
      owed -= bh * bw;
      if (owed === 0) break;
    }
    if (owed === 0) return set;
  }
  return null;
}

/** A diagonal run of 2x2 blocks, folding back when it reaches the box edge. */
function buildStaircase(rng: Rng, limits: Limits): Set<number> | null {
  for (let attempt = 0; attempt < DRAW_ATTEMPTS; attempt++) {
    const target = evenTarget(rng, limits);
    let dir = rng.next() < 0.5 ? 1 : -1;
    let r = 0;
    let c = dir > 0 ? 0 : limits.box - 2;
    const set = rectCells(r, c, 2, 2);

    while (set.size + 3 <= target && r + 2 < limits.box) {
      const step = 1 + rng.int(2);
      let nc = c + dir * step;
      if (nc < 0 || nc + 2 > limits.box) {
        dir = -dir;
        nc = c + dir * step;
      }
      if (nc < 0 || nc + 2 > limits.box) break;
      r += 1;
      c = nc;
      for (const k of rectCells(r, c, 2, 2)) set.add(k);
    }

    // Steps of one column overlap by a cell, so the run can land on an odd
    // count. An inner corner of the staircase evens it up without making a
    // dead end, taken in the colour the shape is short of so that it can
    // still be tiled.
    if (set.size % 2 === 1) {
      const balance = [...set].reduce((n, k) => n + (colourOf(k) === 0 ? 1 : -1), 0);
      const fill = [...set]
        .flatMap((k) => [0, 1, 2, 3].map((i) => key(rowOf(k) + (DR[i] as number), colOf(k) + (DC[i] as number))))
        .filter((k) => !set.has(k) && rowOf(k) >= 0 && colOf(k) >= 0 && rowOf(k) < limits.box && colOf(k) < limits.box)
        .filter((k) => colourOf(k) === (balance > 0 ? 1 : 0) && degreeIn(set, k) >= 2);
      if (fill.length === 0) continue;
      set.add(rng.pick(fill));
    }
    if (set.size >= limits.min && set.size <= limits.max) return set;
  }
  return null;
}

/** Two blobs side by side, joined by a bridge two cells tall. */
function buildLobes(rng: Rng, limits: Limits): Set<number> | null {
  if (limits.box < 5) return null;
  for (let attempt = 0; attempt < DRAW_ATTEMPTS; attempt++) {
    const target = evenTarget(rng, limits);
    const gap = 1 + rng.int(2);
    const leftWidth = 2 + rng.int(limits.box - gap - 3);
    const rightStart = leftWidth + gap;
    if (limits.box - rightStart < 2) continue;

    const span = { r0: 0, r1: limits.box - 1 };
    const bridge = 2 * gap;
    const leftSize = 2 * Math.max(1, Math.round((target - bridge) / 4));
    const left = growBlob(rng, { ...span, c0: 0, c1: leftWidth - 1 }, leftSize, true);
    const right = growBlob(rng, { ...span, c0: rightStart, c1: limits.box - 1 }, target - bridge - left.size, true);

    // The bridge needs two rows where both lobes reach the gap.
    const pick = reservoir<number>(rng);
    for (let r = 0; r + 1 < limits.box; r++) {
      const touchesLeft = left.has(key(r, leftWidth - 1)) || left.has(key(r + 1, leftWidth - 1));
      const touchesRight = right.has(key(r, rightStart)) || right.has(key(r + 1, rightStart));
      if (touchesLeft && touchesRight) pick.offer(r);
    }
    if (pick.chosen === null) continue;

    const set = new Set([...left, ...right]);
    for (const k of rectCells(pick.chosen, leftWidth, 2, gap)) set.add(k);
    if (set.size >= limits.min && set.size <= limits.max) return set;
  }
  return null;
}

/**
 * A grown blob with one or two holes knocked out of its middle. Punches come
 * in colour-balanced pairs: the grid is bipartite, so removing two cells of
 * the same colour would leave a shape with no perfect tiling.
 */
function buildPunched(rng: Rng, limits: Limits): Set<number> | null {
  const win = { r0: 0, c0: 0, r1: limits.box - 1, c1: limits.box - 1 };

  for (let attempt = 0; attempt < DRAW_ATTEMPTS; attempt++) {
    const punches = 1 + rng.int(2);
    const target = evenTarget(rng, limits);
    const set = growBlob(rng, win, target + 2 * punches, true);
    if (set.size !== target + 2 * punches) continue;

    for (let i = 0; i < punches; i++) {
      // Interior means every neighbour is playable, so what is left behind is
      // a real hole rather than a bite out of the edge. Recomputed per punch,
      // so the second punch cannot eat the edge of the first one's hole.
      const inside = [...set].filter((k) => degreeIn(set, k) === 4);
      if (inside.length === 0) break;
      const a = rng.pick(inside);
      // A neighbouring second cell makes one two-cell hole; otherwise the two
      // pinpricks sit apart, and either way the colours balance out.
      const beside = inside.filter((k) => k !== a && adjacent(k, a));
      const apart = inside.filter((k) => k !== a && !adjacent(k, a) && colourOf(k) !== colourOf(a));
      const from = beside.length > 0 && (apart.length === 0 || rng.next() < 0.5) ? beside : apart;
      if (from.length === 0) break;
      set.delete(a);
      set.delete(rng.pick(from));
    }
    if (set.size === target) return set;
  }
  return null;
}

function buildFamily(rng: Rng, family: ShapeFamily, limits: Limits): Set<number> | null {
  switch (family) {
    case 'blob':
      return buildBlob(rng, limits);
    case 'ring':
      return buildRing(rng, limits);
    case 'punched':
      return buildPunched(rng, limits);
    case 'staircase':
      return buildStaircase(rng, limits);
    case 'lobes':
      return buildLobes(rng, limits);
    case 'cross':
      return buildCross(rng, limits);
    case 'notched':
      return buildNotched(rng, limits);
  }
}

function buildBlob(rng: Rng, limits: Limits): Set<number> {
  const win = { r0: 0, c0: 0, r1: limits.box - 1, c1: limits.box - 1 };
  return growBlob(rng, win, evenTarget(rng, limits), limits.compact);
}

/**
 * Tile a candidate shape and check the board invariants. A shape with no
 * perfect matching is repaired by dropping the cells the maximum matching
 * could not cover — the rest of that matching is already a perfect tiling of
 * what is left — and re-checked.
 */
function finish(candidate: Set<number>, limits: Limits, rng: Rng): Array<[Cell, Cell]> | null {
  const tiles = maxMatching(cellsOf(candidate), rng);
  const set = new Set(tiles.flatMap(([a, b]) => [key(a.r, a.c), key(b.r, b.c)]));
  if (set.size < limits.min || set.size > limits.max) return null;
  if (!isConnected(set)) return null;
  if ([...set].some((k) => degreeIn(set, k) < 2)) return null;
  return tiles;
}

/**
 * Draw a shape family for this seed and return its cells as a domino tiling.
 * Families that cannot meet the preset's cell count fall through to another
 * draw, and finally to a blob, which always can.
 */
export function buildShape(rng: Rng, spec: ShapeSpec): Array<[Cell, Cell]> {
  const limits: Limits = {
    box: spec.box,
    min: spec.minDominoes * 2,
    max: spec.maxDominoes * 2,
    compact: spec.compact,
  };
  const families = FAMILIES.filter((f) => spec.shapeWeights[f] > 0);
  const weights = families.map((f) => spec.shapeWeights[f]);

  for (let attempt = 0; attempt < FAMILY_ATTEMPTS; attempt++) {
    const family = families[weightedIndex(rng, weights)] as ShapeFamily;
    const set = buildFamily(rng, family, limits);
    if (!set) continue;
    const tiles = finish(set, limits, rng);
    if (tiles) return tiles;
  }

  // A blob is grown from dominoes, so it always tiles; the caller re-rolls the
  // rare one that still trips the dead-end check.
  const blob = buildBlob(rng, limits);
  return finish(blob, limits, rng) ?? maxMatching(cellsOf(blob), rng);
}
