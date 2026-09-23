# No Mainline — Design

**Goal:** A per-notebook **No mainline** tickbox that removes the concept of a
mainline from the report. Every line becomes a peer: no reference column, no
elided `…` prefix, no `★ Make mainline`, and the first line is as tag-able,
hide-able and footnote-able as any other. Lines still scaffold — they are shown
grouped by what they share and split at each point of divergence — but that
structure is now emergent from the lines themselves rather than measured against
a privileged trunk.

---

## 1. The idea: the mainline becomes an empty line

The mainline has exactly two structural jobs, and both are parameterised by a
single value:

- `divergence(line, main)` (`tree.js:105`) — how many leading moves a line
  shares with the mainline; everything before that index renders as `…`.
- `buildTrie(lines, main)` (`tree.js:118`) — the trie of lines' divergent
  **tails**, which is what produces group columns and the editor's nesting.

Give both an empty mainline — `{ moves: [] }` — and the feature falls out of
code that already exists:

- `divergence(l, ∅) === 0` for every line, so no line has an elided prefix and
  every line spells itself out from move 1.
- `buildTrie` therefore roots at ply 1, so the trie spans the whole game rather
  than the divergent tails. `groupedVars`/`pushNode` (`group-cols.js:41`) hoist
  each run of shared moves into a group column and open it at the first real
  fork — the same machinery, applied one level further up.

No new layout code. The table in the approved sketch — `▾ 1.e4` over `Line 1`
and `Line 2`, `▾ 1.d4` over `Line 3` — is what `pushNode` already emits for
that trie.

## 2. Data model

### 2.1 The flag

`current.noMain` (boolean, default `false`), added to `freshState()` in
`app.js:62-75` beside `showBoards`.

It travels with the notebook in the existing `view` object (`app.js:245`,
`store.js:29`), exactly as `showBoards` and `boardSize` do — it changes what the
report *is*, so it must survive a reload, and two notebooks in one workbook list
may disagree about it.

A notebook saved before this field existed has no `view.noMain` and reads back
`false`, matching the `view.showBoards ?? …` fallback already used for notebooks
predating `view`.

### 2.2 `l.isMain` is untouched

The flag does **not** mutate the lines. `l.isMain` keeps being written by
`collectLines` (`tree.js:98`), `promoteMainline` (`line-editor.js:118`),
`merge.js:194-204` and `store.js:80`, and keeps being persisted as
`nb.main = keyFor(mainLine.moves)`.

This is what makes the tickbox **lossless in both directions**: ticking it does
not throw away which line you had promoted, so unticking restores the table you
had before, without a second remembered field to keep in sync.

What changes is every *read* of `l.isMain`, which is now a question about the
notebook and not only about the line.

## 3. The seam: two functions in `src/tree.js`

```js
// The reference the whole table is measured against. With the mainline
// disabled it is an empty line: divergence() is then 0 for every line, so
// nothing elides a prefix and buildTrie() roots at ply 1.
export const EMPTY_MAIN = Object.freeze({
	moves: [], marks: {}, comments: [], synthetic: true,
});
export const noMain = () => !!(getCurrent() && getCurrent().noMain);
export const mainOf = (lines) =>
	noMain() ? EMPTY_MAIN : lines.find((l) => l.isMain) || lines[0];
export const isMainLine = (l) => !noMain() && !!l.isMain;
```

`tree.js` gains an import of `getCurrent` from `state.js`. `state.js` imports
nothing, so this closes no cycle, and `tree.js` already owns the mainline
concept (`defaultLineName`, `divergence`, `buildTrie`). `divergence` and
`buildTrie` stay pure — only these three read state.

Then, mechanically across `src/`:

- every `lines.find((l) => l.isMain) || lines[0]` → `mainOf(lines)` (10 sites:
  `app.js:681`, `analysis-commit.js:56`, `export.js:32`, `store.js:26`,
  `notes.js:60`, `table.js:25`, `pgn-out.js:41,185`, `line-editor.js:146`,
  `merge.js:202`)
- every **read** of `l.isMain` → `isMainLine(l)` (~22 sites). Writers are left
  alone.

Two deliberate exceptions, both because they must not see an empty line:

- **`pgn-out.js:41,185`** keep `lines.find((l) => l.isMain) || lines[0]`. A
  `.pgn` has no representation for "no mainline" — the movetext *is* a trunk with
  parenthesised variations — so PGN export keeps writing the first line as the
  trunk, and every other line as a variation of it. This is the same deliberate
  lossiness already recorded for hidden lines.
- **`store.js:26`** keeps writing a real `nb.main`, per §2.2.

## 4. `grid()` and the synthetic var

`grid()` (`table.js:20`) builds one var per line and sorts the mainline first.
With `noMain`, no line yields a `mainline` var (`isMainLine` is false for all of
them), so `grid()` builds one for `EMPTY_MAIN` itself and puts it at the head of
`vars`: `{ tag: "mainline", label: "Mainline", synthetic: true, moves: [],
cells: {}, d: 0, line: null }`. The existing mainline-first `sort` is stable and
leaves it there.

That is the cheap choice on purpose: four call sites read the mainline var as
`g.vars[0]` and the rest as `g.vars.slice(1)` (`trie-view.js:34-35,139,226`,
`print.js:102-103`), and every one of them passes it straight into
`groupedVars`/`buildTrie`/`flatGroupedVars` as the divergence reference. Keeping
the synthetic var at index 0 leaves all four unchanged; dropping it would mean
reshaping `grid()`'s contract and re-adding the mainline at every row loop.

