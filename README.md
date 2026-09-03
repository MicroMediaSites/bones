# Bones

A domino logic puzzle you can play on your phone. Drag every tile from your
hand onto the board so that each shaded region satisfies its rule.

Rules a region can carry:

| Label | Meaning |
|---|---|
| `7` | the pips in the region add up to exactly 7 |
| `<5` / `>9` | the pips add up to less than 5 / more than 9 |
| `=` | every pip in the region is the same |
| `≠` | every pip in the region is different |
| (blank) | anything goes |

Every puzzle is generated on demand at easy, medium, or hard, and checked by
a solver before it is served.

## Develop

```sh
bun install
bun run dev        # http://localhost:5173/bones/
bun test           # engine tests
bun run typecheck
```

`src/engine/` is pure TypeScript (no DOM): types, generator, solver,
validator. `src/ui/` renders and handles input. The engine contract is
`src/engine/types.ts`. `server/` is the ratings service — Bun + `bun:sqlite`,
no dependencies, its own `package.json` and `tsconfig.json`; see
`server/README.md`.

## Rating puzzles

Generated boards vary in quality, so the game can label them. In a puzzle, tap
**Rate**: mark it **Good** or **Bad**, type a one-line note, and tap any region
on the board to flag it (flagged regions get a dashed ring on every cell).
**Save** overwrites any previous rating of that puzzle.

Ratings go to a small server, so a puzzle rated on a phone shows up on a
laptop: <https://ratings-production-199b.up.railway.app> (`server/`, deployed on
Railway with a volume at `/data`). Point the build somewhere else with
`VITE_RATINGS_URL=http://localhost:8787 bun run build`.

`localStorage` is now a mirror and a retry queue: a save always lands in the
browser under `bones.ratings` and is pushed to the server; if that push fails
the toast says **Saved offline — will retry**, the id is queued under
`bones.ratings.unsent`, and the next page load retries it. The **#ratings**
page (linked from the home screen) shows the server's corpus merged with
anything still queued (tagged `unsent`), and can copy or download it as JSON.
**Clear local** empties this browser's mirror only — the server keeps its copy.

Each record embeds the whole puzzle, because the generator is still moving —
replaying a seed may not reproduce the board that was rated.

Run the report:

```sh
bun run ratings:report                # the ratings server ($RATINGS_URL wins)
bun run ratings:report ratings/       # exported files or dirs instead
bun run ratings:report http://localhost:8787
```

It prints one row of measurable properties per puzzle (regions, mean region
size, singleton and revealed cells, rule histogram, solution count capped at
60), then good-vs-bad means per difficulty, the notes, and the flagged
regions. The point is to find which properties separate good boards from bad
ones — and to keep the records as regression fixtures.

This repo is stamp-gated; see `AGENTS.md` before any git operation. The
GitHub repo is a read-only mirror of the stamp server origin. `main` deploys
to GitHub Pages.
