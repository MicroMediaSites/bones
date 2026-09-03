// Game state: the puzzle, the tiles on the board, and each tile's orientation.
// Mutated in place; the caller re-renders.

import { cellKey } from '../engine';
import type { Board, Cell, Placement, Puzzle } from '../engine';

/** 0 = horizontal, 1 = vertical, 2/3 = the same two with the pips swapped. */
export type Orientation = 0 | 1 | 2 | 3;

export interface Game {
  puzzle: Puzzle;
  board: Board;
  /** Indexed by tile id. Rotating changes this; placing reads it. */
  orientation: Orientation[];
  startedAt: number;
}

export function newGame(puzzle: Puzzle): Game {
  return {
    puzzle,
    board: [],
    orientation: puzzle.dominoes.map<Orientation>(() => 0),
    startedAt: Date.now(),
  };
}

export function isVertical(o: Orientation): boolean {
  return o === 1 || o === 3;
}

export function nextOrientation(o: Orientation): Orientation {
  return ((o + 1) % 4) as Orientation;
}

export function orientationOf(game: Game, tile: number): Orientation {
  return game.orientation[tile] ?? 0;
}

/** The cells a tile anchored at (r,c) covers, ordered so cells[0] holds pip 0. */
export function cellsFor(o: Orientation, r: number, c: number): [Cell, Cell] {
  const head: Cell = { r, c };
  const tail: Cell = isVertical(o) ? { r: r + 1, c } : { r, c: c + 1 };
  return o >= 2 ? [tail, head] : [head, tail];
}

/** Top-left cell of a placement — the anchor `cellsFor` takes. */
export function anchorOf(p: Placement): Cell {
  const [a, b] = p.cells;
  return a.r < b.r || a.c < b.c ? a : b;
}

export function placedOrientation(p: Placement): Orientation {
  const [a, b] = p.cells;
  const vertical = a.r !== b.r;
  const swapped = a.r > b.r || a.c > b.c;
  return ((vertical ? 1 : 0) + (swapped ? 2 : 0)) as Orientation;
}

/** cellKey -> the tile id covering it. */
function coverage(game: Game): Map<string, number> {
  const covered = new Map<string, number>();
  for (const p of game.board) {
    covered.set(cellKey(p.cells[0].r, p.cells[0].c), p.domino);
    covered.set(cellKey(p.cells[1].r, p.cells[1].c), p.domino);
  }
  return covered;
}

/** Tile ids not on the board, in hand order. */
export function handTiles(game: Game): number[] {
  const placed = new Set(game.board.map((p) => p.domino));
  return game.puzzle.dominoes.map((_, id) => id).filter((id) => !placed.has(id));
}

/** Both cells playable and free — `tile`'s own placement doesn't block it. */
export function canPlace(game: Game, cells: [Cell, Cell], tile: number): boolean {
  const covered = coverage(game);
  return cells.every((cell) => {
    if (game.puzzle.cells[cell.r]?.[cell.c] !== true) return false;
    const owner = covered.get(cellKey(cell.r, cell.c));
    return owner === undefined || owner === tile;
  });
}

export function place(game: Game, tile: number, cells: [Cell, Cell]): void {
  unplace(game, tile);
  game.board.push({ domino: tile, cells });
}

export function unplace(game: Game, tile: number): void {
  game.board = game.board.filter((p) => p.domino !== tile);
}
