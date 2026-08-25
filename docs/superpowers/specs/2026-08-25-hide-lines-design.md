# Hide/Disable Lines — Design

**Task:** `830a6b6a` — Add hide/disable for a line, applicable to a whole group
too, with a hide/show all toggle; hidden lines drop out of the editor, table and
every export.

**Goal:** Let a line — or a whole trie group — be marked hidden. Hidden lines
leave the table, the print view, the Markdown export and the PGN, and move out
of the main editor list into a collapsed drawer from which they can be brought
back individually or as a group.

---

## 1. Data model

`l.hidden === true` marks a line hidden. It is orthogonal to `l.tag`: a footnote
can also be hidden, so hidden is never expressed as a tag value.

An absent property means visible. Clearing hidden **deletes** the property rather
than writing `hidden: false`, matching the existing rule in `line-editor.js`'s
`apply()` that a cleared mark is always a delete, never a falsy value that
lingers in the saved notebook.

`l.isMain` is never hidden. The mainline is `grid()`'s reference row and every
sideline's cells are computed as a divergence from it, so hiding it would not be
one row disappearing — it would redefine the whole table. The writers in
`visibility.js` enforce this, so no caller can route around it.

## 2. Persistence

Hidden state rides the existing per-line `tags` array in `store.js:saveNotebook`,
which is already keyed by `keyFor(l.moves)`:

```js
tags: lines.map((l) => ({ key, tag, name, meta, marks, comments,
                          hidden: !!l.hidden }))
```

It is restored in the `// re-apply tags` block of `openNotebook()` in `app.js`:

```js
l.hidden = !l.isMain && !!t.hidden;
```

Notebooks saved before this field existed have no `hidden` key and read back as
visible, matching the `view.showBoards ?? …` fallback style already used for
notebooks predating the `view` object.

PGN does not carry hidden state and does not carry hidden lines at all. Per the
decision recorded on task `a3f4f9db`, PGN export is deliberately lossy and
`store.js` is what preserves line state; a hidden line is therefore absent from
an exported PGN and does not return on re-import. This is accepted: localStorage
is the archive, PGN is a publishing format.

## 3. `src/visibility.js`

A new pure module. Indents with TABS, matching `table.js`, `foot-groups.js` and
`nags.js`.

| Export | Behaviour |
| --- | --- |
| `visibleLines(lines)` | `lines.filter((l) => !l.hidden)` |
| `hiddenLines(lines)` | `lines.filter((l) => l.hidden)` |
| `setHidden(targets, on)` | per line: `isMain` is a no-op; `on` sets `l.hidden = true`; otherwise `delete l.hidden` |
| `hideAll(lines)` | hide every non-mainline line |
| `showAll(lines)` | unhide every line |
| `solo(all, keep)` | hide every non-mainline line not in `keep`; unhide every line in `keep` |
| `hiddenState(leaves)` | `"all"` \| `"some"` \| `"none"`, for the tri-state group chip |

`setHidden` and `solo` are the only writers and both refuse `isMain`, so §1's
mainline rule lives in exactly one place. Every export is a pure function over a
line array and is testable without a DOM.

`solo` unhides the lines it keeps: "hide all except this" implies this one is
visible, including when the target is a group whose members were themselves
hidden.

## 4. Consumers

Hidden lines are filtered at each consumer's own entry point rather than at a
single seam, because the consumers are independent entry points — `buildPgn` is
called straight from the export bar and `allNotes()` reads state itself, so
neither passes through `grid()`.

| File | Site | Change |
| --- | --- | --- |
| `table.js` | `grid()` | filter at the top, before the `isMain` lookup and before `numberNotes` |
| `pgn-out.js` | `buildPgn()` | `visibleLines(state.lines \|\| [])` |
| `notes.js` | `allNotes()` | wrap `getCurrent().lines` |
| `line-editor.js` | `moveStrip()` | wrap the `numberNotes` argument |
| `app.js` | editor `buildTrie` | visible lines, plus a second trie over `hiddenLines()` for the drawer |

Filtering at the top of `grid()` covers the table, the print view and the
Markdown export in one place, since all three read `grid()`'s output.

Two consumers deliberately need no change:

- `foot-groups.js` — `numberNotes` calls `footGroups(lines, main)` with the
  array it was given, so filtering upstream reaches footnote lettering for free.
  A hidden member drops out of its group, and a group reduced below two members
  stops being a group, which is correct.
