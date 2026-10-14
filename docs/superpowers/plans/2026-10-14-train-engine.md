# Train: the engine while learning

Spec: `docs/superpowers/specs/2026-10-13-train-mode-design.md`, "The engine"
(under The Train window) and Settings → Engine. Davis agreed (2026-10-14):
engine evaluations and lines while learning, never while being quizzed on
moves; off by default; an evaluation-only option.

Branch `train-mode`. Tabs in `src/*.js` train files and `analysis-view.js`
(check each file), two spaces in `src/app.js`, `e2e/`, `style.css`.

Reuse, don't copy (CLAUDE.md: one implementation per action): the engine box
is `engineBox(engine, pos, onChange, { board, bar, flavors, playLine })` in
`src/engine-view.js`; Study wires it in `src/study-view.js` (with
`boardAndEngine`, `boardRow` from `src/analysis-view.js`) and gets `engine` /
`flavors` from `src/app.js` (`sharedEngine()`, `sharedFlavors()`; the study
overlay calls `engine.pause()` on close). `drawArrows` (board-input.js) needs
a board wrapper `.an-board` with `_geom = { size, flipped }`, as
`interactiveBoard` returns.

---

### Task 10 (first): One progress store per browser

**Files:** `src/train.js`, `src/train-view.js`, `src/app.js`, `src/store.js`,
`tests/train.test.mjs`, `tests/train-view.test.mjs`,
`tests/train-app.test.mjs`, `tests/old-workbooks.test.mjs`, other tests that
touch `ott-train:` keys

Spec: "Progress storage" (rewritten). Today progress lives under
`ott-train:<workbook id>` / `ott-train:unsaved`, and `app.js` clears the
unsaved slot whenever a PGN is loaded or a file without progress opens, so
reloading a PGN loses everything.

1. `train.js`: `loadProgress()` / `saveProgress(progress)` take no id and use
   the key `ott-train`. `loadProgress` first migrates: if any other key
   starting `ott-train:` exists, read each (with today's per-key rules:
   streak default 0, `seen` timestamps renumbered), merge them with the
   store (per card the record with the higher streak; ties: the higher
   `seen` rank), renumber all `seen` 1..n in their combined order, set
   `asked` = n, keep the store's settings or else the first migrated key's,
   save, and remove the old keys. Delete `moveProgress`.
2. `export function mergeProgress(into, from)`: the per-card rule above,
   `from`'s settings only when `into` has none saved. Used by migration
   and by opening a file. `export function progressFor(progress, deck)`:
   `{ settings, asked, cards }` with only the deck's card ids — what Save
   to file writes.
3. `app.js`: Train opens with `loadProgress()`; `trainPanel` no longer needs
   `workbookId` for saving (drop it if nothing else uses it). Save to file
   writes `train: progressFor(loadProgress(), buildDeck(…))` for the
   workbook. Opening a file with `train` merges it into the store
   (`mergeProgress`, then save). Loading a PGN or opening a workbook never
   clears progress (remove both `saveProgress(…, emptyProgress())` resets
   and the `moveProgress` on first Save).
4. `store.js`: deleting a workbook no longer removes Train progress.
5. Tests: rewrite the per-workbook/unsaved/move tests for the single store:
   progress survives loading a new PGN, reloading the same PGN, editing it
   (positions still there keep their records, others are simply unused),
   saving the workbook, deleting it; migration from `ott-train:<id>` and
   `ott-train:unsaved` (merged, renumbered, old keys gone); file round trip
   (Save to file holds only the workbook's cards; opening merges by higher
   streak). The `2026-10-14-train` old-workbook fixture must still open: its
   `train` now merges into `ott-train`; update `checkFormat` accordingly.
6. Docs: the user guide's Train section, where it says where progress lives.

Commit: "Keep Train progress per browser, by position, across PGN reloads"

### Task 11: Engine in the Train window

**Files:** `src/train-view.js`, `src/train.js` (setting), `src/app.js`,
`src/analysis-view.js` / `src/engine-view.js` only as below, `style.css`,
`tests/train-view.test.mjs`, `tests/train.test.mjs`, engine-view tests if
you touch it

