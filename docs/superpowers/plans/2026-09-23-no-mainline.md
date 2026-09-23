# No Mainline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-notebook **No mainline** tickbox that makes every line a peer — no reference column, no elided `…` prefix, no `★ Make mainline`, and the first line as tag-able, hide-able and footnote-able as any other.

**Architecture:** The mainline becomes an empty line. `divergence(l, {moves: []})` is 0 for every line, so nothing elides a prefix, and `buildTrie` then roots at ply 1 — which makes the existing group columns scaffold the whole game instead of the divergent tails. Three new functions in `src/tree.js` (`mainOf`, `isMainLine`, `EMPTY_MAIN`) are the only place the flag is read; everything else is those two calls replacing the open-coded `lines.find((l) => l.isMain) || lines[0]` and the bare `l.isMain`.

**Tech Stack:** Vanilla ES modules, no framework. `node --test` + jsdom. `npm test`, `npm run lint`, `npm run knip`.

**Spec:** `docs/superpowers/specs/2026-09-23-no-mainline-design.md`

## Global Constraints

- The flag defaults **off**. The entire existing test suite must stay green with no changes to its expectations — that is the regression guard for every rewritten site.
- `l.isMain` is never mutated or deleted by this feature. Writers (`tree.js:98`, `line-editor.js:118-121`, `merge.js:194-204`, `store.js:80`) are left exactly as they are, so ticking and unticking the box is lossless.
- `src/pgn-out.js` keeps its open-coded `lines.find((l) => l.isMain) || lines[0]`. A `.pgn` has no representation for "no mainline"; export keeps writing a real trunk.
- `store.js:26` keeps writing a real `nb.main`.
- Clearing a flag DELETES the property rather than writing a falsy value — the existing rule in `line-editor.js`'s `apply()`. `view.noMain` is the exception, as `view` is a plain settings bag where `showBoards: false` is already written.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Stay on branch `analysis-board`. Do **not** merge or push to `master`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/tree.js` | **Modify.** The seam: `EMPTY_MAIN`, `noMain()`, `mainOf(lines)`, `isMainLine(l)`. Imports `getCurrent` from `state.js`. `divergence`/`buildTrie`/`collectLines` stay pure. |
| `src/app.js` | **Modify.** `noMain` in `freshState()` and in the `view` save/restore; the **No mainline** tickbox; the editor panel's mainline row and copy. |
| `src/store.js` | **Modify.** `view.noMain` round-trip; `mainOf` for the `nb.main` lookup's *sibling* reads only. |
| `src/table.js` | **Modify.** `grid()`: the synthetic mainline var, `noMain` on the result. |
| `src/group-cols.js` | **Modify.** `groupedVars`/`flatGroupedVars` skip pushing a synthetic `mainV`. |
| `src/render.js` | **Modify.** `main-col`/`sticky-col` only when there is a mainline; cards skip a synthetic var. |
| `src/export.js` | **Modify.** Markdown skips a synthetic var. |
| `src/visibility.js` | **Modify.** `setHidden`/`solo`/`isFocused` use `isMainLine`. |
| `src/line-editor.js` | **Modify.** `isMainLine`; `★ Make mainline` suppressed when `noMain`. |
| `src/table-menu.js` | **Modify.** `isMainLine`. |
| `src/notes.js` | **Modify.** `mainOf`/`isMainLine`; an unanchorable footnote is skipped rather than filed against the empty main. |
| `src/foot-groups.js`, `src/analysis-commit.js`, `src/merge.js` | **Modify.** `mainOf`/`isMainLine` at their existing lookups. |
| `tests/no-mainline.test.mjs` | **Create.** The flag's own end-to-end behaviour through `bootApp`. |
| `tests/tree.test.mjs`, `table.test.mjs`, `trie-view.test.mjs`, `visibility.test.mjs`, `line-editor.test.mjs`, `notes.test.mjs`, `store.test.mjs`, `pgn-out.test.mjs`, `print.test.mjs`, `export.test.mjs` | **Modify.** Per-module `noMain` coverage. |
| `README.md` | **Modify.** Document the tickbox. |

---

### Task 1: The seam in `src/tree.js`

**Files:**
- Modify: `src/tree.js:1-20`
- Test: `tests/tree.test.mjs`

**Interfaces:**
- Consumes: `getCurrent` from `src/state.js` (already exists).
- Produces: `EMPTY_MAIN` (frozen `{moves: [], marks: {}, comments: [], synthetic: true}`), `noMain(): boolean`, `mainOf(lines): line`, `isMainLine(line): boolean`. Every later task uses these exact names.

- [ ] **Step 1: Write the failing test**

Append to `tests/tree.test.mjs`:

```js
import { EMPTY_MAIN, mainOf, isMainLine, divergence } from "../src/tree.js";
import { setCurrent } from "../src/state.js";

test("mainOf finds the isMain line, or falls back to the first", () => {
	setCurrent({ lines: [] });
	const a = { moves: [{ san: "e4", ply: 0 }] };
	const b = { moves: [{ san: "d4", ply: 0 }], isMain: true };
	assert.strictEqual(mainOf([a, b]), b);
	assert.strictEqual(mainOf([a]), a);
});

test("isMainLine is the line's own flag while the mainline is enabled", () => {
	setCurrent({ lines: [] });
	assert.strictEqual(isMainLine({ isMain: true }), true);
	assert.strictEqual(isMainLine({}), false);
});

test("noMain makes the reference an empty line and no line the mainline", () => {
	setCurrent({ lines: [], noMain: true });
	const b = { moves: [{ san: "d4", ply: 0 }], isMain: true };
	assert.strictEqual(mainOf([b]), EMPTY_MAIN);
	assert.strictEqual(isMainLine(b), false);
	// which is the whole point: nothing elides a prefix
	assert.strictEqual(divergence(b, EMPTY_MAIN), 0);
	setCurrent(null);
});

test("mainOf survives no state at all", () => {
	setCurrent(null);
	const a = { moves: [] };
	assert.strictEqual(mainOf([a]), a);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- --test-name-pattern="mainOf|isMainLine|noMain"`
