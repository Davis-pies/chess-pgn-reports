# Footnote-as-Note Design

Date: 2026-08-22

Status: approved (design sections reviewed in conversation)

## Context

This is sub-project **A** of a five-task cluster tracked in taskwarrior under project
`chess-pgn-reports`. The cluster splits into a footnote/disposition subsystem
(A here, then group-footnote, then hidden lines) plus two independent pieces (a real
PGN writer, and recursive table collapse). A comes first because it redefines what a
footnote renders as, which the other two in the cluster build on and which the PGN
writer needs settled before it can decide how a footnote serializes.

The starting premise of the task — "footnotes should not be displayed in the table" —
is already true. `grid()` diverts `tag: "foot"` lines into `footNotes`
(`src/table.js:92`) and they never become table rows, on screen or in the printed
table (`appendPrintTables` builds from `g.vars`, `src/print.js:31`).

What is actually wrong is everything around that:

1. **Footnotes are unanchored.** Nothing in the table points at a footnote. There is
   no marker on the parent row at the move the footnote branches from, so the table
   gives the reader no indication a footnote exists or where it applies.
2. **Footnotes leak into print as cards.** `renderCards` merges `footNotes` back in
   with the regular variations (`src/render.js:343`), so in the printed card view a
   footnote renders as a full card, indistinguishable from a sideline.
3. **Two sources of truth for the footnote list.** `grid()` classifies and letters
   footnotes (`src/table.js:92,103`), and `src/export.js:91` independently re-derives
   the same list with its own `lines.filter(l => l.tag === "foot")` and its own
   lettering loop at `src/export.js:96`.
4. **Two implementations of note numbering.** `allNotes()` (`src/notes.js:12`) and
   `grid()` (`src/table.js:37`) each walk the lines in order assigning numbers, with
   a code comment asserting the two agree. Nothing enforces it.

## Goals

1. A footnote line appears as a **numbered note** in the single Notes list, and is
   anchored by an `[n]` marker in the table on the move it replaces.
2. Footnotes render consistently everywhere — screen, printed table, printed cards —
   travelling with the notes rather than as table rows or cards.
3. Note numbering has one owner, so the table's superscripts and the notes list
   cannot drift apart.

## Non-goals

- **No new persisted state.** A footnote is still `tag: "foot"`. Saved workbooks in
  `localStorage` load unchanged; no migration, no changes to `src/store.js` or
  `src/state.js`.
- **No group-level footnotes.** Marking a whole trie group as one footnote is the
  next sub-project.
- **No hidden/disabled lines.** That is a separate, orthogonal bit, a sub-project
  later in the cluster.
- **No Markdown export removal.** The Markdown export is unused and slated for
  deletion, but that happens in the PGN-writer sub-project so all export changes land
  together. Here it is only updated to match the new footnote model.

## 1. Model: a footnote derives a note

A footnote line derives a note rather than being its own lettered entity. The derived
note is **computed at render time from the line**, never materialized into
`line.comments`. Materializing it would leave a stale note behind the moment the line
is renamed, re-tagged, or its moves change.

`allNotes()` gains a second entry kind. Every entry keeps its existing shape
(`{ply, text, owner, n}`); a footnote entry instead carries structured data:

```
{ ply, owner, n, foot: { name, eval, note, moves, d, marks, noteByPly } }
```

Structured, not a pre-rendered string, because three renderers consume notes — the
screen panel (`src/export.js:72`), the print block (`src/print.js:82`), and Markdown
(`src/export.js:274`) — and each formats moves in its own medium (DOM superscripts vs
plain text). A formatted string would force at least one of them to parse it back
apart.

Renderers branch once on the presence of `foot`.

## 2. Numbering gets a single owner

`src/notes.js` becomes the sole owner of note numbering. One pass over the lines
returns both:

- the ordered, numbered entries (text notes and footnote notes together), and
- a per-line map of `ply -> [numbers]`.

`grid()` consumes that map to populate each var's `noteByPly` instead of counting for
itself. The dedupe rules are unchanged and are already identical in both current
implementations: identical `(ply, text)` notes shared across lines collapse to one
number, and a line carrying the same note twice at one ply lists the number once.

This is a prerequisite, not a cleanup. Injecting footnote entries into one sequence
and not the other would silently renumber the table's superscripts away from the
notes list.

Ordering is unchanged: entries are numbered in line order, so a footnote's number
falls at its line's position in the walk. Table markers are therefore not monotonic
left-to-right, which is already true today.

## 3. Anchoring

A footnote's `[n]` marker attaches to the **mainline row at the divergence ply** —
the move the footnote replaces. Mainline plays `7.Nbd2`, footnote is `7.Bg5`, marker
lands on `7.Nbd2`. This is the ECO convention: "at this move, there is an
alternative."

If the footnote runs past the mainline's last move (no mainline cell exists at the
divergence ply), the marker falls back to the last mainline ply.

