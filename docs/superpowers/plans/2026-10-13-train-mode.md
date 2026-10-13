# Train Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Train window that quizzes the reader on a workbook's named
variations (name, move order, family, book moves), unlocks deeper levels as
they are mastered, and schedules reviews on a Leitner system.

**Architecture:** Three new modules. `names.js` holds named positions (keyed by
`posKey`), reads/writes them as PGN `[%name]`/`[%tags]` commands and derives the
variation tree. `train.js` is pure logic: cards, answer checks, scheduling,
unlocking, sessions, progress storage. `train-view.js` is the window, mirroring
`study-view.js`/`studyOverlay` in `app.js`.

**Tech Stack:** Vanilla ES modules, chess.js, jsdom + `node:test` for tests,
Playwright for e2e. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-13-train-mode-design.md`

## Global Constraints

- No new dependencies. Tabs for indentation in new files (match `study.js`).
- `npm run check` must pass at the end: eslint with 0 warnings, knip (no unused
  exports), coverage ≥ 97% lines, ≥ 87% branches, ≥ 97% functions.
- Never import `src/app.js` with a `?t=` cache-buster in tests (it hides its
  coverage). App-level tests use `bootApp()` from `tests/helpers.mjs` as
  `tests/study-app.test.mjs` does.
- Position key: `posKey(fen)` from `src/audit.js` (FEN's first four fields).
- Comment style: short prose comments explaining *why*, like the surrounding code.
- Commit after each task with a message in the repo's style (imperative,
  sentence case, no prefix) ending with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Run a single test file with `node --test tests/<file>.test.mjs`.

## File map

- Create `src/names.js`, `src/train.js`, `src/train-view.js`
- Create `tests/names.test.mjs`, `tests/train.test.mjs`, `tests/train-view.test.mjs`, `tests/train-app.test.mjs`, `e2e/train.spec.mjs`
- Modify `src/pgn.js` (read `[%name]`/`[%tags]` onto nodes)
- Modify `src/pgn-out.js` (`buildPgn` writes them back)
- Modify `src/store.js` (`toNotebook` carries `names`, file carries `train`)
- Modify `src/state.js` (`setMode` accepts `"train"`)
- Modify `src/app.js` (state `names`, toolbar **Train**, overlay, save/load)
- Modify `src/table-menu.js` (**Name this position…**, **Train from here**)
- Modify `src/study-view.js` (trail of names + **Name this position…**)
- Modify `style.css`, `docs/user-guide.md`, `README.md`, `docs/architecture.md`

---

### Task 1: names.js and the PGN round trip

**Files:**
- Create: `src/names.js`, `tests/names.test.mjs`
- Modify: `src/pgn.js` (comment branch of `parseSeq`, ~line 133), `src/pgn-out.js` (`buildPgn`, ~line 307)

**Interfaces:**
- Produces (all exported from `src/names.js`):
  - `readNameCmd(text: string) -> { name: string, tags: string[] } | null` —
    finds `[%name "X"]` and optional `[%tags "a; b"]` in raw comment text.
    Tags split on `;`, trimmed, empties dropped. No `%name` → `null`.
  - `nameCmd({name, tags}) -> string` — inverse: `[%name "X"]` plus
    ` [%tags "a; b"]` when tags non-empty. `"` in values becomes `'`.
  - `namesFromNodes(nodes) -> Record<key, {name, tags}>` — walks parsed nodes
    (and `variations`, recursively); every node with `posName` contributes
    `posKey(node.fen) -> node.posName`. First one wins.
  - `setName(names, fen, name, tags = []) -> names` — mutates and returns.
    Blank/whitespace `name` deletes the key.
  - `variationTree(lines, names) -> { byKey: Map<key, VNode>, roots: VNode[] }`
    where `VNode = { key, fen, name, tags, parent: VNode|null, also: VNode[],
    children: VNode[], level: number, orders: string[][] }`.
    `lines` are visible lines in reading order (each `{ moves: [{san, ply}], isMain? }`).
    Walk each line from the start, computing FENs with `fenMap(line.moves)`
    from `src/pgn.js` (the start position is never a named key). For each
    named position reached: on first encounter create the VNode with
    `parent` = the nearest named position before it on that line (or null);
    on later encounters with a different nearest-named-ancestor, push that
    ancestor to `also` (no duplicates). `orders` collects each distinct SAN
    path (array of SAN from the start) reaching the key. After the walk,
    `level` = 1 + min over {parent, ...also} of their level (roots are 1;
    compute top-down by repeated relaxation). `children` filled from `parent`
    only, in first-encounter order. `roots` = nodes with `parent === null`.
  - `trailOf(sans: string[], names) -> {key, name}[]` — replay `sans` with
    chess.js and return each named position passed through, in order
    (including the final position).
