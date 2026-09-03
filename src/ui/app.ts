// Screens, routing and pointer-drag. Owns the single mutable Game.

import { generate, validate } from '../engine';
import type { Cell, Difficulty, Placement, Puzzle } from '../engine';
import { devPuzzle } from './devFixtures';
import { tileEl } from './pips';
import { renderBoard, renderTray } from './render';
import {
  anchorOf,
  canPlace,
  cellsFor,
  isVertical,
  newGame,
  nextOrientation,
  orientationOf,
  place,
  placedOrientation,
  unplace,
  type Game,
  type Orientation,
} from './state';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const HASH_ROUTE = /^#(easy|medium|hard)-(\d+)$/;
/** Drag threshold: below this a pointerup is a tap, which rotates. */
const TAP_SLOP_PX = 8;

interface Drag {
  pointerId: number;
  tile: number;
  /** Where the tile sat before the drag, if it was picked up off the board. */
  origin: Placement | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  ghost: HTMLElement | null;
  target: [Cell, Cell] | null;
}

let root: HTMLElement;
let game: Game | null = null;
let boardEl: HTMLElement | null = null;
let timerEl: HTMLElement | null = null;
let timerId: ReturnType<typeof setInterval> | null = null;
let drag: Drag | null = null;

export function mount(el: HTMLElement): void {
  root = el;
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('hashchange', route);
  route();
}

// ---------------------------------------------------------------- routing

/** A 7-digit seed derived from the clock — short enough to share in a URL. */
function freshSeed(): number {
  return Date.now() % 10_000_000;
}

function route(): void {
  const match = HASH_ROUTE.exec(location.hash);
  const difficulty = match?.[1] as Difficulty | undefined;
  const seed = match?.[2];
  if (difficulty && seed !== undefined) {
    const n = Number(seed);
    if (game && game.puzzle.difficulty === difficulty && game.puzzle.seed === n) return;
    openGame(generate(difficulty, n));
    return;
  }
  if (location.hash === '#dev') {
    if (game?.puzzle !== devPuzzle) openGame(devPuzzle);
    return;
  }
  stopTimer();
  game = null;
  renderHome();
}

function setHash(hash: string): void {
  // replaceState so the hash tracks the puzzle without piling up history and
  // without re-entering the hashchange handler.
  history.replaceState(null, '', hash || location.pathname + location.search);
}

function startPuzzle(difficulty: Difficulty): void {
  const seed = freshSeed();
  setHash(`#${difficulty}-${seed}`);
  openGame(generate(difficulty, seed));
}

function openGame(puzzle: Puzzle): void {
  game = newGame(puzzle);
  startTimer();
  renderGame();
}

function exitGame(): void {
  stopTimer();
  game = null;
  setHash('');
  renderHome();
}

// ---------------------------------------------------------------- timer

function startTimer(): void {
  stopTimer();
  timerId = setInterval(tickTimer, 1000);
}

function stopTimer(): void {
  if (timerId !== null) clearInterval(timerId);
  timerId = null;
}

function tickTimer(): void {
  if (!game || !timerEl) return;
  timerEl.textContent = elapsed(game);
}

