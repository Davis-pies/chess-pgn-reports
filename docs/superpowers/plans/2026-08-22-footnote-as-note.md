# Footnote-as-Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a footnote line render as a numbered note anchored to the move it replaces, instead of living in its own lettered section.

**Architecture:** `src/notes.js` becomes the single owner of note numbering, returning both the numbered entries and a per-line `ply -> [numbers]` map that `grid()` consumes instead of counting for itself. A footnote line derives an extra entry in that same pass — computed from the line, never written into `line.comments` — anchored on the mainline row at the divergence ply. Every renderer then reads one list.

**Tech Stack:** Vanilla ES modules, no framework. Tests are `node --test` with jsdom for DOM modules. `npm run lint` (eslint) and `npm run knip` (dead-code check) both gate CI.

**Spec:** `docs/superpowers/specs/2026-08-22-footnote-as-note-design.md`

**Conventions:** Match the indentation of the file you are editing — `src/table.js`, `src/render.js`, `src/notes.js`, `src/tree.js`, `src/dom.js`, `src/trie-view.js` and `src/line-editor.js` use **tabs**; `src/app.js`, `src/export.js` and `src/print.js` use **2 spaces**. Tests mirror the file they cover. Run `npm run lint` before every commit.

**Test helper you will use constantly:** `loadState(pgn, { tags })` in `tests/helpers.mjs` builds the `current` state from a PGN and tags lines by index, e.g. `loadState("1. e4 e5 (1... c5)", { tags: { 1: "foot" } })` makes the `c5` variation a footnote. `installDom()` installs jsdom globals and returns a teardown function that must be called at the end of the test.

---

### Task 1: Move `divergence` into `tree.js`

`src/notes.js` needs `divergence` to compute a footnote's anchor, but `src/table.js` will import the numbering from `src/notes.js` — importing `divergence` back out of `table.js` would make those two modules circular. `divergence` is a pure function of the line model and belongs with the other line-model code in `tree.js`, which imports nothing.

**Files:**
- Modify: `src/tree.js`
- Modify: `src/table.js:8-14` (remove), `src/table.js:1` (import)
- Modify: `src/export.js:1`
- Modify: `src/trie-view.js:1`
- Test: `tests/tree.test.mjs`, `tests/table.test.mjs:5,13-19`

- [ ] **Step 1: Move the divergence test into the tree test file**

Delete this test from `tests/table.test.mjs` (lines 13-19) and drop `divergence` from its import on line 5, so it reads `import { grid } from "../src/table.js";`.

Add to the end of `tests/tree.test.mjs`:

```js
test("divergence finds where a variation splits from mainline", () => {
	const lines = collectLines(
		parsePgn("1. e4 c5 (1... e5 2. Nf3) 2. Nf3 d6").nodes,
	);
	const main = lines[0];
	const e5var = lines.find((l) => l.moves.some((m) => m.san === "e5"));
	// main: e4 c5 Nf3 d6 ; var: e4 e5 Nf3  -> differ at index 1
	assert.strictEqual(divergence(e5var, main), 1);
});
```

Make sure `tests/tree.test.mjs` imports `divergence` from `../src/tree.js` and has `parsePgn` from `../src/pgn.js` available — add them to the existing imports at the top of the file if they are not already there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test tests/tree.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../src/tree.js' does not provide an export named 'divergence'`

- [ ] **Step 3: Add `divergence` to `tree.js`**

Append to `src/tree.js` (tabs):

```js
// How many leading moves a line shares with the mainline. The line's own tail
// starts at this index; everything before it is the shared prefix. Lives here
// rather than in table.js so notes.js can use it without the two modules
// importing each other.
export function divergence(line, main) {
	let i = 0;
	const a = line.moves;
	const b = main.moves;
	while (i < a.length && i < b.length && a[i].san === b[i].san) i++;
	return i;
}
```

- [ ] **Step 4: Remove it from `table.js` and import it instead**

Delete lines 8-14 of `src/table.js` (the `export function divergence` block) and add this import below the header comment:

```js
import { divergence } from "./tree.js";
```

- [ ] **Step 5: Update the other two importers**

In `src/export.js` line 1, split the import:

```js
import { grid } from "./table.js";
import { divergence } from "./tree.js";
```

In `src/trie-view.js` line 1:

```js
import { divergence } from "./tree.js";
```

- [ ] **Step 6: Run the full suite and lint**

Run: `npm test && npm run lint && npm run knip`
Expected: PASS, 116 tests. `knip` reports no unused exports.

- [ ] **Step 7: Commit**

```bash
git add src/tree.js src/table.js src/export.js src/trie-view.js tests/tree.test.mjs tests/table.test.mjs
git commit -m "Move divergence to tree.js so notes.js can reach it"
```

---

### Task 2: Move `renderInline` into `dom.js`

The shared footnote renderer will live in `src/render.js` (both `export.js` and `print.js` already import from it, and `render.js` imports neither, so there is no cycle). It needs `renderInline` to render a footnote's commentary, but `renderInline` currently lives in `export.js`, which imports `render.js`. `renderInline` is a generic DOM helper with no dependencies, so it belongs in `dom.js`.

