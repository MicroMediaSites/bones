// The #ratings screen: the corpus so far, plus the three ways to get it out
// of the browser (copy, download, clear).

import type { Difficulty } from '../engine';
import { clearRatings, loadRatings, ratingsJson, type Rating } from './ratings';
import { toast } from './ratePanel';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

function countsTable(ratings: Rating[]): HTMLElement {
  const table = document.createElement('div');
  table.className = 'counts';

  const header: string[] = ['', 'good', 'bad'];
  for (const label of header) {
    const cell = document.createElement('b');
    cell.textContent = label;
    table.appendChild(cell);
  }

  const rows: [string, Rating[]][] = DIFFICULTIES.map((d) => [
    d,
    ratings.filter((r) => r.puzzle.difficulty === d),
  ]);
  rows.push(['all', ratings]);

  for (const [label, group] of rows) {
    const name = document.createElement('span');
    name.className = 'counts-name';
    name.textContent = label;
    const good = document.createElement('span');
    good.textContent = String(group.filter((r) => r.verdict === 'good').length);
    const bad = document.createElement('span');
    bad.textContent = String(group.filter((r) => r.verdict === 'bad').length);
    table.append(name, good, bad);
  }
  return table;
}

function ratingRow(rating: Rating): HTMLElement {
  const row = document.createElement('li');
  row.className = 'rating-row';

  const head = document.createElement('div');
  head.className = 'rating-head';

  const verdict = document.createElement('span');
  verdict.className = `verdict-tag verdict-tag-${rating.verdict}`;
  verdict.textContent = rating.verdict;

  const id = document.createElement('span');
  id.className = 'rating-id';
  id.textContent = rating.id;

  const play = document.createElement('a');
  play.className = 'rating-play';
  play.href = `#${rating.puzzle.difficulty}-${rating.puzzle.seed}`;
  play.textContent = 'play';

  head.append(verdict, id, play);

  const meta = document.createElement('div');
  meta.className = 'rating-meta';
  const bits = [
    new Date(rating.at).toLocaleString(),
    rating.solved ? 'solved' : 'unsolved',
    `${rating.regions.length} flagged`,
  ];
  meta.textContent = bits.join(' · ');

  row.append(head, meta);

  if (rating.note) {
    const note = document.createElement('p');
    note.className = 'rating-note';
    note.textContent = rating.note;
    row.appendChild(note);
  }
  return row;
}

/**
 * @param rerender re-draw the screen after the corpus changes.
 */
export function buildRatingsScreen(rerender: () => void): HTMLElement {
  const ratings = loadRatings();

  const screen = document.createElement('div');
  screen.className = 'screen ratings';

  const bar = document.createElement('header');
  bar.className = 'topbar';
  const topline = document.createElement('div');
  topline.className = 'topline';
  const mark = document.createElement('h1');
  mark.className = 'wordmark';
  mark.textContent = 'Ratings';
  const back = button('Back', 'btn', () => {
    location.hash = '';
  });
  back.classList.add('ratings-back');
  topline.append(mark, back);
  bar.appendChild(topline);

  const body = document.createElement('div');
  body.className = 'ratings-body';

  const warn = document.createElement('p');
  warn.className = 'ratings-warn';
  warn.textContent =
    'The generator is still changing, so replaying a seed may produce a different board than the one rated. The puzzle stored inside each record is the record of truth.';

  const actions = document.createElement('div');
  actions.className = 'controls ratings-actions';
  const json = ratingsJson(ratings);

  const copy = button('Copy JSON', 'btn', () => {
    const clipboard = navigator.clipboard;
    if (clipboard?.writeText) {
      clipboard.writeText(json).then(
        () => toast('Copied'),
        () => showFallback(),
      );
    } else {
      showFallback();
    }
  });

  const download = button('Download', 'btn', () => {
    const a = document.createElement('a');
    a.href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
    a.download = `ratings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  const clear = button('Clear all', 'btn btn-danger', () => askClear());
  actions.append(copy, download, clear);

  // Inline confirm — never window.confirm; it blocks the page and looks alien
  // on a phone.
  const confirmRow = document.createElement('div');
  confirmRow.className = 'controls ratings-confirm';
  confirmRow.hidden = true;
  const confirmText = document.createElement('span');
  confirmText.className = 'ratehint';
  const confirmCancel = button('Keep', 'btn', () => {
    confirmRow.hidden = true;
    actions.hidden = false;
  });
  const confirmGo = button('Delete', 'btn btn-danger', () => {
    if (clearRatings()) toast('Cleared');
    else toast('Could not clear');
    rerender();
  });
  confirmRow.append(confirmText, confirmCancel, confirmGo);

  function askClear(): void {
    confirmText.textContent = `Delete ${ratings.length} rating${ratings.length === 1 ? '' : 's'}?`;
    actions.hidden = true;
    confirmRow.hidden = false;
  }

  const fallback = document.createElement('textarea');
  fallback.className = 'json-fallback';
  fallback.readOnly = true;
  fallback.value = json;
  fallback.hidden = true;

  function showFallback(): void {
    fallback.hidden = false;
    fallback.focus();
    fallback.select();
  }

  body.append(warn, countsTable(ratings), actions, confirmRow, fallback);

  if (ratings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'ratings-empty';
    empty.textContent = 'No ratings yet. Open a puzzle and tap Rate.';
    body.appendChild(empty);
    clear.disabled = true;
    copy.disabled = true;
    download.disabled = true;
  } else {
    const list = document.createElement('ul');
    list.className = 'rating-list';
    for (const rating of ratings) list.appendChild(ratingRow(rating));
    body.appendChild(list);
  }

  screen.append(bar, body);
  return screen;
}
