# Hide/Disable Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let a line — or a whole trie group — be marked hidden, dropping it from the table, print view, Markdown export and PGN, and moving it into a collapsed drawer in the editor from which it can be restored individually or as a group.

**Architecture:** A new pure module `src/visibility.js` owns the `l.hidden` predicate and every writer of it. Consumers filter at their own entry point (`grid()`, `buildPgn()`, `allNotes()`, the editor's `buildTrie`) because they are independent entry points — `buildPgn` is called straight from the export bar and never passes through `grid()`. The mainline is never hidable, which is enforced inside `setHidden`/`solo` so no caller can violate it.

**Tech Stack:** Vanilla ES modules, no build step. Tests are `node --test` with jsdom for DOM-touching modules.

**Conventions:** `src/table.js`, `src/tree.js`, `src/notes.js`, `src/line-editor.js`, `src/foot-groups.js`, `src/nags.js`, `src/trie-view.js` and `src/pgn-out.js` indent with **TABS**; `src/app.js`, `src/store.js`, `src/export.js` and `style.css` indent with **2 SPACES**. Match the file you are editing. New module `src/visibility.js` uses tabs. Run `npm test`, lint with `npm run lint`.

**Spec:** `docs/superpowers/specs/2026-08-25-hide-lines-design.md`

**Do not** import `src/app.js` with a `?t=` cache-buster in any new test — it hides most of that module's coverage.

---

### Task 1: The visibility module

The predicate and every writer of `l.hidden`, as pure functions over a line array.

**Files:**
- Create: `src/visibility.js`
- Test: `tests/visibility.test.mjs`

- [x] **Step 1: Write the failing test**

Create `tests/visibility.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	visibleLines,
	hiddenLines,
	setHidden,
	hideAll,
	showAll,
	solo,
	hiddenState,
} from "../src/visibility.js";

// four lines: the mainline plus three sidelines
const mk = () => [
	{ isMain: true, name: "Mainline" },
	{ name: "Line 1" },
	{ name: "Line 2" },
	{ name: "Line 3" },
];

test("splits a line list into visible and hidden", () => {
	const ls = mk();
	ls[2].hidden = true;
	assert.deepEqual(
		visibleLines(ls).map((l) => l.name),
		["Mainline", "Line 1", "Line 3"],
	);
	assert.deepEqual(
		hiddenLines(ls).map((l) => l.name),
		["Line 2"],
	);
});

test("setHidden deletes the property rather than writing false", () => {
	const ls = mk();
	setHidden([ls[1]], true);
	assert.equal(ls[1].hidden, true);
	setHidden([ls[1]], false);
	assert.equal("hidden" in ls[1], false);
});

test("setHidden refuses to hide the mainline", () => {
	const ls = mk();
	setHidden([ls[0]], true);
	assert.equal("hidden" in ls[0], false);
});

test("hideAll hides every line but the mainline", () => {
	const ls = mk();
	hideAll(ls);
	assert.deepEqual(
		visibleLines(ls).map((l) => l.name),
		["Mainline"],
	);
});

test("showAll clears every hidden line", () => {
	const ls = mk();
	hideAll(ls);
	showAll(ls);
	assert.equal(hiddenLines(ls).length, 0);
});

test("solo hides every other line and keeps the mainline", () => {
	const ls = mk();
	solo(ls, [ls[2]]);
	assert.deepEqual(
		visibleLines(ls).map((l) => l.name),
		["Mainline", "Line 2"],
	);
});

test("solo unhides the lines it keeps", () => {
	const ls = mk();
	hideAll(ls);
	solo(ls, [ls[3]]);
	assert.equal("hidden" in ls[3], false);
	assert.deepEqual(
		visibleLines(ls).map((l) => l.name),
		["Mainline", "Line 3"],
	);
});

test("solo keeps a whole group", () => {
	const ls = mk();
	solo(ls, [ls[1], ls[2]]);
	assert.deepEqual(
		visibleLines(ls).map((l) => l.name),
		["Mainline", "Line 1", "Line 2"],
	);
});

test("hiddenState reads a group's chip state off its leaves", () => {
	const ls = mk();
	assert.equal(hiddenState([ls[1], ls[2]]), "none");
	ls[1].hidden = true;
	assert.equal(hiddenState([ls[1], ls[2]]), "some");
	ls[2].hidden = true;
	assert.equal(hiddenState([ls[1], ls[2]]), "all");
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/visibility.test.mjs`
Expected: FAIL — cannot find module `../src/visibility.js`.

- [x] **Step 3: Write the implementation**

Create `src/visibility.js` (TABS):

```js
// Hidden lines: a presentation-only flag, orthogonal to a line's tag (a
// footnote can also be hidden, so hidden is never a tag value). A hidden line
// leaves the table, the print view, the Markdown export and the PGN, and moves
// into the editor's hidden drawer.
//
// The mainline is never hidden. grid() uses it as the table's reference row and
// every sideline's cells are computed as a divergence FROM it, so hiding it
// would redefine the table rather than remove a row from it. setHidden() and
// solo() are the only writers and both refuse l.isMain, so no caller can route
// around that rule.

export function visibleLines(lines) {
	return lines.filter((l) => !l.hidden);
}

export function hiddenLines(lines) {
	return lines.filter((l) => l.hidden);
}

// Clearing DELETES the property rather than writing hidden:false — the same
// rule line-editor.js applies to a cleared mark, so a saved notebook never
// carries a falsy value that means nothing.
export function setHidden(targets, on) {
	targets.forEach((l) => {
		if (l.isMain) return;
		if (on) l.hidden = true;
		else delete l.hidden;
	});
}

export function hideAll(lines) {
	setHidden(lines, true);
}

export function showAll(lines) {
	setHidden(lines, false);
}

// "Hide everything except this line/group". The kept lines are unhidden:
// hiding all but one implies that one is visible, even if it was hidden itself.
export function solo(all, keep) {
	const spare = new Set(keep);
	setHidden(
		all.filter((l) => !spare.has(l)),
		true,
	);
	setHidden(keep, false);
}

// Tri-state for the group chip, read back off the leaves rather than stored —
// the same derivation groupFootChip uses for the group Footnote chip.
export function hiddenState(leaves) {
	const hid = leaves.filter((l) => l.hidden).length;
	if (!hid) return "none";
	return hid === leaves.length ? "all" : "some";
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `node --test tests/visibility.test.mjs`
Expected: PASS, 8 tests.

- [x] **Step 5: Commit**

```bash
git add src/visibility.js tests/visibility.test.mjs
git commit -m "Add the visibility module for hidden lines"
```

---

### Task 2: Hidden lines leave the table, print view and Markdown

All three read `grid()`'s output, so one filter at the top of `grid()` covers
them. Placing it ahead of the `isMain` lookup and `numberNotes` also means
hidden lines consume no `[n]` numbers and no footnote letters.

**Files:**
- Modify: `src/table.js:18-19`
- Test: `tests/table.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/table.test.mjs`. This file indents with **TABS** and already
imports `grid`, `parsePgn`, `collectLines` and `assert`.

```js
test("a hidden line is absent from the grid", () => {
	const lines = [
		{ isMain: true, moves: [{ san: "e4", ply: 0 }], name: "Mainline" },
		{
			moves: [
				{ san: "e4", ply: 0 },
				{ san: "c5", ply: 1 },
			],
			name: "Visible",
			tag: "sideline",
		},
		{
			moves: [
				{ san: "e4", ply: 0 },
				{ san: "e5", ply: 1 },
			],
			name: "Gone",
			tag: "sideline",
			hidden: true,
		},
	];
	const g = grid(lines);
	assert.deepEqual(
		g.vars.map((v) => v.name),
		["Mainline", "Visible"],
	);
});

test("a hidden footnote is absent from footNotes", () => {
	const lines = [
		{ isMain: true, moves: [{ san: "e4", ply: 0 }], name: "Mainline" },
		{
			moves: [
				{ san: "e4", ply: 0 },
				{ san: "e5", ply: 1 },
			],
			name: "Gone",
			tag: "foot",
			hidden: true,
		},
	];
	assert.equal(grid(lines).footNotes.length, 0);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/table.test.mjs`
Expected: FAIL — the hidden line still appears in `vars` / `footNotes`.

- [x] **Step 3: Write the implementation**

In `src/table.js`, add the import at the top of the import block:

```js
import { visibleLines } from "./visibility.js";
```

Change the head of `grid()` from:

```js
export function grid(lines) {
	const main = lines.find((l) => l.isMain) || lines[0];
```

to:

```js
export function grid(all) {
	// Hidden lines leave the table, the print view and the Markdown export.
	// Filtering HERE — ahead of the isMain lookup and numberNotes — also means
	// a hidden line consumes no [n] note number and no footnote letter.
	const lines = visibleLines(all);
	const main = lines.find((l) => l.isMain) || lines[0];
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/table.test.mjs tests/print.test.mjs tests/render.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/table.js tests/table.test.mjs
git commit -m "Drop hidden lines from the table grid"
```

---

### Task 3: Hidden lines leave the PGN

`buildPgn(state)` is called straight from the export bar and never passes
through `grid()`, so it needs its own filter.

**Files:**
- Modify: `src/pgn-out.js:267`
- Test: `tests/pgn-out.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/pgn-out.test.mjs` (TABS):

```js
test("a hidden line is not exported", () => {
	const { nodes } = parsePgn("1. e4 c5 (1... e5) (1... e6) *");
	const lines = collectLines(nodes);
	const gone = lines.find((l) => l.moves.some((m) => m.san === "e6"));
	gone.hidden = true;
	const pgn = buildPgn({ name: "t", lines });
	assert.ok(pgn.includes("e5"), "the visible variation survives");
	assert.equal(pgn.includes("e6"), false, "the hidden variation is gone");
});
```

If `parsePgn` / `collectLines` are not already imported in this file, add:

```js
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/pgn-out.test.mjs`
Expected: FAIL — `e6` still present in the exported PGN.

- [x] **Step 3: Write the implementation**

In `src/pgn-out.js`, add to the import block:

```js
import { visibleLines } from "./visibility.js";
```

Change line 267 from:

```js
	const lines = state.lines || [];
```

to:

```js
	// Hidden lines are omitted. PGN is deliberately lossy (see the decision on
	// task a3f4f9db) and store.js is what archives the notebook, so a hidden
	// line does not come back on re-import — that is accepted, not a bug.
	const lines = visibleLines(state.lines || []);
```

- [x] **Step 4: Run the test to verify it passes**

Run: `node --test tests/pgn-out.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/pgn-out.js tests/pgn-out.test.mjs
git commit -m "Drop hidden lines from the PGN export"
```

---

### Task 4: Hidden lines consume no note numbers

`allNotes()` and `moveStrip()` call `numberNotes` with the raw state list, so
each needs the filter. `footGroups` needs no change — `numberNotes` passes it
the array it was given, so footnote lettering follows automatically.

**Files:**
- Modify: `src/notes.js:249-253`
- Modify: `src/line-editor.js:143`
- Test: `tests/notes.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/notes.test.mjs` (TABS). This uses `loadState` from
`tests/helpers.mjs`; if the file does not already import it, add
`import { loadState } from "./helpers.mjs";`

```js
test("a hidden line's note consumes no number", () => {
	const state = loadState("1. e4 c5 {sicilian} (1... e5 {open}) *");
	const gone = state.lines.find((l) => l.moves.some((m) => m.san === "e5"));
	gone.hidden = true;
	const entries = allNotes();
	assert.equal(
		entries.some((e) => e.text === "open"),
		false,
		"the hidden line's note is gone",
	);
	assert.deepEqual(
		entries.map((e) => e.n),
		[1],
		"numbering closes up rather than skipping",
	);
});
```


Also append this, covering the footnote-lettering half of the same filter — a
group that loses members to hiding stops being a group, because `footGroups`
returns nothing for fewer than two foot lines:

```js
test("hiding a group's members dissolves the footnote group", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3");
	s.lines.forEach((l) => {
		if (!l.isMain) l.tag = "foot";
	});
	const grouped = allNotes().length;
	// hide one of the two members: the survivor is a lone footnote, not a group
	s.lines.find((l) => l.moves.some((m) => m.san === "Nc3")).hidden = true;
	const entries = allNotes();
	assert.ok(
		!entries.some((e) => JSON.stringify(e).includes("Nc3")),
		"the hidden member contributes nothing",
	);
	assert.notStrictEqual(
		entries.length,
		0,
		"the surviving footnote is still listed",
	);
	assert.ok(grouped >= 1, "sanity: the group produced entries to begin with");
});
```

- [x] **Step 1b: Guard the shared-notes decision**

Hidden lines must KEEP receiving notes added at a shared move, so
`computeShared` in `app.js` is deliberately NOT filtered (spec §7). Append this
regression guard to `tests/app.test.mjs` (**TABS**, reusing `loadGroupPgn`,
`doc` and `tick`):

```js
test("a note added at a shared move still reaches a hidden line", async () => {
	await loadGroupPgn();
	const hidden = getCurrent().lines.find((l) =>
		l.moves.some((m) => m.san === "Nc3"),
	);
	hidden.hidden = true;
	getRenderHooks().renderApp();
	await tick();

	// select the shared 1... c5 move on the line that is still visible
	const chip = [
		...doc("view").querySelectorAll(".markup .ledge .move-chip"),
	].find((b) => b.textContent.includes("c5"));
	chip.click();
	await tick();

	const box = doc("view").querySelector(".markup .cedit");
	box.querySelector("input.lno").value = "shared idea";
	[...box.querySelectorAll("button")]
		.find((b) => b.textContent === "Add note")
		.click();
	await tick();

	assert.ok(
		(hidden.comments || []).some((c) => c.text === "shared idea"),
		"the hidden line received the shared note",
	);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/notes.test.mjs tests/app.test.mjs`
Expected: FAIL — the hidden line's note is still numbered. The shared-note
guard should already PASS (nothing filters `computeShared`); it is there to
fail loudly if someone later filters it.

- [x] **Step 3: Write the implementation**

In `src/notes.js` add to the import block:

```js
import { visibleLines } from "./visibility.js";
```

and change `allNotes()`:

```js
// The numbered Notes list for the open notebook. Hidden lines are filtered out
// here so they consume no [n] number and no footnote letter.
export function allNotes() {
	return numberNotes(visibleLines(getCurrent().lines), {
		footNames: getCurrent().showFootNames,
	}).entries;
}
```

In `src/line-editor.js` add to the import block:

```js
import { visibleLines } from "./visibility.js";
```

and change line 143 from:

```js
	const marksByPly = numberNotes(getCurrent().lines).byLine.get(l) || {};
```

to:

```js
	const marksByPly =
		numberNotes(visibleLines(getCurrent().lines)).byLine.get(l) || {};
```

Note the existing `|| {}` already covers the new case where `l` is itself
hidden and therefore absent from the numbering — its chips simply show no
superscripts, which is correct.

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/notes.test.mjs tests/line-editor.test.mjs tests/app.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/notes.js src/line-editor.js tests/notes.test.mjs tests/app.test.mjs
git commit -m "Keep hidden lines out of note numbering"
```

---

### Task 5: Hidden state survives a save/load round-trip

**Files:**
- Modify: `src/store.js:29-36`
- Modify: `src/app.js:396-405` (the `// re-apply tags` block)
- Test: `tests/store.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/store.test.mjs` (2 SPACES — this file uses spaces):

```js
test("saveNotebook records a line's hidden flag", () => {
  withStorage(() => {
    const lines = [
      { isMain: true, moves: [{ san: "e4", ply: 0 }], name: "Mainline" },
      {
        moves: [
          { san: "e4", ply: 0 },
          { san: "e5", ply: 1 },
        ],
        tag: "sideline",
        name: "Hidden one",
        hidden: true,
      },
    ];
    saveNotebook("n1", { name: "t", pgn: "1. e4 e5 *", lines, view: {} });
    const nb = loadNotebook("n1");
    assert.strictEqual(nb.tags[0].hidden, false);
    assert.strictEqual(nb.tags[1].hidden, true);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/store.test.mjs`
Expected: FAIL — `nb.tags[1].hidden` is `undefined`.

- [x] **Step 3: Write the implementation**

In `src/store.js`, add `hidden` to the `tags` map (2 SPACES):

```js
        tags: lines.map((l) => ({
          key: keyFor(l.moves),
          tag: l.tag || "sideline",
          name: l.name || "",
          meta: l.meta || {},
          marks: l.marks || {},
          comments: l.comments || [],
          hidden: !!l.hidden,
        })),
```

In `src/app.js`, inside the `// re-apply tags` block in `openNotebook()`, add
one line after the existing `l.tag = ...` assignment:

```js
          // legacy notebooks used 'main'/'minor'; mainline is now structural
          l.tag = l.isMain ? undefined : t.tag === "foot" ? "foot" : "sideline";
          // notebooks saved before hidden existed have no field and load visible
          l.hidden = !l.isMain && !!t.hidden;
```

Note `l.hidden = false` here rather than a delete is deliberate and harmless:
`openNotebook` builds brand new line objects from `collectLines`, and the next
`saveNotebook` writes `!!l.hidden` regardless.

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/store.test.mjs tests/app.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/store.js src/app.js tests/store.test.mjs
git commit -m "Persist a line's hidden flag in the saved notebook"
```

---

### Task 6: A separate open-state Set for the drawer's trie

The drawer's trie can produce the SAME `node.key` as the editor's for the same
move path. Sharing one Set would make opening a drawer group also open its twin
in the editor above, so `renderTrieNode` takes the Set as a parameter.

**Files:**
- Modify: `src/state.js` (append)
- Modify: `src/trie-view.js:148-200` (`renderTrieNode`)
- Test: none of its own — Task 9 asserts the key-isolation behaviour this enables

- [x] **Step 1: Add the Set**

Append to `src/state.js` after the `openTablePaths` declaration (TABS to match
the file — check: `state.js` uses TABS):

```js
// Hidden-drawer groups the user expanded. Separate from openPaths because the
// drawer's trie can produce the SAME node.key as the editor's for the same move
// path — one shared Set would make opening a drawer group open its twin above.
export const openHiddenPaths = new Set();
```

- [x] **Step 2: Parameterise renderTrieNode**

In `src/trie-view.js`, change the signature from:

```js
export function renderTrieNode(container, node, nameCounter, path, allOpen) {
```

to:

```js
export function renderTrieNode(
	container,
	node,
	nameCounter,
	path,
	allOpen,
	paths = openPaths,
) {
```

Then inside the function replace every use of `openPaths` with `paths`:

- `det.open = openPaths.has(node.key);` → `det.open = paths.has(node.key);`
- `const had = openPaths.has(node.key);` → `const had = paths.has(node.key);`
- `if (det.open && !had) openPaths.add(node.key);` → `paths.add(node.key);`
- `else if (!det.open && had) openPaths.delete(node.key);` → `paths.delete(node.key);`

And pass `paths` down both recursive calls:

```js
	if (!node.leaf && node.children.size === 1) {
		node.children.forEach((c) =>
			renderTrieNode(container, c, nameCounter, nextPath, allOpen, paths),
		);
		return;
	}
```

```js
	node.children.forEach((c) =>
		renderTrieNode(body, c, nameCounter, "", allOpen && open, paths),
	);
```

- [x] **Step 3: Run the suite to verify nothing regressed**

Run: `npm test`
Expected: PASS — the default parameter keeps every existing call site behaving
exactly as before.

- [x] **Step 4: Commit**

```bash
git add src/state.js src/trie-view.js
git commit -m "Let renderTrieNode render against a caller's open-path set"
```

---

### Task 7: Per-line Hide and Solo chips

**Files:**
- Modify: `src/line-editor.js` (the `else` branch of the tags block, after the promote chip)
- Test: `tests/line-editor.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/line-editor.test.mjs`. This file indents with **TABS** and
already defines `byText(node, sel, txt)`, the `TWO_LINES` PGN constant, and
imports `installDom`, `loadState`, `lineEditor` and `getCurrent`. Add one import:

```js
import { visibleLines } from "../src/visibility.js";
```

```js
test("the mainline offers no Hide chip", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const row = lineEditor(s.lines[0], 0);
	assert.ok(!byText(row, "button", "Hide"), "no Hide chip on the mainline");
	assert.ok(!byText(row, "button", "Solo"), "no Solo chip on the mainline");
	off();
});

test("the Hide chip hides its line and then brings it back", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const side = s.lines[1];
	byText(lineEditor(side, 1), "button", "Hide").click();
	assert.strictEqual(side.hidden, true);
	// the chip on a hidden line reads "Hidden" and clears the flag outright
	byText(lineEditor(side, 1), "button", "Hidden").click();
	assert.strictEqual("hidden" in side, false);
	off();
});

test("Solo hides every other line but keeps the mainline", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5) (1... e6) 2. Nf3");
	const keep = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	byText(lineEditor(keep, 1), "button", "Solo").click();
	const shown = visibleLines(s.lines);
	assert.strictEqual(shown.length, 2, "mainline plus the soloed line");
	assert.ok(shown.includes(keep));
	assert.ok(shown.some((l) => l.isMain));
	off();
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/line-editor.test.mjs`
Expected: FAIL — no Hide chip exists, so `byText(...)` returns undefined.

- [x] **Step 3: Write the implementation**

In `src/line-editor.js`, add to the import block:

```js
import { setHidden, solo } from "./visibility.js";
```

In `lineEditor()`, inside the `else` branch (the one that already appends the
Sideline/Footnote buttons and the promote chip), after `tags.appendChild(promote);`
add:

```js
		// Hide/Solo sit with the tag chips, and only on a non-mainline row —
		// the mainline is the table's reference row and is never hidable.
		const hide = el("button", {
			className: "chip hide" + (l.hidden ? " on" : ""),
			textContent: l.hidden ? "Hidden" : "Hide",
			title: l.hidden ? "bring this line back" : "hide this line",
		});
		hide.onclick = () => {
			setHidden([l], !l.hidden);
			getRenderHooks().renderApp();
		};
		const soloBtn = el("button", {
			className: "chip solo",
			textContent: "Solo",
			title: "hide every other line",
		});
		soloBtn.onclick = () => {
			solo(getCurrent().lines, [l]);
			getRenderHooks().renderApp();
		};
		tags.append(hide, soloBtn);
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/line-editor.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/line-editor.js tests/line-editor.test.mjs
git commit -m "Add per-line Hide and Solo chips"
```

---

### Task 8: Group Hide and Solo chips

Mirrors the existing `groupFootChip`, including the `preventDefault` /
`stopPropagation` pair that stops the click toggling the `<details>`.

**Files:**
- Modify: `src/trie-view.js` (add two chip builders; extend the `count > 1` line)
- Test: `tests/app.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/app.test.mjs`. This file indents with **TABS** and already
provides `app` (from `bootApp()`), `doc(id)`, `tick()`, the `GROUP_PGN`
constant and the `loadGroupPgn()` helper — reuse them exactly as the existing
group-Footnote test does.

```js
test("the group Hide chip hides every line under the group", async () => {
	await loadGroupPgn();
	const chip = doc("view").querySelector(
		".markup details.lgroup summary .chip.grouphide",
	);
	assert.ok(chip, "group summary carries a Hide chip");
	assert.ok(!chip.className.includes("on"), "off to start");

	chip.click();
	await tick();
	assert.strictEqual(
		getCurrent().lines.filter((l) => l.hidden).length,
		2,
		"both lines under the group are hidden",
	);
	// they have left the editor list for the drawer
	assert.ok(
		!doc("view").querySelector(".markup details.lgroup"),
		"the group is gone from the editor list",
	);
});

test("the group Hide chip reads partial when only some are hidden", async () => {
	await loadGroupPgn();
	const leaf = getCurrent().lines.find((l) =>
		l.moves.some((m) => m.san === "Nc3"),
	);
	leaf.hidden = true;
	getRenderHooks().renderApp();
	await tick();
	const chip = doc("view").querySelector(
		".markup details.lgroup summary .chip.grouphide",
	);
	assert.ok(chip, "the group still renders with one line left");
	assert.ok(
		chip.className.includes("partial"),
		"chip reads partial with one of two hidden",
	);
});

test("group Solo hides every line outside the group", async () => {
	app.reset();
	const view = doc("view");
	view.querySelector("textarea.pgnin").value =
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) (1... e6) 2. Nf3";
	[...view.querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	doc("view")
		.querySelector(".markup details.lgroup summary .chip.groupsolo")
		.click();
	await tick();
	const gone = getCurrent().lines.find((l) =>
		l.moves.some((m) => m.san === "e6"),
	);
	assert.strictEqual(gone.hidden, true, "the line outside the group is hidden");
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/app.test.mjs`
Expected: FAIL — no `.chip.grouphide` element exists.

- [x] **Step 3: Write the implementation**

In `src/trie-view.js`, add to the import block:

```js
import { setHidden, solo, hiddenState } from "./visibility.js";
```

Add these two builders next to `groupFootChip` (**TABS**):

```js
// The group-level Hide chip. Like groupFootChip its state is read back off the
// leaves rather than stored: all hidden reads "on", some reads "partial". One
// click always changes something — it hides every line unless they are all
// already hidden, in which case it brings them all back.
function groupHideChip(node) {
	const leaves = leavesOf(node);
	const state = hiddenState(leaves);
	const chip = el("button", {
		className:
			"chip hide grouphide" +
			(state === "all" ? " on" : state === "some" ? " partial" : ""),
		textContent: state === "all" ? "Hidden" : "Hide",
	});
	chip.onclick = (e) => {
		// the chip lives in the <summary>, where a click would otherwise toggle
		// the <details> open/closed as well
		e.preventDefault();
		e.stopPropagation();
		setHidden(leaves, state !== "all");
		getRenderHooks().renderApp();
	};
	return chip;
}

// "Hide everything outside this group."
function groupSoloChip(node) {
	const chip = el("button", {
		className: "chip solo groupsolo",
		textContent: "Solo",
		title: "hide every line outside this group",
	});
	chip.onclick = (e) => {
		e.preventDefault();
		e.stopPropagation();
		solo(getCurrent().lines, leavesOf(node));
		getRenderHooks().renderApp();
	};
	return chip;
}
```

Then extend the existing group-chip line in `renderTrieNode` from:

```js
	if (count > 1) summary.appendChild(groupFootChip(node));
```

to:

```js
	// A group of one is just a line, and its own editor row already has these.
	if (count > 1)
		summary.append(
			groupFootChip(node),
			groupHideChip(node),
			groupSoloChip(node),
		);
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/app.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/trie-view.js tests/app.test.mjs
git commit -m "Add group-level Hide and Solo chips"
```

---

### Task 9: The editor filters hidden lines and grows a drawer

Both editor views (grouped trie and flat list) drop hidden lines, and a
collapsed drawer at the foot of the panel holds them, grouped, with its own
open-path Set.

**Files:**
- Modify: `src/app.js` `markupPanel()`
- Test: `tests/app.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/app.test.mjs` (**TABS**, reusing `app`, `doc`, `tick`,
`GROUP_PGN` and `loadGroupPgn` as above):

```js
test("a hidden line leaves the editor list and enters the drawer", async () => {
	await loadGroupPgn();
	const before = doc("view").querySelectorAll(".markup .ledge").length;
	const gone = getCurrent().lines.find((l) =>
		l.moves.some((m) => m.san === "Nc3"),
	);
	gone.hidden = true;
	getRenderHooks().renderApp();
	await tick();

	const drawer = doc("view").querySelector(".hidden-drawer");
	assert.ok(drawer, "the drawer appears once something is hidden");
	assert.strictEqual(drawer.querySelector("summary").textContent, "Hidden (1)");
	assert.strictEqual(
		doc("view").querySelectorAll(".markup > .ledge, .markup .lgroup .ledge")
			.length,
		before - 1,
		"the hidden line is gone from the editor list itself",
	);
});

test("no drawer when nothing is hidden", async () => {
	await loadGroupPgn();
	assert.strictEqual(doc("view").querySelector(".hidden-drawer"), null);
});

test("the drawer's Show all brings every hidden line back", async () => {
	await loadGroupPgn();
	getCurrent().lines.forEach((l) => {
		if (!l.isMain) l.hidden = true;
	});
	getRenderHooks().renderApp();
	await tick();

	[...doc("view").querySelectorAll(".hidden-drawer button")]
		.find((b) => b.textContent === "Show all")
		.click();
	await tick();
	assert.strictEqual(getCurrent().lines.filter((l) => l.hidden).length, 0);
	assert.strictEqual(doc("view").querySelector(".hidden-drawer"), null);
});

test("the flat view also drops hidden lines", async () => {
	await loadGroupPgn();
	doc("view")
		.querySelectorAll("button")
		.forEach((b) => {
			if (b.textContent === "Flat") b.click();
		});
	await tick();
	const before = doc("view").querySelectorAll(".markup > .ledge").length;
	const gone = getCurrent().lines.find((l) =>
		l.moves.some((m) => m.san === "Nc3"),
	);
	gone.hidden = true;
	getRenderHooks().renderApp();
	await tick();
	assert.strictEqual(
		doc("view").querySelectorAll(".markup > .ledge").length,
		before - 1,
	);
});

test("opening a drawer group does not open its twin in the editor", async () => {
	// both lines of the c5 group hidden, plus one visible c5 line left behind,
	// so the SAME trie key exists in the editor and in the drawer at once
	app.reset();
	const view = doc("view");
	view.querySelector("textarea.pgnin").value =
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) (1... c5 2. d4) 2. Nf3";
	[...view.querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	getCurrent()
		.lines.filter((l) => l.moves.some((m) => m.san === "Nc3"))
		.forEach((l) => (l.hidden = true));
	getRenderHooks().renderApp();
	await tick();

	const drawerGroup = doc("view").querySelector(
		".hidden-drawer details.lgroup",
	);
	assert.ok(drawerGroup, "the drawer groups its hidden lines");
	drawerGroup.open = true;
	drawerGroup.dispatchEvent(new app.dom.window.Event("toggle"));
	await tick();

	const editorGroup = doc("view").querySelector(
		".markup > details.lgroup, .markup details.lgroup",
	);
	if (editorGroup)
		assert.ok(
			!editorGroup.open,
			"the editor's same-key group stayed closed",
		);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/app.test.mjs`
Expected: FAIL — no `.hidden-drawer` element.

- [x] **Step 3: Write the implementation**

In `src/app.js` add to the import block:

```js
import { visibleLines, hiddenLines, hideAll, showAll } from "./visibility.js";
```

and add `openHiddenPaths` to the existing `./state.js` import.

In `markupPanel()`, filter the Expand-all trie. Change:

```js
      onclick: () => {
        const trie = buildTrie(getCurrent().lines, main);
```

to:

```js
      onclick: () => {
        const trie = buildTrie(visibleLines(getCurrent().lines), main);
```

Then change:

```js
  const trie = buildTrie(getCurrent().lines, main);
  // flat view renders every non-main line in order; grouped uses the trie
  if (getCurrent().groupView === "flat") {
    getCurrent().lines.forEach((l) => {
```

to:

```js
  // hidden lines leave BOTH editor views and live in the drawer below
  const shown = visibleLines(getCurrent().lines);
  const trie = buildTrie(shown, main);
  // flat view renders every non-main line in order; grouped uses the trie
  if (getCurrent().groupView === "flat") {
    shown.forEach((l) => {
```

Finally, replace the closing `return box;` of `markupPanel()` with:

```js
  const hid = hiddenLines(getCurrent().lines);
  if (hid.length) box.appendChild(hiddenDrawer(hid, main, counter));
  return box;
```

Add the drawer builder as a new function directly after `markupPanel()`
(**2 SPACES** — `app.js` uses spaces):

```js
// The hidden lines, in their own collapsed drawer at the foot of the editor.
// They keep their trie grouping so a whole group can be brought back in one
// click, and they continue the main list's name counter so an auto-assigned
// "Line N" cannot collide across the two lists.
function hiddenDrawer(hid, main, counter) {
  const det = el("details", { className: "hidden-drawer" });
  det.open = !!getCurrent().hiddenOpen;
  det.addEventListener("toggle", () => {
    // no rerender here: only the drawer's own open state changed, and
    // rebuilding would re-fire this toggle (see the guard in renderTrieNode)
    getCurrent().hiddenOpen = det.open;
  });
  det.appendChild(
    el("summary", {
      className: "hd-head",
      textContent: `Hidden (${hid.length})`,
    }),
  );
  const body = el("div", { className: "hidden-body" });
  body.appendChild(
    el("button", {
      className: "chip mini",
      textContent: "Show all",
      onclick: () => {
        showAll(hid);
        renderApp();
      },
    }),
  );
  const trie = buildTrie(hid, main);
  // a hidden line that is a strict PREFIX of the mainline lands on the trie
  // root rather than on a child; render it too, or it would be unreachable
  if (trie.leaf)
    body.appendChild(
      lineEditor(trie.leaf, counter.n++, getCurrent().showBoards),
    );
  // openHiddenPaths, not openPaths: the drawer's trie can produce the SAME
  // node.key as the editor's, and one shared Set would open both at once
  trie.children.forEach((c) =>
    renderTrieNode(body, c, counter, "", true, openHiddenPaths),
  );
  det.appendChild(body);
  return det;
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/app.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/app.js tests/app.test.mjs
git commit -m "Move hidden lines out of the editor into a drawer"
```

---

### Task 10: Bulk Hide all / Show all

**Files:**
- Modify: `src/app.js` `markupPanel()` control row
- Test: `tests/app-toolbar.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/app-toolbar.test.mjs`. This file indents with **2 SPACES** and
provides `app` from `bootApp()` plus the `PGN` constant; drive it with
`app.reset()`, `app.loadPgn(...)` and `app.button(text)`. Add one import:

```js
import { visibleLines } from "../src/visibility.js";
import { getCurrent } from "../src/state.js";
```

```js
test("Hide all hides every line but the mainline, Show all restores them", async () => {
  app.reset();
  await app.loadPgn(PGN);
  app.button("Hide all").click();
  const shown = visibleLines(getCurrent().lines);
  assert.strictEqual(shown.length, 1, "only the mainline is left");
  assert.ok(shown[0].isMain);

  app.button("Show all").click();
  assert.strictEqual(getCurrent().lines.filter((l) => l.hidden).length, 0);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/app-toolbar.test.mjs`
Expected: FAIL — `app.button("Hide all")` is undefined.

- [x] **Step 3: Write the implementation**

In `markupPanel()`, after the `if (getCurrent().groupView !== "flat") { ... }`
block closes — so the buttons appear in both views — and before
`box.appendChild(row);`, add (**2 SPACES**):

```js
  const hideEvery = el("button", {
    className: "chip mini",
    textContent: "Hide all",
    onclick: () => {
      hideAll(getCurrent().lines);
      renderApp();
    },
  });
  const showEvery = el("button", {
    className: "chip mini",
    textContent: "Show all",
    onclick: () => {
      showAll(getCurrent().lines);
      renderApp();
    },
  });
  row.append(" Lines: ", hideEvery, showEvery);
```

Note the drawer's own "Show all" button (Task 9) has the same label. The
toolbar one lives in `.markup > .orow` and the drawer's in `.hidden-drawer`;
`app.button()` returns the first match in DOM order, which is the toolbar's.

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/app-toolbar.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/app.js tests/app-toolbar.test.mjs
git commit -m "Add bulk Hide all and Show all controls"
```

---

### Task 11: Styling

**Files:**
- Modify: `style.css` (near the existing `.chip.groupfoot` / `.chip.partial` block at ~line 238)

- [x] **Step 1: Add the rules**

`.chip.partial { opacity: 0.55 }` already exists and is generic, so the group
Hide chip's partial state needs nothing new. Add (2 SPACES):

```css
.chip.hide.on {
  background: var(--muted);
  border-color: var(--muted);
  color: #fff;
}
.chip.grouphide,
.chip.groupsolo {
  margin-left: 0.4em;
}
.hidden-drawer {
  margin-top: 1rem;
  border-top: 1px solid var(--line);
  padding-top: 0.6rem;
}
.hidden-drawer .hd-head {
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--muted);
  font-weight: 600;
}
.hidden-body {
  opacity: 0.75;
  padding-top: 0.5rem;
}
```

- [x] **Step 2: Verify nothing broke**

Run: `npm test && npm run lint`
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add style.css
git commit -m "Style the hide chips and the hidden drawer"
```

---

### Task 12: Close out

**Files:**
- Modify: `docs/superpowers/plans/2026-08-25-hide-lines.md`

- [x] **Step 1: Full verification**

Run: `npm test && npm run lint && npm run knip && npm run coverage`
Expected: all pass, with `src/visibility.js` well covered.

- [x] **Step 2: Manual check**

Open `index.html`, import a PGN with several variations. Hide a line — confirm
it leaves the table, the print view and the Markdown/PGN exports and appears in
the drawer. Hide a whole group with the group chip. Use Solo on a group. Save
the notebook, reload the page, reopen it, and confirm the hidden lines are
still hidden.

- [x] **Step 3: Mark the plan complete and close the task**

```bash
git commit -am "Mark the hide-lines plan complete"
task 830a6b6a done
```
