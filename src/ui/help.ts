// In-game explanation: the popover a rule tab opens, and the "How to play"
// sheet behind the ? button.
//
// Both are overlays parented to document.body, never to the game screen: the
// board sizes itself from a fixed `--chrome` budget (see .board in style.css),
// so anything added inside .screen.game would squeeze the board or push the
// tray off a phone. These float above instead.

import { cellKey, pipMap, validate } from '../engine';
import type { Region, Rule } from '../engine';
import { REGION_SKINS } from './render';
import type { Game } from './state';

/** Same slop the root drag controller uses (TAP_SLOP_PX in app.ts): below it a
 *  press-and-release is a tap, above it the player was trying to drag. */
const TAP_SLOP_PX = 8;
/** A popover is a glance, not a panel — it clears itself. */
const POPOVER_MS = 5000;
/** Keep the popover this far off every viewport edge. */
const EDGE_PX = 8;

// ------------------------------------------------------------ rule wording

function cellsPhrase(n: number): string {
  return n === 1 ? 'this cell' : `these ${n} cells`;
}

/** The rule in plain English, sized to the region it belongs to. */
export function ruleExplanation(rule: Rule, cells: number): string {
  switch (rule.kind) {
    case 'sum':
      return `The pips in ${cellsPhrase(cells)} must add up to exactly ${rule.n}.`;
    case 'lt':
      return `The pips in ${cellsPhrase(cells)} must add up to less than ${rule.n}.`;
    case 'gt':
      return `The pips in ${cellsPhrase(cells)} must add up to more than ${rule.n}.`;
    case 'eq':
      return `Every pip in ${cellsPhrase(cells)} must be the same number.`;
    case 'neq':
      return `Every pip in ${cellsPhrase(cells)} must be a different number.`;
    case 'none':
      return `No requirement on ${cellsPhrase(cells)} — anything goes.`;
  }
}

/** "3, 4 and 5" — the values a player can see on the board, in region order. */
function spoken(values: number[]): string {
  if (values.length < 2) return String(values[0] ?? '');
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

/**
 * Where this region stands right now, in the same plain English. The pass/fail
 * verdict comes from the engine rather than being re-derived here — the UI must
 * never disagree with the board's own ✓/✗.
 */
export function ruleState(region: Region, game: Game): string {
  const pips = pipMap(game.puzzle, game.board);
  const values: number[] = [];
  for (const cell of region.cells) {
    const v = pips.get(cellKey(cell.r, cell.c));
    if (v !== undefined) values.push(v);
  }
  const empty = region.cells.length - values.length;
  const holds = validate(game.puzzle, game.board).regions[region.id] === 'ok';
  const rule = region.rule;

  if (rule.kind === 'eq' || rule.kind === 'neq') {
    if (empty > 0) {
      return values.length === 0 ? 'Nothing laid here yet.' : `${values.length} filled so far.`;
    }
    if (holds) return `So far: ${spoken(values)} ✓`;
    return rule.kind === 'eq'
      ? `${spoken(values)} don't match.`
      : `${spoken(values)} repeats a number.`;
  }

  const sum = values.reduce((a, b) => a + b, 0);
  if (empty > 0) return `So far ${sum}, with ${empty} cell${empty === 1 ? '' : 's'} empty.`;
  if (holds) return `Adds up to ${sum} ✓`;
  // A short sum fails "exactly n" and "more than n"; anything else overshot.
  const tooMany = rule.kind === 'lt' || (rule.kind === 'sum' && sum > rule.n);
  return `Adds up to ${sum} — ${tooMany ? 'too many' : 'not enough'}.`;
}

// ------------------------------------------------------------ rule popover

let popover: HTMLElement | null = null;
let popoverTimer: ReturnType<typeof setTimeout> | null = null;

function onPopoverKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') hideRulePopover();
}

export function hideRulePopover(): void {
  if (popoverTimer !== null) {
    clearTimeout(popoverTimer);
    popoverTimer = null;
  }
  if (!popover) return;
  window.removeEventListener('pointerdown', hideRulePopover, true);
  window.removeEventListener('keydown', onPopoverKey);
  popover.remove();
  popover = null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

function showRulePopover(tag: HTMLElement, region: Region, game: Game): void {
  // Only one at a time — tapping a second tab swaps this one out.
  hideRulePopover();

  const el = document.createElement('div');
  el.className = 'rulepop';
  el.setAttribute('role', 'status');
  const what = document.createElement('p');
  what.className = 'rulepop-what';
  what.textContent = ruleExplanation(region.rule, region.cells.length);
  const state = document.createElement('p');
  state.className = 'rulepop-state';
  state.textContent = ruleState(region, game);
  el.append(what, state);
  document.body.appendChild(el);

  // Measure once it is in the document, then place it: above the tab when
  // there is room, below when there isn't, always inside the viewport.
  const anchor = tag.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const above = anchor.top - box.height - EDGE_PX;
  const top = above >= EDGE_PX ? above : anchor.bottom + EDGE_PX;
  el.style.top = `${clamp(top, EDGE_PX, innerHeight - box.height - EDGE_PX)}px`;
  el.style.left = `${clamp(
    anchor.left + anchor.width / 2 - box.width / 2,
    EDGE_PX,
    innerWidth - box.width - EDGE_PX,
  )}px`;
  requestAnimationFrame(() => el.classList.add('in'));

  popover = el;
  // Capture phase: a tab swallows its own pointerdown (see wireRuleTags), so a
  // bubbling listener would never hear the tap that opens the next popover.
  window.addEventListener('pointerdown', hideRulePopover, true);
  window.addEventListener('keydown', onPopoverKey);
  popoverTimer = setTimeout(hideRulePopover, POPOVER_MS);
}

/**
 * Make every rule tab on a freshly rendered board tappable. The tab owns the
 * whole gesture — capture, stopPropagation, preventDefault — so the root drag
 * controller in app.ts never sees it and cannot start a drag or rotate the
 * tile underneath. A pointer that travelled more than the tap slop was a drag
 * attempt: cancel and do nothing.
 */
export function wireRuleTags(board: HTMLElement, game: Game): void {
  const regions = new Map(game.puzzle.regions.map((r) => [r.id, r]));
  for (const tag of board.querySelectorAll<HTMLElement>('.tag')) {
    const region = regions.get(Number(tag.dataset.region));
    if (!region) continue;
    let start: { pointerId: number; x: number; y: number } | null = null;

    tag.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!e.isPrimary) return;
      tag.setPointerCapture(e.pointerId);
      start = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    });
    tag.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const began = start;
      start = null;
      if (!began || e.pointerId !== began.pointerId) return;
      if (Math.hypot(e.clientX - began.x, e.clientY - began.y) >= TAP_SLOP_PX) return;
      showRulePopover(tag, region, game);
    });
    tag.addEventListener('pointercancel', () => {
      start = null;
    });
  }
}