`grid()`'s return gains `noMain: noMain()` so renderers can ask without
importing state, and `mainMoves` becomes `[]`.

A synthetic var must never render as a row. Four guards:

| Site | Guard |
| --- | --- |
| `group-cols.js:41` `groupedVars` | don't `vars.push(mainV)` when `mainV.synthetic` |
| `print.js:27` `flatGroupedVars` | same |
| `render.js:532` cards | skip a synthetic var |
| `export.js:209` Markdown | skip a synthetic var |

## 5. The first column stops being special

`renderTable` marks column 0 `main-col sticky-col` (`render.js:359,447`). With
no mainline, column 0 is an ordinary line and pinning it is arbitrary, so both
sites become conditional on `!grid.noMain`.

`render.js:477,508` read `v.tag === "mainline" ? v.moves : v.moves.slice(v.d)`.
No change needed: `v.d` is 0 for every line when `noMain`, so `slice(0)` is the
whole line.

`print.js:174-191` `renderTableNotes` looks the mainline var up by
`tag === "mainline"`; with `noMain` that find returns the synthetic var, so the
`showMain` branch must treat a synthetic hit as "no mainline note to show".

## 6. Footnotes need almost nothing

`notes.js parentOf` (`notes.js:83`) already anchors a footnote on the line it
shares the most moves with — the mainline is only the tie-break
(`d === bestD && c.isMain`) and the fallback (`best || main`). With `noMain`:

- the tie-break is inert, because `isMainLine` is false for every candidate, so
  ties fall to document order. Correct: there is no privileged line to prefer.
- the fallback must not be `EMPTY_MAIN`. A footnote that is the *only* non-foot
  line in the notebook has nothing to anchor on; `numberNotes` already guards
  the per-line case with `main &&` (`notes.js:132`), which becomes
  `parent &&` so an unanchorable footnote is skipped rather than filed against
  an empty line.

`foot-groups.js:68` and `tree.js:159` take `main` from their callers and need no
change beyond those callers using `mainOf`.

## 7. Editor and visibility

**`line-editor.js:36-60`.** `isMainLine(l)` is false for every line, so every
row gets the `Sideline`/`Footnote` chips plus `Hide`/`Focus` — the first line
included. The `★ Make mainline` button is suppressed while `noMain` is on:
there is no mainline to make. `defaultLineName(isMainLine(l), idx)` therefore
never produces `"Mainline"`, so lines are `Line 1`, `Line 2`, … A line already
*named* `"Mainline"` from an earlier session keeps that name — it is a name the
user can edit, and `isDefaultLineName` still recognises it.

**`visibility.js`.** `setHidden` and `solo` refuse `l.isMain`; via `isMainLine`
that refusal lifts, so every line can be hidden — including all of them, which
already renders as an empty table. `isFocused`'s exclusions lift the same way.

**`app.js:722,744`.** The `Hide all`/`Show all` copy and the editor's
explanatory line ("The mainline is the reference row…") need a `noMain`
variant; the editor no longer renders a mainline row above the trie
(`app.js:748`), only the grouped or flat list of all lines.

**`table-menu.js:219`.** `if (line.isMain)` gates the menu's mainline branch →
`isMainLine(line)`, so a right-clicked line offers `Move to footnote` / `Hide`
like any other.

## 8. What the flag does not reach

- **PGN export** — §3.
- **The analysis board.** `analysis-commit.js:56` uses `mainOf` for divergence
  when filing an analysed line, so an added line diverges from the empty main
  and lands as a full line. Nothing else in the analysis flow reads the
  mainline.
- **Merge.** `merge.js` compares two parses of the same PGN; its mainline
  handling is about *reconciling* `isMain`, which §2.2 preserves untouched.
- **The trace.** `trace.js` works off a var's SAN path and its `trail`, both of
  which the group columns still supply.

## 9. Testing

The flag defaults off, so the whole existing suite must stay green unchanged —
that is the first check, and the regression guard for all ~32 rewritten sites.

New coverage, with `noMain: true` set on the state:

| Test | Assertion |
| --- | --- |
| `tests/tree.test.mjs` | `mainOf` returns `EMPTY_MAIN`; `isMainLine` false for a line carrying `isMain`; both honour the flag off |
| `tests/table.test.mjs` | no var has an `ellip` cell; every var's `d` is 0; the var at index 0 is synthetic; `noMain` is on the result |
| `tests/trie-view.test.mjs` | no `main-col`/`sticky-col`; shared opening moves appear in a group column, not repeated per line; folding still works |
| `tests/visibility.test.mjs` | the `isMain` line can be hidden and soloed |
| `tests/line-editor.test.mjs` | no `★ Make mainline`; the first line has tag and Hide chips; its default name is `Line 1` |
| `tests/notes.test.mjs` | a footnote anchors on the line it shares most moves with; a lone footnote produces no anchor against the empty main |
| `tests/store.test.mjs` | `view.noMain` round-trips; a promoted `nb.main` survives a tick/untick |
| `tests/pgn-out.test.mjs` | export still emits a trunk with variations when `noMain` is on |
| `tests/print.test.mjs` | the print report emits no mainline column and no mainline note row |
| `tests/export.test.mjs` | Markdown emits no `**Mainline**` section |

`npm test`, `npm run lint` and `npm run knip` all clean.
