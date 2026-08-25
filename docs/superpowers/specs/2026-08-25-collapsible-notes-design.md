# Collapsible Notes — Design

**Task:** `df3c5369` — Let the editor collapse note groups and notes as a whole,
matching the collapsible grouping the line editor already has for trie branches.

**Goal:** Make the on-screen **Notes** panel foldable. Anything nested under an
entry — a group footnote's branches, a footnote's own sub-notes — collapses to a
one-line header saying how much is beneath it, and the whole section collapses to
its heading. Everything starts expanded; the panel remembers what you closed for
the rest of the session.

The task annotation calls its sibling "task 23 (table expand/collapse)". Task 23
is the PGN tag editor; the sibling it means is **task 21**, the table's
expand/collapse work.

---

## 1. Scope

Screen only. `.notes` is `display: none` inside the print `@media` block in
`style.css`, and Markdown, PGN and the print report each build their notes
through their own code path (`buildMarkdown`, `buildPgn`, `print.js`'s
`printNotes`). No exported artifact changes shape, and no test covering one
should move.

## 2. `src/notes-view.js`

A new module. It owns the screen Notes panel, which moves out of `src/export.js`
— that file is left with `moveRef`, `branchContext`, `exportBar` and
`buildMarkdown`, one subject instead of three. Indents with **TABS**, matching
`notes.js`, `render.js` and `visibility.js`.

### 2.1 `noteTree(entries)` — pure

Takes `allNotes()`'s entry list and returns the root node. Every node is:

```js
{ key, head, count, kind, rows }   // kind: "branches" | "notes" | "items"
```

`rows` holds child nodes and leaves; a **leaf** is an entry with nothing nested
under it. Only nodes are collapsible, so nothing gains a disclosure triangle it
has no use for.

Three rules build the tree:

| Rule | Becomes a node when | Head |
| ---- | ------------------- | ---- |
| Footnote entry | `foot.children.length \|\| foot.subNotes.length` | the footnote stem |
| Nested foot node | an `.fnode` that itself has children or sub-notes | that node's stem |

Entries are never grouped with one another. Several notes on one move stay
separate numbered rows, each stating its own `moveRef(ply, owner) + " — "`
prefix — grouping them under a shared move header was tried and read worse than
the repetition it saved.

Sub-notes come before branches inside a footnote node, which is the order
`appendFootnote()` already renders them in.

**The header count is recursive.** `tally(rows)` gives each node the number of
rows beneath it *at any depth*, not just its direct children: a group whose
branches carry the commentary would otherwise announce "2 branches" and say
nothing about the notes inside them. The word follows what the subtree contains
— `3 notes` when it is all commentary, `5 items` once any branch is in it —
singular below two.

### 2.2 Keys

`numberNotes()` renumbers every entry on every render (the `remap` pass at the
end of `notes.js`), so `n` cannot key anything that must survive an edit. A key
is a path built from content:

| Level | Segment |
| ----- | ------- |
| root | `notes` |
| entry | `e<ownerIdx>:<ply>:<firstSan>` |
| nested foot node | its sibling index |

`ownerIdx` is the owner line's index in `getCurrent().lines` — the ply alone is
not enough, since two footnotes anchored at the same ply on different lines can
open with the same move. `firstSan` is `foot.moves[foot.d]`'s SAN, or empty for a
footnote with no tail of its own. Segments join with `/`.

A key that does go stale — a line promoted to mainline reorders `lines`, say —
costs nothing: the default is expanded and the state Set records only what the
user **closed**, so a stale key reopens a group. It can never hide a note.

### 2.3 `notesPanel()`

Walks the tree. A node becomes:

```html
<details class="ngroup" open>
  <summary class="ng-head">…head… · 4 branches</summary>
  <div class="ngroup-body">…rows…</div>
</details>
```

with `details.open = !closedNotePaths.has(key)`. A leaf keeps rendering exactly
as it does now — a `.nt` row for a note, `appendFootnote()`'s output for a
footnote with nothing nested.

The section itself is the outermost node: `<details class="notes">` whose
`<summary>` holds the existing `<h3>Notes</h3>` and the two bulk chips. The class
stays `notes`, so the print rule that hides it still matches.

### 2.4 Toggling does not re-render

The `toggle` listener adds or deletes the key and stops. This differs from
`renderTrieNode()` in `trie-view.js`, which rebuilds on every toggle — it has to,
because inline boards appear and disappear with expansion. The notes panel's
nested content is already in the DOM and `<details>` hides it natively, so a
rebuild would be work with no visible effect. It also sidesteps the toggle-loop
guard `renderTrieNode()` needs, because jsdom fires `toggle` when a rebuilt
element is handed `open = true`.

