// Domino faces, built as DOM (never innerHTML).

/** Classic pip arrangements, as (col,row) slots on a 3x3 face grid. */
const LAYOUTS: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[1, 1]],
  [[0, 0], [2, 2]],
  [[0, 0], [1, 1], [2, 2]],
  [[0, 0], [2, 0], [0, 2], [2, 2]],
  [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
];

const SVG_NS = 'http://www.w3.org/2000/svg';

/** One half of a tile: `value` pips (0-6) in the classic arrangement. */
export function pipFace(value: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 30 30');
  svg.setAttribute('class', 'face');
  for (const [col, row] of LAYOUTS[value] ?? []) {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(7 + col * 8));
    dot.setAttribute('cy', String(7 + row * 8));
    dot.setAttribute('r', '2.8');
    dot.setAttribute('class', 'pip');
    svg.appendChild(dot);
  }
  return svg;
}

/** A tile. `first`/`second` are in reading order: left-to-right, or top-to-bottom. */
export function tileEl(first: number, second: number, vertical: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.className = vertical ? 'tile tile-v' : 'tile tile-h';
  for (const value of [first, second]) {
    const half = document.createElement('div');
    half.className = 'half';
    half.appendChild(pipFace(value));
    el.appendChild(half);
  }
  return el;
}