**Files:**
- Modify: `src/dom.js`
- Modify: `src/export.js:41-68` (remove), `src/export.js:3` (import)
- Modify: `src/print.js:9`
- Test: `tests/export.test.mjs:7`

- [ ] **Step 1: Point the existing tests at the new home**

In `tests/export.test.mjs`, remove `renderInline` from the `../src/export.js` import block (line 7) and add a new import at the top of the file:

```js
import { renderInline } from "../src/dom.js";
```

The three `renderInline` tests at `tests/export.test.mjs:110,121,130` stay exactly as they are.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test tests/export.test.mjs`
Expected: FAIL — `does not provide an export named 'renderInline'`

- [ ] **Step 3: Move the function**

Cut `renderInline` and its comment (`src/export.js:41-68`) and paste into `src/dom.js`, converting the indentation to tabs:

```js
// Safely render a small markdown subset (bold/italic/code + newlines) into DOM
// nodes (no innerHTML, so note text can't inject markup).
export function renderInline(container, text) {
	const lines = text.split("\n");
	lines.forEach((line, li) => {
		if (li) container.appendChild(document.createElement("br"));
		const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
		let last = 0;
		let m;
		while ((m = re.exec(line))) {
			if (m.index > last)
				container.appendChild(
					document.createTextNode(line.slice(last, m.index)),
				);
			const tok = m[0];
			const bold = tok.startsWith("**");
			const code = tok.startsWith("`");
			const node = document.createElement(
				bold ? "strong" : code ? "code" : "em",
			);
			node.textContent = tok.slice(bold ? 2 : 1, tok.length - (bold ? 2 : 1));
			container.appendChild(node);
			last = m.index + tok.length;
		}
		if (last < line.length)
			container.appendChild(document.createTextNode(line.slice(last)));
	});
}
```

- [ ] **Step 4: Update the importers**

In `src/export.js`, change the `dom.js` import (line 3) to:

```js
import { el, renderInline } from "./dom.js";
```

In `src/print.js` line 9, split the import:

```js
import { moveRef } from "./export.js";
import { el, renderInline } from "./dom.js";
```

`src/print.js` already imports `el` from `./dom.js` on line 5 — merge the two rather than importing the module twice, so line 5 becomes the combined import and line 9 keeps only `moveRef`.

- [ ] **Step 5: Run the full suite and lint**

Run: `npm test && npm run lint && npm run knip`
Expected: PASS, 116 tests.

- [ ] **Step 6: Commit**

```bash
git add src/dom.js src/export.js src/print.js tests/export.test.mjs
git commit -m "Move renderInline to dom.js so render.js can use it"
```

---

### Task 3: One numbering pass in `notes.js`

Note numbers are currently computed twice — in `allNotes()` (`src/notes.js:12`) and again inside `grid()` (`src/table.js:37`) — with a comment asserting the two agree and nothing enforcing it. This task makes `notes.js` the single owner. No footnote behavior yet.

**Files:**
- Modify: `src/notes.js`
- Test: `tests/notes.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/notes.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { loadState } from "./helpers.mjs";
import { numberNotes, allNotes } from "../src/notes.js";

test("numberNotes numbers notes in line order and maps them back per line", () => {
	const s = loadState("1. e4 {first} e5 (1... c5 {second}) 2. Nf3");
	const { entries, byLine } = numberNotes(s.lines);
	assert.deepStrictEqual(
		entries.map((e) => [e.n, e.text]),
		[
			[1, "first"],
			[2, "second"],
		],
	);
	// the mainline owns note 1 at ply 0; the c5 variation owns note 2 at ply 1
	assert.deepStrictEqual(byLine.get(s.lines[0])[0], [1]);
	const c5 = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	assert.deepStrictEqual(byLine.get(c5)[1], [2]);
});

test("numberNotes gives identical (ply,text) notes on different lines one number", () => {
	const s = loadState("1. e4 e5 (1... c5) 2. Nf3");
	const c5 = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	s.lines[0].comments = [{ ply: 0, text: "shared" }];
	c5.comments = [{ ply: 0, text: "shared" }];
	const { entries, byLine } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 1, "one entry for the shared note");
	assert.deepStrictEqual(byLine.get(s.lines[0])[0], [1]);
	assert.deepStrictEqual(byLine.get(c5)[0], [1], "both lines point at note 1");
});

test("numberNotes lists a number once when a line repeats a note at one ply", () => {
	const s = loadState("1. e4 e5");
	s.lines[0].comments = [
		{ ply: 0, text: "twice" },
		{ ply: 0, text: "twice" },
	];
	const { entries, byLine } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 1);
	assert.deepStrictEqual(byLine.get(s.lines[0])[0], [1]);
});

