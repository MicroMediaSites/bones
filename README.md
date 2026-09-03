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
`src/engine/types.ts`.

This repo is stamp-gated; see `AGENTS.md` before any git operation. The
GitHub repo is a read-only mirror of the stamp server origin. `main` deploys
to GitHub Pages.