function elapsed(g: Game): string {
  const total = Math.floor((Date.now() - g.startedAt) / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- screens

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

function renderHome(): void {
  const screen = document.createElement('div');
  screen.className = 'screen home';

  const title = document.createElement('h1');
  title.className = 'wordmark';
  title.textContent = 'Bones';

  const tagline = document.createElement('p');
  tagline.className = 'tagline';
  tagline.textContent =
    'Lay every domino from your hand so that each shaded region obeys the rule written on it.';

  const picker = document.createElement('div');
  picker.className = 'difficulties';
  for (const difficulty of DIFFICULTIES) {
    const label = difficulty[0]?.toUpperCase() + difficulty.slice(1);
    picker.appendChild(button(label, 'btn btn-lg', () => startPuzzle(difficulty)));
  }

  const legend = document.createElement('div');
  legend.className = 'legend';
  const entries: [string, string][] = [
    ['7', 'pips add up to exactly 7'],
    ['<5', 'pips add up to less than 5'],
    ['>9', 'pips add up to more than 9'],
    ['=', 'every pip the same'],
    ['≠', 'every pip different'],
  ];
  for (const [glyph, meaning] of entries) {
    const key = document.createElement('b');
    key.textContent = glyph;
    const value = document.createElement('span');
    value.textContent = meaning;
    legend.append(key, value);
  }

  screen.append(title, tagline, picker, legend);
  boardEl = null;
  timerEl = null;
  root.replaceChildren(screen);
}

function renderGame(): void {
  if (!game) return;
  const status = validate(game.puzzle, game.board);
  if (status.solved) stopTimer();

  const screen = document.createElement('div');
  screen.className = 'screen game';

  const topline = document.createElement('div');
  topline.className = 'topline';
  const mark = document.createElement('span');
  mark.className = 'wordmark';
  mark.textContent = 'Bones';
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = game.puzzle.difficulty;
  timerEl = document.createElement('span');
  timerEl.className = 'timer';
  timerEl.textContent = elapsed(game);
  topline.append(mark, chip, timerEl);

  const controls = document.createElement('div');
  controls.className = 'controls';
  controls.append(
    button('New puzzle', 'btn', newPuzzle),
    button('Reset', 'btn', resetBoard),
    button('Exit', 'btn', exitGame),
  );

  const bar = document.createElement('header');
  bar.className = 'topbar';
  bar.append(topline, controls);

  const wrap = document.createElement('div');
  wrap.className = 'boardwrap';
  boardEl = renderBoard(game, status, null);
  wrap.appendChild(boardEl);

  const trayZone = document.createElement('div');
  trayZone.className = 'trayzone';
  trayZone.appendChild(status.solved ? solvedPanel(game) : renderTray(game));

  screen.append(bar, wrap, trayZone);
  root.replaceChildren(screen);
}

function solvedPanel(g: Game): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'solved';
  panel.setAttribute('role', 'status');

  const heading = document.createElement('h2');
  heading.textContent = 'Solved';
  const time = document.createElement('span');
  time.className = 'solved-time';
  time.textContent = `in ${elapsed(g)}`;

  panel.append(heading, time, button('New puzzle', 'btn', newPuzzle), button('Exit', 'btn', exitGame));
  return panel;
}

function newPuzzle(): void {
  if (!game) return;
  startPuzzle(game.puzzle.difficulty);
}

function resetBoard(): void {
  if (!game) return;
  game.board = [];
  renderGame();
}

/** Swap in a freshly rendered board without rebuilding the tray mid-drag. */
function refreshBoard(): void {
  if (!game || !boardEl) return;
  const preview: Placement | null =
    drag?.target ? { domino: drag.tile, cells: drag.target } : null;
  const next = renderBoard(game, validate(game.puzzle, game.board), preview);
  boardEl.replaceWith(next);
  boardEl = next;
}

// ---------------------------------------------------------------- dragging

function onPointerDown(e: PointerEvent): void {
  if (!game || drag) return;
  const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tile]') : null;
  if (!target) return;
  const tile = Number(target.dataset.tile);
  if (!Number.isInteger(tile)) return;

  e.preventDefault();
  root.setPointerCapture(e.pointerId);
  const origin = game.board.find((p) => p.domino === tile) ?? null;
  // A tile on the board is the truth about its own orientation.
  if (origin) game.orientation[tile] = placedOrientation(origin);
  drag = {
    pointerId: e.pointerId,
    tile,
    origin,
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    moved: false,
    ghost: null,
    target: null,
  };
}

