# Analysis board — design

Status: approved 2026-09-07. Scope: sub-project **A** only.

## Why

Today the app can only *annotate* an imported PGN. Nothing in `src/` creates or
changes a move: every edit is a tag, a symbol, a note, a promotion or a hide.
Fixing a wrong move or adding a variation means editing the PGN outside the app
and re-importing it.

This adds a dedicated Analysis mode: an interactive board with its own scratch
tree, free to explore without touching the notebook, and one write operation —
commit a scratch line into `current.lines` as a new sideline.

## Sub-projects

This is one of four. Only **A** is in scope here.

- **A. Analysis board** — interactive board, scratch tree, commit-as-new-line.
- **B. Line mutation** — *dropped*. See "Why B is dropped" below.
- **C. Empty-notebook start** — play a repertoire in with no PGN. Later.
- **D. Engine eval** — Stockfish WASM in a worker. Later; needs only A's
  "current FEN".

### Why B is dropped

In-place move editing (replace a move, extend a line, truncate) is not needed,
because A's entry points plus the existing `hide` reach the same outcomes:

- *Fix a wrong move* — analyse from the move before it, play the correct move,
  add as a line, hide the old one.
- *Extend a line* — analyse from its last move, keep playing, add as a line.

`visibility.js` already removes a hidden line from the table, the print view,
the Markdown export **and** the PGN, so hiding is functionally deleting for
every output. Avoiding in-place mutation also avoids the real hazard: lines are
a flat list whose tree structure is recovered by prefix-matching in
`pgn-out.js`, so mutating moves can silently re-parent siblings and strand
`marks`/`comments` keyed by a `ply` that moved. Appending a line does not — an
appended line is re-parented by the same prefix rule as an imported sibling.

## Model: scratch as a parallel `lines[]` array

The scratch holds line objects in exactly the shape `current.lines` uses, so
one data shape runs end to end and committing is an array push.

```js
{ lines: [ { moves: [{san, ply}] } ],  // each root-to-leaf
  active: 0,   // scratch line the board is on
  at: 0,       // cursor: how many of its moves are played
  flipped: false }
```

All tree behaviour comes from one rule in `play(san)`, with the cursor at `at`
in the active line:

| Condition | Effect |
|---|---|
| `san` equals `moves[at].san` | advance the cursor — walking a line already held |
| `at` is at the end | append |
| otherwise | **fork**: new line copying `moves[0..at)` + `san`, becomes active |

Forking never discards a tail, which is what "several lines at a time" means
here. Branches duplicate their shared prefix — the same trade the notebook
already makes, not a new one.

`buildTrie(lines, lines[0])` is a pure function of a line array and gives the
scratch's nesting for free. `grid()` is **not** reused: it is report-specific —
it filters by `hidden`, runs `numberNotes`, and assumes a mainline reference
row, none of which a scratch has. `renderTrieTable` is not reusable either: it
reads `getCurrent()`, the shared open-path sets, trace state and the table
menu. The scratch gets its own small move-list-tree renderer over `buildTrie`.

Per-ply FEN comes from the existing `fenMap(moves)`, cached per line in a
`WeakMap` as `app.js` already does.

## Modules

New:

| File | Responsibility | DOM |
|---|---|---|
| `src/analysis.js` | scratch model: play / back / forward / goto / fork, and the commit shape | no |
| `src/board-input.js` | interactive board over `boardSvg`: hit-testing, legal targets, drag + click-click, promotion picker; emits SAN | yes |
| `src/analysis-view.js` | the mode panel: board, scratch list, nav, commit buttons | yes |

Modified:

- `src/state.js` — mode flag and scratch, session-only. `store.js` must not
  persist either; a saved workbook carries no scratch and no mode key.
- `src/app.js` — toolbar Report/Analysis toggle, mode branch in `viewRoot()`.
- `src/table-menu.js`, `src/line-editor.js` — the "Analyse from here" entry.
- `src/render.js` — stamp `data-sq` on board squares. Attribute only, no change
  to drawing, so printed output stays byte-identical.