- Produces on parsed nodes: `node.posName = {name, tags}` (from pgn.js).

- [ ] **Step 1: Write the failing tests** in `tests/names.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { posKey } from "../src/audit.js";
import { buildPgn } from "../src/pgn-out.js";
import { readNameCmd, nameCmd, namesFromNodes, setName, variationTree, trailOf } from "../src/names.js";

const PGN = `1. e4 c5 2. Nf3 d6 {[%name "...d6 Sicilians"]} (2... e6 {[%name "...e6 Sicilians"] [%tags "e6"]} 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 d6 {[%name "Scheveningen"] Small centre.}) 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 e6 {[%name "Scheveningen"]} (5... a6 {[%name "Najdorf"] [%tags "d6; Nc3 committed"]} 6. Be3 {[%name "English Attack"]}) *`;
const parsed = () => parsePgn(PGN);

test("readNameCmd reads a name and ;-separated tags, and nameCmd writes them back", () => {
	assert.deepStrictEqual(readNameCmd('[%name "Najdorf"] [%tags "d6; Nc3 committed ;"] text'), { name: "Najdorf", tags: ["d6", "Nc3 committed"] });
	assert.deepStrictEqual(readNameCmd('[%name "Kan/Paulsen"]'), { name: "Kan/Paulsen", tags: [] });
	assert.strictEqual(readNameCmd("[%clk 0:01:00] plain"), null);
	assert.strictEqual(nameCmd({ name: "Najdorf", tags: ["d6", "x"] }), '[%name "Najdorf"] [%tags "d6; x"]');
	assert.strictEqual(nameCmd({ name: 'Say "hi"', tags: [] }), "[%name \"Say 'hi'\"]");
});

test("the parser puts names on nodes and keeps them out of the note text", () => {
	const { nodes, comments } = parsed();
	assert.deepStrictEqual(nodes[3].posName, { name: "...d6 Sicilians", tags: [] });
	assert.ok(!comments.some((c) => /%name/.test(c.text)));
	assert.ok(comments.some((c) => /Small centre\./.test(c.text)));
});

test("namesFromNodes keys names by position, so a transposition is one entry", () => {
	const names = namesFromNodes(parsed().nodes);
	const keys = Object.keys(names);
	assert.strictEqual(keys.filter((k) => names[k].name === "Scheveningen").length, 1);
	assert.strictEqual(keys.length, 5);
});

test("setName adds, replaces and (blank) removes", () => {
	const names = {};
	const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
	setName(names, fen, "King's pawn", ["e4"]);
	assert.deepStrictEqual(names[posKey(fen)], { name: "King's pawn", tags: ["e4"] });
	setName(names, fen, "  ");
	assert.deepStrictEqual(names, {});
});

test("variationTree: parents, also-reached-from, levels, children and move orders", () => {
	const { nodes } = parsed();
	const lines = collectLines(nodes);
	const t = variationTree(lines, namesFromNodes(nodes));
	const byName = (n) => [...t.byKey.values()].find((v) => v.name === n);
	assert.deepStrictEqual(t.roots.map((v) => v.name).sort(), ["...d6 Sicilians", "...e6 Sicilians"]);
	const sch = byName("Scheveningen");
	assert.strictEqual(sch.level, 2);
	assert.strictEqual(sch.orders.length, 2);
	assert.strictEqual(sch.parent.name, "...d6 Sicilians");
	assert.deepStrictEqual(sch.also.map((v) => v.name), ["...e6 Sicilians"]);
	assert.strictEqual(byName("English Attack").level, 3);
	assert.strictEqual(byName("English Attack").parent.name, "Najdorf");
	assert.deepStrictEqual(byName("Najdorf").children.map((v) => v.name), ["English Attack"]);
});

test("trailOf lists the named positions a move sequence passes through", () => {
	const names = namesFromNodes(parsed().nodes);
	const sans = "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5".split(" ");
	assert.deepStrictEqual(trailOf(sans, names).map((x) => x.name), ["...d6 Sicilians", "Najdorf", "English Attack"]);
	assert.deepStrictEqual(trailOf([], names), []);
});

test("buildPgn writes names and tags back as commands, and they read back the same", () => {
	const { nodes } = parsed();
	const names = namesFromNodes(nodes);
	const lines = collectLines(nodes);
	const out = buildPgn({ lines, names });
	assert.match(out, /\[%name "Najdorf"\] \[%tags "d6; Nc3 committed"\]/);
	assert.deepStrictEqual(namesFromNodes(parsePgn(out).nodes), names);
});
```

