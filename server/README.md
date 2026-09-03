# bones ratings service

Bun + `bun:sqlite`, no dependencies. `POST /ratings` (upsert by id, later `at`
wins), `GET /ratings` and `/ratings.json` (newest first), `GET /health`.

Run it: `DATA_DIR=. bun run index.ts` — listens on `$PORT`, default 8787.
Deploy: `railway up` from this directory; the DB lives at `$DATA_DIR/ratings.db`.
