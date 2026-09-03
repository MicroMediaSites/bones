// The rating corpus: Matt's verdict on a generated puzzle. Ratings are made on
// a phone and read on a laptop, so the server in `server/` is the corpus;
// localStorage is a mirror plus a retry queue for the ratings a flaky phone
// connection could not deliver.
//
// Each record embeds the full Puzzle. The generator is still changing, so a
// seed does not reliably reproduce the board it was rated on — the stored
// puzzle is the record of truth, and the reason a record stands alone.

import type { Puzzle } from '../engine';
// `ratings.ts` is also imported by the report script and by tests, where there
// is no DOM. That is safe only while `ratePanel.ts` touches the document from
// inside functions and never at module level — keep it that way.
import { toast } from './ratePanel';

export const RATINGS_KEY = 'bones.ratings';
/** Ids saved locally that the server has not accepted yet. */
const UNSENT_KEY = 'bones.ratings.unsent';

/**
 * Where ratings go. Overridable at build time (`VITE_RATINGS_URL=... bun run
 * build`) so a local server can be pointed at without editing this file.
 */
export const RATINGS_URL: string =
  import.meta.env.VITE_RATINGS_URL ?? 'https://ratings-production-199b.up.railway.app';

export type Verdict = 'good' | 'bad';

export interface Rating {
  /** `${difficulty}-${seed}`. Rating a puzzle again overwrites this id. */
  id: string;
  /** ISO timestamp of when the rating was saved. */
  at: string;
  verdict: Verdict;
  note: string;
  /** Region ids the rater flagged. */
  regions: number[];
  /** Was the board solved at the moment it was rated. */
  solved: boolean;
  puzzle: Puzzle;
}

export function ratingId(puzzle: Puzzle): string {
  return `${puzzle.difficulty}-${puzzle.seed}`;
}

// ---------------------------------------------------------------- guards

function isCell(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const cell = v as Record<string, unknown>;
  return typeof cell['r'] === 'number' && typeof cell['c'] === 'number';
}

function isRule(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const kind = (v as Record<string, unknown>)['kind'];
  return (
    kind === 'sum' || kind === 'eq' || kind === 'neq' || kind === 'lt' || kind === 'gt' || kind === 'none'
  );
}

function isRegion(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const region = v as Record<string, unknown>;
  return (
    typeof region['id'] === 'number' &&
    isRule(region['rule']) &&
    Array.isArray(region['cells']) &&
    region['cells'].every(isCell)
  );
}

function isPuzzle(v: unknown): v is Puzzle {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  const difficulty = p['difficulty'];
  return (
    typeof p['rows'] === 'number' &&
    typeof p['cols'] === 'number' &&
    typeof p['seed'] === 'number' &&
    (difficulty === 'easy' || difficulty === 'medium' || difficulty === 'hard') &&
    Array.isArray(p['cells']) &&
    p['cells'].every((row) => Array.isArray(row) && row.every((b) => typeof b === 'boolean')) &&
    Array.isArray(p['regions']) &&
    p['regions'].every(isRegion) &&
    Array.isArray(p['dominoes']) &&
    p['dominoes'].every(
      (d) => Array.isArray(d) && d.length === 2 && d.every((n) => typeof n === 'number'),
    )
  );
}

/**
 * Structural check on one record. Ratings round-trip through localStorage and
 * through hand-edited files on disk, so nothing about their shape is assumed.
 */
export function isRating(v: unknown): v is Rating {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['id'] === 'string' &&
    typeof r['at'] === 'string' &&
    (r['verdict'] === 'good' || r['verdict'] === 'bad') &&
    typeof r['note'] === 'string' &&
    typeof r['solved'] === 'boolean' &&
    Array.isArray(r['regions']) &&
    r['regions'].every((n) => typeof n === 'number') &&
    isPuzzle(r['puzzle'])
  );
}

// ---------------------------------------------------------------- local store