test("allNotes returns the numbered entries for the current notebook", () => {
	const s = loadState("1. e4 {first} e5");
	assert.deepStrictEqual(
		allNotes().map((n) => [n.n, n.text, n.owner === s.lines[0]]),
		[[1, "first", true]],
	);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test tests/notes.test.mjs`
Expected: FAIL — `does not provide an export named 'numberNotes'`

- [ ] **Step 3: Rewrite `src/notes.js`**

Replace the whole file (tabs):

```js
import { getCurrent } from "./state.js";

// The single owner of note numbering. One pass over the lines produces both
// the numbered entries (the Notes list) and, per line, a map of
// `ply -> [numbers]` for the markers that render on that line's moves.
//
// It has to be one pass: grid() renders the [n] superscripts in the table and
// the notes panel renders the list, and if those two numbered the notes
// separately they could drift apart without anything failing.
//
// Dedupe rules: identical (ply, text) notes carried by several lines are one
// note with one number, and a line that repeats a note at one ply lists that
// number once.
export function numberNotes(lines) {
	const entries = [];
	const byLine = new Map();
	const seen = new Map(); // "ply|text" -> the number first assigned to it
	lines.forEach((l) => {
		const map = {};
		byLine.set(l, map);
		(l.comments || []).forEach((c) => {
			const k = c.ply + "|" + c.text;
			let n = seen.get(k);
			if (n === undefined) {
				n = entries.length + 1;
				seen.set(k, n);
				entries.push({ ply: c.ply, text: c.text, owner: l, n });
			}
			const at = (map[c.ply] = map[c.ply] || []);
			if (!at.includes(n)) at.push(n);
		});
	});
	return { entries, byLine };
}

// The numbered Notes list for the open notebook.
export function allNotes() {
	return numberNotes(getCurrent().lines).entries;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx node --test tests/notes.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run lint`
Expected: PASS, 120 tests. `grid()` still has its own numbering — that is removed in the next task.

- [ ] **Step 6: Commit**

```bash
git add src/notes.js tests/notes.test.mjs
git commit -m "Give note numbering a single owner in notes.js"
```

---

### Task 4: `grid()` consumes the shared numbering

**Files:**
- Modify: `src/table.js:34-93`
- Test: `tests/notes.test.mjs`

- [ ] **Step 1: Write the failing parity test**

Append to `tests/notes.test.mjs`:

Add `import { grid } from "../src/table.js";` to the imports at the **top** of the file (imports are hoisted, but eslint and readability both want them together), then append:

```js
test("grid's note markers use the same numbers as allNotes", () => {
	const s = loadState(
		"1. e4 {opening} e5 (1... c5 {sicilian} 2. Nf3 {knight}) 2. Nf3 {develops} Nc6",
	);
	const { vars } = grid(s.lines);
	const byNumber = new Map(allNotes().map((n) => [n.n, n]));
	let checked = 0;
	vars.forEach((v) => {
		Object.entries(v.noteByPly).forEach(([ply, nums]) => {
			nums.forEach((n) => {
				assert.ok(byNumber.has(n), `note ${n} exists in the notes list`);
				assert.strictEqual(
					byNumber.get(n).ply,
					Number(ply),
					`note ${n} is anchored at the same ply in both`,
				);
				checked++;
			});
		});
	});
	assert.ok(checked >= 3, `the fixture exercised markers (got ${checked})`);
});
```

- [ ] **Step 2: Run the test to verify it passes for the wrong reason**

Run: `npx node --test tests/notes.test.mjs`
Expected: PASS — the two implementations currently agree. This test is the guard that keeps them agreeing; it must be in place before the numbering is rewired.

- [ ] **Step 3: Rewire `grid()`**

In `src/table.js`, add to the imports:

```js
import { numberNotes } from "./notes.js";
```

Replace the numbering block. Delete lines 37-40 (the `let noteNum` / `const seen` declarations and their comment) and put this immediately after `const main = ...`:

```js
	// Numbering lives in notes.js so the table's [n] superscripts and the Notes
	// list cannot drift apart. byLine gives each line its own ply -> [numbers].
	const { byLine } = numberNotes(lines);
```

Then delete the per-line numbering block (`src/table.js:62-80`, from the `// note markers keyed by ply` comment through the closing `});` of the `(l.comments || []).forEach` loop) and replace it with:

```js
		const noteByPly = byLine.get(l) || {};
```

Leave the rest of the loop untouched — `base`, the `tag === "foot"` split at line 92, and the `vars`/`footNotes` pushes all still read `noteByPly`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 121 tests — including the existing marker assertions in `tests/table.test.mjs:97,120,135`.

- [ ] **Step 5: Lint and check for dead code**

Run: `npm run lint && npm run knip`
Expected: PASS, no unused exports.

- [ ] **Step 6: Commit**

```bash
git add src/table.js tests/notes.test.mjs
git commit -m "Have grid() read note numbers instead of recomputing them"
```

---

### Task 5: Footnote lines derive a note

**Files:**
- Modify: `src/notes.js`
- Test: `tests/notes.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/notes.test.mjs`:

```js
test("a footnote line derives a note anchored on the move it replaces", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const c5 = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	c5.name = "Sicilian";
	c5.meta = { eval: "=", note: "sharp" };
	const { entries, byLine } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 1);
	const e = entries[0];
	// the mainline plays e5 at ply 1; the footnote replaces it with c5
	assert.strictEqual(e.ply, 1, "anchored on the mainline move it replaces");
	assert.strictEqual(e.owner, s.lines[0], "owned by the mainline");
	assert.strictEqual(e.text, undefined, "a footnote entry carries no text");
	assert.strictEqual(e.foot.name, "Sicilian");
	assert.strictEqual(e.foot.eval, "=");
	assert.strictEqual(e.foot.note, "sharp");
	assert.strictEqual(e.foot.d, 1, "divergence index into its own moves");
	// the marker lands on the MAINLINE, not on the footnote line
	assert.deepStrictEqual(byLine.get(s.lines[0])[1], [1]);
});

test("a footnote past the end of the mainline anchors on its last move", () => {
	// built by hand rather than from a PGN: the point is a footnote whose
	// divergence index lands beyond the mainline's last move
	const main = {
		isMain: true,
		comments: [],
		moves: [
			{ san: "e4", ply: 0 },
			{ san: "e5", ply: 1 },
		],
	};
	const foot = {
		tag: "foot",
		comments: [],
		marks: {},
		meta: {},
		moves: [
			{ san: "e4", ply: 0 },
			{ san: "e5", ply: 1 },
			{ san: "Nf3", ply: 2 },
		],
	};
	const { entries } = numberNotes([main, foot]);
	assert.strictEqual(entries.length, 1);
	assert.strictEqual(entries[0].ply, 1, "falls back to the mainline's last move");
	assert.strictEqual(entries[0].foot.d, 2);
});

test("a footnote's own notes stay separate numbered entries", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const c5 = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	const { entries, byLine } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 2, "the footnote plus its inner note");
	assert.ok(entries[0].foot, "the footnote comes first");
	assert.strictEqual(entries[1].text, "knight move");
	// the inner note's marker renders inside the footnote's own move text
	const innerPly = entries[1].ply;
	assert.deepStrictEqual(byLine.get(c5)[innerPly], [2]);
	assert.deepStrictEqual(entries[0].foot.noteByPly[innerPly], [2]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx node --test tests/notes.test.mjs`
Expected: FAIL — `entries.length` is 0 (or 1 for the inner-note test); no `foot` property exists.

- [ ] **Step 3: Derive footnote entries in `numberNotes`**

In `src/notes.js`, add the import:

```js
import { divergence } from "./tree.js";
```

Add this helper above `numberNotes`:

```js
// The mainline move a footnote replaces: the one at the divergence index. A
// footnote that runs past the mainline's end has no such move, so it anchors
// on the mainline's last move instead.
function anchorPly(main, d) {
	const m = main.moves[d] || main.moves[main.moves.length - 1];
	return m ? m.ply : 0;
}
```

Then, inside the `lines.forEach((l) => { ... })` loop in `numberNotes`, insert this **before** the `(l.comments || []).forEach(...)` block:

```js
		// A footnote line is pulled out of the table and rendered as a note
		// anchored on the mainline move it replaces. Derived here rather than
		// written into l.comments so renaming or re-tagging the line can never
		// leave a stale note behind. `noteByPly: map` is this line's own map,
		// filled in by the comment loop just below — the reference is shared, so
		// the footnote's inner markers are present by the time anything renders.
		if (!l.isMain && l.tag === "foot" && main) {
			const d = divergence(l, main);
			const ply = anchorPly(main, d);
			const n = entries.length + 1;
			entries.push({
				ply,
				owner: main,
				n,
				foot: {
					name: l.name || "",
					eval: (l.meta && l.meta.eval) || "",
					note: (l.meta && l.meta.note) || "",
					moves: l.moves,
					marks: l.marks || {},
					noteByPly: map,
					d,
				},
			});
			const mainMap = byLine.get(main) || {};
			byLine.set(main, mainMap);
			(mainMap[ply] = mainMap[ply] || []).push(n);
		}
```

And add the mainline lookup at the top of `numberNotes`, above `lines.forEach`:

```js
	const main = lines.find((l) => l.isMain) || lines[0];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx node --test tests/notes.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test && npm run lint`
Expected: PASS. Existing footnote tests still pass — the lettered section has not been touched yet, it now simply has a numbered entry alongside it.

- [ ] **Step 6: Commit**

```bash
git add src/notes.js tests/notes.test.mjs
git commit -m "Derive a numbered note from every footnote line"
```

---

### Task 6: Shared footnote renderers in `render.js`

Three places render notes — the screen panel, the print block, and Markdown — so the footnote formatting lives in one DOM builder and one text builder rather than being written out three times.

**Files:**
- Modify: `src/render.js`
- Test: `tests/render.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/render.test.mjs` (follow the file's existing pattern of installing jsdom and tearing it down):

```js
test("appendFootnote renders name, context, moves, eval and commentary", () => {
	const off = installDom();
	const span = document.createElement("span");
	appendFootnote(span, {
		name: "Sicilian",
		eval: "=",
		note: "sharp and **double-edged**",
		moves: [
			{ san: "e4", ply: 0 },
			{ san: "c5", ply: 1 },
			{ san: "Nf3", ply: 2 },
		],
		marks: { 2: "!" },
		noteByPly: { 2: [3] },
		d: 1,
	});
	const text = span.textContent;
	assert.match(text, /^Sicilian: /);
	assert.match(text, /1\.e4/, "context move precedes the divergent tail");
	assert.match(text, /1\.\.\.c5/);
	assert.match(text, /2\.Nf3 !/, "per-move marks are kept");
	assert.match(text, /—/);
	assert.strictEqual(
		span.querySelector("sup").textContent,
		"3",
		"the footnote's own notes render as inline superscripts",
	);
	assert.ok(
		span.querySelector("strong"),
		"commentary goes through renderInline",
	);
	off();
});

test("appendFootnote omits the parts a footnote does not have", () => {
	const off = installDom();
	const span = document.createElement("span");
	appendFootnote(span, {
		name: "",
		eval: "",
		note: "",
		moves: [
			{ san: "e4", ply: 0 },
			{ san: "c5", ply: 1 },
		],
		marks: {},
		noteByPly: {},
		d: 1,
	});
	assert.strictEqual(span.textContent.trim(), "⋯ 1.e4 1...c5");
	assert.strictEqual(span.querySelector("sup"), null);
	off();
});

test("appendFootnote with no divergent tail renders name and commentary alone", () => {
	const off = installDom();
	const span = document.createElement("span");
	appendFootnote(span, {
		name: "Transposes",
		eval: "",
		note: "same position",
		moves: [{ san: "e4", ply: 0 }],
		marks: {},
		noteByPly: {},
		d: 1,
	});
	// a footnote that shares everything it has with the mainline has no tail to
	// show, so it is just its name, the anchor move, and its commentary
	assert.match(span.textContent, /^Transposes: ⋯ 1\.e4\s+— same position$/);
	off();
});

test("footnoteText renders the same footnote as plain text", () => {
	assert.strictEqual(
		footnoteText({
			name: "Sicilian",
			eval: "=",
			note: "sharp",
			moves: [
				{ san: "e4", ply: 0 },
				{ san: "c5", ply: 1 },
			],
			marks: {},
			noteByPly: {},
			d: 1,
		}),
		"Sicilian: ⋯ 1.e4 1...c5 = — sharp",
	);
});
```

Add `appendFootnote` and `footnoteText` to the `../src/render.js` import at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test tests/render.test.mjs`
Expected: FAIL — `does not provide an export named 'appendFootnote'`

- [ ] **Step 3: Implement both renderers**

Add to `src/render.js` (tabs), next to `fullMovesText` at the bottom of the file, and add `renderInline` to the imports:

```js
import { renderInline } from "./dom.js";
```

```js
// A footnote-derived note: "Sicilian: ⋯ 1.e4 1...c5 = — commentary". The moves
// shown are the footnote's own tail, prefixed with the last shared move for
// context, and any notes on those moves render as inline superscripts.
export function appendFootnote(container, foot) {
	const t = (s) => container.appendChild(document.createTextNode(s));
	if (foot.name) t(foot.name + ": ");
	if (foot.d > 0) {
		const pm = foot.moves[foot.d - 1];
		t("⋯ " + fullmoveLabel(pm.ply) + pm.san + " ");
	}
	foot.moves.slice(foot.d).forEach((m, i) => {
		if (i) t(" ");
		const mark = foot.marks && foot.marks[m.ply] ? " " + foot.marks[m.ply] : "";
		t(fullmoveLabel(m.ply) + m.san + mark);
		const refs = (foot.noteByPly && foot.noteByPly[m.ply]) || [];
		if (refs.length) {
			const sup = document.createElement("sup");
			sup.textContent = refs.join(",");
			container.appendChild(sup);
		}
	});
	if (foot.eval) t(" " + foot.eval);
	if (foot.note) {
		t(" — ");
		renderInline(container, foot.note);
	}
}

// Same footnote, as plain text for exports that have no DOM. Inline note
// markers are dropped: a text export has no superscripts to render them as.
export function footnoteText(foot) {
	const pm = foot.d > 0 ? foot.moves[foot.d - 1] : null;
	const ctx = pm ? "⋯ " + fullmoveLabel(pm.ply) + pm.san + " " : "";
	const tail = foot.moves
		.slice(foot.d)
		.map(
			(m) =>
				fullmoveLabel(m.ply) +
				m.san +
				(foot.marks && foot.marks[m.ply] ? " " + foot.marks[m.ply] : ""),
		)
		.join(" ");
	return (
		(foot.name ? foot.name + ": " : "") +
		ctx +
		tail +
		(foot.eval ? " " + foot.eval : "") +
		(foot.note ? " — " + foot.note : "")
	);
}
```

Do **not** reach for `fullMovesText` here: it numbers only White's half-moves ("1. e4 e5"), so a footnote tail starting on Black would render as a bare `c5` and disagree with `appendFootnote`, which labels every move.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx node --test tests/render.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite and lint**

Run: `npm test && npm run lint && npm run knip`
Expected: PASS. `knip` may flag `footnoteText` as unused until Task 10 consumes it — if it does, note it and continue; it is resolved by the end of the plan.

- [ ] **Step 6: Commit**

```bash
git add src/render.js tests/render.test.mjs
git commit -m "Add the shared footnote renderers"
```

---

### Task 7: One notes list on screen

**Files:**
- Modify: `src/export.js:72-118` (`notesFootnotesPanel`)
- Test: `tests/export.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/export.test.mjs`:

```js
test("the notes panel renders footnotes as numbered notes with no separate section", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 {develops}", {
    tags: { 1: "foot" },
  });
  s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
  const box = notesFootnotesPanel();
  const headings = [...box.querySelectorAll("h3")].map((h) => h.textContent);
  assert.deepStrictEqual(headings, ["Notes"], "no Footnotes heading");
  const rows = [...box.querySelectorAll(".nt")];
  assert.strictEqual(rows.length, 2, "the footnote and the mainline note");
  const marks = rows.map((r) => r.querySelector("sup").textContent);
  assert.deepStrictEqual(marks, ["[1]", "[2]"], "one numbered sequence");
  assert.match(rows[0].textContent, /Sicilian/);
  off();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test tests/export.test.mjs`
Expected: FAIL — headings are `["Notes", "Footnotes"]`.

- [ ] **Step 3: Rewrite the panel**

Replace `notesFootnotesPanel` in `src/export.js` (2 spaces) with:

```js
// The read-only reference list that prints and exports. Notes are numbered
// (PGN {comments}); a Footnote-tagged line derives an entry in the same
// sequence, anchored on the mainline move it replaces.
export function notesFootnotesPanel() {
  const box = el("div", { className: "notes" });
  const notes = allNotes();
  box.appendChild(el("h3", { textContent: "Notes" }));
  notes.forEach((note) => {
    const row = el("div", { className: "nt" });
    row.appendChild(el("sup", { textContent: "[" + note.n + "]" }));
    const span = document.createElement("span");
    if (note.foot) {
      appendFootnote(span, note.foot);
    } else {
      span.appendChild(
        document.createTextNode(moveRef(note.ply, note.owner) + " — "),
      );
      renderInline(span, note.text);
    }
    row.appendChild(span);
    box.appendChild(row);
  });
  return box;
}
```

Add `appendFootnote` to the `./render.js` import at the top of `src/export.js`. Remove `divergence` and `branchContext` from that file's imports **only if** nothing else in the file still uses them — `branchContext` is exported and used by `src/line-editor.js:6`, so it stays.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx node --test tests/export.test.mjs`
Expected: PASS. Any existing test asserting a `Footnotes` heading or lettered `a`/`b` markers in this panel now fails — update those assertions to the numbered form rather than deleting the tests.

- [ ] **Step 5: Run the full suite and lint**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/export.js tests/export.test.mjs
git commit -m "Render footnotes inside the one numbered notes list"
```

---

### Task 8: Footnotes leave the print cards

**Files:**
- Modify: `src/render.js:343` and `src/render.js:405-415`
- Test: `tests/render.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/render.test.mjs`:

```js
test("renderCards renders no card for a footnote line", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const g = grid(s.lines);
	const box = document.createElement("div");
	renderCards(box, g, { notes: allNotes() });
	const names = [...box.querySelectorAll(".card")].map(
		(c) => c.querySelector(".tag").textContent,
	);
	assert.ok(!names.includes("Footnote"), `no footnote cards (got ${names})`);
	off();
});

test("a card lists a footnote anchored on its own line", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", {
		tags: { 1: "foot" },
	});
	s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
	const g = grid(s.lines);
	const box = document.createElement("div");
	renderCards(box, g, { notes: allNotes() });
	const mainCard = box.querySelector(".card");
	assert.match(mainCard.querySelector(".card-notes").textContent, /Sicilian/);
	off();
});
```

Add `loadState`, `grid` and `allNotes` to the imports of `tests/render.test.mjs` if they are not already there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx node --test tests/render.test.mjs`
Expected: FAIL — the first test finds a `Footnote` card; the second throws inside `strip()` because a footnote entry has no `.text`.

