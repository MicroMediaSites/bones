// Screens, routing and pointer-drag. Owns the single mutable Game.

import { generate, validate } from '../engine';
import type { Cell, Difficulty, Placement, Puzzle } from '../engine';
import { devPuzzle } from './devFixtures';
import { tileEl } from './pips';
import { createRatePanel, toast, type RatePanel } from './ratePanel';
import { loadRatings, ratingId, saveRating, type Rating, type Verdict } from './ratings';
import { buildRatingsScreen } from './ratingsPage';
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

/** An open rating panel. Non-null means the game screen is in rating mode. */
interface RateSession {
  verdict: Verdict | null;
  flagged: Set<number>;
  panel: RatePanel;
}

/** A board tap taken while rating, resolved on pointerup if it wasn't a drag. */
interface RegionTap {
  pointerId: number;
  region: number;
  x: number;
  y: number;
}

let root: HTMLElement;
let game: Game | null = null;
let boardEl: HTMLElement | null = null;
let timerEl: HTMLElement | null = null;
let timerId: ReturnType<typeof setInterval> | null = null;
let drag: Drag | null = null;
/** rAF handle for the pending ghost/snap paint, so pointermove never lays out. */
let dragFrame: number | null = null;
let rate: RateSession | null = null;
let regionTap: RegionTap | null = null;

const NO_FLAGS: ReadonlySet<number> = new Set<number>();

function flaggedRegions(): ReadonlySet<number> {
  return rate ? rate.flagged : NO_FLAGS;
}

export function mount(el: HTMLElement): void {
  root = el;
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  // A cancel is not a drop and not a tap — it needs its own handler.
  root.addEventListener('pointercancel', onPointerCancel);
  // touch-action in CSS stops the board scrolling, but iOS still synthesises
  // double-tap zoom and the long-press callout from the raw touch stream, and
  // it can retract a gesture as a scroll (which arrives as a pointercancel).
  // Non-passive so preventDefault is honoured; scoped to the play surface so
  // the home and ratings screens keep scrolling normally.
  root.addEventListener('touchstart', onTouchStart, { passive: false });
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  // Android Chrome opens a selection menu on long-press; a long press on a
  // tile is a player thinking, not a request for a menu.
  root.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('hashchange', route);
  route();
}

/** True for the fixed play surface — the board, a tile, or the hand tray. */
function isPlaySurface(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-tile], .board, .tray') !== null;
}

function onTouchStart(e: TouchEvent): void {
  if (isPlaySurface(e.target)) e.preventDefault();
}

function onTouchMove(e: TouchEvent): void {
  if (drag || regionTap) e.preventDefault();
}

function onContextMenu(e: Event): void {
  if (isPlaySurface(e.target)) e.preventDefault();
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
    deal(difficulty, n);
    return;
  }
  if (location.hash === '#dev') {
    if (game?.puzzle !== devPuzzle) openGame(devPuzzle);
    return;
  }
  if (location.hash === '#ratings') {
    leaveGame();
    renderRatings();
    return;
  }
  leaveGame();
  renderHome();
}

/** Drop everything the game screen owns, so another screen starts clean. */
function leaveGame(): void {
  stopTimer();
  // A drag left in flight (back button pressed mid-drag, say) would leave a
  // ghost pinned to the screen and — because onPointerDown bails while `drag`
  // is set — kill dragging for the rest of the session. The board it belonged
  // to is going away, so there is nothing to put the tile back onto.
  if (drag) endDrag(drag.pointerId);
  game = null;
  rate = null;
  regionTap = null;
}

function setHash(hash: string): void {
  // replaceState so the hash tracks the puzzle without piling up history and
  // without re-entering the hashchange handler.
  history.replaceState(null, '', hash || location.pathname + location.search);
}

function startPuzzle(difficulty: Difficulty): void {
  const seed = freshSeed();
  setHash(`#${difficulty}-${seed}`);
  deal(difficulty, seed);
}

/**
 * Show a dealing screen, then build the puzzle once that has painted. Hard
 * boards take a second or more to settle, and a button that freezes reads as
 * broken. Two frames guarantee the splash is on screen before the work starts.
 */
function deal(difficulty: Difficulty, seed: number): void {
  leaveGame();
  const splash = document.createElement('div');
  splash.className = 'dealing';
  splash.textContent = `Dealing ${difficulty}…`;
  root.replaceChildren(splash);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      // The hash is the source of truth; if it moved on, so has the player.
      if (location.hash !== `#${difficulty}-${seed}`) return;
      openGame(generate(difficulty, seed));
    }),
  );
}