function readJson(key: string): unknown {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Every record in the local mirror, newest first. A corrupt or absent store
 * reads as empty rather than throwing — a broken corpus must never stop
 * someone playing.
 */
export function loadRatings(): Rating[] {
  const parsed = readJson(RATINGS_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isRating).sort((a, b) => b.at.localeCompare(a.at));
}

function writeRatings(ratings: Rating[]): boolean {
  try {
    localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings));
    return true;
  } catch {
    return false;
  }
}

/** Ids of local records the server has not acknowledged. */
export function unsentIds(): Set<string> {
  const parsed = readJson(UNSENT_KEY);
  if (!Array.isArray(parsed)) return new Set();
  return new Set(parsed.filter((id): id is string => typeof id === 'string'));
}

function writeUnsent(ids: Set<string>): void {
  try {
    localStorage.setItem(UNSENT_KEY, JSON.stringify([...ids]));
  } catch {
    // Nothing to do: the rating is already lost to this browser's quota.
  }
}

function markUnsent(id: string): void {
  const ids = unsentIds();
  ids.add(id);
  writeUnsent(ids);
}

function markSent(id: string): void {
  const ids = unsentIds();
  if (ids.delete(id)) writeUnsent(ids);
}

/**
 * Store one rating, replacing any earlier rating of the same puzzle, and push
 * it to the server. Returns whether the local write succeeded — the caller
 * reports that immediately; the push reports itself when it fails, because a
 * phone on a bad connection should still see its rating land somewhere.
 */
export function saveRating(rating: Rating): boolean {
  const kept = loadRatings().filter((r) => r.id !== rating.id);
  const stored = writeRatings([rating, ...kept]);
  markUnsent(rating.id);
  void push(rating).then((result) => {
    if (result === 'offline') toast('Saved offline — will retry');
    else if (result === 'rejected') toast('Server rejected this rating');
  });
  return stored;
}

/** Drop the local mirror and its retry queue. The server keeps its copy. */
export function clearRatings(): boolean {
  try {
    localStorage.removeItem(RATINGS_KEY);
    localStorage.removeItem(UNSENT_KEY);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- server

/**
 * The three outcomes of a push, kept apart because they mean different things
 * to the queue: only `offline` is worth retrying. A record the server refuses
 * on shape would be refused forever, so it leaves the queue and says so.
 */
type PushResult = 'ok' | 'rejected' | 'offline';

async function push(rating: Rating): Promise<PushResult> {
  let response: Response;
  try {
    response = await fetch(`${RATINGS_URL}/ratings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rating),
    });
  } catch {
    return 'offline';
  }
  if (response.ok) {
    markSent(rating.id);
    return 'ok';
  }
  // 429 is the rate limiter, and 5xx is the server having a moment: both pass.
  if (response.status === 429 || response.status >= 500) return 'offline';
  markSent(rating.id);
  return 'rejected';
}

/** The whole corpus from the server, newest first. */
export async function fetchRatings(): Promise<Rating[]> {
  const response = await fetch(`${RATINGS_URL}/ratings.json`);
  if (!response.ok) throw new Error(`ratings server returned ${response.status}`);
  const parsed: unknown = await response.json();
  if (!Array.isArray(parsed)) throw new Error('ratings server did not return an array');
  return parsed.filter(isRating).sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Retry everything the server has not acknowledged. Silent by design — this
 * runs on page load, and a queue draining in the background is not news.
 */
export async function flushUnsent(): Promise<void> {
  const ids = unsentIds();
  if (ids.size === 0) return;
  const byId = new Map(loadRatings().map((r) => [r.id, r]));
  for (const id of ids) {
    const rating = byId.get(id);
    // The record is gone from the mirror (cleared, or evicted); stop tracking.
    if (!rating) markSent(id);
    // Still offline — leave the rest of the queue for the next page load.
    else if ((await push(rating)) === 'offline') return;
  }
}

// Retry on load, on whatever page Matt opens next — including a puzzle, which
// is the point: a rating made on a train should land without him going looking
// for the ratings screen. Guarded so the report script and the tests, which
// import the shape guards from here, never touch the network.
if (typeof document !== 'undefined') void flushUnsent();

/** The corpus as the JSON that the report script eats. */
export function ratingsJson(ratings: Rating[]): string {
  return JSON.stringify(ratings, null, 2);
}