Recording the key still matters: the next full `renderApp()` — from tagging a
line, editing a note, anything — rebuilds the panel from the Set.

### 2.5 Expand all / Collapse all

Two `chip mini` buttons in the section's `<summary>`, matching `markupPanel()`'s
pair. Both call `preventDefault()` and `stopPropagation()` so the click does not
also toggle the section, the way `groupFootChip()` does inside its `<summary>`.

- **Expand all** — `closedNotePaths.clear()`, which also reopens the section if
  the reader had folded it by hand
- **Collapse all** — walk the tree's **rows** with `collectNoteKeys()`, adding
  every key inside the section but not the section's own. Collapse all folds
  what is *in* the Notes list; folding the section too would hide the chip that
  undoes it

Both then call `getRenderHooks().rerenderNotes()`.

## 3. `src/state.js`

```js
// Note groups the user COLLAPSED in the Notes panel. Inverted relative to
// openPaths: notes are a reference list, so everything starts expanded and the
// Set records what was closed. Session-only — never saved with the notebook.
export const closedNotePaths = new Set();
```

Session lifetime, like `openPaths` / `openTablePaths` / `openHiddenPaths`:
survives re-renders, cleared when a notebook is opened or started fresh, gone on
reload. Nothing in `store.js` changes.

## 4. `src/app.js`

A `notesBox` module reference beside the existing `markupBox`, and a
`rerenderNotes()` that rebuilds it in place:

```js
function rerenderNotes() {
  if (!notesBox) return;
  const nb = notesPanel();
  notesBox.replaceChildren(...nb.children);
}
```

registered in the `setRenderHooks()` call alongside `rerenderMarkup`. In-place,
so the left panel's scroll position survives — the same reason `rerenderMarkup`
exists.

`closedNotePaths.clear()` joins `openPaths.clear()` at all three sites that
already call it: the module-level pair near the top of `app.js` (which exists for
the test suite's re-imports), the notebook-open handler, and the PGN-import
handler.

## 5. `src/render.js` seams

Two exports, so the collapsible view reuses the footnote rendering rather than
restating it:

| Export | Content |
| ------ | ------- |
| `footStem(container, foot)` | the inline span: name, moves (via `appendFootMoves`), eval, note. Appends nothing when there is nothing to show, which is the existing `span.childNodes.length` guard. |
| `subNoteRow(s)` | one `.subnote` div for a sub-note |

`appendFootnote()` and `renderSubNotes()` are refactored to call them and keep
their exact current output. `print.js` and the cards path are untouched, and
neither acquires a screen-only mode flag — the reason for a new module rather
than a `{ collapsible }` option on `appendFootnote()`.

## 6. CSS

Every row reserves a `1.6em` left gutter, and a collapsible row draws its
disclosure marker in it via `list-style-position: outside` on the `<summary>`:

```css
.notes,
.notes-body > *,
.ngroup-body > * {
  padding-left: 1.6em;
}
.ngroup-body {
  border-left: 2px solid var(--line);
}
```

So a row's text starts at the same x whether or not it folds, and the arrow
hangs outside the indent rather than sitting ahead of the `[n]`. That one gutter
per level is also what produces the indentation — a child's gutter opens inside
its parent's body, one step further in — and `.ngroup-body`'s border falls
directly under the text of the row it belongs to, the vertical guide `.lgroup`
already gives a trie branch in the editor.

Because the gutter supplies the step, `.fnode` and `.subnote` that are direct
children of a body drop their own `margin-left` and do not step twice. The bare
`.fnode` / `.subnote` rules are unchanged: print and the cards still render
those rows flat and rely on the `em` margin — including the depth-6 behaviour
`render.test.mjs` pins — as do the deeper `.fnode` rows `appendFootNode` nests
inside a branch.

`.ng-head` copies `.lg-head`'s `cursor: pointer` and hover color.

## 7. Testing

New `tests/notes-view.test.mjs`:

- `noteTree`: a lone note stays a leaf; several notes on one move stay separate
  rows; a group footnote becomes a node; a footnote with sub-notes becomes a
  node; nesting recurses into an inner fork; a group's count reaches notes
  buried inside its branches.
- Keys are stable across a rerender that renumbers the notes.
- `closedNotePaths` drives `details.open`.
- Toggling a `<details>` records the key, and closing it does **not** rebuild the
  panel (the same element instance is still in the DOM afterwards).
- Collapse all fills the Set from the tree; Expand all empties it.
- Every note row prints its own move reference.

`tests/export.test.mjs` updates its `notesPanel` import to the new module.
`tests/render.test.mjs` and `tests/print.test.mjs` must pass **unchanged** —
that is the evidence the flat footnote path did not move.

Do not import `src/app.js` with a `?t=` cache-buster in any new test; it hides
most of that module's coverage.