function openGame(puzzle: Puzzle): void {
  // Same teardown a screen change does: the previous board's drag, rating and
  // timer must not survive into the new one (#dev reaches here without deal()).
  leaveGame();
  game = newGame(puzzle);
  startTimer();
  renderGame();
}

function exitGame(): void {
  leaveGame();
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

  const ratingsLink = document.createElement('a');
  ratingsLink.className = 'ratings-link';
  ratingsLink.href = '#ratings';
  ratingsLink.textContent = 'Ratings';

  screen.append(title, tagline, picker, legend, ratingsLink);
  boardEl = null;
  timerEl = null;
  root.replaceChildren(screen);
}

function renderRatings(): void {
  boardEl = null;
  timerEl = null;
  root.replaceChildren(buildRatingsScreen(renderRatings));
}

function renderGame(): void {
  if (!game) return;
  const status = validate(game.puzzle, game.board);
  if (status.solved) stopTimer();

  const screen = document.createElement('div');
  screen.className = rate ? 'screen game rating' : 'screen game';
  // The hand wraps at four tiles a row and never scrolls: a tile the player
  // cannot see is a puzzle the player cannot solve. Reserve the full-hand
  // height for the whole game so the board doesn't jump as tiles leave.
  screen.style.setProperty('--tray-rows', String(Math.ceil(game.puzzle.dominoes.length / 4)));

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
  const rateBtn = button(rate ? 'Rating…' : 'Rate', 'btn btn-rate', openRatePanel);
  rateBtn.disabled = rate !== null;
  topline.append(mark, chip, timerEl, rateBtn);

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
  boardEl = renderBoard(game, status, null, flaggedRegions());
  wrap.appendChild(boardEl);

  const trayZone = document.createElement('div');
  trayZone.className = 'trayzone';
  trayZone.appendChild(status.solved ? solvedPanel(game) : renderTray(game));

  screen.append(bar, wrap);
  // The panel element outlives a re-render on purpose: rebuilding it would
  // throw away whatever is half-typed in the note field.
  if (rate) screen.append(rate.panel.el);
  screen.append(trayZone);
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
  const next = renderBoard(game, validate(game.puzzle, game.board), preview, flaggedRegions());
  boardEl.replaceWith(next);
  boardEl = next;
}

// ---------------------------------------------------------------- rating

function openRatePanel(): void {
  if (!game || rate) return;
  const previous = loadRatings().find((r) => r.id === ratingId(game!.puzzle));
  const panel = createRatePanel(
    {
      verdict: previous?.verdict ?? null,
      note: previous?.note ?? '',
      flagged: previous?.regions.length ?? 0,
    },
    { onVerdict: pickVerdict, onSave: saveCurrentRating, onCancel: closeRatePanel },
  );
  rate = {
    verdict: previous?.verdict ?? null,
    flagged: new Set(previous?.regions ?? []),
    panel,
  };
  renderGame();
}

function closeRatePanel(): void {
  rate = null;
  regionTap = null;
  renderGame();
}

function pickVerdict(verdict: Verdict): void {
  if (!rate) return;
  rate.verdict = verdict;
  rate.panel.setVerdict(verdict);
}

function toggleFlag(regionId: number): void {
  if (!rate) return;
  if (!rate.flagged.delete(regionId)) rate.flagged.add(regionId);
  rate.panel.setFlagCount(rate.flagged.size);
  refreshBoard();
}

function saveCurrentRating(): void {
  if (!game || !rate) return;
  if (!rate.verdict) {
    toast('Pick Good or Bad');
    return;
  }
  const record: Rating = {
    id: ratingId(game.puzzle),
    at: new Date().toISOString(),
    verdict: rate.verdict,
    note: rate.panel.note(),
    regions: [...rate.flagged].sort((a, b) => a - b),
    solved: validate(game.puzzle, game.board).solved,
    puzzle: game.puzzle,
  };
  const stored = saveRating(record);
  rate = null;
  regionTap = null;
  renderGame();
  toast(stored ? 'Saved' : 'Could not save');
}

/**
 * The id of the region under a viewport point, or null if not on the board.
 * Cells are uniform and the grid has no gap, so a plain divide locates one —
 * the same arithmetic `snapTarget` uses.
 */
function regionAtPoint(g: Game, x: number, y: number): number | null {
  const rect = boardRect();
  if (!rect || !overBoard(x, y)) return null;
  const c = Math.floor((x - rect.left) / (rect.width / g.puzzle.cols));
  const r = Math.floor((y - rect.top) / (rect.height / g.puzzle.rows));
  for (const region of g.puzzle.regions) {
    if (region.cells.some((cell) => cell.r === r && cell.c === c)) return region.id;
  }
  return null;
}