- [ ] **Step 3: Stop merging footnotes into the cards**

In `src/render.js`, change line 343 from:

```js
	const all = [...grid.vars, ...grid.footNotes];
```

to:

```js
	// Footnote lines are notes, not cards — they render in the notes block of
	// whichever card carries their anchor.
	const all = grid.vars;
```

- [ ] **Step 4: Handle footnote entries in the card notes block**

In `renderCards`, the notes block (`src/render.js:405-415`) does `strip(note.text)`, which is `undefined` for a footnote entry. Replace the collection loop:

```js
		const owned = [];
		for (const ply in v.noteByPly || {}) {
			v.noteByPly[ply].forEach((n) => {
				const note = notes[n - 1];
				if (note) owned.push({ n, ply: Number(ply), text: strip(note.text) });
			});
		}
```

with:

```js
		const owned = [];
		for (const ply in v.noteByPly || {}) {
			v.noteByPly[ply].forEach((n) => {
				const note = notes[n - 1];
				if (!note) return;
				owned.push({
					n,
					ply: Number(ply),
					text: note.foot ? footnoteText(note.foot) : strip(note.text),
				});
			});
		}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx node --test tests/render.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the full suite and lint**

Run: `npm test && npm run lint`
Expected: PASS. Existing card tests that count cards on a fixture containing footnotes now expect one fewer card — update those counts.

- [ ] **Step 7: Commit**

```bash
git add src/render.js tests/render.test.mjs
git commit -m "Keep footnotes out of the print cards"
```

---

### Task 9: Footnotes in the printed notes block

`renderTableNotes` matches a note back to a table's rows through `notesForVar`, which walks `line.comments` (`src/print.js:63-77`). A footnote entry has no comment behind it, so it needs collecting by owner instead.

**Files:**
- Modify: `src/print.js:63-77` (`notesForVar`)
- Test: `tests/print.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/print.test.mjs`:

```js
test("a footnote prints in the notes block under the first table", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6", {
    tags: { 1: "foot" },
  });
  s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  const blocks = [...box.querySelectorAll(".print-notes")];
  assert.ok(blocks.length, "a notes block is emitted");
  assert.match(blocks[0].textContent, /Sicilian/, "the footnote prints");
  assert.strictEqual(
    blocks[0].querySelector(".nt sup").textContent,
    "[1]",
    "numbered, not lettered",
  );
  off();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test tests/print.test.mjs`
Expected: FAIL — the notes block has no `Sicilian` in it (the block is emitted empty).

- [ ] **Step 3: Collect footnote entries by owner**

Replace `notesForVar` in `src/print.js` (2 spaces):

```js
// The numbered notes belonging to a table's var (matched back to its source
// line by move-array identity). Numbers match the superscripts in the cells.
// Footnote-derived entries have no comment behind them, so they are collected
// by owner: they belong to the line their anchor marker sits on.
function notesForVar(v) {
  const line = getCurrent().lines.find((l) => l.moves === v.moves);
  if (!line) return [];
  const all = allNotes();
  const out = [];
  const seen = new Set();
  const take = (n) => {
    if (!n || seen.has(n.n)) return;
    seen.add(n.n);
    out.push(n);
  };
  all.forEach((n) => {
    if (n.foot && n.owner === line) take(n);
  });
  (line.comments || []).forEach((c) => {
    take(all.find((x) => x.ply === c.ply && x.text === c.text));
  });
  return out;
}
```

- [ ] **Step 4: Render footnote entries in the block**

In `renderTableNotes` (`src/print.js:114-124`), replace the row-building loop:

```js
  rows.forEach((n) => {
    const row = el("div", { className: "nt" });
    row.appendChild(el("sup", { textContent: "[" + n.n + "]" }));
    const span = document.createElement("span");
    span.appendChild(document.createTextNode(moveRef(n.ply, n.owner) + " — "));
    renderInline(span, n.text);
    row.appendChild(span);
    box.appendChild(row);
  });
