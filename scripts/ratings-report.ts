#!/usr/bin/env bun
//
// Turn a pile of exported rating files into a plain-text report: one row per
// rated puzzle, then GOOD-vs-BAD means so we can see which measurable
// properties actually separate the boards Matt likes from the ones he doesn't.
//
//   bun run scripts/ratings-report.ts [files or dirs...]   # default: ratings/
//
// Not machine learning. Labelled data plus arithmetic.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { countSolutions, ruleLabel } from '../src/engine/index';
import type { Difficulty, Puzzle, Rule } from '../src/engine/index';
import { isRating, type Rating } from '../src/ui/ratings';

/** Stop counting solutions here; past this the exact number stops meaning much. */
const SOLUTION_CAP = 60;

const RULE_KINDS = ['sum', 'eq', 'neq', 'lt', 'gt', 'none'] as const;
type RuleKind = (typeof RULE_KINDS)[number];

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

// ---------------------------------------------------------------- metrics

export interface Metrics {
  /** Tiles in the hand. */
  dominoes: number;
  /** Playable cells on the board. */
  cells: number;
  regions: number;
  meanRegionSize: number;
  /** Regions holding exactly one cell. */
  singletons: number;
  /**
   * Singleton regions carrying a `sum` rule: the rule states the cell's pip
   * value outright, so the cell is effectively revealed. Expressed as a
   * percentage of playable cells.
   */
  revealedPct: number;
  /** Regions with no constraint at all. */
  noneRegions: number;
  ruleKinds: Record<RuleKind, number>;
  /** Capped at SOLUTION_CAP — a value of 60 means "60 or more". */
  solutions: number;
}

/** The numeric columns that get averaged in the summary. */
const MEAN_KEYS = [
  'dominoes',
  'cells',
  'regions',
  'meanRegionSize',
  'singletons',
  'revealedPct',
  'noneRegions',
  'solutions',
] as const satisfies readonly (keyof Metrics)[];

type MeanKey = (typeof MEAN_KEYS)[number];

function playableCells(puzzle: Puzzle): number {
  let n = 0;
  for (const row of puzzle.cells) {
    for (const cell of row) if (cell === true) n++;
  }
  return n;
}

/** Everything derivable from the board without running the solver. */
export function shapeMetrics(puzzle: Puzzle): Omit<Metrics, 'solutions'> {
  const cells = playableCells(puzzle);
  const regions = puzzle.regions;

  const ruleKinds = Object.fromEntries(RULE_KINDS.map((k) => [k, 0])) as Record<RuleKind, number>;
  let cellsInRegions = 0;
  let singletons = 0;
  let revealed = 0;

  for (const region of regions) {
    ruleKinds[region.rule.kind]++;
    cellsInRegions += region.cells.length;
    if (region.cells.length === 1) {
      singletons++;
      if (region.rule.kind === 'sum') revealed++;
    }
  }

  return {
    dominoes: puzzle.dominoes.length,
    cells,
    regions: regions.length,
    meanRegionSize: regions.length === 0 ? 0 : cellsInRegions / regions.length,
    singletons,
    revealedPct: cells === 0 ? 0 : (revealed / cells) * 100,
    noneRegions: ruleKinds.none,
    ruleKinds,
  };
}

export function computeMetrics(puzzle: Puzzle, cap: number = SOLUTION_CAP): Metrics {
  return { ...shapeMetrics(puzzle), solutions: countSolutions(puzzle, cap) };
}

/** e.g. "sum:4 eq:1 none:2" — zero counts omitted. */
function ruleHistogram(kinds: Record<RuleKind, number>): string {
  return RULE_KINDS.filter((k) => kinds[k] > 0)
    .map((k) => `${k}:${kinds[k]}`)
    .join(' ');
}

// ---------------------------------------------------------------- loading

/** Every *.json under the given files/dirs (dirs are read one level deep). */
export function collectFiles(paths: string[]): string[] {
  const files: string[] = [];
  for (const path of paths) {
    let stat;
    try {
      stat = statSync(path);
    } catch {
      console.error(`skip: cannot read ${path}`);
      continue;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) {
        if (entry.endsWith('.json')) files.push(join(path, entry));
      }
    } else if (path.endsWith('.json')) {
      files.push(path);
    }
  }
  return files;
}

export interface Loaded {
  ratings: Rating[];
  skipped: number;
}

/**
 * Read every file, keep the records that match the rating shape, and dedupe by
 * id keeping the newest — exports taken at different times overlap.
 */
export function loadRecords(files: string[]): Loaded {
  const byId = new Map<string, Rating>();
  let skipped = 0;

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      console.error(`skip: ${file} is not valid JSON`);
      continue;
    }
    if (!Array.isArray(parsed)) {
      console.error(`skip: ${file} is not a JSON array`);
      continue;
    }
    for (const record of parsed) {
      if (!isRating(record)) {
        skipped++;
        continue;
      }
      const existing = byId.get(record.id);
      if (!existing || existing.at < record.at) byId.set(record.id, record);
    }
  }

  const ratings = [...byId.values()].sort((a, b) => b.at.localeCompare(a.at));
  return { ratings, skipped };
}

// ---------------------------------------------------------------- printing

function pad(text: string, width: number, right: boolean): string {
  return right ? text.padStart(width) : text.padEnd(width);
}

