# CLAUDE.md

Guidance for AI agents (and humans) working in this repository. Read
[docs/architecture.md](docs/architecture.md) for how the code fits together.

## What this is

A static, client-side web app that turns a chess PGN into a printable opening
theory table. Plain ES modules, no bundler, no build step, no backend.
`index.html` loads `src/app.js`; `chess.js` is resolved from esm.sh by an
importmap. GitHub Pages serves the repository root from `master`.

## Checks

Run all of these before pushing; CI (`.github/workflows/ci.yml`, Node 22) runs
the same:

```bash
npm ci
npm run lint       # ESLint; `npm run lint:fix` fixes what it can
npm run knip       # fails on unused files, exports or dependencies
npm test           # node --test 'tests/**/*.test.mjs'
npm run coverage   # CI fails below 97% lines, 87% branches, 97% functions
```

Run a single test file with `node --test tests/pgn.test.mjs`.

`npm run dev` serves the app at http://127.0.0.1:8000 with live reload. esm.sh
must be reachable for the page to load `chess.js`; in a sandbox without it,
intercept `https://esm.sh/**` and serve `node_modules/chess.js/dist/esm/chess.js`.

## Conventions

- **Do not add a bundler or change the importmap.** The dev server serves the
  exact bytes GitHub Pages does; that is deliberate (see `tools/dev-server.mjs`).
- **No new runtime dependencies** without a strong reason. `chess.js` is the
  only one. Dev dependencies must be used, or knip fails.
- **Every export must be imported somewhere**, including by tests; knip
  enforces it. Delete dead code rather than leaving it.
- **Views are pure functions of state.** Mutate `current` (via `getCurrent()`)
  or the analysis scratch, then re-render through the hooks in `state.js`.
  Never import `app.js` from another module; use `getRenderHooks()`.
- **The PGN is the source of truth for moves.** A workbook re-parses its PGN on
  load, so any change to the line set must regenerate the PGN
  (`pgn-out.js`), as `analysis-commit.js` and Update PGN do.
- **One implementation per action.** The table's context menu reuses the line
  editor's components; the symbol palette and the PGN exporter share
  `nags.js`. Add a second way to reach an action, not a second copy of it.
- **Workbook format changes** go through `store.js`. Keep old files readable:
  migrate on the way in, and bump `VERSION` only when older builds could not
  read the new data correctly.
- **Build DOM with `el()`** from `dom.js` or `createElementNS`, not
  `innerHTML`, so modules run identically in jsdom.
- **Plies are 0-based.** A variation's first move is an alternative at the
  same ply as the move it replaces.
- **Comments explain why.** The codebase documents intent and past bugs in
  block comments above the code; keep that style, and keep comments accurate
  when you change the code under them.
- **Match the file's indentation.** Some files use tabs, some two spaces.
- `vendor/` is third-party (Stockfish, GPL-3.0). Do not edit it; it is not
  linted.

## Tests

- Every behaviour change comes with a test in `tests/`. Use `installDom()`
  and the state builders in `tests/helpers.mjs` for anything touching the DOM.
- Never skip, disable or loosen a test, or lower a coverage floor, to get
  green. Raise the floors when coverage improves.

## Features and docs

- Larger features start with a design in `docs/superpowers/specs/` and a plan
  in `docs/superpowers/plans/`, named `YYYY-MM-DD-<feature>.md`. Read the
  relevant spec before changing a feature.
- User-visible changes update [docs/user-guide.md](docs/user-guide.md), and the
  README's feature list if the change is headline-level.

## Commits and PRs

- Commit subjects are short imperative sentences describing the behaviour
  ("List a printed table's notes in number order"), not the code.
- Work on a branch and open a PR against `master`; CI must be green to merge.
