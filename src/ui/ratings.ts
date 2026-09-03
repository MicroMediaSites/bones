// The rating corpus: Matt's verdict on a generated puzzle, kept in
// localStorage so a play session can label boards without a backend.
//
// Each record embeds the full Puzzle. The generator is still changing, so a
// seed does not reliably reproduce the board it was rated on — the stored
// puzzle is the record of truth, and the reason a record stands alone.

import type { Difficulty, Puzzle } from '../engine';

export const RATINGS_KEY = 'bones.ratings';

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

/** The difficulty a record belongs to, read from the puzzle it carries. */
export function difficultyOf(rating: Rating): Difficulty {
  return rating.puzzle.difficulty;
}

// ---------------------------------------------------------------- storage

/**
 * Every record currently stored, newest first. A corrupt or absent store
 * reads as empty rather than throwing — a broken corpus must never stop
 * someone playing.
 */
export function loadRatings(): Rating[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RATINGS_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
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

/** Store one rating, replacing any earlier rating of the same puzzle. */
export function saveRating(rating: Rating): boolean {
  const kept = loadRatings().filter((r) => r.id !== rating.id);
  return writeRatings([rating, ...kept]);
}

export function clearRatings(): boolean {
  try {
    localStorage.removeItem(RATINGS_KEY);
    return true;
  } catch {
    return false;
  }
}

/** The corpus as the JSON that the report script eats. */
export function ratingsJson(ratings: Rating[]): string {
  return JSON.stringify(ratings, null, 2);
}
