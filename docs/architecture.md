# Architecture

A contributor's map of the code. The app is plain ES modules served as-is:
`index.html` loads `src/app.js`, and the only runtime dependency, `chess.js`,
comes from esm.sh through an importmap. There is no bundler and no build step.

## Data flow

```text
PGN text
  │  pgn.js        parsePgn: tokenize, recurse into (variations), check SAN with chess.js
  ▼
variation tree
  │  tree.js       collectLines: one root-to-leaf "line" per leaf, mainline first
  ▼
lines[]  ◄──────── store.js applyNotebook: re-attach a saved workbook's tags by move key
  │                merge.js: re-home them onto a NEW PGN by move path / longest prefix
  │
  ├─ table.js      grid: ply-keyed cells, sidelines as divergence from the mainline
  │    └ group-cols.js / trie-view.js   grouped, foldable columns for the screen table
  │    └ print.js                       paper tables, sliced and headed by shared moves
  ├─ notes.js      one-pass numbering of [n] markers and the Notes list
  │    └ foot-groups.js / foot-nodes.js group footnotes and their lettered sub-notes
  ├─ export.js     Markdown; pgn-out.js rebuilds PGN from the flat lines
  └─ line-editor.js / table-menu.js     tagging, names, symbols, notes, hide, focus
```

The central value is **`lines`**: a flat array of root-to-leaf lines, each
with its `moves`, `tag` (`"sideline"` or `"foot"`), `name`, `meta`, per-ply
`marks` (NAG symbols), `comments` and `hidden` flag. Everything the app shows
is derived from it on every render; nothing caches a view of it.

A variation's first move is an **alternative at the same ply** as the move it
replaces (standard PGN `(1... e5)` semantics). Plies are 0-based throughout.

## State

`src/state.js` holds the shared mutable state. `current` (the open workbook:
name, PGN, `lines`, view settings) is **replaced wholesale** by `freshState()`
in `app.js` on every "start over" path, so modules read it through
`getCurrent()` rather than holding a reference. Session-only UI state (which
groups are open, the traced line, collapsed notes) lives in sets next to it and
is never saved.

View modules call back into `app.js` through `setRenderHooks()` rather than
importing it. The tests re-import `app.js` with a cache-busting query string to
get fresh state per test, and a static import would stay bound to the first
instance.

Views are pure functions of state: a control mutates `current` (or the
analysis scratch) and asks for a re-render. The analysis board follows the
same contract with its own scratch object (`analysis.js`), which has exactly
the shape of `current.lines` so committing a line is an array push.

What a change redraws is kept as small as the change (big workbooks run to
tens of thousands of elements; `npm run bench` measures them):

- The analysis window redraws on its own when only the scratch changes
  (stepping, switching lines, flipping). Saving a note or adding a line
  writes to the notebook, so that goes through the full `renderApp`.
- The print tables, and the cards unless they are the preview, are built on
  `beforeprint` from the notebook as it is then, not on every render.
- Inside one render pass (`renderPass` in `notes.js`) note numbering is
  computed once and shared by every caller.
- `pgn.js` caches every move it plays by position and SAN, so replaying lines
  (`fenMap`, `fenAt`) is mostly map lookups, and `render.js` clones board
  diagrams it has drawn before.

## Persistence

A **workbook** (`store.js`) is the raw PGN plus per-line annotations keyed by
the line's move string (`"e4 c5 Nf3 …"`), the view settings, and optionally
the analysis board as it was left. It is stored as JSON in `localStorage` or
written to a `.json` file; both use the same format. The viewer's own preferences
(theme, orientation, panel width, the last workbook) are kept apart in
`prefs.js`, so a workbook file never carries them. On load the PGN is
re-parsed and the annotations re-applied by key, so **the PGN is the source of
truth for the moves**. That is why `analysis-commit.js` regenerates the PGN
when it adds a line: a line missing from the PGN would vanish on reload.

The format carries a `format` marker and a `version`. Bump `VERSION` only for a
change older builds could not read correctly, and migrate older data on the
way in (see `migrate()`).

## Modules