- `index.html` — chess.js version fix (see Risks).

## Board interaction

`boardSvg` keeps drawing the board; `board-input.js` attaches behaviour to the
SVG it returns. Click-to-select then click-to-target, plus drag. Legal targets
come from `chess.moves({ square, verbose: true })` and show as dots. Promotion
opens a Q/R/B/N picker. An illegal drop snaps back and changes no state.
Left/Right arrows step the cursor, matching the keyboard operability
`render.js` already maintains. Flip is view-only and never touches the scratch.

## Commit

**Add as line** commits the active scratch line; **Add all** commits every one.
Each becomes the exact shape `collectLines` emits:

```js
{ moves, marks: {}, comments: [], fen: <final>, ply: <last>,
  tag: "sideline", name: defaultLineName(false, idx) }   // idx = its index in current.lines after the push
```

pushed onto `current.lines`. Never `isMain` — a committed line is a sideline,
promoted afterwards with the existing ★. A scratch line whose moves already
match a notebook line is refused with a message rather than duplicated.

## Persistence

A workbook is **not** a dump of `current.lines`. `toNotebook` saves `pgn` plus
`tags` keyed by `keyFor(l.moves)`, and `applyNotebook` re-parses that PGN on
load and re-applies the tags by move-key. So a committed line that lives only
in `current.lines` is gone on the next save/reload: it is not in the PGN, so
nothing re-parses it.

Commit therefore has two writes, not one: push the line, then regenerate
`current.pgn` with `buildPgn(getCurrent())`. `app.js` already does exactly this
in the Update PGN flow, so the pattern exists and is not new machinery.

## Ply numbering

Plies are **0-based** (`parseSeq` starts at `ply: 0`), so within a scratch line
a move's `ply` equals its index in `moves`. The scratch cursor is therefore an
index `at` -- the number of moves played, and the ply of the next move. `at` is
used throughout rather than `ply` so the cursor is never confused with a move's
own `ply` field.

## Entry points

1. Toolbar toggle — Analysis from the start position.
2. Right-click a table move → "Analyse from here" (`table-menu.js` already has
   the menu, the move and its line).
3. The line editor's move controls — same action.

Entering from 2 or 3 seeds the scratch with that line's full prefix up to and
including the clicked move, cursor at its end. A line is a root-to-leaf path,
so the scratch always carries the moves from move 1; there is no mid-game FEN
setup in A, which would produce a rootless line and break the table's
divergence maths.

## Testing

`node --test` with jsdom, matching the existing suite. No `?t=` cache-busting
on `src/app.js` imports — it hides most of that file's coverage.

- `tests/analysis.test.mjs` — the three `play` branches, fork prefix
  correctness, cursor bounds, commit shape. Pure, no DOM.
- `tests/board-input.test.mjs` — select marks legal targets; clicking a target
  emits the right SAN; an illegal target emits nothing; the promotion picker
  yields `e8=Q`.
- `tests/analysis-view.test.mjs` — the toggle renders a board; commit lands a
  line in `current.lines`; "Analyse from here" preloads the clicked move's full
  prefix and cursor.
- A guard test that a saved workbook round-trips with no scratch or mode key.

## Risks

**chess.js version drift.** `index.html` pins `chess.js@1.0.0` through the
esm.sh importmap while `package.json` declares `^1.4.0` and `node_modules` has
1.4.0 — the tests and the deployed site run different versions. Survivable for
SAN parsing; not for an interactive board, which leans on
`moves({ square, verbose })`, promotion handling and game-over detection.
Fix `index.html` to 1.4.0 and add a check that the two agree. This is the first
task of the plan, not a footnote.

## Out of scope

Engine (D), empty-notebook start (C), FEN paste / position setup, and in-place
editing of an existing line's moves (B, dropped).
