// The #ratings screen: the corpus so far, plus the ways to get it out of the
// browser (copy, download, clear).
//
// The server is the corpus; this screen renders the local mirror first so it
// paints instantly, then swaps in what the server has. Anything still sitting
// in the retry queue is shown too, tagged, so a rating never silently vanishes
// between the phone that made it and the laptop reading it.

import type { Difficulty } from '../engine';
import {
  clearRatings,
  fetchRatings,
  loadRatings,
  ratingsJson,
  unsentIds,
  type Rating,
} from './ratings';
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

function ratingRow(rating: Rating, unsent: boolean): HTMLElement {
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
  if (unsent) bits.push('unsent');
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
 * The server's records plus any local record the server has not acknowledged,
 * newest first. Where both sides hold an id, the later `at` wins — the same
 * rule the server applies on upsert.
 */
export function mergeCorpus(remote: Rating[], local: Rating[], unsent: Set<string>): Rating[] {
  const byId = new Map(remote.map((r) => [r.id, r]));
  for (const rating of local) {
    if (!unsent.has(rating.id)) continue;
    const existing = byId.get(rating.id);
    if (!existing || existing.at < rating.at) byId.set(rating.id, rating);
  }
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * @param rerender re-draw the screen after the corpus changes.
 */
export function buildRatingsScreen(rerender: () => void): HTMLElement {
  let unsent = unsentIds();
  let ratings = loadRatings();
  let json = ratingsJson(ratings);

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

  const status = document.createElement('p');
  status.className = 'ratings-warn';
  status.setAttribute('role', 'status');
  status.textContent = 'Loading from the server…';

  const warn = document.createElement('p');
  warn.className = 'ratings-warn';
  warn.textContent =
    'The generator is still changing, so replaying a seed may produce a different board than the one rated. The puzzle stored inside each record is the record of truth.';

  const actions = document.createElement('div');
  actions.className = 'controls ratings-actions';

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

  const clear = button('Clear local', 'btn btn-danger', () => askClear());
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
    if (clearRatings()) toast('Cleared this browser');
    else toast('Could not clear');
    rerender();
  });
  confirmRow.append(confirmText, confirmCancel, confirmGo);

  function askClear(): void {
    const local = loadRatings().length;
    const queued = unsent.size;
    confirmText.textContent =
      queued > 0
        ? `Delete ${local} local record(s), including ${queued} not yet on the server?`
        : `Delete ${local} local record(s)? The server keeps its copy.`;
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

  // Reassigned on every paint: the replaced node is detached, so the next
  // paint has to hold the one that is actually in the document.
  let counts = countsTable(ratings);
  const list = document.createElement('ul');
  list.className = 'rating-list';

  const empty = document.createElement('p');
  empty.className = 'ratings-empty';
  empty.textContent = 'No ratings yet. Open a puzzle and tap Rate.';

  function paint(): void {
    json = ratingsJson(ratings);
    fallback.value = json;
    const next = countsTable(ratings);
    counts.replaceWith(next);
    counts = next;
    list.replaceChildren(...ratings.map((r) => ratingRow(r, unsent.has(r.id))));
    const none = ratings.length === 0;
    empty.hidden = !none;
    list.hidden = none;
    copy.disabled = none;
    download.disabled = none;
    clear.disabled = loadRatings().length === 0;
  }

  body.append(status, warn, counts, actions, confirmRow, fallback, empty, list);
  paint();

  void fetchRatings().then(
    (remote) => {
      unsent = unsentIds();
      ratings = mergeCorpus(remote, loadRatings(), unsent);
      status.textContent =
        unsent.size === 0
          ? `${remote.length} rating${remote.length === 1 ? '' : 's'} on the server.`
          : `${remote.length} on the server · ${unsent.size} still waiting to send.`;
      paint();
    },
    () => {
      status.textContent = 'Server unreachable — showing this browser’s copy only.';
    },
  );

  screen.append(bar, body);
  return screen;
}
