# Trie Collapse + Table Splitting Design

Date: 2026-08-17

Status: approved (user reviewed design sections in conversation; final tweaks: print-split checkbox, mainline-on-left confirmed)

## Context

The editor's grouped (trie) view already collapses multi-line fork groups, but a lone
line (leaf, no fork) renders as an always-open block with its editor visible — the
user wants every group to behave the same: collapsed by default, expand to edit.
Separately, the on-screen table is one giant wide grid (a column per line) that is
hard to scan with many variations, and the print/PDF table splits only when too
wide, chunking rows at an arbitrary 16-row cut instead of respecting the trie's
natural fork structure.

## Goals

1. Every trie group in the editor is collapsible, including lone lines; collapsed by
   default; the edit menu (tags, move chips, note) and the inline board appear only
   when expanded.
2. The interactive on-screen table groups its sideline columns/rows by trie branch,
   collapsed by default, with the mainline always visible.
3. The print/PDF table offers a checkbox to always split by trie branch; when not
   checked, the existing conditional behavior remains but chunking cuts at real trie
   forks instead of arbitrary row counts.

## 1. Editor: lone-line groups become collapsible

`renderTrieNode` in `src/app.js` currently has three branches: lone-line (always-open
`.lgroup.open` block), single-child chain (inlined), fork (collapsible `<details>`).
Unify: render EVERY node as a `<details>` — lone lines too, collapsed by default
(header shows the full shared path + "1 line"). The single-child chain inlining stays
(accumulates the header path), and its terminal leaf is a collapsible details.

- Expand state reuses the existing `openPaths` set (keys already exist on every trie
  node from `buildTrie`); the details toggle listener is the same code path.
- The inline board (`showBoard`) is gated on `allOpen && open` — a collapsed lone line
  renders no board, exactly like a collapsed fork. Falls out of the current logic.
- The mainline editor (rendered directly in `markupPanel`, outside the trie) stays
  always visible — it is the reference row.
- The "Tag remaining as sideline" button below the trie is unchanged.

## 2. Interactive table: collapsible trie branches

The left-panel table (`pv-table`) stops rendering one giant grid. New structure:

- **Mainline always visible** at the top. Render it alone via the existing
  `renderTable` with `vars = [mainline]` — in the default horizontal layout that is
  the leftmost column strip (rows = plies); in vertical layout the top row. This
  matches "mainline on the LEFT" (horizontal is the default orientation).
- **One collapsible section per trie branch** below it, header styled like the
  editor's `lg-head` showing the shared path + line count (e.g. `1... c5 2. Nf3 · 2
  lines`). Expanded, the section renders its sideline lines as a table slice
  (`renderTable` with `vars = [branch lines]`, orientation respected) — no mainline
  duplication, since the reference sits above. Collapsed = header only.
- The table trie is built with the same `buildTrie` over the table's sideline lines
  (`g.vars` minus the mainline; footnotes are already excluded from the table).
- Expand state: a NEW module-level `Set` (`openTablePaths`), deliberately NOT synced
  with the editor's `openPaths` — expanding a branch in the table does not expand the
  editor group. Same key scheme so the toggle listener code is shared.
- Default: all branches collapsed.

## 3. Print/PDF: split-by-trie checkbox

Add a third checkbox to the print-options bar (`exportBar`'s `pOpts`, next to
"final-position image" / "latest-divergence image"): **"split table by trie"**
(stored as `current.showSplitTrie`, default OFF).

- **OFF (default):** existing conditional behavior — one table when the sideline
  count fits; when too wide, split by trie with the improved fork-based cutting:
  group by trie branch (as today, keyed by first divergent move), and when a branch's
  own table still exceeds the width cap, recurse into its sub-forks so shared
  continuations stay together; fall back to row-chunking (cap 15) only when a branch
  has no sub-fork and still overflows.
- **ON:** always split — every trie branch renders as its own print table section
  (mainline reference column included, as the print tables do today), regardless of
  width.
- Print group headers show the full shared path (branch) instead of only the first
  divergent move.

## Out of scope

- The cards/lines print view and the editor's move-panel board: unchanged.
- Syncing table and editor expand state: explicitly rejected (separate sets).
- Changing the width cap of 15 columns: unchanged.

## Testing

- Existing 25 tests stay green.
- New tests: lone-line groups render as collapsed `<details>` (editor); table renders
  mainline block + collapsed branch headers; expanding a table branch reveals its
  rows; `showSplitTrie` off/on changes the print table structure.
- Manual: big-PGN scanability in both orientations; print preview with the checkbox
  on and off.