```

with:

```js
  rows.forEach((n) => {
    const row = el("div", { className: "nt" });
    row.appendChild(el("sup", { textContent: "[" + n.n + "]" }));
    const span = document.createElement("span");
    if (n.foot) {
      appendFootnote(span, n.foot);
    } else {
      span.appendChild(document.createTextNode(moveRef(n.ply, n.owner) + " — "));
      renderInline(span, n.text);
    }
    row.appendChild(span);
    box.appendChild(row);
  });
```

Add `appendFootnote` to the `./render.js` import at the top of `src/print.js`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx node --test tests/print.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the full suite and lint**

Run: `npm test && npm run lint`
Expected: PASS. Footnote entries are owned by the mainline, so the existing `showMain` rule keeps them under the first table only — no change needed there.

- [ ] **Step 7: Commit**

```bash
git add src/print.js tests/print.test.mjs
git commit -m "Print footnotes in the per-table notes block"
```

---

### Task 10: Markdown emits footnotes as notes

The Markdown export is slated for deletion in the PGN-writer sub-project; until then it stays consistent with the rest.

**Files:**
- Modify: `src/export.js:257-273` (the `## Footnotes` block) and `src/export.js:274-280` (the notes block)
- Test: `tests/export.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/export.test.mjs`:

```js
test("Markdown emits footnotes as notes with no Footnotes section", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", {
    tags: { 1: "foot" },
  });
  s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
  const md = buildMarkdown();
  assert.ok(!md.includes("## Footnotes"), "no Footnotes section");
  assert.match(md, /## Notes/);
  assert.match(md, /1\. Sicilian: /, "the footnote is note 1");
  off();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test tests/export.test.mjs`