**Known limitation:** `divergence()` compares only against the mainline
(`src/table.js:8`), so a footnote that genuinely branches off a *sideline* still gets
its marker on the mainline row. Accepted for this sub-project. The group-footnote
sub-project generalizes "parent" from "always the mainline" to a trie node, which is
where this is fixed.

## 4. A footnote's own notes

**Amended 2026-08-22, after the original was built and reviewed in use.** The
decision below replaces the original one, which made a footnote's own notes peers of
top-level notes in the same flat numbered list. In practice that read badly: a
top-level entry like `[3]` turned out to be commentary on a move that exists only
inside `[2]`'s move text, so the reader had to leave the list to find what it was
talking about.

A footnote's own notes are now **lettered sub-notes nested under their footnote**,
and they no longer appear in the global numbered list at all.

- **Letters restart per footnote.** Each footnote's notes are `a`, `b`, `c` from
  scratch. A letter is only ever meaningful beside its own footnote, so scoping it
  globally would buy nothing.
- **Only footnote-exclusive notes are lettered.** The editor shares a note across
  every line in an equal-position group, so the same `(ply, text)` can sit on a
  footnote *and* on a sideline. When it does, it stays a global numbered note and the
  footnote's move text references it by number — nothing is duplicated.
- **Mixed markers are allowed.** A footnote's moves can therefore carry both `[3]`
  and `[a]`. This is rare: a shared note normally sits before the divergence, and a
  footnote only renders markers on its divergent tail. It is reachable through
  transposition, where a footnote's post-divergence move reaches the same position
  and SAN as a move on a non-footnote line. Referencing the global note from inside
  the footnote is the correct outcome there, and costs nothing — marker values are
  strings and renderers emit whatever the array holds.
- **No table cell can show a letter.** Letters are only assigned to notes exclusive
  to footnote lines, and footnote lines are never table rows.

The footnote entry carries `foot.subNotes = [{label, ply, text}]`, and
`foot.noteByPly` maps a ply to the markers on that move.

## 5. Rendering changes

- **Table** — unchanged apart from the new `[n]` on the mainline row. Footnotes were
  never rows.
- **Notes panel** (`src/export.js:72`) — the `Footnotes` heading, the
  `lines.filter(l => l.tag === "foot")` re-derivation and the local lettering loop are
  removed. Footnote entries render inside the one Notes list.
- **Print cards** — `src/render.js:343` stops merging `footNotes` into the cards, so
  footnotes no longer print as full cards.
- **Print notes** — footnote entries attribute to the mainline var. The mainline
  column repeats in every packed table but its notes print only under the first
  (`showMain`, `src/print.js:82`), so footnote notes print there too, with the rest of
  the mainline's notes.
- **Markdown** (`src/export.js:257`) — the `## Footnotes` section is dropped and
  footnotes are emitted as notes, keeping the export consistent until it is deleted in
  the PGN-writer sub-project.

### Deletions

- `footLetter()` (`src/table.js:18`) and the `f.letter` assignment
  (`src/table.js:103`).
- Both `v.letter` superscript blocks (`src/render.js:203,358`), dead once no var or
  card carries a letter.
- The independent footnote derivation and lettering in `src/export.js:91-96`.

`grid()` still returns `footNotes` — consumers need the footnote lines to build the
derived notes. Only the lettering goes.

## 6. Note text format

The existing footnote-section format, minus the letter:

```
Name: ⋯ 6...Nbd7 7.Bg5 ± — commentary
```

Name and commentary are omitted when absent. Evaluation symbols come from `marks`
as they do today. Inline `[n]` superscripts on the footnote's own moves come from the
existing `noteByPly` path.

## 7. Edge cases

- **No divergent tail** (footnote identical to the mainline as far as it goes):
  anchors at the last shared move, renders name and commentary with no move tail.
- **No name and no commentary:** renders just the moves.
- **Every line footnoted:** the table holds only the mainline row; everything else is
  in the notes list.
- **No mainline:** `grid()` already falls back to `lines[0]`; anchoring follows that
  same fallback.

## 8. Testing

Per-module tests alongside the existing suites:

- `tests/table.test.mjs` — footnotes carry no letter; the mainline var gains a
  `noteByPly` entry at the divergence ply; the past-the-end fallback anchors at the
  last mainline ply.
- `tests/export.test.mjs` — the notes panel emits one list with no `Footnotes`
  heading and includes footnote entries; Markdown emits no `## Footnotes` section.
- `tests/print.test.mjs` — the per-table notes block includes footnote entries under
  the first table; footnotes are absent from the cards.
- `tests/render.test.mjs` — `renderCards` renders no card for a footnote line.

Plus the regression guard this design exists to protect:

- **Numbering parity** — on a fixture containing shared notes across lines, footnote
  lines, and footnote lines carrying their own inner notes, every number in `grid()`'s
  `noteByPly` matches the number `allNotes()` assigns to the same note. This is the
  invariant that fails silently, so it gets an explicit test rather than relying on
  the two implementations being read side by side.

Note for coverage runs: never import `src/app.js` with a `?t=` cache-buster in tests —
it hides most of the module's coverage.
