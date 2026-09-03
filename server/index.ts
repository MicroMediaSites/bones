// The ratings service: one SQLite table behind four routes, so a rating made
// on a phone shows up on a laptop.
//
// Deliberately not shared with the browser bundle — this file imports nothing
// from `src/`, because `src/ui/ratings.ts` reaches for `localStorage` and the
// DOM. The record shape is the contract between the two; the validator below
// re-states the top-level half of it. That duplication is the price of the
// server being a standalone deployable with its own package.json.

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env['DATA_DIR'] ?? '.';
const PORT = Number(process.env['PORT'] ?? 8787);

/** Bodies bigger than this are junk or an attack; nothing legitimate is close. */
const MAX_BODY_BYTES = 64 * 1024;
/** Oldest records past this are dropped, so the disk cannot grow forever. */
const MAX_ROWS = 10_000;
const RATE_LIMIT_PER_MINUTE = 60;

// ---------------------------------------------------------------- storage

mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(join(DATA_DIR, 'ratings.db'), { create: true });
db.run('PRAGMA journal_mode = WAL');
db.run(`CREATE TABLE IF NOT EXISTS ratings (
  id   TEXT PRIMARY KEY,
  at   TEXT NOT NULL,
  json TEXT NOT NULL
)`);

// Upsert by id, and only forward in time: a stale record replayed off a
// browser's retry queue must not clobber a newer rating of the same puzzle.
const upsert = db.query(`INSERT INTO ratings (id, at, json) VALUES ($id, $at, $json)
  ON CONFLICT(id) DO UPDATE SET at = excluded.at, json = excluded.json
  WHERE excluded.at > ratings.at`);
const trim = db.query(
  `DELETE FROM ratings WHERE id NOT IN (SELECT id FROM ratings ORDER BY at DESC LIMIT $keep)`,
);
const selectAll = db.query<{ json: string }, []>('SELECT json FROM ratings ORDER BY at DESC');
const countRows = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM ratings');

function allRecords(): unknown[] {
  return selectAll.all().map((row) => JSON.parse(row.json));
}

// ---------------------------------------------------------------- validation

/**
 * The top-level rating shape. `puzzle` is checked as "a board-ish object"
 * rather than validated cell by cell — the browser and the report script both
 * run the full guard, and a half-formed puzzle here costs one bad row, not a
 * broken service.
 */
function invalidReason(v: unknown): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'body must be a JSON object';
  const r = v as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || r['id'] === '') return 'id must be a non-empty string';
  if (typeof r['at'] !== 'string' || Number.isNaN(Date.parse(r['at'])))
    return 'at must be an ISO timestamp';
  if (r['verdict'] !== 'good' && r['verdict'] !== 'bad') return "verdict must be 'good' or 'bad'";
  if (typeof r['note'] !== 'string') return 'note must be a string';
  if (typeof r['solved'] !== 'boolean') return 'solved must be a boolean';
  if (!Array.isArray(r['regions']) || !r['regions'].every((n) => typeof n === 'number'))
    return 'regions must be an array of numbers';
  const puzzle = r['puzzle'];
  if (typeof puzzle !== 'object' || puzzle === null || Array.isArray(puzzle))
    return 'puzzle must be an object';
  const p = puzzle as Record<string, unknown>;
  if (typeof p['seed'] !== 'number' || !Array.isArray(p['regions']))
    return 'puzzle must carry a numeric seed and a regions array';
  return null;
}

// ---------------------------------------------------------------- rate limit

/** ip -> [minute bucket, hits]. Crude on purpose; one process, no token. */
const hits = new Map<string, [number, number]>();

function overRateLimit(ip: string): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const seen = hits.get(ip);
  if (!seen || seen[0] !== minute) {
    // A new minute makes every older bucket dead weight; drop them all rather
    // than carry a map that grows with every IP that ever posted.
    if (hits.size > 1000) hits.clear();
    hits.set(ip, [minute, 1]);
    return false;
  }
  seen[1]++;
  return seen[1] > RATE_LIMIT_PER_MINUTE;
}

// ---------------------------------------------------------------- CORS

/**
 * The game's origin, plus any localhost port for development. Everything else
 * gets no CORS header at all, which is what a browser needs to refuse it.
 */
function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (origin === 'https://micromediasites.github.io') return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function cors(origin: string | null): Record<string, string> {
  const allowed = allowedOrigin(origin);
  if (!allowed) return {};
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });
}

// ---------------------------------------------------------------- routes

async function postRating(req: Request, ip: string, origin: string | null): Promise<Response> {
  if (overRateLimit(ip)) {
    return json({ ok: false, error: 'rate limited: 60 ratings per minute' }, 429, origin);
  }

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return json({ ok: false, error: `body larger than ${MAX_BODY_BYTES} bytes` }, 413, origin);
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    return json({ ok: false, error: `body larger than ${MAX_BODY_BYTES} bytes` }, 413, origin);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ ok: false, error: 'body is not valid JSON' }, 400, origin);
  }

  const reason = invalidReason(parsed);
  if (reason) return json({ ok: false, error: reason }, 400, origin);

  const record = parsed as { id: string; at: string };
  upsert.run({ $id: record.id, $at: record.at, $json: JSON.stringify(parsed) });
  trim.run({ $keep: MAX_ROWS });

  return json({ ok: true, count: countRows.get()?.n ?? 0 }, 200, origin);
}

const server = Bun.serve({
  port: PORT,
  fetch(req, self) {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    if (url.pathname === '/health') {
      return json({ ok: true, count: countRows.get()?.n ?? 0 }, 200, origin);
    }

    if (url.pathname === '/ratings' || url.pathname === '/ratings.json') {
      if (req.method === 'GET') return json(allRecords(), 200, origin);
      if (req.method === 'POST' && url.pathname === '/ratings') {
        // Railway terminates TLS in front of us, so the socket address is the
        // proxy's; the first forwarded hop is the closest thing to a client.
        const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
        const ip = forwarded || self.requestIP(req)?.address || 'unknown';
        return postRating(req, ip, origin);
      }
      return json({ ok: false, error: `${req.method} not allowed on ${url.pathname}` }, 405, origin);
    }

    return json({ ok: false, error: `no route for ${url.pathname}` }, 404, origin);
  },
});

console.log(`bones ratings on :${server.port} (data in ${DATA_DIR})`);