Expected: FAIL — the output still contains `## Footnotes`.

- [ ] **Step 3: Delete the Footnotes section and render footnotes in the notes list**

In `src/export.js`, delete the whole `if (g.footNotes.length) { ... }` block (lines 257-273) and replace the notes block that follows it with:

```js
  const notes = allNotes();
  if (notes.length) {
    L.push("", "## Notes", "");
    notes.forEach((note) =>
      L.push(
        note.foot
          ? `${note.n}. ${footnoteText(note.foot)}`
          : `${note.n}. ${moveRef(note.ply, note.owner)} — ${note.text}`,
      ),
    );
  }
```

Add `footnoteText` to the `./render.js` import at the top of `src/export.js`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx node --test tests/export.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite and lint**

Run: `npm test && npm run lint && npm run knip`
Expected: PASS, and `knip` no longer flags `footnoteText`.

- [ ] **Step 6: Commit**

```bash
git add src/export.js tests/export.test.mjs
git commit -m "Emit footnotes as notes in the Markdown export"
```

---

### Task 11: Delete the lettering

Nothing renders a footnote letter any more.

**Files:**
- Modify: `src/table.js:18-27` (`footLetter`), `src/table.js:99-103` (the lettering call)
- Modify: `src/render.js:203-207` and `src/render.js:358-362` (the `v.letter` blocks)
- Test: `tests/table.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/table.test.mjs`:

```js
test("footnote lines carry no letter", () => {
	const lines = linesFrom("1. e4 e5 (1... c5 2. Nf3) 2. Nf3");
	lines[1].tag = "foot";
	const { footNotes } = grid(lines);
	assert.strictEqual(footNotes.length, 1);
	assert.strictEqual(footNotes[0].letter, undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx node --test tests/table.test.mjs`
Expected: FAIL — `letter` is `"a"`.

- [ ] **Step 3: Remove the lettering**

In `src/table.js`, delete the `footLetter` function and its comment (lines 18-27), and delete the lettering call with its comment block (lines 99-103):

```js
	// letter the footnote lines: a, b, ..., z, aa, ab, ... (spreadsheet-column
	// style bijective base-26) so a 27th+ footnote doesn't overflow into
	// punctuation/non-printable code points past 'z'.
	footNotes.forEach((f, i) => (f.letter = footLetter(i)));
```

- [ ] **Step 4: Remove the two dead superscript blocks**

In `src/render.js`, delete this block at line 203:

```js
		if (v.letter) {
			const s = document.createElement("sup");
			s.textContent = "[" + v.letter + "]";
			c.appendChild(s);
		}
```

and the equivalent block at line 358 (inside `renderCards`, appending to `head`). Both are unreachable now that no var or card carries a letter.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. Any remaining test asserting a lettered marker fails here — update it to the numbered form.

