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
| multi-leaf, open | its branch column, `▾` and shared moves only, clicking it folds that level — then each child by this same rule |

**An open group keeps a column of its own, and it is the group's only control.**
This was tried without one first, hanging the fold on the line columns instead,
to save the table width a header per open level costs. That is unsound: a group
whose children are *all* branches has nothing but shut stubs beneath it, and a
stub's click opens rather than closes, so the group could not be folded at all
short of Collapse all. The column is what guarantees every open level has a way
back.

It carries **no line count while open** — the lines it would count are on screen
beside it, and a count repeated down every open level is what made the first
version read as clutter. Shut, the count is the whole point: it says how much is
folded away.

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
branches, which must still be foldable.

One fix falls out of writing those: `openTablePaths` was cleared only at module
load, so opening a notebook or importing a PGN carried the previous notebook's
open branches over. Its keys are move paths, so an unrelated notebook sharing a
path opened branches nobody asked for. It now clears alongside `openPaths` and
`closedNotePaths` at both reset sites in `app.js`.
