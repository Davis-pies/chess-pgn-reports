# Table Context Menu — Design

**Goal:** Right-clicking a move in the table opens a menu that acts on that move
and that line, without leaving the table.

---

## 1. Why

Every way to act on a line lives in the editor panel: tag it a footnote, hide
it, focus it, promote it, annotate one of its moves. The table is where the
reader actually is — it is the thing they are reading — and acting on what they
see means finding the same line again in a panel beside it, which for a deep
group means opening the editor's trie to match.

## 2. Trigger

**`contextmenu` on a move cell.** Not a left-click: left-click traces, which is
the gesture a reader uses constantly while reading and should stay instant. The
`contextmenu` event is also what the keyboard Menu key and Shift+F10 fire, so
the menu is reachable without a mouse on any cell — and the cells are already
focusable from the trace work.

A line column's header carries a `⋮` button opening the line half of the same
menu. It is the discoverable affordance for a gesture that is otherwise
invisible, and the header has no move to offer.

The browser's own menu is suppressed on cells that open ours, and nowhere else.

## 3. Scopes

| Right-click on | Sections |
| --- | --- |
| A **line** column's move cell | the move, then the line |
| A **group** column's move cell | the group only |
| A **line** column's header (or its `⋮`) | the line only — a header has no move |
| A **group** column's header | the group only |

Right-click never folds. Folding stays on the left-click the `▸`/`▾` advertises,
so the two gestures on a group header do different, predictable things.

**Move section** — the symbol row and the note editor for that ply, headed the
way `movePanel` heads it (`@ 10…Bh6 · 2 shared`).

**Line section** — Make mainline · Move to footnote · Focus · Hide.

**Group section** — Move to footnote · Focus · Hide, over every line under the
group. No Make mainline: a group is not one line. No move section either — the
moves in a group's column belong to all of its lines, and the editor's group
chips have never offered per-move annotation for the same reason.

The mainline column offers no Hide, Focus, Make mainline or footnote controls,
matching `lineEditor`, which renders none of them for `isMain` — the mainline is
the table's reference row and `setHidden`/`solo` refuse it at the primitive.

## 4. One implementation, not two

The menu **embeds the editor's own components**. A symbol set from the menu runs
`movePanel`'s `apply()`; a note typed there runs `commentEditor`'s `writeAll()`,
including the rule that annotating a shared move annotates every line reaching
that position.

- `commentEditor(ply, lines)` is already exported from `line-editor.js` and is
  used as is.
- The symbol row is currently inline in `movePanel`. It is extracted as
  `symbolRow(ply, lines, cur)` and exported, and `movePanel` then calls it — so
  the editor panel and the menu are the same code, and the extraction is
  verified by the editor's existing tests continuing to pass. It shows every
  glyph on one wrapping row; the "More symbols" drawer it used to hide two
  thirds of them behind is gone, since 25 glyphs wrap to about three short rows
  and that is cheaper to scan than remembering what is behind a fold.
- Enter in the add-note field saves, in both surfaces at once — routed through
  `add.click()` so it is the same dispatched event a real click is, which is
  what the menu's rebuild listens for.
- Line actions call `promoteMainline`, `setHidden`, `focusLines` and the same
  `l.tag` toggle the Footnote chip uses.
- Group actions call the same primitives over `leavesOf(node)`.

**No board.** `movePanel` draws the position; a board inside a popup makes it a
window rather than a menu, and the editor panel is one click away.

**Borrowing a component across flex directions costs one reset.** `.cedit` is
`flex: 1 1 300px`, sized for `.movepanel`, a ROW flex container, where that
reads "at least 300px wide, take any leftover width". The menu stacks its
children, so on a vertical main axis the same declaration is a 300px-tall floor
that then grows — one note field claiming the height of the whole menu and
pushing the line actions off the bottom. `.tmenu .cedit { flex: 0 0 auto }`,
and the same for `.sympick`/`.symmore`.

## 5. Getting from a cell to a line

Table vars are not line objects: `grid()` builds `{tag, name, moves, marks, …}`
from each line. The menu mutates lines, so `grid()` carries `line: l` on every
var it emits. A group's lines come from `leavesOf(node)` → `.line`.

This is a back-reference only. `store.js` saves lines, never vars, and the card
and print renderers read named fields, so nothing else sees it.

## 6. The menu element

A new module, `src/table-menu.js`:

```js
openTableMenu({ x, y, target })   // target: { v, ply } or { node, leaves }
closeTableMenu()
```

- One menu in the document at a time; opening closes any other.
- **It rebuilds itself after an edit made inside it.** The menu hangs off
  `document.body`, outside the app's view root, so the `renderApp()` every edit
  triggers rebuilds the table and the editor panel *underneath* it and leaves
  the menu showing the state it was opened with — a symbol picked from here
  stayed unlit, a note added stayed missing. `movePanel` gets this free by
  living inside the root. Rebuilt on the same element so the menu neither jumps
  nor loses its listeners, and only for buttons inside the borrowed components:
  the note field writes on `input` and rebuilding mid-keystroke would steal
  focus, and the line actions close the menu rather than update it. The scroll
  position survives the rebuild.
- Positioned at the cursor, then nudged back inside the viewport so a
  right-click near an edge does not open off-screen.
- Closes on: an action, `Escape`, a click outside it, and a scroll of the table.
- Focus moves into the menu on open and returns to the cell on close.
- Rebuilt from scratch each open, so it never shows stale state.

Actions that change the notebook call `renderApp()` through the render-hooks
registry, exactly as the editor's chips do.

## 7. Testing

- **`tests/table-menu.test.mjs`** — sections per scope; the mainline's reduced
  set; a group's set; each action mutating the lines; Escape and outside-click
  dismissal; the viewport nudge.
- **`tests/line-editor.test.mjs`** — unchanged, and passing, is what proves the
  `symbolRow` extraction did not change the editor.
- **`tests/trie-view.test.mjs`** — left-click still traces and does not open a
  menu; a group header still folds.
- **`tests/print.test.mjs`** — no menu handlers reach the printed report.

## 8. Bulk hide/show in the table

The editor's "Lines: Hide all / Show all" pair is mirrored into the table's own
controls row, beside Expand all / Collapse all. The table is where a reader
decides a line is in the way; making them cross to the editor to act on that was
the same gap the menu closes. Both call `hideAll`/`showAll`, which refuse the
mainline at the primitive.

## 9. Out of scope

- No multi-select (acting on several lines at once).
- No drag to reorder.
- No board in the menu.
- No renaming a line from the menu — the name field is the editor's.
