# Load Progress + UI Polish Design

Date: 2026-08-17

Status: approved (user reviewed design sections in conversation)

## Context

The app is a fully client-side chess PGN → opening theory table builder. Loading a
large PGN or opening a saved workbook runs a synchronous pipeline (parse → collect
lines → `computeShared`/`computeUnique` → render table/cards) inside `renderApp()`.
With hundreds of variations the browser freezes with zero feedback, and the slowest
part is not parsing but a quadratic FEN-replay loop. Separately, the UI has two
rough spots: board diagrams live in a detached overview grid instead of next to
their lines, and the toolbar/line-editor styling feels unfinished.

## Goals

1. Show a progress indicator while a big PGN loads, without fake percentages.
2. Move board diagrams inline next to their line; in grouped view only show them
   inside fully-expanded groups (also a perf win — no SVG building for hidden content).
3. Polish: style the toolbar buttons, make the line editor read as one cohesive
   unit, remove dead CSS/duplicated code.

## 1. Progress indicator + perf fix

### Perf fix (root cause)

`fenAtLine(l, ply)` in `src/app.js` currently calls `fenAt(l.moves, ply)` which
creates a fresh `chess.js` instance and replays the line's whole prefix from move 1
for every (line, ply) pair. `computeShared()` calls it for every move of every line
→ O(sum of line-length²) Chess instantiations. Fix: fill the per-line WeakMap cache
in ONE pass — one Chess instance, replay the line once, record `chess.fen()` at each
ply. `computeShared` then reads cached FENs: linear cost. The cache is keyed by the
line object, which is stable across re-renders, so every interaction (tagging,
symbols, notes — all of which re-run `computeShared`) gets faster, not just load.

Null moves (`--`) are handled by the existing `flipToMove` logic in `pgn.js`'s
`fenAt`; the one-pass replacement must reproduce that behavior: when a line's move
SAN is `--`, load `flipToMove(chess.fen())` instead of `chess.move(...)` before
recording the FEN at that ply.

### Loading overlay

A fixed, full-viewport overlay (spinner + "Loading…") shown only around the slow
synchronous work:

- Show overlay → `await` a double-`requestAnimationFrame` (guarantees the browser
  paints the overlay) → run parse + `renderApp()` synchronously → hide overlay.
- Hooked into the Load & Tag button and `openNotebook()`.
- No chunking, no percentage. After the perf fix, small loads flash the overlay
  sub-frame (effectively invisible); large files show real feedback.
- The existing `pieces.svg` fetch → re-render flow is already async; leave as-is.

## 2. Board diagrams inline with their line

- Delete `renderBoardOverview()` from `src/render.js`, its call site in `viewRoot()`
  (`src/app.js`), and the `.boards` / `figure.board` CSS in `style.css`.
- `lineEditor(l, idx, showBoard)` gains a `showBoard` flag; when true, the row
  renders the line's end-position board inline (`appendBoard(row, l.fen, boardSize)`).
- Flat view: every line (mainline + sidelines + footnotes) passes `showBoard = true`
  when the master toggle is on.
- Grouped (trie) view: `renderTrieNode` threads an open-chain flag — a line's board
  renders only when every ancestor group is open. The `<details>` toggle handler
  (currently only updates `openPaths`) additionally re-renders, so opening a group
  builds its boards and closing removes them. Collapsed groups build no board SVGs.
- The existing "Board diagrams" checkbox becomes the master toggle for inline
  boards, default off (unchanged from today). The 220/300/400 size chips still apply.
- Cards/print view and the selected-move board inside `movePanel`: unchanged.

## 3. Paint

- **Toolbar:** `New / Import` and `Save` are plain unstyled `<button>`s. Give the
  toolbar real structure: Save as a filled primary button, New/Import as a
  secondary chip; consistent height and spacing with the name input.
- **Line editor cohesion:** `.ledge` becomes a contained card — a header row
  (name input + tag chips + promote/mainline label), with the moves strip and the
  note input visually grouped inside the card (subtle border, background, rounded
  corners). `movePanel` renders as part of its line's card. Note input reads as
  attached to its line.
- **Cleanup:** delete dead CSS (`.lmoves`, `.le`, `.symbols`, `.addbar`, `.preview`),
  remove the duplicated `@media (max-width: 1000px)` block, dedupe the doubled
  `moveRef` comment in `src/app.js`. Keep both light/dark themes consistent.

## Out of scope

- Cards/print view layout and its per-card board options (`showFinalBoard`,
  `showFirstDivBoard`) — unchanged.
- Import screen redesign — not requested.
- Real percentage/chunked async rendering — explicitly rejected in favor of the
  perf fix + honest indeterminate indicator (option A).

## Testing

- `npm test` (existing node --test suite) must stay green.
- Manual: load a many-variation PGN → overlay appears only if render is slow;
  boards inline per line in flat view; grouped view builds boards only inside
  expanded groups (toggle on); toolbar buttons styled; line editor reads as a unit.