- `print.js` — looks lines up by identity against `grid()`'s already-filtered
  output, so it can only ever resolve visible lines.
- `app.js:computeShared()` — deliberately keeps the FULL line list, so that a
  note added at a shared move still reaches hidden lines. See §7.

Because filtering happens before `numberNotes`, hidden lines consume no `[n]`
note numbers and no footnote letters, as the task requires.

## 5. Editor UI

**Per line.** `[Hide]` and `[Solo]` chips in `lineEditor`'s `tags` div, inside
the existing `else` branch, so they are absent on the mainline exactly as
`★ Make mainline` already is.

**Per group.** A tri-state `[Hide]` chip and a `[Solo]` chip in
`renderTrieNode`'s `<summary>`, beside `groupFootChip` and under the same
`count > 1` guard. Both call `e.preventDefault()` and `e.stopPropagation()` so
the click does not also toggle the `<details>`, as `groupFootChip` already does.
The Hide chip reads its state back off the leaves via `hiddenState()` — `on`
when all are hidden, `partial` when some are — and one click always changes
something: it hides all unless all are already hidden, in which case it clears.

**Bulk.** A `Lines: [Hide all] [Show all]` control row beside the existing
`Branches: [Expand all] [Collapse all]` controls.

**Drawer.** A collapsed `<details class="hidden-drawer">` at the foot of the
markup panel, with summary `Hidden (N)`, rendered only when `N > 0`. Its body
reuses `renderTrieNode` over a trie built from `hiddenLines()`, so hidden lines
keep their grouping and a whole group can be restored in one click. A hidden
line's own `[Hide]` chip reads `on` inside the drawer, and clicking it unhides.

**Open-state keys.** `renderTrieNode` currently reads the module-level
`openPaths` Set. The drawer's trie can produce the *same* `node.key` as the main
trie for the same move path, so sharing one Set would make opening a drawer
group also open its twin in the editor. `renderTrieNode` therefore takes the
path Set as a parameter defaulting to `openPaths`, and `state.js` gains an
`openHiddenPaths` Set. This is the separation `openPaths` and `openTablePaths`
already exist for.

**Line numbering.** The drawer continues the same `nameCounter` object the main
list used, so auto-assigned `Line N` names cannot collide across the two lists.

## 6. Testing

Test-driven, matching the repo's existing habit of a test file per module.

`tests/visibility.test.mjs` covers the pure module: each filter, `setHidden`
deleting rather than falsifying, `setHidden`/`hideAll`/`solo` all refusing to
hide the mainline, `solo` unhiding the lines it keeps, and `hiddenState`'s three
results.

Per-consumer assertions, added to the existing test files:

- a hidden line is absent from `grid()`'s `vars` and from its `footNotes`
- a hidden line is absent from `buildPgn()` output
- a hidden line consumes no `[n]` number and no footnote letter
- hiding two of three footnote group members dissolves the group
- `hidden` survives a `saveNotebook`/`openNotebook` round-trip, and a notebook
  saved without the field loads as visible
- a note added at a shared move is written to a hidden line reaching the same
  position, and is still there when the line is unhidden

jsdom assertions for the UI: the mainline row offers no Hide chip, the drawer
appears only when something is hidden and carries the hidden lines in their
groups, the group chip's three states, solo from a line and from a group, and
that opening a drawer group does not open the same-key group in the editor.

## 7. Decisions

- **A hidden line still receives shared notes.** `computeShared` runs over the
  full line list, not the visible one, so a note added at a shared move is
  written to every line reaching that position — hidden ones included — and
  unhiding reveals a line with its notes intact. Hiding is a presentation
  choice, not a fork in the notebook's content: a line that silently missed
  every note added while it was hidden would come back subtly wrong.

  Two consequences follow. The shared-count label in `movePanel` ("· N shared")
  counts hidden lines, which is accurate — the note does land on N lines. And a
  hidden line's own notes still exist on the line; they simply go unnumbered,
  because `numberNotes` only ever sees the visible set.
- **Hiding every sideline is legal**, leaving a mainline-only table. No empty
  state is reachable because the mainline cannot be hidden.
- **No export warning.** Omitting hidden lines from the PGN is silent; the
  saved notebook retains them, so nothing is actually lost.

## 8. Out of scope

Table-side expand/collapse (task `878763a0`) and note-group collapsing
(task `df3c5369`) are separate tasks. The `renderTrieNode` path-Set parameter
introduced here is the shared mechanism the latter's annotation anticipates, but
this task does not build on it further.
