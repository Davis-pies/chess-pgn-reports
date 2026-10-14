# Train: show what went wrong on a wrong name or move

Davis (2026-10-14): more detailed feedback on a wrong move order or wrong
name; compare positions visually, highlight the differences. Agreed design:

- Wrong name: the asked position and the picked name's position side by
  side, differing squares highlighted on both; "Najdorf 5...a6 ·
  Scheveningen 5...e6" (where their move orders part); the picked one's own
  note.
- Wrong move (order and book): your move as a red arrow, the right move(s)
  green; "That leads to the <name>" when your move follows a named
  variation's order, else "Not in this workbook"; the note on the right
  move; for order questions, the full order with the part still to play
  marked.
- No piece-control maps (too noisy).

Branch `train-mode`. Tabs in `src/*.js` Train files and `board-input.js`
(check), two spaces in `style.css`. Each task: read ONLY the functions and
files named (use grep -n and sed -n ranges), not whole large files.

Checks per task: `npm run check > /tmp/check.txt 2>&1; echo $?` must be 0
(grep the file for "not ok" / "error" when it is not). Commit with the
subject given, a blank line, then
`Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Stage only the
files changed. Never push, merge, amend; never read ~/Documents.

---

### Task 15: helpers (`src/board-input.js`, `src/train.js`, tests)

1. `drawArrows(wrap, arrows, group = "an-arrows")` in `src/board-input.js`:
   the `<g>` it removes and creates has class `group` (so Train's feedback
   arrows in group "tr-feedback" survive the engine's repaint, which uses
   the default). Each arrow may have `tone`: when given, the arrow `<g>`
   gets class `an-arrow ${tone}`. Existing callers unchanged.
   `style.css`, next to `.an-board .an-arrow line` (around line 1752):
   `.an-board .an-arrow.bad line { stroke: #c0392b; }` and
   `.an-board .an-arrow.bad polygon { fill: #c0392b; }`.
2. `src/train.js` (it already imports Chess, fullmoveLabel):
   - `export function positionDiff(fenA, fenB)`: the squares ("e6") whose
     piece (type and colour, or empty) differs, from `new Chess(fen).board()`.
   - `export function divergence(a, b)`: for two variation nodes (tree
     nodes have `orders` arrays of SAN and `name`), the first index `at`
     where `a.orders[0]` and `b.orders[0]` differ; returns
     `{ a: fullmoveLabel(at) + a.orders[0][at], b: same for b }`, a missing
     move as "" (one order is a prefix of the other).
   - `export function leadsTo(tree, sans)`: among `tree.byKey.values()`,
     the variation with the shortest order (any of its `orders`) that
     starts with all of `sans`; its `name`, or null.
3. Tests in `tests/train.test.mjs` (reuse its PGN/tree helpers): each
   helper, including a prefix case and null for leadsTo; and in the
   board-input tests (find with `grep -ln drawArrows tests/`): a second
   group survives a default-group redraw, `tone` sets the class.

Commit: "Add the helpers Train's feedback compares positions with"

### Task 16: wrong name (`src/train-view.js`, `style.css`, tests)

In `questionScreen` (grep `pickName`): a wrong pick stores the picked
name on `ui.answered` (e.g. `picked`). When answered wrong on a name card
and the picked name is a variation in `tree` (find by `name`), the result
box gets `div.tr-compare`: two figures, each a board picture at BOARD/2
(reuse the picture-board helper train-view already has; grep `_geom`) with
a caption (`"Asked: <name>"`, `"You said: <name>"`), the squares from
`positionDiff` getting class `diff` on their `rect[data-sq="…"]` in both
boards; then `p.tr-diverge` `"<asked name> <divergence.a> · <picked name>
<divergence.b>"`; then the picked variation's own note (its name card's
`notes` filtered by `own`, as `p.tr-note`). Typed answers that match no
variation get no comparison. CSS: `.tr-compare { display: flex; gap:
.8rem; flex-wrap: wrap; }`, figure margin 0, caption small/muted,
`svg rect.diff { fill: #e5b84f; }` and a darker shade for dark squares if
the light one is unreadable (look at how `.an-board rect.last` does it).
Tests in `tests/train-view.test.mjs`: wrong choice → two boards, diff
squares marked in both, divergence text, picked note; right answer → no
`.tr-compare`.

Commit: "Compare the position with the name picked on a wrong Train answer"

### Task 17: wrong move (`src/train-view.js`, `style.css`, tests)

In `questionScreen`, order cards (grep `orderStep`) and book cards (grep
`checkBook`): on a wrong move keep `{ played: the moves before it, san }`
on `ui.answered`. When answered wrong:
- the answered board (a picture board) shows, via `drawArrows(board, …,
  "tr-feedback")`, the wrong move with `tone: "bad"` and each right move
  (order: `step.accepted`; book: `card.moves`) without tone; from/to
  squares from `new Chess(fen).move(san)` on the position before the move.
  The answered board must be the position BEFORE the wrong move.
- `p.tr-leads`: `That leads to the ${name}` from
  `leadsTo(tree, [...played, san])`, else `Not in this workbook`.
- order cards: `p.tr-order`: the variation's first order as numbered moves
  (`movesText`-style, reuse `numbered` in train-view) with the moves from
  the miss on in a `<mark>`.
- the note on the right move: order cards, `card.notes` with `at ===
  played.length`; book cards already show their notes.
Tests: wrong order move → arrows group `tr-feedback` with one `.bad`,
leads text (a move that follows another variation, and one that does not),
the order with a `<mark>`; wrong book move → arrows and leads; right
answers → none of these.

Commit: "Show the right and wrong moves on a wrong Train move"

### Task 18 (main session): docs, e2e, review

User guide Train section; one e2e for each; screenshots.