/** A plain-text table. `numeric` columns are right-aligned. */
function table(headers: string[], rows: string[][], numeric: Set<number> = new Set()): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? '').length)),
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, i) => pad(cell, widths[i] ?? 0, numeric.has(i)))
      .join('  ')
      .trimEnd();
  const rule = widths.map((w) => '-'.repeat(w)).join('  ');
  return [line(headers), rule, ...rows.map(line)].join('\n');
}

function num(value: number, places = 1): string {
  return Number.isInteger(value) && places === 0 ? String(value) : value.toFixed(places);
}

function heading(text: string): void {
  console.log(`\n${text}\n${'='.repeat(text.length)}`);
}

// ---------------------------------------------------------------- report

interface Row {
  rating: Rating;
  metrics: Metrics;
}

const PER_PUZZLE_HEADERS = [
  'id',
  'verdict',
  'solved',
  'tiles',
  'cells',
  'regions',
  'meanSize',
  'singles',
  'revealed%',
  'none',
  'solutions',
  'flagged',
  'rules',
];
/** Column indexes that are right-aligned numbers. */
const PER_PUZZLE_NUMERIC = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11]);

function perPuzzleTable(rows: Row[]): string {
  return table(
    PER_PUZZLE_HEADERS,
    rows.map(({ rating, metrics }) => [
      rating.id,
      rating.verdict,
      rating.solved ? 'yes' : 'no',
      num(metrics.dominoes, 0),
      num(metrics.cells, 0),
      num(metrics.regions, 0),
      num(metrics.meanRegionSize, 2),
      num(metrics.singletons, 0),
      num(metrics.revealedPct, 1),
      num(metrics.noneRegions, 0),
      metrics.solutions >= SOLUTION_CAP ? `${SOLUTION_CAP}+` : num(metrics.solutions, 0),
      num(rating.regions.length, 0),
      ruleHistogram(metrics.ruleKinds),
    ]),
    PER_PUZZLE_NUMERIC,
  );
}

/** null for an empty group — an absent mean is not zero. */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function cell(value: number | null): string {
  return value === null ? '-' : num(value, 2);
}

/** One "good vs bad" block: a row per metric, a column per verdict. */
function comparisonTable(rows: Row[], label: string): string {
  const good = rows.filter((r) => r.rating.verdict === 'good');
  const bad = rows.filter((r) => r.rating.verdict === 'bad');
  const body = MEAN_KEYS.map((key: MeanKey) => {
    const g = mean(good.map((r) => r.metrics[key]));
    const b = mean(bad.map((r) => r.metrics[key]));
    // A diff only means something when both sides have data.
    const diff = g === null || b === null ? null : g - b;
    return [key, cell(g), cell(b), cell(diff)];
  });
  const header = `${label}  (good n=${good.length}, bad n=${bad.length})`;
  return `${header}\n${table(['metric', 'good', 'bad', 'diff'], body, new Set([1, 2, 3]))}`;
}

function flaggedTable(rows: Row[]): string {
  const body: string[][] = [];
  for (const { rating } of rows) {
    for (const id of rating.regions) {
      const region = rating.puzzle.regions.find((r) => r.id === id);
      body.push([
        rating.id,
        rating.verdict,
        String(id),
        region ? describeRule(region.rule) : '(missing)',
        region ? String(region.cells.length) : '-',
      ]);
    }
  }
  if (body.length === 0) return 'No regions flagged.';
  return table(['id', 'verdict', 'region', 'rule', 'size'], body, new Set([2, 4]));
}

function describeRule(rule: Rule): string {
  const label = ruleLabel(rule);
  return label === '' ? 'none' : `${rule.kind} ${label}`;
}

function report(ratings: Rating[]): void {
  const rows: Row[] = ratings.map((rating) => ({
    rating,
    metrics: computeMetrics(rating.puzzle),
  }));

  heading(`Per puzzle (${rows.length} rated)`);
  console.log(perPuzzleTable(rows));

  heading('Good vs bad — means');
  console.log(comparisonTable(rows, 'overall'));
  for (const difficulty of DIFFICULTIES) {
    const subset = rows.filter((r) => r.rating.puzzle.difficulty === difficulty);
    if (subset.length === 0) continue;
    console.log('');
    console.log(comparisonTable(subset, difficulty));
  }

  heading('Notes on bad puzzles');
  const badNotes = rows.filter((r) => r.rating.verdict === 'bad' && r.rating.note !== '');
  if (badNotes.length === 0) console.log('(none)');
  for (const { rating } of badNotes) console.log(`${rating.id}: ${rating.note}`);

  const goodNotes = rows.filter((r) => r.rating.verdict === 'good' && r.rating.note !== '');
  if (goodNotes.length > 0) {
    heading('Notes on good puzzles');
    for (const { rating } of goodNotes) console.log(`${rating.id}: ${rating.note}`);
  }

  heading('Flagged regions');
  console.log(flaggedTable(rows));
  console.log('');
}

export function main(argv: string[]): number {
  const paths = argv.length > 0 ? argv : ['ratings'];
  const files = collectFiles(paths);
  if (files.length === 0) {
    console.error(`No .json files found in: ${paths.join(', ')}`);
    return 1;
  }

  const { ratings, skipped } = loadRecords(files);
  console.log(`Read ${files.length} file(s): ${files.join(', ')}`);
  if (skipped > 0) console.error(`Ignored ${skipped} record(s) that did not match the rating shape.`);
  if (ratings.length === 0) {
    console.error('No usable ratings.');
    return 1;
  }

  report(ratings);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