1. Setting `engineLines: true` (boolean) in `DEFAULT_SETTINGS` /
   `VALID`; Settings screen group **Engine** (before Sessions) with
   "Engine lines", tooltip "Show the engine's lines and arrows as well as its
   evaluation. Off: the evaluation only. Default on."
2. `trainPanel(ui, { …, engine = null, flavors = null }, …)`: `app.js`'s
   `trainOverlay` passes `sharedEngine()` and `sharedFlavors()`, and its
   `close` calls `engine.pause()` (as the study's does).
3. **One board row for every Train board.** Every board the question/intro
   screens draw (picture or interactive) sits in a row with an eval bar
   beside it, like `boardRow`'s (extract the bar's construction from
   `boardRow` into an exported `evalBar(flipped)` in `analysis-view.js` and
   use it in both). Picture boards get a wrapper `div.an-board` holding the
   `boardSvg` with `_geom = { size: BOARD, flipped }` so arrows can be
   drawn on them (a small helper in train-view.js). The bar's place is kept
   when the bar is hidden or the engine is not shown (CSS in the Train rules,
   e.g. `visibility: hidden` rather than `display: none`, scoped to
   `.train`), so the board does not move between questions. The board's
   rendered width must stay as now (`clamp(240px, 55vh, 640px)`, the e2e
   "board keeps one size" test must pass unchanged in what it measures).
4. **Where the engine box goes**, under that row (`boardAndEngine` as Study
   does), when `engine` is given:
   - intro: for the stepped position (`pos` = the position after `ui.step`
     moves);
   - name and tags cards: the variation's position, asked and answered;
   - any card once answered: the position the answered board shows;
   - nowhere else. When a screen shows no box (an order or book card
     waiting for moves, the outline, settings, summary), call
     `engine.pause()` during that render.
   `pos` = `{ fen, over }` (`over` from chess.js as Study's position does —
   reuse whatever Study/analysis uses to build a position object if it
   exists). `playLine`: Train passes none; make `engineBox` render line
   moves as plain text, not clickable, when `playLine` is absent (a test in
   the engine-view tests for that).
5. **Eval only**: when `engineLines` is off, the panel gets a class (e.g.
   `tr-eval-only`) and CSS hides the box's lines (`.an-pvs`), its line-count
   select and the arrows; the toggle, info and bar stay.
6. **Keys**: E toggles the engine (`engine.enable(!engine.state.enabled)`,
   then redraw) where a box is shown, unless focus is in a text input (the
   typed-name field).
7. CSS: whatever the above needs, scoped to `.train`; nothing that changes
   Study or the analysis board.

Tests (`tests/train-view.test.mjs`, with a fake engine object exposing
`state`, `enable`, `analyse`, `pause`, `multiPv`, `onUpdate` — see how the
study tests fake it and reuse that): the box is present on intro, name,
tags and answered screens; absent on unanswered order/book cards, where
`pause` was called; the intro's box follows the step (analyse called with
the stepped FEN); eval-only class when `engineLines` is off; E toggles;
every board has an eval bar beside it; no engine given → no box, nothing
breaks. `tests/train.test.mjs`: the setting's default and validation.

Commit: "Show the engine in Train while learning, never while quizzing moves"

### Task 12: Docs and e2e

**Files:** `docs/user-guide.md` (Train section), `README.md` if its Train
bullet lists features, `e2e/train.spec.mjs`

1. Guide: where the engine shows and where it never does, the toggle and
   E, it being the same engine as Study's, "Engine lines".
2. e2e (the engine worker runs in the browser tests, see e2e/study.spec.mjs
   for how they wait on it): on a name question, switch the engine on, the
   eval bar shows and an engine line appears; on an order question the box
   is absent; with "Engine lines" off the lines are hidden but the bar
   shows. Keep the board-size test passing.

Commit: "Document the engine in Train"

### Verification (main session)

`npm run check`, `npm run test:e2e` twice; screenshots of intro and name
question with the engine on, desktop and phone.