- [ ] **Step 2: Run** `node --test tests/names.test.mjs` — expect FAIL (module not found).

- [ ] **Step 3: Implement.**
  - `src/pgn.js`, comment branch of `parseSeq`: before the existing
    `.replace(/\[%.*?\]/g, "")`, read `const cmd = readNameCmd(text)` (import
    from `./names.js`) and, if `cmd && last`, set `last.posName = cmd`. Then
    strip as now. Keep the `if (!text) continue` after stripping, so a
    comment holding only commands is dropped as today. Watch for a circular
    import: `names.js` must not import `pgn.js` at module top level in a way
    that breaks — importing `fenMap` from `pgn.js` is fine for ES modules as
    long as neither uses the other at load time.
  - `src/pgn-out.js`, `buildPgn(state)`: after `annotate(...)`, if
    `state.names` has keys, walk `tree.trunk` and every nested `variations`
    replaying SANs with chess.js from the start (a variation starts from the
    position before its first move's sibling — replay the path: keep a stack
    of FENs) and, for each node whose resulting `posKey` is in `state.names`,
    `n.comments.unshift(nameCmd(state.names[key]))`. Only the first node
    reaching a key gets it (track a `Set` of written keys) — a transposition
    named twice would read back fine but is noise.
  - `src/names.js` as specified in Interfaces.

- [ ] **Step 4: Run** `node --test tests/names.test.mjs tests/pgn.test.mjs tests/pgn-out.test.mjs` — expect all PASS.

- [ ] **Step 5: Commit** — "Read and write named positions as PGN commands, and derive the variation tree"

---

### Task 2: train.js — cards, checks, scheduling, sessions, progress

**Files:**
- Create: `src/train.js`, `tests/train.test.mjs`

**Interfaces:**
- Consumes: `variationTree`, `VNode` (Task 1); `posKey` from `src/audit.js`;
  `fenMap` from `src/pgn.js`; `isMainLine` from `src/tree.js`.
- Produces (exported from `src/train.js`):

