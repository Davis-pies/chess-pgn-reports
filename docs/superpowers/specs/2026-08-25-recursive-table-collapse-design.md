# Recursive Table Collapse — Design

**Task:** `878763a0` — Make table expand/collapse iterative/recursive, matching
the grouped view in the editor.

**Goal:** Expanding a branch in the table preview reveals its immediate children
— each one a column or a branch of its own — instead of exploding straight to
every leaf. Folding works the same way, one level at a time.

---

## 1. What is wrong today

`renderTrieTable` in `src/trie-view.js` handles only the top level of the trie.
A top-level branch is one of three things:

- one leaf → that line's column
- multi-leaf, closed → a single `▸ N lines` stub of its shared continuation
- multi-leaf, open → **every** leaf column at once, each clickable to fold the
  whole branch back

So a 106-line branch is either one stub or 106 columns, with nothing in between,
while the editor's grouped view nests at every level. The intermediate structure
that already exists in the trie is unreachable from the table.

## 2. The rule

One function decides a node's contribution to the column list, and calls itself
for the children:

| Node | Columns |
| ---- | ------- |
| one leaf | that line's column, with **no** control |
| multi-leaf, shut | its branch column, `▸ N lines`, clicking it opens one level |
| multi-leaf, open | the same branch column, `▾`, clicking it folds that level — then each child by this same rule |

**An open group keeps a column of its own, and it is the group's only control.**
This was tried without one first, hanging the fold on the line columns instead,
to save the table width a header per open level costs. That is unsound: a group
whose children are *all* branches has nothing but shut stubs beneath it, and a
stub's click opens rather than closes, so the group could not be folded at all
short of Collapse all. The column is what guarantees every open level has a way
back.

**Its header is the same in both states.** Opening a group turns its arrow and
changes nothing else. Dropping the line count on open was tried, to keep the
column lean, and read as the column having been *replaced* rather than opened —
the identity a reader had just clicked on disappeared from under them. The
shared moves live in the cells; the header says how many lines are under them,
open or shut, exactly as the editor's group summary does.

Line columns carry no fold. One click therefore closes exactly one level, where
the old code hung the *top* branch's fold on every expanded column and dropped
however many levels the reader had opened.

**Single-child chains are inlined.** `sharedMoves()` already walks a node's
single-child chain to build the column, so opening jumps to the first real fork
rather than revealing one pointless level per shared move. `forkOf(node)` walks
that same chain, and the recursion runs over the fork's children plus its own
leaf, when a line ends exactly there. Together these mean an open group never
renders a single child: the fork has at least two things under it.

## 3. `pushNode(node, vars)` and `branchVar(node, open)`

`pushNode` replaces the three-branch loop in `renderTrieTable`. `branchVar` is
`collapsedVar` renamed, plus the `open` parameter that decides `collapsed`, the
name, and which way the click goes.

No change to `src/render.js`. `varHead` already gives a clickable non-collapsed
column a `▾` cue and the "collapse branch" title; the old code simply never
produced one, because it hung `onclick` on the expanded leaf columns instead.

## 4. Expand all / Collapse all

Unchanged. `collectKeys` already walks the whole trie, so Expand all opens every
level and Collapse all empties the set. A single-leaf node's key in that set is
inert, since the one-leaf case is decided before the set is consulted.

`focusLines()` keeps calling Expand all's logic, so focusing still shows the
focused lines rather than a stub of them — now with their group columns around
them.

## 5. Testing

`tests/app.test.mjs`'s "table preview: mainline always visible, branches
collapsed by default" pins the old shape and is updated: expanding a two-line
fork now yields **one** clickable non-collapsed column (the group) rather than
two (the lines), and it is that column which folds the branch again.

New coverage: a three-level tree where opening the outer branch shows an inner
branch still shut, opening that inner one shows its lines, and folding the inner
group leaves the outer one open; that an open group's column shows no line
count; and — the case that put the column back — a group whose children are all
branches, which must still be foldable; and that opening a group leaves its
header text alone.

One fix falls out of writing those: `openTablePaths` was cleared only at module
load, so opening a notebook or importing a PGN carried the previous notebook's
open branches over. Its keys are move paths, so an unrelated notebook sharing a
path opened branches nobody asked for. It now clears alongside `openPaths` and
`closedNotePaths` at both reset sites in `app.js`.

---

## 6. Showing what a fold will take

Nesting is only usable if a reader can see, before clicking, which columns a
`▾` will fold. Indentation is the editor's answer, but a table has no indent to
give: every column starts at ply 0.

So the block is **tinted**. `pushNode` carries a `depth`: an open group and
everything beneath it share one value, a shut branch inherits whatever block
encloses it, and a group nested inside another takes the next value up.
`render.js` turns that into `grp g1`/`grp g2` on the cells and header — two
shades alternating by depth, so a nested block separates from its parent — plus
`grp-start` on the group's own column, which draws the edge the block begins at
(a left border in the horizontal layout, a top border in the vertical one).

Two shades rather than one per level: the tint is a quiet cue, and a scale of
five ever-darker greys would compete with the moves for attention while still
running out at depth six.

## 7. An open group's column is the block's prefix

Once a group's column is on screen carrying the shared moves, every line under
it repeating those same moves is noise — and worse, it pushes each line's own
continuation to the right of a run of cells the reader has already read.

So `elide(v, cut)` rewrites a line's cells at or before the group's fork ply
into the same `…` the mainline prefix already uses. Columns still start at ply
0 and rows stay aligned; the line simply begins where its group left off. While
the group is *shut* there is no column carrying those moves, so nothing is
elided and the line spells its whole divergence out as before.

Two details:

- A line that ends exactly at the fork would be elided to nothing, and an empty
  column reads as a bug rather than as "this line stops here". Its last move
  stays.
- Note markers are not moved. Rows are plies, so a `[n]` left on an elided cell
  still sits at the move it annotates.

**None of this reaches the printed report.** Grouping, tinting and elision all
live in `pushNode`, which only `renderTrieTable` calls. `appendPrintTables`
builds from `grid()` directly, so the PDF still prints every line's full
divergence from the mainline, with no stubs, shading or fold controls —
`tests/print.test.mjs` pins that with the preview's branches deliberately left
open.
