// DOM builders for the board and the tray. Pure: no event wiring here.

import { cellKey, ruleLabel } from '../engine';
import type { Placement, Puzzle, Region, Validation } from '../engine';
import { tileEl } from './pips';
import {
  anchorOf,
  handTiles,
  isVertical,
  orientationOf,
  placedOrientation,
  type Game,
} from './state';

/** Muted tabletop palette: region wash + the line drawn around its perimeter. */
const REGION_SKINS = [
  { fill: 'rgba(163,133,66,0.20)', edge: 'rgba(198,166,94,0.70)' }, // ochre
  { fill: 'rgba(94,124,148,0.20)', edge: 'rgba(132,166,192,0.66)' }, // slate
  { fill: 'rgba(158,88,62,0.20)', edge: 'rgba(196,120,90,0.66)' }, // rust
  { fill: 'rgba(94,130,88,0.20)', edge: 'rgba(128,172,120,0.66)' }, // moss
  { fill: 'rgba(126,102,130,0.20)', edge: 'rgba(166,138,170,0.62)' }, // plum
  { fill: 'rgba(150,136,104,0.18)', edge: 'rgba(186,172,136,0.62)' }, // sand
] as const;

const SIDES = [
  ['top', -1, 0],
  ['right', 0, 1],
  ['bottom', 1, 0],
  ['left', 0, -1],
] as const;

export function renderBoard(
  game: Game,
  status: Validation,
  preview: Placement | null,
  /** Region ids the rater has flagged; every cell of each gets a marker. */
  flagged: ReadonlySet<number> = new Set(),
): HTMLElement {
  const { puzzle } = game;
  const grid = document.createElement('div');
  grid.className = 'board';
  grid.style.setProperty('--rows', String(puzzle.rows));
  grid.style.setProperty('--cols', String(puzzle.cols));

  const regionAt = new Map<string, Region>();
  const skinOf = new Map<number, number>();
  const tagAt = new Map<string, string>();
  puzzle.regions.forEach((region, i) => {
    skinOf.set(region.id, i % REGION_SKINS.length);
    for (const cell of region.cells) regionAt.set(cellKey(cell.r, cell.c), region);
    const label = ruleLabel(region.rule);
    let corner = region.cells[0];
    if (!label || !corner) return;
    for (const cell of region.cells) {
      if (cell.r < corner.r || (cell.r === corner.r && cell.c < corner.c)) corner = cell;
    }
    tagAt.set(cellKey(corner.r, corner.c), label);
  });

  for (let r = 0; r < puzzle.rows; r++) {
    for (let c = 0; c < puzzle.cols; c++) {
      if (puzzle.cells[r]?.[c] !== true) continue;
      const region = regionAt.get(cellKey(r, c));
      const skin = REGION_SKINS[region ? (skinOf.get(region.id) ?? 0) : 0] ?? REGION_SKINS[0];

      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.style.gridArea = `${r + 1} / ${c + 1}`;
      cell.style.background = skin.fill;
      for (const [side, dr, dc] of SIDES) {
        const neighbour = regionAt.get(cellKey(r + dr, c + dc));
        const perimeter = !region || !neighbour || neighbour.id !== region.id;
        cell.style.setProperty(
          `border-${side}`,
          perimeter ? `2px solid ${skin.edge}` : '1px solid rgba(255,255,255,0.05)',
        );
      }
      if (region) {
        const state = status.regions[region.id];
        if (state === 'ok' || state === 'bad') cell.classList.add(state);
        if (flagged.has(region.id)) cell.classList.add('flagged');
      }
      const label = tagAt.get(cellKey(r, c));
      if (label !== undefined) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = label;
        cell.appendChild(tag);
      }
      grid.appendChild(cell);
    }
  }

  for (const placement of game.board) grid.appendChild(placementEl(puzzle, placement, true));
  if (preview) grid.appendChild(placementEl(puzzle, preview, false));
  return grid;
}

/** A tile laid across the two cells of `placement`, as a grid item. */
function placementEl(puzzle: Puzzle, placement: Placement, interactive: boolean): HTMLElement {
  const [pipA, pipB] = puzzle.dominoes[placement.domino] ?? [0, 0];
  const anchor = anchorOf(placement);
  const vertical = isVertical(placedOrientation(placement));
  const anchorHoldsFirst =
    placement.cells[0].r === anchor.r && placement.cells[0].c === anchor.c;

  const el = tileEl(anchorHoldsFirst ? pipA : pipB, anchorHoldsFirst ? pipB : pipA, vertical);
  el.classList.add(interactive ? 'placed' : 'preview');
  if (interactive) el.dataset.tile = String(placement.domino);
  el.style.gridRow = `${anchor.r + 1} / span ${vertical ? 2 : 1}`;
  el.style.gridColumn = `${anchor.c + 1} / span ${vertical ? 1 : 2}`;
  return el;
}

export function renderTray(game: Game): HTMLElement {
  const tray = document.createElement('div');
  tray.className = 'tray';
  for (const id of handTiles(game)) {
    const pips = game.puzzle.dominoes[id];
    if (!pips) continue;
    const orientation = orientationOf(game, id);
    const swapped = orientation >= 2;
    const el = tileEl(
      swapped ? pips[1] : pips[0],
      swapped ? pips[0] : pips[1],
      isVertical(orientation),
    );
    el.classList.add('in-hand');
    el.dataset.tile = String(id);
    tray.appendChild(el);
  }
  if (tray.childElementCount === 0) {
    const done = document.createElement('p');
    done.className = 'tray-empty';
    done.textContent = 'Hand empty — every tile is on the board.';
    tray.appendChild(done);
  }
  return tray;
}
