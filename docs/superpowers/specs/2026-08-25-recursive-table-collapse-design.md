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
| multi-leaf, closed | its branch column, `▸`, clickable to open |
| multi-leaf, open | its branch column, `▾`, clickable to close, then each child by this same rule |

**An open group keeps a column of its own.** It holds the moves its lines share
and it is the only control in the group, which is what makes a click fold
exactly one level: leaf columns are never clickable, so there is no way to
collapse three levels by clicking the wrong thing. It is also the table's
equivalent of the editor's `<summary>` — a group is a row you can see and act on
whether it is open or shut.

**Single-child chains are inlined.** `sharedMoves()` already walks a node's
single-child chain to build the header, so expanding jumps to the first real
fork rather than opening one pointless level per shared move. `forkOf(node)`
walks that same chain, and the recursion runs over the fork's children (plus its
own leaf, when a line ends exactly there).

Together these mean an open group never renders a child that is its only child:
the fork it recurses into has at least two things under it.

## 3. `branchVar(node, open)`

Replaces `collapsedVar(node)`. Same synthetic column as today — the shared
continuation in its cells, `…` before its divergence, `N lines` for a name — with
two differences:

- `collapsed: !open`, so an open group renders `▾` and "collapse branch"
- `onclick` toggles `openTablePaths` in whichever direction the node is not

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
branch still shut, opening that inner one shows its lines, and clicking the
inner group column folds only that level, leaving the outer one open.