```js
export const DAY = 86400000;
export const DEFAULT_SETTINGS = {
	types: { name: true, order: true, family: false, book: true },
	nameMode: "choice",      // "choice" | "typed"
	choices: 4,
	showMoves: false,        // name/family cards: list the moves that led there
	orderHint: false,        // order cards: show the target position
	familyShowName: true,
	familyGroup: [],         // [] = all tags; else pick-one among these tags
	bookSide: "black",       // "white" | "black" | "both"
	bookRule: "any",         // "any" | "main"
	masteryBox: 3,
	intervals: [0, 1, 3, 7, 16, 35], // days per box 0..5
	newPerSession: 10,
	sessionLength: 20,       // 0 = unlimited
};
// Card = { id, type: "name"|"order"|"family"|"book", key, vkey, level,
//          // book only:
//          sans: string[], moves: string[], main: string|null, notes: Record<san, string> }
// id = `${type}|${key}`; vkey = owning variation key ("" for the unnamed whole-workbook bucket)
export function buildDeck(tree, lines, settings) -> Card[]
export function normalizeSettings(raw) -> settings   // DEFAULT_SETTINGS merged, bad values replaced
export function emptyProgress() -> { settings, cards: {} }
export function loadProgress(id) -> progress          // localStorage `ott-train:${id || "unsaved"}`, defensive
export function saveProgress(id, progress) -> boolean
export function moveProgress(fromId, toId) -> void    // copy key, delete old
export function isDue(rec, settings, now) -> boolean  // rec undefined -> false (new, not due)
export function isMastered(vkey, deck, progress, settings) -> boolean
export function unlockedKeys(tree, deck, progress, settings) -> Set<vkey>
export function bookOpen(vkey, deck, progress, settings) -> boolean
export function newSession(deck, tree, progress, settings, { now, scope = null, practice = false, rng = Math.random }) -> Session
// Session = { queue: Card[], i: number, results: {id, right, from, to}[], unlockedBefore: Set<vkey> }
export function current(session) -> Card | null
export function answer(session, progress, card, right, settings, now) -> void
export function sessionSummary(session, tree, deck, progress, settings, now) -> { right, wrong, up: string[], down: string[], unlocked: string[], nextDue: number|null }
export function markKnown(progress, vkey, deck, settings, now) / skip(progress, vkey, deck, on) / resetVar(progress, vkey, deck) / setBox(progress, vkey, deck, box, now)
export function checkName(input, name) -> boolean
export function nameChoices(card, tree, settings, rng) -> string[]   // includes the right name, length <= settings.choices
export function orderStep(orders, played, san) -> { ok: boolean, done: boolean, accepted: string[] }
export function checkFamily(selected: string[], tags: string[]) -> boolean
export function checkBook(card, san, settings) -> boolean
export function allTags(tree) -> string[]                          // sorted unique
```

Behaviour (the tests below pin it down):
- **Deck.** Per VNode: `name` and `order` cards when those types are on;
  `family` when on and `tags.length`. Book cards: walk each line in order,
  tracking the nearest named position at or before each position (`vkey`; ""
  when none and the tree has no roots — if the tree has roots, positions
  before the first named position make no book cards). A position whose side
  to move matches `bookSide` (`"w"` for white; both for "both") and that has
  a next move becomes a book card `book|<posKey>`; the same key from several
  lines merges: `moves` is the union of next SANs (first-seen order), `main`
  is the mainline's next SAN if a mainline (`isMainLine`) passes, `notes[san]`
  the first line comment (`line.comments` entry with `ply === that move's ply`)
  on a line playing that SAN. `sans` = the first path's SANs up to the
  position. `level` of a book card = its variation's level (0 for "").
- **Due.** `rec.skip` → never due. Box 0 → due. Else due when
  `now >= rec.seen + intervals[box] * DAY`.
- **Mastered.** Every non-book card of the variation exists in progress with
  `box >= masteryBox`. A variation with no non-book cards counts as mastered.
- **Unlocked.** Roots always (unless skipped — skip doesn't lock, it only
  excludes cards). A child is unlocked when its parent or any `also` node is
  mastered, or when any card of the child already has a record (practised or
  marked known).
- **bookOpen(vkey).** The variation is unlocked and mastered. "" is always open.
- **newSession.** Not practice: due cards whose variation is unlocked (and for
  book cards, `bookOpen`), most overdue first; then new cards (no record) from
  unlocked variations, lowest level first then deck order, up to
  `newPerSession`; cap at `sessionLength` (0 = no cap). `scope` (a vkey)
  restricts to that variation and its descendants (via `children`). Practice:
  every card in scope regardless of schedule, lock or skip, deck order, capped
  by `sessionLength`. Book cards of one variation keep deck order (a run).
- **answer.** Right: `box = min(box + 1, 5)` (a new card goes 0 → 1). Wrong:
  `box = 1`, and the card is re-inserted 3 places later in the queue (or at
  the end). `seen = now`. Push `{id, right, from, to}` to results; advance `i`.
- **sessionSummary.** `up`/`down` are card ids whose box rose/fell; `unlocked`
  are names of variations unlocked now but not in `unlockedBefore`; `nextDue`
  the earliest future due time over records (null if none).
- **Manual.** `markKnown`: every non-book card of the variation gets
  `{box: masteryBox, seen: now, skip: false}`. `skip(on)`: sets/clears `skip`
  on every card of the variation (creating `{box:0, seen:0, skip:true}` for
  new ones; clearing `skip` on a record with `seen === 0 && box === 0` deletes
  it). `resetVar`: deletes the variation's records. `setBox`: sets box on all
  its cards (book included), `seen: now`.
