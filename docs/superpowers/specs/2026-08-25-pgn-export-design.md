# PGN export: serialize current state, with full NAG support

Date: 2026-08-25
Task: taskwarrior a3f4f9db (chess-pgn-reports, priority H)

## Problem

`exportBar()` in `src/export.js` wires the Export PGN button to
`getCurrent().pgn` — the raw text the user imported. Every edit made in the
app is therefore absent from the export: promoted mainlines, line tags and
names, per-move symbols, evaluations, notes and footnotes. The exported file
is the input file.

Two further gaps: `pgn.js` parses `$n` NAGs into `node.nags` and then drops
them (`tree.js` never reads the field), so even imported annotations are lost;
and there is no Copy PGN button, though Copy report exists for Markdown.

## Goals

1. Export PGN built from the live state, not the imported text.
2. Symbols, notes and footnotes all represented.
3. Output is spec-valid: accepted by chess.js, lichess and chesstempo.
4. Symbol palette covers the standard NAG set rather than an ad-hoc subset.
5. A Copy PGN button beside Export PGN.

Non-goals: changing the storage format, changing how notes are numbered in
the report, ChessPad's non-standard `$147+` extensions.

## Design

### `src/pgn-out.js` — serialization

Pure; no DOM, no `getCurrent()`. One export:

```js
buildPgn(state) -> string
```

Taking `state` as an argument rather than reading the module singleton is what
structurally prevents the current bug from recurring, and makes the module
directly testable.

Three internal stages:

**`treeFromLines(lines)`** re-nests the flat root-to-leaf line list into a move
tree. The line with `isMain` is the trunk. Every other line attaches as a
variation at its `divergence()` index against its parent; lines sharing a
divergent prefix nest within one another rather than emitting as siblings, so
the PGN's branch structure matches the trie the table already displays.
Footnote-tagged (`tag === "foot"`) lines are ordinary variations here — they
differ only in how the report renders them.

**`annotate(tree, state)`** hangs annotations on each node:

- `line.marks[ply]` -> a NAG token on that move, or a comment if the symbol has
  no standard code (only `TN`).
- `line.meta.eval` and `line.name` -> a comment on the line's first divergent
  move, e.g. `{Najdorf ±}`.
- notes from `allNotes()` -> a comment on the move identified by
  `(ply, owner)`, matching the anchoring `moveRef()` already uses.

Comments carry no `[n]`/`(a)` markers: that numbering is a report-view artifact,
and a PGN reader shows each comment in place.

Comment text is escaped for the format — `}` cannot appear inside a `{}`
comment, and newlines collapse to spaces.

**`writeMovetext(tree)`** emits SAN with correct move numbers. A Black move
re-emits its number as `12...` whenever it does not directly follow White's
move of the same pair (after a variation, a comment or a NAG). Lines wrap at
80 columns on token boundaries, per the spec's export-format rules. The
movetext ends with the result token, defaulting to `*`.

**Header.** A full Seven Tag Roster: `Event` = notebook name (or `"?"`),
`Site "?"`, `Date "????.??.??"`, `Round "?"`, `White "?"`, `Black "?"`,
`Result` matching the movetext terminator. Some online importers reject a
file without the roster, so this is required rather than cosmetic.

`state.pgn` is never mutated — it remains the source text notebooks re-parse
on load.

### `src/nags.js` — the NAG table

One table, consulted in both directions:

```js
export const NAGS = [{ code, sym, name, group, common }, ...]
export function nagFor(sym)   // symbol -> code   (export)
export function symFor(code)  // code -> symbol   (import)
```

Contents: every standard NAG from `$1` to `$139` that carries a typographic
symbol, including both halves of each paired glyph — zugzwang `⨀` (22/23),
space `○` (26/27), development `⟳` (32/33), initiative `↑` (36/37), attack `→`
(40/41), compensation `⯹` (44/45), counterplay `⇆` (132/133), zeitnot `⨁`
(138/139) — plus the symbol-less assessments `$8` singular, `$9` worst move,
`$11` equal chances quiet and `$12` equal chances active, shown by short label.
`$140` supplies `△` "with the idea" and `$146` supplies `N` novelty.

`group` is the spec's own classification (move assessment, positional
assessment, time pressure) and drives the palette's grouping. `common` marks
the roughly fifteen symbols shown without opening the drawer — the set the
palette offers today.

The palette's ASCII `+=` and `=+` normalize to `⩲` and `⩱`, their real NAG
glyphs. `TN` has no standard code and exports as a `{TN}` comment.

### Import side

`pgn.js` already collects `$n` into `node.nags`. `tree.js` will carry those
through into each line's `marks`, via `symFor()`, so an imported annotation
survives into the editor and back out to the export.

### Palette drawer

`EVAL_SYMBOLS` is derived from `NAGS` rather than hand-listed, so the palette
and the exporter cannot drift apart. The symbol row in `line-editor.js` renders
the `common` entries inline exactly as now; the remainder go inside a
`<details>` labelled "More symbols", grouped by `group` with a heading per
group. The drawer stays closed by default, so the default row is no denser than
today's.

### Copy PGN button

Added to `exportBar()` beside Export PGN, reusing the clipboard-with-textarea
fallback and the "Copied ✓" flash the Copy report button already uses.

## Testing

TDD, in a new `tests/pgn-out.test.mjs`, driven by the existing
`tests/fixtures`:

1. **Structure** — nesting depth and order, move numbering after variations and
   comments, export of a user-promoted mainline, footnote lines as variations.
2. **Annotation** — every palette symbol emits its NAG code; notes land on the
   move `moveRef()` names; `TN` and line evals land in comments; a `}` in a
   note does not corrupt the file.
3. **External parse** — each fixture's output is fed to chess.js `loadPgn` and
   must load without throwing.
4. **Round-trip** — `parsePgn(buildPgn(state))` reproduces the line set, the
   marks and the notes.

Manual verification on lichess and chesstempo is the user's, and is the reason
the Seven Tag Roster is mandatory.

## Risks

- **Re-nesting is the hard part.** The flat line list loses which sideline
  branched off which other sideline; `divergence()` against each candidate
  parent recovers it, the same way `notes.js` already picks a note's parent
  line. Tests cover a sideline-of-a-sideline explicitly.
- **Move numbering after variations** is the classic PGN serializer bug and
  gets its own tests.
- **Widening the palette** changes a user-visible control. The drawer keeps the
  default row unchanged in density.