// ------------------------------------------------------------ how to play

const HELP_SEEN_KEY = 'bones.seenHelp';

let sheet: HTMLElement | null = null;
let returnFocus: HTMLElement | null = null;
/** Backstop for a browser that refuses localStorage (Safari private mode):
 *  the sheet still opens at most once per session. */
let seenThisSession = false;

/** True the first time a player reaches the game screen, and never again. */
export function shouldAutoOpenHelp(): boolean {
  if (seenThisSession) return false;
  // `bun run playtest:live` drives this page with Playwright and taps straight
  // into the tray; a modal on first paint would swallow that first tap and make
  // the test flaky. navigator.webdriver is only ever true under automation, so
  // real players still get the sheet.
  if (navigator.webdriver) return false;
  try {
    return localStorage.getItem(HELP_SEEN_KEY) === null;
  } catch {
    return true;
  }
}

function onHelpKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeHelp();
}

export function closeHelp(): void {
  if (!sheet) return;
  window.removeEventListener('keydown', onHelpKey);
  sheet.remove();
  sheet = null;
  seenThisSession = true;
  // Any dismissal counts as seen: a player who taps the backdrop has read (or
  // decided not to read) the sheet just as deliberately as one who taps Got it.
  try {
    localStorage.setItem(HELP_SEEN_KEY, '1');
  } catch {
    // No storage — seenThisSession still keeps it to once per visit.
  }
  returnFocus?.focus();
  returnFocus = null;
}

function heading(text: string): HTMLElement {
  const el = document.createElement('h3');
  el.className = 'sheet-head';
  el.textContent = text;
  return el;
}

function bullets(lines: string[]): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'sheet-list';
  for (const line of lines) {
    const item = document.createElement('li');
    item.textContent = line;
    list.appendChild(item);
  }
  return list;
}

/** A rule row: the tab exactly as it looks on the board, plus what it means. */
function ruleRow(glyph: string, meaning: string, skin: number): HTMLElement {
  const row = document.createElement('li');
  const tab = document.createElement('b');
  tab.className = 'help-tab';
  tab.textContent = glyph;
  tab.style.background = (REGION_SKINS[skin] ?? REGION_SKINS[0]).edge;
  const text = document.createElement('span');
  text.textContent = meaning;
  row.append(tab, text);
  return row;
}

export function openHelp(): void {
  if (sheet) return;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const panel = document.createElement('section');
  panel.className = 'sheet';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'sheet-title');

  const title = document.createElement('h2');
  title.id = 'sheet-title';
  title.className = 'sheet-title';
  title.textContent = 'How to play';

  const rules = document.createElement('ul');
  rules.className = 'sheet-list sheet-rules';
  rules.append(
    ruleRow('7', 'pips add up to exactly 7', 0),
    ruleRow('<5', 'pips add up to less than 5', 1),
    ruleRow('>9', 'pips add up to more than 9', 2),
    ruleRow('=', 'every pip the same', 3),
  );

  const rulesNote = document.createElement('p');
  rulesNote.className = 'sheet-note';
  rulesNote.textContent = 'Tap any tab on the board to see its rule and how it is doing.';

  const free = document.createElement('p');
  free.className = 'sheet-free';
  const swatch = document.createElement('span');
  swatch.className = 'help-free';
  const freeText = document.createElement('span');
  freeText.textContent = 'A dashed square has no rule — anything goes.';
  free.append(swatch, freeText);

  const gotIt = document.createElement('button');
  gotIt.type = 'button';
  gotIt.className = 'btn btn-gotit';
  gotIt.textContent = 'Got it';
  gotIt.addEventListener('click', closeHelp);

  panel.append(
    title,
    heading('Playing'),
    bullets([
      'Drag a bone from your hand onto the board.',
      'Tap a bone to turn it.',
      'Drag a bone back to your hand to take it off.',
      'Every bone must be placed to finish the puzzle.',
    ]),
    heading('Rules'),
    rules,
    rulesNote,
    heading('Free cells'),
    free,
    gotIt,
  );
  backdrop.appendChild(panel);
  // The backdrop itself dismisses; a tap inside the card must not.
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeHelp();
  });

  document.body.appendChild(backdrop);
  sheet = backdrop;
  window.addEventListener('keydown', onHelpKey);
  gotIt.focus();
}