Expected: FAIL — `SyntaxError: The requested module '../src/tree.js' does not provide an export named 'EMPTY_MAIN'`.

- [ ] **Step 3: Implement**

In `src/tree.js`, add to the imports at the top (below the `nags.js` import):

```js
import { getCurrent } from "./state.js";
```

and after the `isDefaultLineName` export:

```js
// The reference the whole table is measured against.
//
// With the mainline disabled it is an EMPTY line, which is the whole feature:
// divergence() is then 0 for every line, so no line elides a prefix, and
// buildTrie() roots at ply 1 instead of at each line's divergent tail -- so the
// group columns scaffold the whole game. No layout code knows about the flag.
//
// Frozen because it is shared by every caller in a render, and a renderer that
// wrote to `.marks` on it would leak into the next one.
export const EMPTY_MAIN = Object.freeze({
	moves: [],
	marks: {},
	comments: [],
	synthetic: true,
});

// The three readers of the flag. `l.isMain` stays on the line and stays
// persisted (see store.js) -- what the flag changes is every READ of it, which
// is now a question about the notebook and not only about the line. That is
// what makes the tickbox lossless: ticking it does not forget which line had
// been promoted, so unticking restores the table you had.
export const noMain = () => !!(getCurrent() && getCurrent().noMain);
export const mainOf = (lines) =>
	noMain() ? EMPTY_MAIN : lines.find((l) => l.isMain) || lines[0];
export const isMainLine = (l) => !noMain() && !!l.isMain;
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- --test-name-pattern="mainOf|isMainLine|noMain"` → PASS
Run: `npm test` → all green (nothing calls the new functions yet).

- [ ] **Step 5: Commit**

```bash
git add src/tree.js tests/tree.test.mjs
git commit -m "$(printf 'Add the mainline seam: mainOf, isMainLine, EMPTY_MAIN\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 2: The flag and its persistence

**Files:**
- Modify: `src/app.js:62-75` (`freshState`), `src/app.js:245-260` (the `view` bag), the `view` restore beside it, `src/app.js:665-674` (`viewControls`)
- Test: `tests/store.test.mjs`, `tests/app-toolbar.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `current.noMain` (boolean) and `view.noMain` in the saved workbook. Task 1's `noMain()` reads it.

- [ ] **Step 1: Write the failing test**