- [ ] **Step 6: Lint and check for dead code**

Run: `npm run lint && npm run knip`
Expected: PASS, no unused exports.

- [ ] **Step 7: Commit**

```bash
git add src/table.js src/render.js tests/table.test.mjs
git commit -m "Delete footnote lettering now that nothing renders it"
```

---

### Task 12: Numbering-parity regression guard and final verification

The parity test from Task 4 runs on a fixture with no footnotes. This widens it to the case the design exists to protect.

**Files:**
- Modify: `tests/notes.test.mjs`

- [ ] **Step 1: Write the test**

Append to `tests/notes.test.mjs`:

```js
test("table markers and the notes list agree with footnotes in the mix", () => {
	const s = loadState(
		"1. e4 {opening} e5 (1... c5 {sicilian} 2. Nf3 {knight}) (1... e6 2. d4) 2. Nf3 {develops} Nc6",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const { vars, footNotes } = grid(s.lines);
	const notes = allNotes();
	const byNumber = new Map(notes.map((n) => [n.n, n]));
	// every number is dense, 1..N, with no gaps left by a diverted footnote
	assert.deepStrictEqual(
		notes.map((n) => n.n),
		notes.map((_, i) => i + 1),
	);
	// two footnote entries, both owned by the mainline
	const feet = notes.filter((n) => n.foot);
	assert.strictEqual(feet.length, 2);
	feet.forEach((f) => assert.strictEqual(f.owner, s.lines[0]));
	// every marker in the table resolves to a note anchored at the same ply
	[...vars, ...footNotes].forEach((v) => {
		Object.entries(v.noteByPly).forEach(([ply, nums]) => {
			nums.forEach((n) => {
				assert.ok(byNumber.has(n), `marker ${n} resolves`);
				assert.strictEqual(byNumber.get(n).ply, Number(ply));
			});
		});
	});
	// the footnote's inner note is its own entry, marked inside the footnote text
	const inner = notes.find((n) => n.text === "knight");
	assert.ok(inner, "the inner note survives as its own entry");
	const withInner = feet.find((f) => f.foot.noteByPly[inner.ply]);
	assert.ok(withInner, "and is marked inside its footnote's move text");
	assert.deepStrictEqual(withInner.foot.noteByPly[inner.ply], [inner.n]);
});
```

- [ ] **Step 2: Run the test**

Run: `npx node --test tests/notes.test.mjs`
Expected: PASS. If it fails, the numbering has a real bug — fix `src/notes.js`, do not weaken the test.

- [ ] **Step 3: Run everything CI runs**

Run: `npm run lint && npm run knip && npm test`
Expected: PASS, all three.

- [ ] **Step 4: Check coverage**

Run: `npm run coverage`
Expected: `src/notes.js` and `src/table.js` are well covered. Do **not** import `src/app.js` with a `?t=` cache-buster anywhere in the tests — it hides most of that module's coverage.

- [ ] **Step 5: Update the README**

`README.md:15-17` still describes footnotes as "pulled out of the table into the prose **Footnotes** section". Change that sentence to say footnotes are pulled out of the table and appear as numbered notes, anchored in the table on the move they replace.

- [ ] **Step 6: Commit**

```bash
git add tests/notes.test.mjs README.md
git commit -m "Guard note-numbering parity and update the README"
```

---

## Done when

- A Footnote-tagged line renders nowhere in the table and as a numbered note in the one Notes list, on screen, in print, and in Markdown.
- The table shows `[n]` on the mainline row at the move each footnote replaces.
- A footnote's own notes are separate numbered entries, marked inline in the footnote's move text.
- No footnote renders as a print card, and no letter appears anywhere.
- `npm run lint && npm run knip && npm test` all pass.