| File | Responsibility |
| ---- | -------------- |
| `src/app.js` | browser glue: import screen, toolbar, `freshState()`, render hooks, save/open, print |
| `src/state.js` | shared mutable state and the render-hook registry |
| `src/dom.js` | `el()` element builder and a small Markdown-to-DOM renderer |
| `src/pgn.js` | tokenize and recursively parse PGN movetext into a variation tree; FEN per ply |
| `src/tree.js` | flatten the tree into lines; mainline lookup, divergence, the trie of shared moves |
| `src/nags.js` | the single NAG table, read by the symbol palette and the PGN exporter |
| `src/visibility.js` | hidden lines: a presentation flag orthogonal to the tag |
| `src/table.js` | tagged lines to a ply-keyed cell grid shared by screen and print |
| `src/group-cols.js` | grid to grouped columns (a branch's shared moves in a column of their own) |
| `src/trie-view.js` | the on-screen grouped table: folding, shading, trace highlighting |
| `src/trace.js` | which cells make up one line in the grouped table |
| `src/table-menu.js` | the table's right-click menu, reusing the line editor's components |
| `src/line-editor.js` | the tagging panel: names, tags, symbols, notes, hide, focus, make mainline |
| `src/report-summary.js` | the report's head: title, PGN header facts, counts and the verdict tally, for print and Markdown |
| `src/game-info.js` | the Game info dialog: edits to the header tags, kept in `state.header` over the PGN's own |
| `src/render.js` | DOM tables, print cards, and SVG board diagrams from FEN |
| `src/print.js` | the printed report: tables headed by shared moves, sliced to fit, chosen to save paper |
| `src/notes.js` | one-pass numbering of note markers and the Notes list |
| `src/foot-groups.js` | which trie nodes are whole-group footnotes (derived, not stored) |
| `src/foot-nodes.js` | the nested tree inside a group footnote and its lettering |
| `src/notes-view.js` | the on-screen, collapsible Notes list |
| `src/export.js` | the export bar (print, PGN, Markdown), Markdown building, file downloads, footnote rendering |
| `src/pgn-out.js` | rebuild a PGN (with variations, comments, NAGs) from the flat lines |
| `src/store.js` | the workbook format, `localStorage` and `.json` persistence, re-applying tags |
| `src/merge.js` | re-homing annotations onto a new PGN, and the report of what cannot be carried |
| `src/analysis.js` | the analysis board's scratch lines: play, fork, cut, reorder, undo, pack/unpack |
| `src/analysis-view.js` | the analysis window: board, lines, notes, engine box, commit bar |
| `src/analysis-commit.js` | the only write from the board into the workbook (line plus regenerated PGN) |
| `src/share-tools.js` | the analysis panel's copy/save row: FEN, PGN, board PNG and SVG |
| `src/share.js` | standalone board SVG (pieces inlined), SVG to PNG, file names for saved positions |
| `src/board-input.js` | click, drag and touch input over `render.js`'s board, promotion, highlights, arrows |
| `src/engine.js` | Stockfish in a Web Worker over UCI: search sequencing, eval cache, SAN conversion |
| `src/engine-store.js` | the full engine's one-time download, its SHA-256 check and its IndexedDB copy |
| `src/engine-flavor.js` | which engine build runs (lite or full) and the download box's state |
| `src/prefs.js` | what the viewer's browser remembers between visits: theme, board orientation, panel width, the last workbook and its board |
| `src/settings-view.js` | the Settings drop-down over `prefs.js` |
| `vendor/stockfish/` | Stockfish 19 WebAssembly builds (GPL-3.0, unmodified; not linted) |
| `tools/dev-server.mjs` | the dependency-free live-reload dev server |
| `style.css` | all styles, including `@media print` rules for the report |

## Tests

`tests/*.test.mjs` run under `node --test`. DOM-touching modules are tested
against jsdom: `tests/helpers.mjs` has `installDom()` to put a window on the
globals and helpers that build `current` from a PGN string. IndexedDB is faked
with `fake-indexeddb`. `tests/fixtures/` holds real PGNs.

`e2e/*.spec.mjs` are Playwright tests against the real page in Chromium
(`npm run test:e2e`, configured in `playwright.config.js`): importing, the
report's editor, the analysis board, the engine, and saving and reopening
workbooks. They start the dev server themselves and answer the esm.sh request
for chess.js from `node_modules`.

Coverage is enforced in CI with floors just below the current numbers, so new
code needs tests to keep them.

## Design history

`docs/superpowers/specs/` holds a design document per feature and
`docs/superpowers/plans/` the implementation plan that followed it. Read the
spec before changing a feature; it records why the behaviour is the way it is.