Append to `tests/store.test.mjs` (follow the file's existing `toNotebook`/`applyNotebook` setup):

```js
test("view.noMain rides the workbook", () => {
	const nb = toNotebook({
		name: "n",
		pgn: "1. e4 e5",
		lines: [{ moves: [{ san: "e4", ply: 0 }], isMain: true }],
		view: { noMain: true },
	});
	assert.strictEqual(nb.view.noMain, true);
	assert.strictEqual(JSON.parse(JSON.stringify(nb)).view.noMain, true);
});

test("a promoted mainline is still recorded while noMain is on", () => {
	const a = { moves: [{ san: "e4", ply: 0 }] };
	const b = { moves: [{ san: "d4", ply: 0 }], isMain: true };
	const nb = toNotebook({ name: "n", pgn: "", lines: [a, b], view: { noMain: true } });
	// unticking the box must restore the table the user had
	assert.strictEqual(nb.main, "d4");
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- tests/store.test.mjs`
Expected: the first test FAILS (`undefined !== true`) because `view` is passed through verbatim but `app.js` never puts `noMain` in it; the second already PASSES, and is there to pin the losslessness so a later task cannot quietly break it.

Note: `store.js:toNotebook` already copies `view` wholesale (`view: view || {}`), so the failure is in `app.js`'s `view` bag, not in `store.js`.

- [ ] **Step 3: Implement**

In `src/app.js`'s `freshState()`, beside `showBoards: false`:

```js
    showBoards: false,
    // No mainline: every line is a peer. See tree.js's mainOf/isMainLine --
    // the flag is read there and nowhere else.
    noMain: false,
```

In the `view:` bag (`app.js:245`), beside `showBoards: c.showBoards`:

```js
      showBoards: c.showBoards,
      noMain: c.noMain,
```

In the `openNotebook` restore (`app.js:538`, the `freshState({...})` call), beside `showBoards: view.showBoards ?? getCurrent().showBoards`:

```js
      noMain: !!view.noMain,
```

`!!` rather than the neighbours' `??` fallback on purpose: the session's own `noMain` is not a sensible default to inherit. Opening a notebook saved without the flag should give you the mainline back, not whatever the last notebook you had open was doing.

In `viewControls()` (`app.js:665-674`), after the `Board diagrams` label:

```js
  const nm = el("label", {}, [
    "No mainline ",
    el("input", { type: "checkbox", checked: !!getCurrent().noMain }),
  ]);
  nm.title =
    "every line is a peer: no reference column, and no line is privileged";
  nm.querySelector("input").onchange = (e) => {
    getCurrent().noMain = e.target.checked;
    // The trie now spans the whole game rather than the divergent tails, so
    // every remembered open path is keyed off a root that no longer exists.
    openPaths.clear();
    openTablePaths.clear();
    setTraced(null);
    renderApp();
  };
  bar.appendChild(nm);
```

Check `app.js`'s existing imports from `./state.js` cover `openPaths`, `openTablePaths` and `setTraced`; add whichever is missing.

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/store.test.mjs` → PASS
Run: `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/app.js tests/store.test.mjs
git commit -m "$(printf 'Add the No mainline tickbox and save it with the notebook\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 3: Route every mainline read through the seam

This task changes no behaviour — the flag is off everywhere — so the existing suite staying green IS its test. It is a separate task because it is the one place a typo hides, and a reviewer should be able to reject it on its own.

**Files:**
- Modify: `src/app.js:681,756`, `src/analysis-commit.js:56`, `src/export.js:20,30,32`, `src/store.js:26,80,87,89`, `src/notes.js:60,66,88,132`, `src/table.js:25,36`, `src/line-editor.js:26,146,156,164,169`, `src/merge.js:202,209,210`, `src/visibility.js:25,45,47`, `src/foot-groups.js:9`, `src/table-menu.js:219`
- Test: the whole existing suite

**Interfaces:**
- Consumes: `mainOf`, `isMainLine` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: List the sites**

Run: `grep -rn "isMain" src/ | grep -v "^src/pgn-out.js" | grep -v "//"`

Expect ~32 lines. Two patterns:

- `lines.find((l) => l.isMain) || lines[0]` → `mainOf(lines)`
- a bare read `l.isMain` / `x.isMain` in a condition → `isMainLine(l)`

- [ ] **Step 2: Rewrite the lookups**

Replace each of these with `mainOf(...)`, adding `import { mainOf } from "./tree.js";` (or extending the existing `tree.js` import) per file:

| File:line | Before | After |
| --- | --- | --- |
| `app.js:681` | `getCurrent().lines.find((l) => l.isMain) \|\| getCurrent().lines[0]` | `mainOf(getCurrent().lines)` |
| `analysis-commit.js:56` | `lines.find((l) => l.isMain) \|\| lines[0]` | `mainOf(lines)` |
| `export.js:32` | `getCurrent().lines.find((x) => x.isMain) \|\| getCurrent().lines[0]` | `mainOf(getCurrent().lines)` |
| `notes.js:60` | `lines.find((l) => l.isMain) \|\| lines[0]` | `mainOf(lines)` |
| `table.js:25` | `lines.find((l) => l.isMain) \|\| lines[0]` | `mainOf(lines)` |
| `line-editor.js:146` | `getCurrent().lines.find((x) => x.isMain) \|\| getCurrent().lines[0]` | `mainOf(getCurrent().lines)` |
| `merge.js:202` | `oldLines.find((l) => l.isMain)` | leave as is — see Step 4 |
| `store.js:26` | `lines.find((l) => l.isMain) \|\| lines[0]` | leave as is — Global Constraints |
| `pgn-out.js:41,185` | — | leave as is — Global Constraints |

- [ ] **Step 3: Rewrite the reads**

Every remaining bare read becomes `isMainLine(x)`. Add `isMainLine` to each file's `tree.js` import.

- `visibility.js:25` `if (l.isMain) return;` → `if (isMainLine(l)) return;`
- `visibility.js:45` `keep.filter((l) => !l.isMain)` → `keep.filter((l) => !isMainLine(l))`
- `visibility.js:47` `all.filter((l) => !l.hidden && !l.isMain)` → `all.filter((l) => !l.hidden && !isMainLine(l))`
- `table.js:36` `const isMain = !!l.isMain;` → `const isMain = isMainLine(l);`
- `notes.js:66` `const isFoot = (l) => !l.isMain && l.tag === "foot";` → `!isMainLine(l) && …`
- `notes.js:88` `(d === bestD && c.isMain)` → `(d === bestD && isMainLine(c))`
- `notes.js:132` `if (!l.isMain && l.tag === "foot" && main && …)` → `if (!isMainLine(l) && l.tag === "foot" && main && …)`
- `foot-groups.js:9` same shape as `notes.js:66`
- `export.js:20` `getCurrent().lines.filter((l) => l.isMain)` → `.filter((l) => isMainLine(l))`
- `export.js:30` `if (l.isMain) return "";` → `if (isMainLine(l)) return "";`
- `line-editor.js:26` `const isMain = !!l.isMain;` → `const isMain = isMainLine(l);`
- `line-editor.js:156,164,169` `!l.isMain` / `l.isMain ?` → `isMainLine(l)`
- `table-menu.js:219` `if (line.isMain)` → `if (isMainLine(line))`
- `app.js:756` `if (!l.isMain)` → `if (!isMainLine(l))`
- `store.js:87,89` and `merge.js:209,210` — `l.tag = l.isMain ? …` and `l.hidden = !l.isMain && …` → `isMainLine(l)`. These normalise a line on the way IN, and with `noMain` on, "the mainline carries no tag and is never hidden" must not apply to any line, so they follow the flag like the rest.

- [ ] **Step 4: Leave the writers alone**

Do **not** touch: `tree.js:98` (`isMain: true` in `collectLines`), `line-editor.js:118-121` (`promoteMainline`), `merge.js:194,202,204` (reconciling `isMain` across two parses of one PGN), `store.js:80` (restoring `nb.main`). `merge.js:202` is a writer's lookup, not a render's reference — it asks "which line did the old parse call the mainline", which is about `isMain` itself.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all green, unchanged. Any failure here is a typo in this task, not a design problem.

Run: `npm run lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "$(printf 'Route every mainline read through mainOf and isMainLine\n\nNo behaviour change: the flag is off. The writers of l.isMain are left\nalone, and pgn-out keeps its own lookup -- a .pgn needs a real trunk.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 4: `grid()` emits a synthetic mainline var

**Files:**
- Modify: `src/table.js:20-91`, `src/group-cols.js:41-46`, `src/print.js:27-28` (`flatGroupedVars`, in `group-cols.js` — confirm which file defines it with `grep -n "flatGroupedVars" src/*.js`)
- Test: `tests/table.test.mjs`

**Interfaces:**
- Consumes: `mainOf`, `noMain`, `EMPTY_MAIN` from Task 1.
- Produces: `grid()` returns `{ vars, maxPly, mainMoves, footNotes, noMain }`. `vars[0]` is still the mainline var; when `noMain` it carries `synthetic: true`, `tag: "mainline"`, `moves: []`, `cells: {}`, `d: 0`, `line: null`. Tasks 5-7 read `grid.noMain` and `v.synthetic`.

- [ ] **Step 1: Write the failing test**

Append to `tests/table.test.mjs` (use the file's existing `loadState` helper import):

```js
test("noMain: no line elides a prefix and none is the mainline", () => {
	const st = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6");
	st.noMain = true;
	const g = grid(st.lines);
	assert.strictEqual(g.noMain, true);
	const rows = g.vars.filter((v) => !v.synthetic);
	assert.ok(rows.length >= 2);
	for (const v of rows) {
		assert.strictEqual(v.d, 0, `${v.name} still diverges`);
		assert.notStrictEqual(v.tag, "mainline");
		const ellip = Object.values(v.cells).filter((c) => c.cls === "ellip");
		assert.strictEqual(ellip.length, 0, `${v.name} still elides`);
	}
});

test("noMain: the mainline var is synthetic and still sorts first", () => {
	const st = loadState("1. e4 e5 (1... c5) 2. Nf3");
	st.noMain = true;
	const g = grid(st.lines);
	assert.strictEqual(g.vars[0].synthetic, true);
	assert.strictEqual(g.vars[0].tag, "mainline");
	assert.deepStrictEqual(g.vars[0].moves, []);
	assert.deepStrictEqual(g.mainMoves, []);
});

test("the mainline var is real and not synthetic by default", () => {
	const st = loadState("1. e4 e5 (1... c5) 2. Nf3");
	const g = grid(st.lines);
	assert.strictEqual(g.vars[0].tag, "mainline");
	assert.strictEqual(g.vars[0].synthetic, undefined);
	assert.strictEqual(g.noMain, false);
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- tests/table.test.mjs`
Expected: FAIL — `g.noMain` is `undefined`, and `g.vars[0]` is the first real line.

- [ ] **Step 3: Implement `grid()`**

In `src/table.js`, extend the import:

```js
import { divergence, mainOf, noMain, EMPTY_MAIN } from "./tree.js";
```

Replace `const main = lines.find((l) => l.isMain) || lines[0];` with `const main = mainOf(lines);` (Task 3 already did this) and, after the `lines.forEach` that fills `vars`, before the sort:

```js
	// With the mainline disabled no line yields a mainline var, so grid builds
	// one for the empty reference itself. It is kept in `vars` rather than
	// dropped because four call sites read the reference as `vars[0]` and the
	// rest as `vars.slice(1)` (trie-view, print) and pass it straight into
	// groupedVars/buildTrie as the divergence reference -- keeping it there
	// leaves all four unchanged. It renders as no row: every row loop skips a
	// synthetic var, and groupedVars never pushes one as a column.
	if (noMain())
		vars.unshift({
			line: null,
			tag: "mainline",
			label: TAG_META.mainline.label,
			name: "",
			eval: "",
			note: "",
			fen: undefined,
			moves: EMPTY_MAIN.moves,
			marks: {},
			d: 0,
			cells: {},
			noteByPly: {},
			synthetic: true,
		});
```

The existing mainline-first `sort` is stable, so it leaves the synthetic var at the head.

`maxPly`'s reduce spreads `Object.keys(v.cells).map(Number)` into `Math.max`; for an empty `cells` that is `Math.max(m)`, which is `m`. No change needed.

Change the return to:

```js
	return { vars, maxPly, mainMoves: main.moves, footNotes, noMain: noMain() };
```

- [ ] **Step 4: Stop the synthetic var becoming a column**

In `src/group-cols.js`'s `groupedVars`:

```js
	const trie = buildTrie(lines, mainV);
	// A synthetic mainV is the empty reference, not a column: with the mainline
	// disabled there is nothing for it to show and nothing to read against.
	const vars = mainV.synthetic ? [] : [mainV];
```

In `src/group-cols.js`'s `flatGroupedVars` (`group-cols.js:306`) the same guard is needed, **and its span bookkeeping has to go with it.** The top-level `roots` block emits `spans.push({ ply, from: 1, to: …, tees })` — the `1` is literally "the column after the mainline", and each run is a rule drawn *from the mainline's row* out to the branch that leaves it. With no mainline there is no row for a run to leave, so the whole top-level block drops:

```js
export function flatGroupedVars(mainV, lines) {
	const trie = buildTrie(lines, mainV);
	// A synthetic mainV is the empty reference, not a column (see table.js).
	// Its top-level "runs" go with it: a run is a rule drawn FROM the mainline's
	// row out to the branch that leaves it, and there is no such row now. The
	// branches are top-level and leave nothing. Inner groups keep their own
	// runs, which pushFlat draws.
	const flat = !!mainV.synthetic;
	const vars = flat ? [] : [mainV];
	const spans = [];
	const roots = new Map();
	byDeparture(trie.children).forEach((c) => {
		const at = vars.length;
		pushFlat(c, vars, spans, -1);
		const ply = firstOwnPly(vars[at], 0) - 1;
		if (!roots.has(ply)) roots.set(ply, []);
		roots.get(ply).push(at);
	});
	if (!flat)
		roots.forEach((tees, ply) => {
			if (ply >= 0)
				spans.push({ ply, from: 1, to: tees[tees.length - 1], tees });
		});
	return { vars, spans };
}
```

`orderedLeaves` (`group-cols.js:299`) needs no change: it never puts `mainV` in its output, only uses it as the trie reference.

- [ ] **Step 5: Run the tests**

Run: `npm test -- tests/table.test.mjs` → PASS
Run: `npm test` → all green.

- [ ] **Step 6: Commit**

```bash
git add src/table.js src/group-cols.js tests/table.test.mjs
git commit -m "$(printf 'grid: a synthetic mainline var when the mainline is off\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 5: The screen table's first column stops being special

**Files:**
- Modify: `src/render.js:233` (destructure), `src/render.js:359`, `src/render.js:447`
- Test: `tests/trie-view.test.mjs`

**Interfaces:**
- Consumes: `grid.noMain` from Task 4.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `tests/trie-view.test.mjs` (follow the file's existing `installDom` + `loadState` + `renderTrieTable` setup):

```js
test("noMain: no column is pinned as the mainline", () => {
	const undo = installDom();
	const st = loadState("1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6");
	st.noMain = true;
	const box = document.createElement("div");
	renderTrieTable(box, grid(st.lines));
	assert.strictEqual(box.querySelectorAll(".main-col").length, 0);
	assert.strictEqual(box.querySelectorAll(".sticky-col.var-head").length, 0);
	// every line spells its own first move out; nothing is read against a trunk
	const texts = [...box.querySelectorAll("td, th")].map((n) => n.textContent);
	assert.ok(texts.some((t) => t.includes("e4")));
	assert.ok(texts.some((t) => t.includes("c5")));
	// and the scaffold is still there: 1.e4 is shared by two lines, so it is
	// stated once in a group column rather than once per line
	const e4cells = [...box.querySelectorAll("td")].filter(
		(n) => n.textContent.trim() === "e4",
	);
	assert.strictEqual(e4cells.length, 1, "e4 repeated per line");
	undo();
});

test("the mainline column is pinned by default", () => {
	const undo = installDom();
	const st = loadState("1. e4 e5 (1... c5) 2. Nf3");
	const box = document.createElement("div");
	renderTrieTable(box, grid(st.lines));
	assert.ok(box.querySelectorAll(".main-col").length > 0);
	undo();
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- tests/trie-view.test.mjs`
Expected: FAIL — the first real line's column still carries `main-col sticky-col`.

- [ ] **Step 3: Implement**

`src/render.js:233`:

```js
	const { vars, maxPly, noMain } = grid;
```

`src/render.js:359` (the header):

```js
				(i === 0 && !noMain ? " main-col sticky-col" : "") +
```

`src/render.js:447` (the body cell):

```js
				if (v === vars[0] && !noMain) c.classList.add("main-col", "sticky-col");
```

The `ply` column's own `sticky-col` (`render.js:352`) stays: it is the row label, not the mainline.

`render.js:477,508` (`v.tag === "mainline" ? v.moves : v.moves.slice(v.d)`) need no change — `v.d` is 0 for every line under `noMain`, so `slice(0)` is the whole line.

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/trie-view.test.mjs` → PASS
Run: `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/render.js tests/trie-view.test.mjs
git commit -m "$(printf 'Stop pinning the first column when there is no mainline\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 6: Cards and Markdown skip the synthetic var

**Files:**
- Modify: `src/render.js:532`, `src/export.js:209-215`
- Test: `tests/render.test.mjs`, `tests/export.test.mjs`

**Interfaces:**
- Consumes: `v.synthetic` from Task 4.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `tests/export.test.mjs`:

```js
test("noMain: Markdown has no Mainline entry", () => {
	const st = loadState("1. e4 e5 (1... c5) 2. Nf3");
	st.noMain = true;
	const md = buildMarkdown();
	assert.ok(!md.includes("**Mainline**"), md);
	assert.ok(md.includes("e4"), md);
	assert.ok(md.includes("c5"), md);
});

test("Markdown leads with the Mainline by default", () => {
	const st = loadState("1. e4 e5 (1... c5) 2. Nf3");
	assert.ok(buildMarkdown().includes("**Mainline**"));
});
```

`buildMarkdown` writes to a `Blob`/anchor in some paths — follow whatever the existing tests in this file do to get the string back (`captureDownloads` from `tests/helpers.mjs`, or the exported builder directly).

Append to `tests/render.test.mjs`:

```js
test("noMain: no empty card for the absent mainline", () => {
	const undo = installDom();
	const st = loadState("1. e4 e5 (1... c5) 2. Nf3");
	st.noMain = true;
	const box = document.createElement("div");
	renderCards(box, grid(st.lines), { notes: [] });
	const cards = box.querySelectorAll(".card");
	assert.strictEqual(cards.length, grid(st.lines).vars.length - 1);
	for (const c of cards) assert.ok(c.textContent.trim().length > 0);
	undo();
});
```

Check `renderCards`' real exported name and argument shape with `grep -n "export function render" src/render.js` and match the existing card tests in the file.

- [ ] **Step 2: Run them**

Run: `npm test -- tests/export.test.mjs tests/render.test.mjs`
Expected: FAIL — Markdown emits `**Mainline**:` with no moves, and the cards emit an empty card.

- [ ] **Step 3: Implement**

`src/render.js:532`:

```js
	// A synthetic mainline var is the empty reference, not a row (see table.js).
	const all = grid.vars.filter((v) => !v.synthetic);
```

`src/export.js`, in the `for (const v of g.vars)` loop:

```js
  for (const v of g.vars) {
    if (v.synthetic) continue; // the empty reference, not a line
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/export.test.mjs tests/render.test.mjs` → PASS
Run: `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/render.js src/export.js tests/export.test.mjs tests/render.test.mjs
git commit -m "$(printf 'Cards and Markdown skip the empty mainline reference\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 7: The printed report

Expected to need no `src/print.js` change at all — this task is the proof, and fixes whatever it turns up.

**Files:**
- Modify: `src/print.js` only if the test fails
- Test: `tests/print.test.mjs`, `tests/print-invariants.test.mjs`

**Interfaces:**
- Consumes: Task 4's guard in `flatGroupedVars`, `v.synthetic`.
- Produces: nothing new.

- [ ] **Step 1: Write the test**

Append to `tests/print.test.mjs` (follow its existing setup):

```js
test("noMain: the printed report has no mainline column and no stem", () => {
	const undo = installDom();
	const st = loadState("1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 3. Bb5");
	st.noMain = true;
	const box = document.createElement("div");
	appendPrintTables(box, grid(st.lines));
	assert.strictEqual(box.querySelectorAll(".print-stem").length, 0);
	assert.strictEqual(box.querySelectorAll(".main-col").length, 0);
	const heads = [...box.querySelectorAll(".var-head")].map((n) => n.textContent);
	assert.ok(!heads.includes("Mainline"), heads.join("|"));
	// every line still reaches paper
	const text = box.textContent;
	assert.ok(text.includes("Bb5"));
	assert.ok(text.includes("d6"));
	undo();
});
```

Use the real exported entry point (`grep -n "export function" src/print.js`) and the same argument shape as the file's existing tests.

- [ ] **Step 2: Run it**

Run: `npm test -- tests/print.test.mjs tests/print-invariants.test.mjs`
Expected: PASS if Task 4's `flatGroupedVars` guard was right. If it fails, the two likely causes, in order:

1. `packForPrint(mainV, others, size)` (`print.js:117`) mis-packs with a zero-move `mainV`. Fix: pass `mainV.synthetic ? null : mainV` and let `packForPrint`'s existing "no mainline to reserve a column for" path handle it, or reserve one fewer column.
2. `maxPly = i === 0 ? subMaxPly([mainV, ...lines])` (`print.js:122`) — a synthetic `mainV` contributes nothing, so this already reduces to `subMaxPly(lines)`. No fix needed.

`stemLength([mainV, ...lines])` returning 0 is correct and deliberate: with no mainline there is no lead-in stem, and a run of moves several lines share is stated by `flatGroupedVars`' group rules like any other shared run. `renderTableNotes` needs no change either — `flatGroupedVars` has already dropped the synthetic var, so its `vars.find((v) => v.tag === "mainline")` returns `undefined` and the existing `if (mainV)` guard covers it.

- [ ] **Step 3: Run the full suite**

Run: `npm test` → all green.

- [ ] **Step 4: Commit**

```bash
git add src/print.js tests/print.test.mjs
git commit -m "$(printf 'Pin the printed report against a disabled mainline\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 8: Every line is tag-able, hide-able and footnote-able

**Files:**
- Modify: `src/line-editor.js:36-60`, `src/app.js:722`, `src/app.js:741-748`, `src/table-menu.js:216-231`
- Test: `tests/line-editor.test.mjs`, `tests/visibility.test.mjs`, `tests/table-menu.test.mjs`

**Interfaces:**
- Consumes: `isMainLine`, `noMain` from Task 1 (already wired by Task 3).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Append to `tests/visibility.test.mjs`:

```js
test("noMain: the line carrying isMain can be hidden and soloed", () => {
	const a = { moves: [{ san: "e4", ply: 0 }], isMain: true };
	const b = { moves: [{ san: "d4", ply: 0 }] };
	setCurrent({ lines: [a, b], noMain: true });
	setHidden([a], true);
	assert.strictEqual(a.hidden, true);
	solo([a, b], [b]);
	assert.strictEqual(a.hidden, true);
	assert.strictEqual(b.hidden, undefined);
	assert.strictEqual(isFocused([a, b], [b]), true);
	setCurrent(null);
});

test("the mainline is still never hidden by default", () => {
	const a = { moves: [{ san: "e4", ply: 0 }], isMain: true };
	setCurrent({ lines: [a] });
	setHidden([a], true);
	assert.strictEqual(a.hidden, undefined);
	setCurrent(null);
});
```

Append to `tests/line-editor.test.mjs`:

```js
test("noMain: every row gets the tag chips and no promote button", () => {
	const undo = installDom();
	const st = loadState("1. e4 e5 (1... c5) 2. Nf3");
	st.noMain = true;
	const row = lineEditor(st.lines[0], 1, false);
	const labels = [...row.querySelectorAll("button")].map((b) => b.textContent);
	assert.ok(!labels.some((t) => t.includes("Make mainline")), labels.join("|"));
	assert.ok(labels.includes("Sideline"));
	assert.ok(labels.includes("Footnote"));
	assert.ok(labels.includes("Hide"));
	assert.strictEqual(row.querySelectorAll(".maintag").length, 0);
	assert.strictEqual(row.querySelector("input.ln").value, "Line 1");
	undo();
});

test("the mainline row keeps its tag and no chips by default", () => {
	const undo = installDom();
	const st = loadState("1. e4 e5 (1... c5) 2. Nf3");
	const row = lineEditor(st.lines[0], 0, false);
	assert.strictEqual(row.querySelectorAll(".maintag").length, 1);
	assert.strictEqual(row.querySelector("input.ln").value, "Mainline");
	undo();
});
```

Append to `tests/table-menu.test.mjs` a test that with `noMain: true` the menu for the `isMain` line offers `Move to footnote`/`Hide` and no `★ Make mainline`, and no `.tmenu-note` — matching the file's existing way of opening the menu.

- [ ] **Step 2: Run them**

Run: `npm test -- tests/visibility.test.mjs tests/line-editor.test.mjs tests/table-menu.test.mjs`
Expected: the `noMain` tests FAIL (Task 3 already fixed `visibility.js`, so those two may pass — that is fine, they are the regression pin). The `★ Make mainline` assertion FAILS: Task 3 made the `isMainLine` branch fall through to the `else`, which offers promotion.

- [ ] **Step 3: Implement**

`src/line-editor.js`, in the `else` branch that builds the chips, wrap the promote button:

```js
		tags.append(btn("sideline", "Sideline"), btn("foot", "Footnote"));
		// Nothing to promote to when the mainline is disabled.
		if (!noMain()) {
			const promote = el("button", {
				className: "chip",
				textContent: "★ Make mainline",
			});
			promote.onclick = () => {
				promoteMainline(l);
			};
			tags.appendChild(promote);
		}
```

Add `noMain` to the file's `tree.js` import.

`src/table-menu.js`, in the `else` branch:

```js
		} else {
			if (!noMain())
				box.appendChild(item("★ Make mainline", () => promoteMainline(line)));
			lineActions(box, [line]);
		}
```

`src/app.js`'s editor panel:

- `app.js:722`'s comment ("the mainline is never affected") becomes "the mainline, when there is one, is never affected".
- `app.js:741-748`: the `h3` copy and the mainline row are conditional.

```js
  box.appendChild(
    el("h3", {
      textContent: noMain()
        ? "Every line is a peer. Tag each one Sideline or Footnote; lines are shown grouped by the moves they share."
        : "The mainline is the reference row. Promote a sideline to make it the mainline; tag the rest Sideline or Footnote.",
    }),
  );
  // mainline first, then the side lines grouped as a trie of shared divergence
  if (!noMain()) box.appendChild(lineEditor(main, 0, getCurrent().showBoards));
```

The flat branch (`app.js:754-758`) already filters on `isMainLine`, which is false for everything under `noMain`, so it renders every line. The grouped branch builds from `buildTrie(shown, main)` with `main === EMPTY_MAIN`, which roots the editor's trie at ply 1 the same way the table's is — no change.

Add `noMain` to `app.js`'s `tree.js` import.

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/visibility.test.mjs tests/line-editor.test.mjs tests/table-menu.test.mjs` → PASS
Run: `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/line-editor.js src/table-menu.js src/app.js tests/
git commit -m "$(printf 'Make every line a peer in the editor and the table menu\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 9: Footnotes anchor without a trunk

**Files:**
- Modify: `src/notes.js:83-95` (`parentOf`), `src/notes.js:132`
- Test: `tests/notes.test.mjs`

**Interfaces:**
- Consumes: `mainOf`, `isMainLine`, `EMPTY_MAIN`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `tests/notes.test.mjs`. Per the repo's own note, set `line.comments` directly rather than writing a `{comment}` inside a PGN variation — a comment there swallows the moves after it.

```js
test("noMain: a footnote anchors on the line it shares most moves with", () => {
	const st = loadState("1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6", { tags: { 1: "foot" } });
	st.noMain = true;
	const foot = st.lines[1];
	foot.comments = [{ text: "the Sicilian", ply: foot.moves.at(-1).ply }];
	const { entries } = numberNotes(st.lines);
	const e = entries.find((x) => x.foot);
	assert.ok(e, "no footnote entry");
	assert.ok(e.owner, "footnote has no owner");
	assert.notStrictEqual(e.owner, EMPTY_MAIN);
	assert.ok(e.owner.moves.length > 0);
});

test("noMain: a notebook of nothing but one footnote files no anchor", () => {
	const st = loadState("1. e4 e5", { tags: { 0: "foot" } });
	st.noMain = true;
	st.lines[0].tag = "foot";
	const { entries } = numberNotes(st.lines);
	for (const e of entries) assert.notStrictEqual(e.owner, EMPTY_MAIN);
});
```

- [ ] **Step 2: Run them**

Run: `npm test -- tests/notes.test.mjs`
Expected: the second FAILS — `parentOf`'s `best || main` hands back `EMPTY_MAIN`, and the entry is filed against a line with no moves and no row.

- [ ] **Step 3: Implement**

`src/notes.js`, in `parentOf`:

```js
		// `main` is the fallback, but with the mainline disabled it is the EMPTY
		// reference -- a line with no moves, no row and no card, so a note filed
		// against it would render nowhere. No candidate then means no anchor.
		return best || (main.synthetic ? null : main);
```

Both call sites must then tolerate `null`. The group pass (`notes.js:105-118`) and the per-line pass (`notes.js:132-140`) each compute `const parent = parentOf(…)`; guard both:

```js
		const parent = parentOf(pseudo);
		if (!parent) return; // nothing in the table for this note to hang off
```

`notes.js:132`'s existing `main &&` becomes redundant once the guard is in — leave it, it costs nothing and states the same thing.

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/notes.test.mjs` → PASS
Run: `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/notes.js tests/notes.test.mjs
git commit -m "$(printf 'Skip a footnote with nothing in the table to anchor on\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 10: PGN export still writes a trunk

**Files:**
- Modify: nothing expected — `src/pgn-out.js` was left alone by Task 3
- Test: `tests/pgn-out.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the test**

Append to `tests/pgn-out.test.mjs`:

```js
test("noMain: export still emits a trunk with variations", () => {
	const st = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6");
	st.noMain = true;
	const out = buildPgn(st.lines, { name: "n" });
	assert.ok(out.includes("1. e4 e5"), out);
	assert.ok(out.includes("(1... c5"), out);
	// and it round-trips
	const { nodes } = parsePgn(out);
	assert.ok(collectLines(nodes).length >= 2);
});
```

Match the file's real exported builder name and signature (`grep -n "export function" src/pgn-out.js`).

- [ ] **Step 2: Run it**

Run: `npm test -- tests/pgn-out.test.mjs`
Expected: PASS. `pgn-out.js` keeps its own `lines.find((l) => l.isMain) || lines[0]`, so it never sees the empty reference.

If it FAILS, the cause is a stray `mainOf`/`isMainLine` that Task 3 introduced into `pgn-out.js` — revert that one site rather than changing the exporter.

- [ ] **Step 3: Commit**

```bash
git add tests/pgn-out.test.mjs
git commit -m "$(printf 'Pin PGN export to a real trunk when the mainline is off\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 11: End-to-end, docs, and the full gate

**Files:**
- Create: `tests/no-mainline.test.mjs`
- Modify: `README.md`
- Test: everything

**Interfaces:**
- Consumes: the whole feature.
- Produces: nothing.

- [ ] **Step 1: Write the end-to-end test**

Create `tests/no-mainline.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers.mjs";

// Per the repo's coverage note: boot ONCE per file, with no cache-busting
// query string, and use reset() between scenarios.
test("the No mainline tickbox reshapes the report and survives a save", async (t) => {
	const app = await bootApp();
	t.after(() => app.teardown());

	await app.loadPgn("1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6");
	const box = () =>
		[...app.view().querySelectorAll("label")].find((l) =>
			l.textContent.includes("No mainline"),
		);
	assert.ok(box(), "no No mainline tickbox");
	assert.ok(app.view().querySelectorAll(".main-col").length > 0);

	const input = box().querySelector("input");
	input.checked = true;
	input.dispatchEvent(new app.dom.window.Event("change"));
	await app.settle();

	assert.strictEqual(app.view().querySelectorAll(".main-col").length, 0);
	assert.strictEqual(app.view().querySelectorAll(".maintag").length, 0);
	assert.ok(
		![...app.view().querySelectorAll("button")].some((b) =>
			b.textContent.includes("Make mainline"),
		),
	);
	// the tickbox stayed ticked through the re-render
	assert.strictEqual(box().querySelector("input").checked, true);

	// unticking restores the mainline
	const back = box().querySelector("input");
	back.checked = false;
	back.dispatchEvent(new app.dom.window.Event("change"));
	await app.settle();
	assert.ok(app.view().querySelectorAll(".main-col").length > 0);
});
```

Check `bootApp`'s helpers against `tests/helpers.mjs` and against how the other `bootApp` tests drive a checkbox; use their idiom if it differs.

- [ ] **Step 2: Run it**

Run: `npm test -- tests/no-mainline.test.mjs`
Expected: PASS. A failure here is real — it means the flag does not survive a `renderApp`, or a panel still reads `l.isMain` directly. Find the stray with `grep -rn "\.isMain" src/ | grep -v pgn-out | grep -v "isMain = \|isMain:"`.

- [ ] **Step 3: Document it**

In `README.md`, in the numbered **Tag** step (§2), after the sentence about `★ Make mainline`, add:

```markdown
   **No mainline** in the View row drops the concept entirely: every line
   becomes a peer, with no reference column and no elided `…` prefix, and the
   first line is as tag-able, hide-able and footnote-able as any other. Lines
   are still shown grouped by the moves they share, splitting at each point of
   divergence — that structure just comes from the lines themselves rather than
   from a privileged trunk. The setting travels with the notebook, and ticking
   it doesn't forget which line you had promoted, so unticking restores the
   table you had. PGN export is the exception: a `.pgn` has no way to say "no
   mainline", so it keeps writing the first line as the trunk.
```

- [ ] **Step 4: The full gate**

Run each, and paste the actual output rather than asserting success:

```bash
npm test
npm run lint
npm run knip
```

All three must be clean. `knip` will flag `EMPTY_MAIN` or `noMain` if a task left one unused — if so, that is a real finding: a guard is missing somewhere.

- [ ] **Step 5: Commit**

```bash
git add tests/no-mainline.test.mjs README.md
git commit -m "$(printf 'Document the No mainline tickbox and cover it end to end\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

- [ ] **Step 6: Stop**

Leave the work on `analysis-board`. Do **not** merge or push to `master` — that needs explicit approval.