function onPointerMove(e: PointerEvent): void {
  if (!drag || !game || e.pointerId !== drag.pointerId) return;
  drag.x = e.clientX;
  drag.y = e.clientY;

  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < TAP_SLOP_PX) return;
    drag.moved = true;
    if (drag.origin) {
      unplace(game, drag.tile);
      refreshBoard();
    }
    drag.ghost = makeGhost(game, drag.tile);
    document.body.appendChild(drag.ghost);
  }

  if (drag.ghost) {
    drag.ghost.style.left = `${drag.x}px`;
    drag.ghost.style.top = `${drag.y}px`;
  }

  const target = snapTarget(game, drag);
  if (cellsKey(target) !== cellsKey(drag.target)) {
    drag.target = target;
    refreshBoard();
  }
}

function onPointerUp(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  d.ghost?.remove();
  if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
  if (!game) return;

  if (!d.moved) {
    rotateTile(game, d.tile);
    return;
  }

  d.x = e.clientX;
  d.y = e.clientY;
  const target = snapTarget(game, d);
  if (target) place(game, d.tile, target);
  else if (d.origin && overBoard(d.x, d.y)) place(game, d.tile, d.origin.cells);
  // Otherwise the tile is left in hand: dropped on the tray, or off the board.
  renderGame();
}

function cellsKey(cells: [Cell, Cell] | null): string {
  return cells ? `${cells[0].r},${cells[0].c}:${cells[1].r},${cells[1].c}` : '-';
}

function boardRect(): DOMRect | null {
  return boardEl ? boardEl.getBoundingClientRect() : null;
}

function overBoard(x: number, y: number): boolean {
  const rect = boardRect();
  return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** The nearest legal cell pair under the pointer, or null. */
function snapTarget(g: Game, d: Drag): [Cell, Cell] | null {
  const rect = boardRect();
  if (!rect || !overBoard(d.x, d.y)) return null;
  const c = Math.floor((d.x - rect.left) / (rect.width / g.puzzle.cols));
  const r = Math.floor((d.y - rect.top) / (rect.height / g.puzzle.rows));
  const orientation = orientationOf(g, d.tile);
  // The pointer may be over either half of the tile, so try both anchors.
  const anchors: Cell[] = isVertical(orientation)
    ? [{ r, c }, { r: r - 1, c }]
    : [{ r, c }, { r, c: c - 1 }];
  for (const anchor of anchors) {
    const cells = cellsFor(orientation, anchor.r, anchor.c);
    if (canPlace(g, cells, d.tile)) return cells;
  }
  return null;
}

/** Tap without dragging: rotate. A placed tile skips orientations that don't fit. */
function rotateTile(g: Game, tile: number): void {
  const current = g.board.find((p) => p.domino === tile);
  if (!current) {
    g.orientation[tile] = nextOrientation(orientationOf(g, tile));
    renderGame();
    return;
  }
  const anchor = anchorOf(current);
  let orientation: Orientation = placedOrientation(current);
  for (let i = 0; i < 4; i++) {
    orientation = nextOrientation(orientation);
    const cells = cellsFor(orientation, anchor.r, anchor.c);
    if (canPlace(g, cells, tile)) {
      g.orientation[tile] = orientation;
      place(g, tile, cells);
      renderGame();
      return;
    }
  }
}

function makeGhost(g: Game, tile: number): HTMLElement {
  const pips = g.puzzle.dominoes[tile];
  const orientation = orientationOf(g, tile);
  const vertical = isVertical(orientation);
  const swapped = orientation >= 2;
  const first = (swapped ? pips?.[1] : pips?.[0]) ?? 0;
  const second = (swapped ? pips?.[0] : pips?.[1]) ?? 0;

  const el = tileEl(first, second, vertical);
  el.classList.add('ghost');
  const rect = boardRect();
  const cell = rect ? rect.width / g.puzzle.cols : 44;
  el.style.width = `${vertical ? cell : cell * 2}px`;
  el.style.height = `${vertical ? cell * 2 : cell}px`;
  return el;
}
