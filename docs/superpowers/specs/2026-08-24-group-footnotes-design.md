# Group Footnotes Design

Date: 2026-08-24

Status: approved (design sections reviewed in conversation)

## Context

Sub-project **B** of the five-task cluster tracked in taskwarrior under project
`chess-pgn-reports`, following the footnote-as-note work
(`2026-08-22-footnote-as-note-design.md`). That sub-project made a footnote line
render as a numbered note anchored on its parent line's move. This one lets a whole
*group* of lines — a node in the trie the editor already groups by — be one footnote:
one `[n]` marker on the parent, one note, and the group's lines rendered inside it as
an indented list.

It blocks task 23 (hide/disable a line or a group), which needs the same
group-as-a-unit handling.

Two seams were left in place for this work and are used here:

- `parentOf` in `src/notes.js` carries a "Group-footnote seam" comment saying a group
  needs the parent computed from the trie node the lines share rather than one line.
- `grid()` keeps `footNotes` (`src/table.js`) as the structural output of the
  foot/sideline split, noted as being for this follow-up.

## Goals

1. A trie node whose lines are all tagged Footnote renders as **one** numbered note,
   anchored by a single `[n]` on the parent line's move at the divergence.
2. The note renders as a shared stem followed by an indented, nested list of the
   group's branches, mirroring the trie's shape.
3. Labels alternate by nesting depth — numbers, letters, numbers, letters — for
   arbitrary depth.
4. It works identically on all four surfaces: screen notes panel, print notes block,
   print cards, Markdown.

## Non-goals

- **No new persisted state.** A group is derived from the hierarchy: a node is a
  group when every leaf under it is `tag: "foot"`. No group id on lines, no set of
  trie keys, no migration, no changes to `src/store.js` or `src/state.js`.
- **No group-level name/evaluation inputs.** Names and evals stay per line.
- **No compact/parenthesized rendering mode.** Considered and dropped: the indented
  list is always used, so there is no toggle and no second code path.
- **No hidden/disabled lines** (task 23) and **no PGN-writer changes** (task 22).

## 1. Modules

`src/tree.js` gains `buildTrie(lines, main)`, `leavesOf(node)` and `countLeaves(node)`,
moved verbatim out of `src/trie-view.js`, which re-imports them. They are pure graph
code with no DOM and no state, but `trie-view.js` imports `render.js`, `state.js` and
`print.js`, so `notes.js` cannot reach them where they currently live. `tree.js` is
already the pure line/divergence module and is the natural home.

`src/foot-groups.js` (new) owns grouping:

```
footGroups(lines, main) -> { groups, grouped }
```

It builds the trie over foot-tagged non-main lines only, walks it top-down, and takes
each **maximal node whose leaves are all foot-tagged**, requiring at least two leaves.
Each group is:

```
{ members: [line], stem: [{ply, san}], tree }

tree = { moves: [{ply, san}], line, children: [tree] }
```

`stem` is the moves every member shares: the node's own move and its single-child
chain down to the first fork. `tree` is the group's shape below the stem — each node
carrying its own move run, its `line` if it is a leaf, and its children. It is
undecorated: no labels, no depths, no note maps. `notes.js` decorates it (§2, §4),
because labelling and numbering are its job, not this module's.

`footGroups` does not compute the divergence index against the parent line: it does
not know the parent. `notes.js` computes that after `parentOf` (§3).

`grouped` is a `Set` of member lines, so `notes.js` can tell which foot lines a group
already speaks for and leave the rest as today's lone footnotes.

A line that ends where others continue past it — its moves are a prefix of its
siblings' — is demoted to a moveless child (`moves: []`) of the node it ends on, so
that a node is strictly one of two things: a leaf carrying a line, or a fork carrying
children. A node that was both would silently lose either its line's name and
commentary or its children, since `notes.js` and the renderers branch on exactly that
dichotomy. This applies at every depth, the stem included.

A node with one leaf is never a group. Such a line stays exactly the footnote it is
today, lettered sub-notes and all.

This is a separate module rather than more code in `notes.js` (already ~150 lines
owning numbering, dedupe, parent-finding and sub-lettering) or in `grid()` (which
calls `numberNotes`, so the dependency would run backwards). It takes plain line
arrays and returns plain data, so it is testable with no DOM.

## 2. Entry shape

A group is **one** entry in the numbered list, reusing the `foot` branch every
renderer already tests for, with a recursive `children` tree added:

```
{ ply, owner, n, foot: {
    moves: stem, d, marks, noteByPly,   // moves shared by the whole group
    depth: 0,
    children: [ node ]
} }

node = { label, depth, moves, d, marks, noteByPly,  // tail from the parent node
         name, eval, note, subNotes,                // leaf only (a real line)
         children }                                 // internal fork only
```

`notes.js` walks the `tree` from `footGroups` and produces this decorated form,
assigning `label`, `depth` and `noteByPly` as it goes.

An **internal** node is a shared continuation with no line behind it: it carries moves
and children, but no name, eval or note, because nothing owns them. A **leaf** node is
one member line and carries that line's name, eval, note and its own notes. A leaf's
own notes sit at `depth + 1` and are labelled by the same function as everything else.

`foot.children` absent means a lone footnote, unchanged from the previous design.
Renderers branch once more, on `children`.

Structured data, not a pre-rendered string, for the same reason the previous design
gave: four renderers consume notes and each formats moves in its own medium.

## 3. Anchoring

A group anchors the way a single footnote does, with `parentOf` run on the group's
**stem** instead of on one member line: the non-foot line sharing the longest move
prefix with the stem wins, the mainline breaking ties. Foot-tagged lines stay excluded
as candidates, since `grid()` pulls them out of the table and a note anchored on one
would have no row or card to render on.

The `[n]` lands on the parent's move at the divergence ply, falling back to the
parent's last move if the group runs past its end — the existing `anchorPly` rule,
unchanged. One marker for the whole group.

## 4. Numbering and labels

The group takes one number from the global sequence and is ordered by anchor ply along
with every other entry, under the existing reading-order renumbering pass.

`labelFor(depth, i)` in `src/notes.js`:

- depth 0 — the global `[n]`;
- odd depth — bijective base-26 letters, the existing `subLabel`;
- even depth ≥ 2 — `1, 2, 3 …`.

Each sequence restarts within its parent, so `[3] → a) → 1. → a) → 1.` for as deep as
the structure goes. Only depth 0 participates in global numbering and in the remap
pass; everything below is local. Writing a note nested five levels inside a group can
therefore never renumber a table marker.

A note a member shares with a **non-foot** line still stays a global numbered note the
member references by its `[n]`. That rule is unchanged from the previous design and
applies at every depth.

## 5. Rendering

`appendFootnote(container, foot)` in `src/render.js` keeps emitting the stem inline as
it does today, then, when `foot.children` is present, appends one indented
`<div class="fnode d1|d2|…">` per child: the label as a `<sup>`, the child's moves
through the same move-emitting helper (so marks and note superscripts keep working),
then name, eval and note for a leaf. It recurses into grandchildren and into a leaf's
own notes.

The four consumers change by inheriting this:

- screen notes panel (`src/export.js:60`),
- print notes block (`src/print.js:126`),
- print cards (`src/render.js:436`, plain-text rows),
- Markdown (`src/export.js`).

`footnoteText` and `subNoteLines` grow the same recursion for the two text-only
surfaces, indenting by depth.

`style.css` gets one indent-per-depth rule shared by screen and print.

The table is unaffected by design: every member is foot-tagged, so `grid()` already
pulls them all out, and the single `[n]` is the only trace the group leaves in the
table.

## 6. Editor UI

`renderTrieNode` (`src/trie-view.js`) adds a `Footnote` chip to a group's `<summary>`,
on nodes with at least two leaves. Its state is read from the leaves:

- every leaf foot-tagged — `on`;
- some — `partial`, rendered dimmed;
- none — off.

Clicking sets `tag: "foot"` on every leaf, unless all of them already have it, in
which case it clears all, then calls `renderApp()`. The per-line chips keep working
untouched; a group forms or dissolves purely as a consequence of its leaves' tags.

## 7. Testing

Test-driven, red first, per the project's usual flow.

`tests/foot-groups.test.mjs` (new), over plain line arrays with no DOM:

- maximal-node selection when a whole subtree is foot-tagged;
- a partially-tagged node does not group;
- nested inner forks produce nested children;
- stem extraction down a single-child chain;
- a single foot line is not a group.

`tests/notes.test.mjs`:

- one entry per group, with one marker on the correct parent line and ply;
- label alternation by depth;
- adding a deeply nested note does not renumber global notes;
- a note shared with a non-foot line stays global.

`tests/render.test.mjs`, `tests/print.test.mjs`, `tests/export.test.mjs`: the nested
output on all four surfaces.

`tests/line-editor.test.mjs` / `tests/app.test.mjs`: the chip's three states and its
all-or-nothing toggle.

Note the existing pitfall: do not import `src/app.js` with a `?t=` cache-buster in new
tests.