- **checkName.** Normalise: lowercase, strip everything but letters, digits
  and spaces, collapse spaces, trim. Accept if the input matches the whole
  name or any `/`-separated alias. "kan", "Paulsen", "kan/paulsen" all match
  "Kan/Paulsen"; "" never matches.
- **nameChoices.** Right name, then distractors: other VNodes of the same
  level first (shuffled with `rng`), then any others, no duplicates, total
  `min(settings.choices, available)`; the final array is shuffled with `rng`.
- **orderStep.** `played + san` must be a prefix of some order: `ok`.
  `done` when it equals a whole order. `accepted` = the distinct next SANs
  after `played` over all orders (returned whether or not `ok`).
- **checkFamily.** Same set, order-insensitive.
- **checkBook.** `"main"` with `card.main` → `san === card.main`; otherwise
  `card.moves.includes(san)`.

- [ ] **Step 1: Write the failing tests** in `tests/train.test.mjs`. Build a
  fixture with `parsePgn` + `collectLines` + `namesFromNodes` + `variationTree`
  from the Task 1 `PGN` (copy it in). Use `localStorage` from a jsdom window
  (`installDom()` from `tests/helpers.mjs`) for the storage tests. Cover, at
  minimum, one test each:
  1. deck: name+order cards per VNode, family only for tagged ones when
     enabled, book cards only for Black-to-move positions at or after a named
     position (bookSide "black"), merged moves/main/notes for a shared key.
  2. isDue for box 0, a box-2 record just before and after `seen + 3 days`,
     and a skipped record.
  3. unlocking: only roots before anything is learned; after `markKnown` on
     "...d6 Sicilians", Najdorf and Scheveningen unlock; Scheveningen also
     unlocks via `also` when only "...e6 Sicilians" is known.
  4. newSession ordering: due before new, new capped at `newPerSession`,
     whole queue capped at `sessionLength`, scope limits to a subtree,
     practice includes locked cards.
  5. answer: right 0→1→2…→5 cap; wrong → box 1 and the card comes back 3
     later in the queue.
  6. sessionSummary up/down/unlocked/nextDue.
  7. manual: markKnown, skip on/off (record cleanup), resetVar, setBox.
  8. checkName aliases and punctuation ("...e6 Sicilians" matches
     "e6 sicilians"); nameChoices count, includes the answer, same-level
     distractors preferred (deterministic `rng`, e.g. `() => 0`).
  9. orderStep ok/done/accepted across two orders of Scheveningen.
  10. checkFamily, checkBook any/main.
  11. load/save/move progress round trip, `normalizeSettings` repairing a
      bad value (e.g. `choices: "x"` → 4, unknown keys dropped), unreadable
      JSON → `emptyProgress()`.

