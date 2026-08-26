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
| one leaf | that line's column, clicking it folds the group it sits in |
| multi-leaf, shut | its branch column, `▸ N lines`, clicking it opens one level |
| multi-leaf, open | no column of its own — each child by this same rule |

**An open group has no column of its own.** A header column was tried and
dropped: the editor can afford one per group because a group there costs a row,
while here it costs a column at every open level, repeating the prefix its own
children already spell out. Table width is the scarce thing.

**So the fold lives on the line columns.** Each column carries the fold of the
nearest open group it sits in, which is what keeps a click to exactly one level
— the old code hung the *top* branch's fold on every expanded column, so one
click dropped however many levels the reader had opened. A shut branch's own
column still opens it; that is the one control that is not a fold.

**Single-child chains are inlined.** `sharedMoves()` already walks a node's
single-child chain to build the stub, so opening jumps to the first real fork
rather than revealing one pointless level per shared move. `forkOf(node)` walks
that same chain, and the recursion runs over the fork's children plus its own
leaf, when a line ends exactly there. Together these mean an open group never
renders a single child: the fork has at least two things under it.

## 3. `pushNode(node, vars, fold)`

Replaces the three-branch loop in `renderTrieTable`. `fold` is the handler for
the nearest enclosing open group, absent at the top level. `collapsedVar` is
renamed `branchVar` and otherwise unchanged — it is only ever built for a shut
branch now.

No change to `src/render.js`. It already draws a clickable column with the right
cue and title in both states.

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
branch still shut, opening that inner one shows its lines, and clicking the
inner group column folds only that level, leaving the outer one open.
