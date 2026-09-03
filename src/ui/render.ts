// DOM builders for the board and the tray. Pure: no event wiring here.

import { cellKey, ruleLabel } from '../engine';
import type { Cell, Placement, Puzzle, Region, Validation } from '../engine';
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
// Region colours sit OVER the board slots (see .cell in style.css), so they
// need real opacity to read as sections; the hues stay muted.
const REGION_SKINS = [
  { fill: 'rgba(178,142,70,0.42)', edge: 'rgba(214,180,104,0.92)' }, // ochre
  { fill: 'rgba(96,132,160,0.42)', edge: 'rgba(138,178,206,0.92)' }, // slate
  { fill: 'rgba(170,94,66,0.42)', edge: 'rgba(212,132,102,0.92)' }, // rust
  { fill: 'rgba(98,140,94,0.42)', edge: 'rgba(136,184,128,0.92)' }, // moss
  { fill: 'rgba(140,108,146,0.42)', edge: 'rgba(184,150,190,0.92)' }, // plum
  { fill: 'rgba(164,148,112,0.40)', edge: 'rgba(202,186,150,0.92)' }, // sand
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
  const tagAt = new Map<string, { label: string; skin: (typeof REGION_SKINS)[number] }>();
  puzzle.regions.forEach((region, i) => {
    skinOf.set(region.id, i % REGION_SKINS.length);
    for (const cell of region.cells) regionAt.set(cellKey(cell.r, cell.c), region);
    const label = ruleLabel(region.rule);
    let corner = region.cells[0];
    if (!label || !corner) return;
    for (const cell of region.cells) {
      if (cell.r < corner.r || (cell.r === corner.r && cell.c < corner.c)) corner = cell;
    }
    tagAt.set(cellKey(corner.r, corner.c), { label, skin: REGION_SKINS[i % REGION_SKINS.length] ?? REGION_SKINS[0] });
  });

  for (let r = 0; r < puzzle.rows; r++) {
    for (let c = 0; c < puzzle.cols; c++) {
      if (puzzle.cells[r]?.[c] !== true) continue;
      const region = regionAt.get(cellKey(r, c));
      const skin = REGION_SKINS[region ? (skinOf.get(region.id) ?? 0) : 0] ?? REGION_SKINS[0];

      // A region with no rule is a "no requirement" square: drawn bare, with a
      // faint dashed edge, so it reads as free space rather than a clue.
      const free = region?.rule.kind === 'none';
      const cell = document.createElement('div');
      cell.className = free ? 'cell free' : 'cell';
      cell.style.gridArea = `${r + 1} / ${c + 1}`;
      // Every playable cell is a slot on the board (style.css paints the slot).
      // A region lays a coloured "mat" over its slots: inset from the region's
      // outer edges so the board shows around each section, flush across the
      // edges it shares with its own cells so the section reads as one piece.
      if (region && !free) {
        const mat = document.createElement('div');
        mat.className = 'mat';
        mat.style.background = skin.fill;
        const inRegion = (dr: number, dc: number): boolean => regionAt.get(cellKey(r + dr, c + dc))?.id === region.id;
        const outer: Record<string, boolean> = {};
        for (const [side, dr, dc] of SIDES) {
          outer[side] = !inRegion(dr, dc);
          mat.style.setProperty(side, outer[side] ? 'var(--mat-inset)' : '0');
          mat.style.setProperty(`border-${side}`, outer[side] ? `var(--mat-border) solid ${skin.edge}` : '1px solid rgba(0,0,0,0.10)');
        }
        // Round only the corners where two outer edges meet.
        mat.style.borderRadius = [
          outer['top'] && outer['left'],
          outer['top'] && outer['right'],
          outer['bottom'] && outer['right'],
          outer['bottom'] && outer['left'],
        ].map((round) => (round ? 'var(--mat-radius)' : '0')).join(' ');
        cell.appendChild(mat);
        // Concave corners: both sides flush with this region but the diagonal
        // cell is not in it. The two neighbours' outlines stop at this cell's
        // edge, so this cell draws the short segments that turn the corner —
        // a notch of board showing through, with the outline curving round it.
        const corners: Array<[string, string, number, number]> = [
          ['top', 'left', -1, -1],
          ['top', 'right', -1, 1],
          ['bottom', 'left', 1, -1],
          ['bottom', 'right', 1, 1],
        ];
        for (const [v, h, dr, dc] of corners) {
          if (outer[v] || outer[h] || inRegion(dr, dc)) continue;
          const notch = document.createElement('div');
          notch.className = `notch notch-${v}-${h}`;
          notch.style.setProperty('--edge', skin.edge);
          cell.appendChild(notch);
        }
      }
      if (region && !free) {
        const state = status.regions[region.id];
        if (state === 'ok' || state === 'bad') cell.classList.add(state);
      }
      if (region && flagged.has(region.id)) cell.classList.add('flagged');
      const tagged = tagAt.get(cellKey(r, c));
      if (tagged) {
        // The rule is a tab in the section's own colour, set inside the mat,
        // so it reads as "the rule for this colour" rather than a footnote.
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = tagged.label;
        tag.style.background = tagged.skin.edge;
        cell.appendChild(tag);
      }
      grid.appendChild(cell);
    }
  }

  // What a placed tile's half needs to know about the cell under it, so the
  // map survives being covered: the section's colour, whether that section is
  // right or wrong, and whether a rule tab sits in this corner.
  const under = (cell: Cell): HalfContext => {
    const region = regionAt.get(cellKey(cell.r, cell.c));
    const skin = REGION_SKINS[region ? (skinOf.get(region.id) ?? 0) : 0] ?? REGION_SKINS[0];
    const state = region ? status.regions[region.id] : undefined;
    return {
      tint: region && region.rule.kind !== 'none' ? skin.fill : null,
      state: state === 'ok' || state === 'bad' ? state : null,
      tagged: tagAt.has(cellKey(cell.r, cell.c)),
    };
  };
  for (const placement of game.board) grid.appendChild(placementEl(puzzle, placement, true, under));
  if (preview) grid.appendChild(placementEl(puzzle, preview, false, under));
  return grid;
}

interface HalfContext {
  tint: string | null;
  state: 'ok' | 'bad' | null;
  tagged: boolean;
}

/** A tile laid across the two cells of `placement`, as a grid item. */
function placementEl(
  puzzle: Puzzle,
  placement: Placement,
  interactive: boolean,
  under: (cell: Cell) => HalfContext,
): HTMLElement {
  const [pipA, pipB] = puzzle.dominoes[placement.domino] ?? [0, 0];
  const anchor = anchorOf(placement);
  const vertical = isVertical(placedOrientation(placement));
  const anchorHoldsFirst =
    placement.cells[0].r === anchor.r && placement.cells[0].c === anchor.c;

  const el = tileEl(anchorHoldsFirst ? pipA : pipB, anchorHoldsFirst ? pipB : pipA, vertical);
  el.classList.add(interactive ? 'placed' : 'preview');
  // Each half wears its cell's section colour (and right/wrong tint), and
  // slides its pips away from a rule tab, so a covered board still reads.
  const other = anchorHoldsFirst ? placement.cells[1] : placement.cells[0];
  const halves = el.querySelectorAll<HTMLElement>('.half');
  [anchor, other].forEach((cell, i) => {
    const half = halves[i];
    if (!half) return;
    const ctx = under(cell);
    if (ctx.tint) half.style.setProperty('--tint', ctx.tint);
    if (ctx.state) half.classList.add(ctx.state);
    if (ctx.tagged) half.classList.add('tagged');
  });
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