- [ ] **Step 2: Run** `node --test tests/train.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement `src/train.js`** to the interface and behaviour above.
- [ ] **Step 4: Run** `node --test tests/train.test.mjs` — expect PASS; then
  `npx c8 --version >/dev/null 2>&1; node --test --experimental-test-coverage --test-coverage-include='src/train.js' --test-coverage-include='src/names.js' tests/train.test.mjs tests/names.test.mjs`
  and add tests until both files are ≥ 97% lines and functions, ≥ 87% branches.
- [ ] **Step 5: Commit** — "Add the Train mode's cards, scheduling and progress"

---

### Task 3: Workbook plumbing — names in state, store, Save to file

**Files:**
- Modify: `src/store.js` (`toNotebook`, `parseWorkbook` untouched), `src/app.js`
  (`freshState`, `workbookState`, `installNotebook`, `loadPgnText`,
  `saveWorkbook`, the Save to file handler, `openWorkbookFile`)
- Test: `tests/store.test.mjs` (extend), `tests/train-app.test.mjs` (create)

**Interfaces:**
- Consumes: `namesFromNodes` (Task 1); `loadProgress`, `saveProgress`,
  `moveProgress`, `emptyProgress` (Task 2).
- Produces: `getCurrent().names` — always an object (`{}` when none).
  `toNotebook({..., names, train})` writes `names` when non-empty and `train`
  only when passed (Save to file passes it; localStorage Save does not).
  `installNotebook(nb, id)`: `names = { ...namesFromNodes(nodes), ...(nb.names || {}) }`;
  if `nb.train` is an object, `saveProgress(id, nb.train)` (id may be null →
  "unsaved" key). `loadPgnText`: `names = namesFromNodes(nodes)`.
  `saveWorkbook`: when the workbook had no id before this save, call
  `moveProgress(null, newId)` after the id is assigned.

- [ ] **Step 1: Failing tests.**
  - `tests/store.test.mjs`: `toNotebook` with `names: {k: {name:"N", tags:[]}}`
    carries them; with `names: {}` omits the field; `train` carried only when
    given.
  - `tests/train-app.test.mjs` (pattern of `tests/study-app.test.mjs`,
    `bootApp()`): loading a PGN containing `{[%name "Najdorf"]}` gives
    `getCurrent().names` one entry; Save (the toolbar button; stub `prompt`
    as other app tests do if needed) stores `names` in localStorage `ott:<id>`;
    progress saved under `ott-train:unsaved` before the first Save moves to
    `ott-train:<id>` after it; opening a workbook file whose JSON has
    `train` restores it under the right key (use the same file-open path the
    workbook tests use — see `tests/workbook-io.test.mjs`).
- [ ] **Step 2: Run** them — expect FAIL.
- [ ] **Step 3: Implement** as in Interfaces. The Save to file handler passes
  `train: loadProgress(getCurrent().id)` into `toNotebook`.
- [ ] **Step 4: Run** `node --test tests/store.test.mjs tests/train-app.test.mjs tests/workbook-io.test.mjs tests/app.test.mjs` — PASS.
- [ ] **Step 5: Commit** — "Keep named positions with the workbook, and Train progress in its file"

---

### Task 4: Naming positions — table menu and Study

**Files:**
- Modify: `src/table-menu.js` (both branches of `buildInto`, next to
  "Study from here"), `src/study-view.js` (trail + button), `src/app.js`
  (render hook `nameAt(moves)`), `style.css`
- Test: `tests/table-menu.test.mjs`, `tests/study-app.test.mjs` (extend)

**Interfaces:**
- Consumes: `setName`, `trailOf` (Task 1); `getCurrent().names` (Task 3).
- Produces: render hook `getRenderHooks().nameAt(moves: {san}[])` registered
  in app.js: computes the FEN after `moves` (chess.js replay), asks
  `prompt("Name for this position (blank removes it):", existing?.name || "")`;
  `null` → nothing; then
  `prompt("Tags, separated by ; (optional):", existing?.tags.join("; ") || "")`
  (`null` → keep existing tags); `setName(...)`; `renderApp()`.
  Table menu item **Name this position…** calls it with `movesUpTo(...)` exactly
  like "Study from here". Study: above the move list (in `studyPanel`, near the
  line heading) a `.st-trail` element: the `trailOf` names for the moves played
  so far joined with " › " (hidden when empty), and a chip
  **Name this position…** that calls `getRenderHooks().nameAt(played moves)`
  then `onChange()`. `studyPanel` reads names via `getCurrent().names`.
- [ ] **Step 1: Failing tests** — table menu shows the item and calls the hook
  with the right moves; Study shows "...d6 Sicilians › Najdorf" after stepping
  to 5...a6 in a PGN with those names; the Study button calls the hook.
- [ ] **Step 2–4:** run (FAIL), implement, run
  `node --test tests/table-menu.test.mjs tests/study-app.test.mjs tests/study.test.mjs` (PASS).
- [ ] **Step 5: Commit** — "Name a position from the table or the study, and show the trail of names in Study"

---

### Task 5: train-view.js — the window's screens

**Files:**
- Create: `src/train-view.js`, `tests/train-view.test.mjs`
- Modify: `style.css` (a `/* Train */` block next to the Study rules, ~line 1890)

**Interfaces:**
- Consumes: Task 2's API; `boardSvg` (`src/render.js`); `interactiveBoard`
  (`src/board-input.js`); `el` (`src/dom.js`); `chipBtn` (`src/analysis-view.js`).
- Produces:

```js
// ui = { screen: "outline"|"question"|"summary"|"settings", session, card,
//        picked: string|null, typed: string, played: string[], answered: null|{right, detail},
//        scope: vkey|null, open: Set<vkey> (outline expanded nodes), flipped: boolean }
export function newTrainUi(scope = null) -> ui
export function trainPanel(ui, { tree, deck, progress, lines, workbookId }, onChange, now = Date.now()) -> HTMLElement
```

`trainPanel` is a pure function of its inputs: every control mutates `ui`
and/or `progress` (then `saveProgress(workbookId, progress)`) and calls
`onChange()`. Screens:

- **outline** (`.tr-outline`): a header row with **Start** (`.tr-start`,
  scheduled session; disabled with text "Nothing due" when the session would be
  empty), **Settings** (`.tr-settings-open`), and a count "N due · M new". Then
  the tree: one `.tr-var` row per VNode (nested `<ul>`), showing name, level,
  a mastery bar (`.tr-bar`, width = mastered non-book cards / non-book cards),
  due count, and state badges "locked"/"skipped"; a ▸/▾ toggle for children;
  per-row actions in a small menu or chips: **Practice** (`.tr-practice`,
  practice session scoped to it), **Known** (`.tr-known`), **Skip/Unskip**
  (`.tr-skip`), **Reset** (`.tr-reset`, `confirm()` first), **Box…**
  (`.tr-box`, a `<select>` 0–5). `ui.scope` set → only that subtree is listed,
  with a "Whole workbook" chip to clear it. No named positions → a `.tr-empty`
  paragraph: "Name positions (right-click a move in the table → Name this
  position…) to be quizzed on them. Until then, Start drills the book moves."
- **settings** (`.tr-settings`): checkboxes for the four types; name mode
  select; choices number (2–8); show moves; order hint; family show name;
  family group (checkbox per `allTags(tree)`); book side select; book rule
  select; mastery box (1–5); intervals (six number inputs); new per session;
  session length. Every change writes `progress.settings` via
  `normalizeSettings`, saves, re-renders. **Done** returns to outline.
- **question** (`.tr-question`): prompt text in `.tr-prompt`, the board, the
  answer area, and after answering a `.tr-result` (`.right`/`.wrong`) with the
  correct answer, the book note when there is one, and **Next** (`.tr-next`,
  also Enter). A progress line "Question i of n".
  - name: board = `boardSvg(cardFen)` (static); `showMoves` lists the moves.
    Choice mode: buttons `.tr-choice` (keys 1–9). Typed: an input `.tr-typed`
    + **Check**.
  - order: prompt "Play the moves to the <name>"; `interactiveBoard` on the
    position after `ui.played`; each move goes through `orderStep`; wrong →
    answered wrong, show `accepted`; done → answered right and list the other
    orders ("Also reached by: …"). `orderHint` shows a small static board of
    the target beside it.
  - family: board + optional name; checkboxes `.tr-tag` per tag (or radio
    buttons when `familyGroup` non-empty, restricted to that group) and
    **Check**.
  - book: prompt "<variation name or 'Book'>: find the move"; the moves so far
    (`card.sans`) as text; `interactiveBoard` on that position, flipped when
    `bookSide` is "black" (or by `ui.flipped`); first move played is the
    answer; show `card.moves` (and the main move) and `card.notes[...]`.
  - Answering calls `answer(...)` from train.js and saves progress.
- **summary** (`.tr-summary`): "Right r / n", lists of moved-up and moved-down
  card names (card id → variation name + type), newly unlocked names, next
  review ("next review: in 2 days" / "now"), and **Back to the outline**.
- Ending: when `current(session)` is null after Next → summary.

Card FEN for name/order/family/book: replay `card.sans` (book) or
`tree.byKey.get(card.key).orders[0]` with chess.js; pass `.fen()` to the board.

- [ ] **Step 1: Failing tests** in `tests/train-view.test.mjs` using
  `installDom()` and a fixture built as in Task 2 (progress via
  `emptyProgress()`, `workbookId: "t1"`). Cover: outline lists roots and
  shows "locked" on a locked child; Known/Skip/Reset/Box update progress and
  re-render; Practice starts a question screen scoped to that variation;
  Start → question → pick the right `.tr-choice` → `.tr-result.right` →
  Next … → summary with "Right"; typed mode accepts an alias; an order card
  played correctly through `orderStep` (drive it by calling the board's move
  callback — find how `tests/analysis-view.test.mjs` simulates a board move
  and reuse that); a wrong book move shows the book moves and the note;
  settings change persists to `localStorage["ott-train:t1"]`; empty tree
  shows `.tr-empty`.
- [ ] **Step 2–4:** run (FAIL), implement, run `node --test tests/train-view.test.mjs` (PASS), and check coverage of `src/train-view.js` ≥ 97/87/97 as in Task 2 Step 4.
- [ ] **Step 5: Commit** — "Add the Train window's outline, settings, questions and summary"

---

### Task 6: App wiring — toolbar, overlay, Train from here

**Files:**
- Modify: `src/state.js` (`setMode` accepts `"train"`), `src/app.js`
  (`openTrain`, `trainOverlay`, `rerenderTrain`, toolbar **Train** chip after
  **Study**, `renderApp` re-adds the overlay, render hooks `openTrain`),
  `src/table-menu.js` (**Train from here**), `style.css` (`.tr-overlay`/
  `.tr-window` sizing like `.st-window`)
- Test: `tests/train-app.test.mjs` (extend), `tests/table-menu.test.mjs`

**Interfaces:**
- Consumes: `newTrainUi`, `trainPanel` (Task 5); `variationTree` (Task 1);
  `buildDeck`, `loadProgress` (Task 2); `visibleLines`, `editorOrder`.
- Produces: `export function openTrain(moves = [])` in app.js, mirroring
  `openStudy`: builds `{ tree, deck, progress, lines, workbookId }` once at
  open from `visibleLines(lines)` in `editorOrder` order and
  `getCurrent().names`; `moves` non-empty → `ui.scope` = the key of the last
  named position in `trailOf(sans, names)` (null if none) and the screen opens
  on the outline scoped there. Overlay: `.modal-overlay an-overlay tr-overlay`,
  window `.modal an-window tr-window`, title `#tr-title` "Train", ✕ / Escape /
  backdrop close (Escape always closes the window),
  `role="dialog"`, `aria-modal`, focus handling like `studyOverlay`.
  Table menu **Train from here** calls `getRenderHooks().openTrain(movesUpTo(...))`.
