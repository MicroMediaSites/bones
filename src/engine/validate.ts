import type { Board, Puzzle, Rule, Validation, RegionStatus } from './types';

export function cellKey(r: number, c: number): string {
  return `${r},${c}`;
}

/** Map of "r,c" -> pip value for every covered cell. */
export function pipMap(puzzle: Puzzle, board: Board): Map<string, number> {
  const pips = new Map<string, number>();
  for (const p of board) {
    const tile = puzzle.dominoes[p.domino];
    if (!tile) continue;
    pips.set(cellKey(p.cells[0].r, p.cells[0].c), tile[0]);
    pips.set(cellKey(p.cells[1].r, p.cells[1].c), tile[1]);
  }
  return pips;
}

export function ruleHolds(rule: Rule, values: number[]): boolean {
  const sum = values.reduce((a, b) => a + b, 0);
  switch (rule.kind) {
    case 'none':
      return true;
    case 'sum':
      return sum === rule.n;
    case 'lt':
      return sum < rule.n;
    case 'gt':
      return sum > rule.n;
    case 'eq':
      return values.every((v) => v === values[0]);
    case 'neq':
      return new Set(values).size === values.length;
  }
}

export function validate(puzzle: Puzzle, board: Board): Validation {
  const pips = pipMap(puzzle, board);
  const regions: Record<number, RegionStatus> = {};
  let solved = true;
  for (const region of puzzle.regions) {
    const values: number[] = [];
    let complete = true;
    for (const cell of region.cells) {
      const v = pips.get(cellKey(cell.r, cell.c));
      if (v === undefined) complete = false;
      else values.push(v);
    }
    let status: RegionStatus;
    if (!complete) status = 'incomplete';
    else status = ruleHolds(region.rule, values) ? 'ok' : 'bad';
    regions[region.id] = status;
    if (status !== 'ok') solved = false;
  }
  return { solved, regions };
}

/** Short label for a rule, for rendering on the board. */
export function ruleLabel(rule: Rule): string {
  switch (rule.kind) {
    case 'none':
      return '';
    case 'sum':
      return String(rule.n);
    case 'lt':
      return `<${rule.n}`;
    case 'gt':
      return `>${rule.n}`;
    case 'eq':
      return '=';
    case 'neq':
      return '≠';
  }
}