// ---------------------------------------------------------------- dragging

function onPointerDown(e: PointerEvent): void {
  // One gesture at a time: a second finger landing mid-drag would otherwise
  // start a rival drag (or a rival region tap) and strand the first tile.
  if (!game || drag || !e.isPrimary) return;

  // While rating, a tap anywhere on the board flags that cell's region. It is
  // only resolved on pointerup, so dragging a placed tile still works.
  if (rate && !regionTap) {
    const region = regionAtPoint(game, e.clientX, e.clientY);
    if (region !== null) {
      regionTap = { pointerId: e.pointerId, region, x: e.clientX, y: e.clientY };
      root.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }

  const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tile]') : null;
  if (!target) return;
  const tile = Number(target.dataset.tile);
  if (!Number.isInteger(tile)) return;

  e.preventDefault();
  // Capture on the root, not the tile: every render replaces the tile's DOM
  // node, and capture dies with the element it was taken on. The root outlives
  // every re-render, so the drag survives the board and tray being rebuilt.
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
  // A mouse or pen move with no button held is hover, or a stray event after
  // the press already ended; either way it is not the player dragging. Touch is
  // exempt: there is no hover, and a browser that under-reports `buttons` for
  // touch would otherwise make the game undraggable on that device.
  if (e.buttons === 0 && e.pointerType !== 'touch') return;

  drag.x = e.clientX;
  drag.y = e.clientY;

  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < TAP_SLOP_PX) return;
    drag.moved = true;
    if (drag.origin) {
      unplace(game, drag.tile);
      refreshBoard();
    }
    drag.ghost = makeGhost(game, drag.tile, drag.x, drag.y);
    document.body.appendChild(drag.ghost);
  }

  // Phones coalesce pointermove far faster than they can paint. Doing the work
  // in a frame keeps the ghost on the finger instead of a queue behind it, and
  // keeps getBoundingClientRect out of the event handler.
  if (dragFrame === null) dragFrame = requestAnimationFrame(paintDrag);
}

/** One frame of the drag: move the ghost, then re-snap if the target changed. */
function paintDrag(): void {
  dragFrame = null;
  if (!drag || !game) return;
  if (drag.ghost) drag.ghost.style.transform = ghostTransform(drag.x, drag.y);
  const target = snapTarget(game, drag);
  if (cellsKey(target) !== cellsKey(drag.target)) {
    drag.target = target;
    refreshBoard();
  }
}

/**
 * Tear the drag down without deciding where the tile goes: drop the ghost,
 * cancel the pending frame, and hand back the drag so the caller can settle it.
 */
function endDrag(pointerId: number): Drag | null {
  const d = drag;
  drag = null;
  if (dragFrame !== null) {
    cancelAnimationFrame(dragFrame);
    dragFrame = null;
  }
  d?.ghost?.remove();
  if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId);
  return d;
}

/**
 * Safari fires pointercancel the moment it reinterprets a gesture as a scroll,
 * a system edge swipe or an app switch. That is neither a drop nor a tap: the
 * tile goes back where it came from and the drag state clears, so the next
 * touch starts fresh.
 */
function onPointerCancel(e: PointerEvent): void {
  if (regionTap && e.pointerId === regionTap.pointerId) regionTap = null;
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = endDrag(e.pointerId);
  // Only a moved drag changed anything: it unplaced the tile and drew a
  // preview. A tile with no origin came from the hand and is already back in it.
  if (!d?.moved || !game) return;
  if (d.origin) place(game, d.tile, d.origin.cells);
  renderGame();
}

function onPointerUp(e: PointerEvent): void {
  if (regionTap && e.pointerId === regionTap.pointerId) {
    const tap = regionTap;
    regionTap = null;
    const moved =
      drag?.moved === true || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) >= TAP_SLOP_PX;
    if (!moved) {
      // A tap, not a drag: flag the region rather than rotating the tile.
      endDrag(e.pointerId);
      toggleFlag(tap.region);
      return;
    }
  }

  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = endDrag(e.pointerId);
  if (!d || !game) return;

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

/** Centre the ghost on the finger. Composited, so it never triggers layout. */
function ghostTransform(x: number, y: number): string {
  return `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
}

function makeGhost(g: Game, tile: number, x: number, y: number): HTMLElement {
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
  // Placed before it is appended, so the ghost never flashes at the origin.
  el.style.transform = ghostTransform(x, y);
  return el;
}