- [ ] **Step 1: Failing tests** — toolbar **Train** opens `.tr-window` and
  sets `getMode() === "train"`; Escape and ✕ close it; a full `renderApp()`
  keeps it open; **Train from here** on a move after 5...a6 opens scoped to
  Najdorf; answering a card persists `ott-train:<id>` for a saved workbook.
- [ ] **Step 2–4:** run (FAIL), implement, run
  `node --test tests/train-app.test.mjs tests/table-menu.test.mjs tests/app-toolbar.test.mjs` (PASS).
- [ ] **Step 5: Commit** — "Open Train from the toolbar and the table"

---

### Task 7: Name the positions in Davis's study PGN (outside the repo)

Done by hand outside the repo. That PGN is private and is not quoted
or committed here.

---

### Task 8: Docs and e2e

**Files:**
- Modify: `docs/user-guide.md` (a "Train" section after "Study"),
  `README.md` (a **Train** bullet after the Study one), `docs/architecture.md`
  (the three new modules in its module list, one line each)
- Create: `e2e/train.spec.mjs` (pattern of `e2e/study.spec.mjs`)

- [ ] **Step 1:** Docs: explain naming positions (table menu, Study, PGN
  `[%name "…"] [%tags "a; b"]`), the four quiz types, levels/unlocking, the
  review schedule, manual controls, settings, where progress lives (this
  browser, per workbook; included in Save to file; not in PGN or shared links).
- [ ] **Step 2:** e2e: load a small named PGN through the import UI, open
  Train, Start, answer one name card by clicking the right choice, see the
  result, Next, close. Run `npx playwright test e2e/train.spec.mjs`.
- [ ] **Step 3:** Run `npm run check` — PASS.
- [ ] **Step 4: Commit** — "Document Train mode and test it end to end"
