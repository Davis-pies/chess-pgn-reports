# Collapsible Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the on-screen Notes panel foldable — every cluster of related entries (a group footnote's branches, a footnote's own sub-notes, several notes on one move) collapses to a one-line header, and the whole section collapses to its heading.

**Architecture:** A new module `src/notes-view.js` owns the screen Notes panel, moved out of `src/export.js`. Its core is a pure `noteTree(entries, lines)` that groups `allNotes()`'s flat entry list into a tree of collapsible rows with content-derived keys; a recursive renderer turns nodes into `<details>` and leaves into exactly the DOM the panel builds today. `src/render.js` exports three small seams (`footStem`, `subNoteRow`, `appendFootNode`) so the flat print/card path and the collapsible screen path share one footnote renderer without either acquiring a mode flag. Collapse state lives in a session-only `closedNotePaths` Set — inverted relative to `openPaths`, because notes start expanded.

**Tech Stack:** Vanilla ES modules, no build step. Tests are `node --test` with jsdom.

**Conventions:** `src/render.js`, `src/notes.js`, `src/table.js`, `src/tree.js`, `src/line-editor.js`, `src/foot-groups.js`, `src/foot-nodes.js`, `src/nags.js`, `src/trie-view.js`, `src/visibility.js`, `src/state.js` and `src/pgn-out.js` indent with **TABS**; `src/app.js`, `src/store.js`, `src/export.js`, `src/dom.js` and `style.css` indent with **2 SPACES**. Match the file you are editing. New module `src/notes-view.js` uses **TABS**. Run `npm test`, `npm run lint`, `npm run knip`.

**Spec:** `docs/superpowers/specs/2026-08-25-collapsible-notes-design.md`

**Do not** import `src/app.js` with a `?t=` cache-buster in any new test — it hides most of that module's coverage.

---

### Task 1: Footnote-rendering seams in `render.js`

Split `appendFootnote()`'s three jobs into reusable pieces so the collapsible view can put a footnote's stem in a `<summary>` and its sub-notes and branches in a body. The flat output must not change by a single element — `tests/render.test.mjs` and `tests/print.test.mjs` are the proof.

**Files:**
- Modify: `src/render.js:521-542` (`appendFootnote`), `src/render.js:566-582` (`appendFootNode`), `src/render.js:589-601` (`renderSubNotes`)
- Test: `tests/render.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/render.test.mjs`:

```js
test("footStem renders a footnote's inline content and nothing else", () => {
	const off = installDom();
	const box = document.createElement("div");
	footStem(box, {
		depth: 0,
		name: "Sicilian",
		eval: "=",
		note: "the **main** try",
		moves: [{ ply: 2, san: "c5" }],
		marks: {},
		noteByPly: {},
		subNotes: [{ label: "a", ply: 2, text: "ignored here" }],
		children: [],
		d: 0,
	});
	assert.strictEqual(box.children.length, 1, "one inline span");
	assert.strictEqual(box.firstChild.tagName, "SPAN");
	assert.match(box.textContent, /Sicilian: 2\.c5 = — the main try/);
	assert.strictEqual(
		box.querySelector(".subnote"),
		null,
		"sub-notes are the caller's job, not the stem's",
	);
	off();
});

test("footStem appends nothing when a footnote has no inline content", () => {
	const off = installDom();
	const box = document.createElement("div");
	footStem(box, { depth: 0, moves: [], marks: {}, noteByPly: {}, d: 0 });
	assert.strictEqual(box.childNodes.length, 0);
	off();
});

test("subNoteRow builds one labelled .subnote row", () => {
	const off = installDom();
	const row = subNoteRow({ label: "b", ply: 4, text: "a *sharp* reply" });
	assert.strictEqual(row.className, "subnote");
	assert.strictEqual(row.querySelector("sup").textContent, "[b]");
	assert.strictEqual(row.querySelector("em").textContent, "sharp");
	off();
});

test("appendFootNode renders one group branch as a depth-marked row", () => {
	const off = installDom();
	const box = document.createElement("div");
	appendFootNode(box, {
		depth: 1,
		label: "a",
		name: "",
		eval: "",
		note: "",
		moves: [{ ply: 3, san: "Nf3" }],
		marks: {},
		noteByPly: {},
		subNotes: [],
		children: [],
		d: 0,
	});
	const row = box.querySelector(".fnode");
	assert.ok(row.className.includes("d1"), "carries its depth class");
	assert.strictEqual(row.querySelector("sup").textContent, "[a]");
	assert.match(row.textContent, /2\.\.\.Nf3/);
	off();
});
```

Add `footStem`, `subNoteRow` and `appendFootNode` to the `../src/render.js` import list at the top of `tests/render.test.mjs:11-20`.

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern='footStem|subNoteRow|appendFootNode'`
Expected: FAIL — `SyntaxError: The requested module '../src/render.js' does not provide an export named 'footStem'`.

- [x] **Step 3: Implement the seams**

In `src/render.js`, replace the body of `appendFootnote` (keep its existing doc comment above it) with:

```js
export function appendFootnote(container, foot) {
	footStem(container, foot);
	renderSubNotes(container, foot);
	// A group's members hang below it as nested labelled rows, one level of
	// indentation per depth (the nesting does the indenting; see .fnode in
	// style.css). A lone footnote has no children and stops here.
	(foot.children || []).forEach((c) => appendFootNode(container, c));
}

// A footnote's inline content — name, moves, evaluation, commentary — as one
// span appended to `container`. Split out of appendFootnote because the
// collapsible notes panel puts this exact stem in a <summary> while its
// sub-notes and branches go in the body below; both callers must produce the
// same stem or the screen and the print report would drift.
export function footStem(container, foot) {
	const span = document.createElement("span");
	const t = (s) => span.appendChild(document.createTextNode(s));
	if (foot.name) t(foot.name + ": ");
	const tail = appendFootMoves(span, foot);
	if (foot.eval) t((tail.length ? " " : "") + foot.eval);
	if (foot.note) {
		// The dash separates moves from commentary. A footnote that shares
		// everything it has with its parent has no moves to separate, so the
		// commentary follows the name directly instead of a dangling dash.
		if (tail.length || foot.eval) t(" — ");
		renderInline(span, foot.note);
	}
	// Nothing inline to show (a footnote with no moves, name, eval or note)
	// leaves no empty span behind.
	if (span.childNodes.length) container.appendChild(span);
}
```

Replace `appendFootNode` with the exported version (its doc comment stays):

```js
export function appendFootNode(container, node) {
	const row = el("div", { className: "fnode d" + node.depth });
	row.appendChild(el("sup", { textContent: "[" + node.label + "]" }));
	footStem(row, node);
	renderSubNotes(row, node);
	(node.children || []).forEach((c) => appendFootNode(row, c));
	container.appendChild(row);
}
```

Note: a branch with no name, moves, eval or note used to get an empty `<span>` here and now gets nothing. That is invisible in every renderer and makes the two stems identical; it is the only behavioural difference in this task.

Replace `renderSubNotes` and add `subNoteRow` (the doc comment on `renderSubNotes` stays):

```js
function renderSubNotes(container, foot) {
	(foot.subNotes || []).forEach((s) => container.appendChild(subNoteRow(s)));
}

// One sub-note as its own labelled row. Exported because the collapsible notes
// panel places these rows itself, inside a <details> body.
export function subNoteRow(s) {
	const row = document.createElement("div");
	row.className = "subnote";
	const sup = document.createElement("sup");
	sup.textContent = "[" + s.label + "]";
	row.appendChild(sup);
	const span = document.createElement("span");
	renderInline(span, s.text);
	row.appendChild(span);
	return row;
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the four new tests, and every existing `render.test.mjs`, `print.test.mjs` and `export.test.mjs` test unchanged. If any flat-output test fails, the refactor changed behaviour; fix `render.js`, do not edit the test.

- [x] **Step 5: Commit**

```bash
git add src/render.js tests/render.test.mjs
git commit -m "Split the footnote renderer into reusable seams"
```

---

### Task 2: `closedNotePaths` in `state.js`

The session-only collapse Set, and the three sites that already reset trie state.

**Files:**
- Modify: `src/state.js:37` (after `openHiddenPaths`), `src/app.js:14-20` (imports), `src/app.js:74-75`, `src/app.js:456`, `src/app.js:694`

- [x] **Step 1: Add the Set**

In `src/state.js`, after the `openHiddenPaths` block:

```js
// Note groups the user COLLAPSED in the Notes panel. Inverted relative to
// openPaths: the notes are a reference list you read, so everything starts
// expanded and this records only what was closed. A key that goes stale
// therefore reopens a group — it can never hide a note. Session-only: nothing
// in store.js saves it.
export const closedNotePaths = new Set();
```

- [x] **Step 2: Clear it alongside `openPaths`**

In `src/app.js`, add `closedNotePaths` to the `./state.js` import list, then add `closedNotePaths.clear();` immediately after each of the three existing `openPaths.clear();` calls that reset a notebook:

- `src/app.js:74` (the module-level pair, which exists for the test suite's re-imports — note `openTablePaths.clear()` follows it)
- `src/app.js:456` (the notebook-open handler)
- `src/app.js:694` (the PGN-import handler)

Leave the two `openPaths.clear()` calls inside `markupPanel()`'s Expand/Collapse-all buttons (`src/app.js:553`, `src/app.js:562`) alone — those are line-editor controls, not notebook resets.

- [x] **Step 3: Verify nothing broke**

Run: `npm test && npm run lint`
Expected: PASS. `npm run knip` will report `closedNotePaths` as an unused export until Task 3 — that is expected here and must be gone by Task 6.

- [x] **Step 4: Commit**

```bash
git add src/state.js src/app.js
git commit -m "Add the session-only collapsed-notes set"
```

---

### Task 3: `noteTree()` — the pure grouping

Turn `allNotes()`'s flat entry list into a tree of rows with keys. No DOM.

**Files:**
- Create: `src/notes-view.js`
- Test: `tests/notes-view.test.mjs`

Row shape, used by every following task:

```js
{
	kind,      // "cluster" | "foot" | "fnode" | "note" | "subnote"
	key,       // collapse key; absent on a leaf
	rows,      // child rows; [] means leaf
	branches,  // nested foot branches under this row
	notes,     // sub-notes under it (for a cluster: its member entries)
	entry,     // "cluster" | "foot" | "note": the numberNotes entry
	node,      // "fnode": the foot-tree node
	sub,       // "subnote": the { label, ply, text } sub-note
	ref,       // "cluster": the move reference for its header
	inCluster, // "note": suppress the repeated move reference
}
```

- [x] **Step 1: Write the failing test**

Create `tests/notes-view.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { allNotes } from "../src/notes.js";
import { noteTree, collectNoteKeys } from "../src/notes-view.js";

// The tree for the state a PGN produces, which is what every case below wants.
const treeFor = (pgn, opts) => {
	const s = loadState(pgn, opts);
	return { s, tree: noteTree(allNotes(), s.lines) };
};

test("a lone note at a move stays a leaf", () => {
	const off = installDom();
	const { tree } = treeFor("1. e4 {solid} e5 2. Nf3");
	assert.strictEqual(tree.rows.length, 1);
	assert.strictEqual(tree.rows[0].kind, "note");
	assert.deepStrictEqual(tree.rows[0].rows, [], "nothing to collapse");
	assert.strictEqual(tree.rows[0].key, undefined);
	off();
});

test("two notes on one move cluster under a single move reference", () => {
	const off = installDom();
	const { s } = treeFor("1. e4 e5 2. Nf3");
	const main = s.lines.find((l) => l.isMain);
	main.comments = [
		{ ply: 0, text: "first" },
		{ ply: 0, text: "second" },
	];
	const tree = noteTree(allNotes(), s.lines);
	assert.strictEqual(tree.rows.length, 1, "one cluster, not two notes");
	const c = tree.rows[0];
	assert.strictEqual(c.kind, "cluster");
	assert.strictEqual(c.ref, "1.e4");
	assert.strictEqual(c.notes, 2);
	assert.strictEqual(c.rows.length, 2);
	assert.ok(
		c.rows.every((r) => r.kind === "note" && r.inCluster),
		"members drop the repeated move reference",
	);
	off();
});

test("notes on the same ply but different owners do not cluster", () => {
	const off = installDom();
	const { s } = treeFor("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", {
		tags: { 1: "sideline" },
	});
	s.lines.find((l) => l.isMain).comments = [{ ply: 2, text: "on the main" }];
	s.lines
		.find((l) => l.moves.some((m) => m.san === "c5"))
		.comments = [{ ply: 2, text: "on the sideline" }];
	const tree = noteTree(allNotes(), s.lines);
	assert.strictEqual(tree.rows.length, 2, "two separate notes");
	assert.ok(tree.rows.every((r) => r.kind === "note"));
	off();
});

test("a group footnote becomes a node counting its branches", () => {
	const off = installDom();
	const { tree } = treeFor("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	assert.strictEqual(tree.rows.length, 1);
	const g = tree.rows[0];
	assert.strictEqual(g.kind, "foot");
	assert.strictEqual(g.branches, 2);
	assert.strictEqual(g.notes, 0);
	assert.strictEqual(g.rows.length, 2);
	assert.ok(g.rows.every((r) => r.kind === "fnode"));
	off();
});

test("a footnote with its own notes becomes a node counting them", () => {
	const off = installDom();
	const { tree } = treeFor("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const f = tree.rows.find((r) => r.kind === "foot");
	assert.strictEqual(f.notes, 1);
	assert.strictEqual(f.branches, 0);
	assert.strictEqual(f.rows.length, 1);
	assert.strictEqual(f.rows[0].kind, "subnote");
	off();
});

test("a footnote with nothing nested stays a leaf", () => {
	const off = installDom();
	const { tree } = treeFor("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const f = tree.rows.find((r) => r.kind === "foot");
	assert.deepStrictEqual(f.rows, []);
	off();
});

test("keys are unique and survive a renumbering edit", () => {
	const off = installDom();
	const { s, tree } = treeFor(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const before = new Set();
	collectNoteKeys(tree, before);
	assert.ok(before.has("notes"), "the section itself has a key");
	// the section, the group entry, and one per branch — four distinct keys,
	// which is also the check that two branches did not collide on one key
	assert.strictEqual(before.size, 4);
	assert.ok([...before].every((k) => k.startsWith("notes")), "rooted");
	// a new note earlier in the game renumbers every entry after it
	s.lines.find((l) => l.isMain).comments = [{ ply: 0, text: "a new note" }];
	const after = new Set();
	collectNoteKeys(noteTree(allNotes(), s.lines), after);
	before.forEach((k) => assert.ok(after.has(k), `key ${k} survived: ${k}`));
	off();
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/notes-view.test.mjs`
Expected: FAIL — `Cannot find module '.../src/notes-view.js'`.

- [x] **Step 3: Implement `noteTree` and `collectNoteKeys`**

Create `src/notes-view.js` (TABS):

```js
// The on-screen Notes panel: the numbered reference list, folded into
// collapsible groups. It lives apart from export.js — which owns the Markdown
// and PGN paths — because only the screen list collapses: the print report,
// the cards and every export render their notes flat, and giving the shared
// footnote renderer a screen-only mode flag would be one branch that only one
// caller ever takes.
import { moveRef } from "./export.js";

// The flat entry list from numberNotes(), grouped into a tree of collapsible
// rows. Pure: `lines` is passed rather than read off the state so the grouping
// can be tested without a notebook loaded.
//
// Three rules, applied together: several entries on one move cluster under that
// move's reference; a footnote with branches or notes of its own is a node; and
// a branch inside a group that has branches or notes of its own is a node too,
// recursively. Anything with nothing under it stays a leaf and gets no key.
export function noteTree(entries, lines) {
	const rows = [];
	// Cluster members by owning line + ply. Entries arrive in reading order, so
	// recording each key's first appearance keeps a cluster where its first
	// member stood; the same ply on two different lines is two clusters, since
	// a variation's first move shares its ply with the move it replaces.
	const at = new Map();
	entries.forEach((e) => {
		const k = lines.indexOf(e.owner) + ":" + e.ply;
		const arr = at.get(k);
		if (arr) arr.push(e);
		else at.set(k, [e]);
	});
	const done = new Set();
	entries.forEach((e) => {
		const k = lines.indexOf(e.owner) + ":" + e.ply;
		if (done.has(k)) return;
		done.add(k);
		const members = at.get(k);
		if (members.length < 2) {
			rows.push(entryRow(e, "notes", false));
			return;
		}
		const key = "notes/m" + k;
		rows.push({
			kind: "cluster",
			key,
			entry: e,
			ref: moveRef(e.ply, e.owner),
			rows: members.map((m) => entryRow(m, key, true)),
			branches: 0,
			notes: members.length,
		});
	});
	return { kind: "root", key: "notes", rows, branches: 0, notes: entries.length };
}

// One numbered entry. A plain note has nothing under it; a footnote may carry
// its own notes, its group's branches, or both.
function entryRow(entry, parentKey, inCluster) {
	if (!entry.foot)
		return { kind: "note", entry, inCluster, rows: [], branches: 0, notes: 0 };
	const foot = entry.foot;
	const key = parentKey + "/e" + entry.ply + ":" + firstSan(foot);
	return {
		kind: "foot",
		key,
		entry,
		rows: footRows(foot, key),
		branches: (foot.children || []).length,
		notes: (foot.subNotes || []).length,
	};
}

// A footnote's contents in the order appendFootnote() renders them: its own
// notes first, then its branches.
function footRows(foot, key) {
	const rows = (foot.subNotes || []).map((sub) => ({
		kind: "subnote",
		sub,
		rows: [],
		branches: 0,
		notes: 0,
	}));
	(foot.children || []).forEach((node, i) => {
		const k = key + "/" + i;
		rows.push({
			kind: "fnode",
			key: k,
			node,
			rows: footRows(node, k),
			branches: (node.children || []).length,
			notes: (node.subNotes || []).length,
		});
	});
	return rows;
}

// The first move a footnote shows — its own tail, starting where it diverges.
// Part of the key, so two footnotes anchored on one move stay distinguishable.
function firstSan(foot) {
	const m = (foot.moves || [])[foot.d];
	return m ? m.san : "";
}

// Every collapse key in the tree, for Collapse all.
export function collectNoteKeys(node, into) {
	if (node.key) into.add(node.key);
	node.rows.forEach((r) => collectNoteKeys(r, into));
	return into;
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/notes-view.test.mjs`
Expected: PASS, all seven.

- [x] **Step 5: Commit**

```bash
git add src/notes-view.js tests/notes-view.test.mjs
git commit -m "Group the notes list into a collapsible tree"
```

---

### Task 4: Render the tree as `<details>`

Move `notesPanel()` into `notes-view.js` and make it emit the tree. A leaf must produce exactly the DOM the panel produces today — the existing `export.test.mjs` and `app.test.mjs` assertions on `.nt`, `.fnode`, `.subnote` and `h3` are the proof.

**Files:**
- Modify: `src/notes-view.js`, `src/export.js:52-75` (delete `notesPanel`), `src/app.js:37` (import), `src/app.js:329`
- Test: `tests/notes-view.test.mjs`, `tests/export.test.mjs:5-12` (import path)

Class contract — three existing test files depend on it:

| Row | Element |
| --- | ------- |
| section | `<details class="notes">` — keeps the class the print rule hides |
| cluster | `<details class="ntcluster ngroup">` — **not** `.nt`, so entry counts stay right |
| footnote entry (node) | `<details class="nt ngroup">` |
| footnote entry (leaf) | `<div class="nt">` + `appendFootnote()` — unchanged |
| plain note | `<div class="nt">` — unchanged, minus the move ref inside a cluster |
| foot branch (node) | `<details class="fnode dN ngroup">` |
| foot branch (leaf) | `appendFootNode()` — unchanged |
| sub-note | `subNoteRow()` — unchanged |

- [x] **Step 1: Write the failing test**

Append to `tests/notes-view.test.mjs` (and add `notesPanel` to the `../src/notes-view.js` import, plus `import { closedNotePaths } from "../src/state.js";`):

```js
test("a group footnote renders as an open details with its branches inside", () => {
	const off = installDom();
	closedNotePaths.clear();
	loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const box = notesPanel();
	assert.strictEqual(box.tagName, "DETAILS");
	assert.strictEqual(box.className, "notes");
	assert.ok(box.open, "expanded by default");
	const g = box.querySelector("details.nt.ngroup");
	assert.ok(g.open, "the group is expanded too");
	assert.match(g.querySelector("summary").textContent, /· 2 branches$/);
	assert.strictEqual(g.querySelectorAll(".fnode").length, 2);
	assert.strictEqual(box.querySelectorAll(".nt").length, 1, "one numbered note");
	off();
});

test("closedNotePaths collapses the group it names, and nothing else", () => {
	const off = installDom();
	closedNotePaths.clear();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const keys = collectNoteKeys(noteTree(allNotes(), s.lines), new Set());
	const groupKey = [...keys].find((k) => k.startsWith("notes/e"));
	closedNotePaths.add(groupKey);
	const box = notesPanel();
	assert.ok(box.open, "the section is still open");
	assert.strictEqual(box.querySelector("details.nt.ngroup").open, false);
	closedNotePaths.clear();
	off();
});

test("toggling a group records the key without rebuilding the panel", () => {
	const off = installDom();
	closedNotePaths.clear();
	loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const box = notesPanel();
	const g = box.querySelector("details.nt.ngroup");
	g.open = false;
	assert.strictEqual(closedNotePaths.size, 1, "the close is recorded");
	assert.strictEqual(
		box.querySelector("details.nt.ngroup"),
		g,
		"the same element is still in place — no rebuild",
	);
	g.open = true;
	assert.strictEqual(closedNotePaths.size, 0, "reopening clears it");
	off();
});

test("a cluster heads its notes with the move reference, once", () => {
	const off = installDom();
	closedNotePaths.clear();
	const s = loadState("1. e4 e5 2. Nf3");
	s.lines.find((l) => l.isMain).comments = [
		{ ply: 0, text: "first" },
		{ ply: 0, text: "second" },
	];
	const box = notesPanel();
	const c = box.querySelector("details.ntcluster");
	assert.match(c.querySelector("summary").textContent, /^1\.e4 · 2 notes$/);
	assert.strictEqual(box.querySelectorAll(".nt").length, 2, "both entries");
	assert.strictEqual(
		box.textContent.match(/1\.e4/g).length,
		1,
		"the move reference is not repeated on every row",
	);
	off();
});

test("a footnote with both notes and branches counts them as items", () => {
	const off = installDom();
	closedNotePaths.clear();
	// the note sits on 1...c5, the group's SHARED stem, so the ROOT hosts it.
	// A note on a member's own move would be hosted by that member's node
	// instead, leaving the root with branches only.
	loadState(
		"1. e4 e5 (1... c5 {sharp} 2. Nf3) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const g = notesPanel().querySelector("details.nt.ngroup");
	assert.match(g.querySelector("summary").textContent, /· 3 items$/);
	off();
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/notes-view.test.mjs`
Expected: FAIL — `notesPanel is not a function` (it is not exported from `notes-view.js` yet).

- [x] **Step 3: Implement the renderer**

Add to `src/notes-view.js`. Extend the imports at the top:

```js
import { el, renderInline } from "./dom.js";
import { closedNotePaths, getCurrent } from "./state.js";
import { allNotes } from "./notes.js";
import {
	appendFootnote,
	appendFootNode,
	footStem,
	subNoteRow,
} from "./render.js";
import { moveRef } from "./export.js";
```

Then:

```js
// The numbered Notes list, folded. Everything starts expanded; closedNotePaths
// carries what the reader shut, so a re-render (a re-tagged line, an edited
// note) puts the panel back the way they left it.
export function notesPanel() {
	const tree = noteTree(allNotes(), getCurrent().lines);
	const box = el("details", { className: "notes" });
	box.open = !closedNotePaths.has(tree.key);
	bindToggle(box, tree.key);
	const head = el("summary", { className: "ng-head notes-head" });
	head.appendChild(el("h3", { textContent: "Notes" }));
	box.appendChild(head);
	// The section's own rows sit in a plain wrapper: .ngroup-body draws the
	// indent guide, and the top level is not indented.
	const body = el("div", { className: "notes-body" });
	tree.rows.forEach((r) => appendRow(body, r));
	box.appendChild(body);
	return box;
}

// A <details> records what the reader closed and stops there — unlike
// renderTrieNode()'s toggle in trie-view.js, which rebuilds because inline
// boards appear and disappear with expansion. A note's nested rows are already
// in the DOM and <details> hides them itself, so a rebuild would be work with
// nothing to show for it — and skipping it also sidesteps the toggle-loop guard
// that pattern needs, since jsdom fires `toggle` when a rebuilt element is
// handed open = true.
function bindToggle(det, key) {
	det.addEventListener("toggle", () => {
		if (det.open) closedNotePaths.delete(key);
		else closedNotePaths.add(key);
	});
}

// One row: a <details> when something is nested under it, otherwise exactly the
// flat DOM the panel rendered before any of this existed.
function appendRow(container, row) {
	if (!row.rows.length) return appendLeaf(container, row);
	const det = el("details", { className: rowClass(row) });
	det.open = !closedNotePaths.has(row.key);
	bindToggle(det, row.key);
	const head = el("summary", { className: "ng-head" });
	appendHead(head, row);
	head.appendChild(
		el("span", { className: "ngcount", textContent: " · " + countLabel(row) }),
	);
	det.appendChild(head);
	const body = el("div", { className: "ngroup-body" });
	row.rows.forEach((r) => appendRow(body, r));
	det.appendChild(body);
	container.appendChild(det);
}

function rowClass(row) {
	if (row.kind === "cluster") return "ntcluster ngroup";
	if (row.kind === "fnode") return "fnode d" + row.node.depth + " ngroup";
	return "nt ngroup"; // a footnote entry
}

// A collapsed row has to say what it is hiding, in the words of the thing it
// hides: a group's members are branches, a footnote's own notes are notes.
function countLabel(row) {
	const { branches, notes } = row;
	if (branches && notes) return plural(branches + notes, "item", "items");
	if (branches) return plural(branches, "branch", "branches");
	return plural(notes, "note", "notes");
}

function plural(n, one, many) {
	return n + " " + (n === 1 ? one : many);
}

function appendHead(head, row) {
	if (row.kind === "cluster") {
		head.appendChild(el("span", { textContent: row.ref }));
		return;
	}
	if (row.kind === "fnode") {
		head.appendChild(el("sup", { textContent: "[" + row.node.label + "]" }));
		footStem(head, row.node);
		return;
	}
	head.appendChild(el("sup", { textContent: "[" + row.entry.n + "]" }));
	footStem(head, row.entry.foot);
}

function appendLeaf(container, row) {
	if (row.kind === "subnote") {
		container.appendChild(subNoteRow(row.sub));
		return;
	}
	if (row.kind === "fnode") {
		appendFootNode(container, row.node);
		return;
	}
	const div = el("div", { className: "nt" });
	div.appendChild(el("sup", { textContent: "[" + row.entry.n + "]" }));
	if (row.kind === "foot") {
		// A footnote owns the whole row: its stem goes in a span of its own, and
		// its sub-notes and a group's branches are block rows beside that span.
		appendFootnote(div, row.entry.foot);
	} else {
		const span = document.createElement("span");
		// Inside a cluster the move reference is already in the header, so the
		// row states its text alone rather than repeating "7.Nbd2 — " down the
		// group.
		if (!row.inCluster)
			span.appendChild(
				document.createTextNode(moveRef(row.entry.ply, row.entry.owner) + " — "),
			);
		renderInline(span, row.entry.text);
		div.appendChild(span);
	}
	container.appendChild(div);
}
```

- [x] **Step 4: Delete `notesPanel` from `export.js` and repoint its callers**

In `src/export.js`, delete the whole `notesPanel()` function (`src/export.js:52-75`) together with its doc comment, and change the `./dom.js` import from `{ el, renderInline }` to `{ el }`: `renderInline` was used only by `notesPanel`, while `el` is still used throughout `exportBar`. `allNotes`, `getCurrent` and `getRenderHooks` all still have callers in the file — leave them.

In `src/app.js:37`, split the import:

```js
import { exportBar } from "./export.js";
import { notesPanel } from "./notes-view.js";
```

In `tests/export.test.mjs`, remove `notesPanel` from the `../src/export.js` import list and add:

```js
import { notesPanel } from "../src/notes-view.js";
```

- [x] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, including every unchanged assertion in `export.test.mjs`, `app.test.mjs`, `render.test.mjs` and `print.test.mjs`. If an `.nt`/`.fnode`/`.subnote` count fails, the class contract table above was not honoured — fix `rowClass`/`appendLeaf`, not the test.

- [x] **Step 6: Commit**

```bash
git add src/notes-view.js src/export.js src/app.js tests/notes-view.test.mjs tests/export.test.mjs
git commit -m "Render the notes panel as collapsible groups"
```

---

### Task 5: Expand all / Collapse all, and the in-place re-render

The two bulk chips, and the hook that rebuilds only the notes panel.

**Files:**
- Modify: `src/notes-view.js` (`notesPanel`), `src/state.js` (doc comment on `setRenderHooks`), `src/app.js:78` (`setRenderHooks`), `src/app.js:100-107` (beside `rerenderMarkup`), `src/app.js:329-331`
- Test: `tests/notes-view.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/notes-view.test.mjs` (add `setRenderHooks` to the `../src/state.js` import):

```js
test("Collapse all closes every group, Expand all reopens them", () => {
	const off = installDom();
	closedNotePaths.clear();
	let box = null;
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 {knight move}) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	// the panel rebuilds itself in place, exactly as app.js's hook does
	const rerenderNotes = () => {
		const fresh = notesPanel();
		box.open = fresh.open;
		box.replaceChildren(...fresh.children);
	};
	setRenderHooks({ renderApp() {}, rerenderTable() {}, rerenderMarkup() {}, rerenderNotes });
	box = notesPanel();
	const chip = (txt) =>
		[...box.querySelectorAll("summary .chip")].find(
			(b) => b.textContent === txt,
		);
	chip("Collapse all").click();
	const keys = collectNoteKeys(noteTree(allNotes(), s.lines), new Set());
	assert.strictEqual(closedNotePaths.size, keys.size, "every key recorded");
	assert.strictEqual(box.open, false, "the section closed too");
	assert.ok(
		[...box.querySelectorAll("details")].every((d) => !d.open),
		"nothing left open",
	);
	chip("Expand all").click();
	assert.strictEqual(closedNotePaths.size, 0);
	assert.ok(box.open, "the section reopened");
	off();
});

test("a bulk chip does not toggle the section it sits in", () => {
	const off = installDom();
	closedNotePaths.clear();
	loadState("1. e4 {solid} e5 2. Nf3");
	setRenderHooks({
		renderApp() {},
		rerenderTable() {},
		rerenderMarkup() {},
		rerenderNotes() {},
	});
	const box = notesPanel();
	const before = box.open;
	[...box.querySelectorAll("summary .chip")][0].click();
	assert.strictEqual(box.open, before, "the click was stopped at the chip");
	off();
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/notes-view.test.mjs`
Expected: FAIL — no `.chip` inside the summary, so `chip("Collapse all")` is undefined.

- [x] **Step 3: Add the chips**

In `src/notes-view.js`, import `getRenderHooks` from `./state.js`, and in `notesPanel()` append the chips to `head` after the `<h3>`:

```js
	head.append(
		bulkChip("Expand all", () => closedNotePaths.clear()),
		bulkChip("Collapse all", () => collectNoteKeys(tree, closedNotePaths)),
	);
```

and add:

```js
// A bulk control living in the section's <summary>, where a plain click would
// also toggle the section — the same reason groupFootChip() in trie-view.js
// stops its event.
function bulkChip(text, act) {
	const chip = el("button", { className: "chip mini", textContent: text });
	chip.onclick = (e) => {
		e.preventDefault();
		e.stopPropagation();
		act();
		getRenderHooks().rerenderNotes();
	};
	return chip;
}
```

- [x] **Step 4: Wire `rerenderNotes` in `app.js`**

Beside the existing `rerenderMarkup` (`src/app.js:100-107`) add:

```js
// In place, like rerenderMarkup: rebuilding the whole app would reset the
// preview panel's scroll position, and folding a note has no effect outside
// this panel. `open` is copied across because Collapse all closes the section
// itself, which lives on the element rather than in its children.
function rerenderNotes() {
  if (!notesBox) return;
  const nb = notesPanel();
  notesBox.open = nb.open;
  notesBox.replaceChildren(...nb.children);
}
```

Declare `let notesBox = null;` beside the existing `markupBox` declaration, assign it at `src/app.js:329` (`notesBox = notesPanel();` — it is already built into a local there), and add `rerenderNotes` to the `setRenderHooks({ ... })` call at `src/app.js:78`.

Update the `setRenderHooks` doc comment in `src/state.js` to list `rerenderNotes` alongside `rerenderTable`/`rerenderMarkup`.

Add `rerenderNotes() {}` to the default hooks in `tests/helpers.mjs`'s `loadState` so existing tests that render the panel keep a complete registry.

- [x] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/notes-view.js src/app.js src/state.js tests/notes-view.test.mjs tests/helpers.mjs
git commit -m "Add Expand all and Collapse all to the notes panel"
```

---

### Task 6: Styling — indent guides and summary affordance

**Files:**
- Modify: `style.css:515-556` (the `.notes` block)

- [x] **Step 1: Add the rules**

After the existing `.nt sup` rule in `style.css` (2-SPACE indent), add:

```css
/* A collapsible note group. The body draws the vertical guide that shows which
   rows belong to it, the same affordance .lgroup gives a trie branch in the
   editor. */
.ng-head {
  cursor: pointer;
  padding: 2px 0;
}
.ng-head:hover {
  color: var(--main);
}
/* The section's own summary holds an <h3>, which is a block — inline it so the
   heading and the bulk chips share the summary's line. Deliberately NOT
   `display: flex` on the <summary> itself: that drops the disclosure triangle
   in Chrome and Safari. */
.notes-head h3 {
  display: inline;
  margin: 0;
  margin-right: 8px;
}
.notes-head .chip {
  margin-right: 4px;
}
.ngcount {
  color: var(--muted);
  font-size: 0.9em;
}
.ngroup-body {
  border-left: 2px solid var(--line);
  padding-left: 8px;
  margin-left: 0.4em;
  margin-top: 4px;
}
/* The body wrapper supplies the indentation step, so a nested row must not
   step again. The bare .fnode/.subnote rules are untouched: print and the
   cards still render these rows flat and rely on that em margin. */
.ngroup-body > .fnode,
.ngroup-body > .subnote {
  margin-left: 0;
}
```

- [x] **Step 2: Verify in the browser**

Run: `python3 -m http.server 8000` and open `http://localhost:8000`. Load a PGN with a group footnote (e.g. `1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3`), tag both sidelines Footnote.

Expected: the Notes section shows a disclosure triangle beside its heading; the group note shows one below it with `· 2 branches`; the branches sit behind a vertical guide line; collapsing hides them; Collapse all shuts everything including the section; both light and dark themes read correctly (toggle in the toolbar).

- [x] **Step 3: Commit**

```bash
git add style.css
git commit -m "Style the collapsible note groups"
```

---

### Task 7: Documentation and closeout

**Files:**
- Modify: `README.md` (the Architecture table and the step-3 "Render" paragraph)

- [x] **Step 1: Document the module**

Add a row to the Architecture table in `README.md`, after the `src/render.js` row:

```markdown
| `src/notes-view.js` | the on-screen Notes list, grouped into collapsible `<details>` |
```

And in the step-3 "Render" paragraph, after the sentence about the Notes section being editable, add:

> On screen the Notes list folds: a group footnote, a footnote's own notes, and
> several notes on one move each collapse to a one-line header, with Expand all
> and Collapse all beside the heading. Everything starts expanded and the
> folding is not saved with the notebook.

- [x] **Step 2: Full verification**

Run each and confirm the output:

```bash
npm test          # every test passes
npm run lint      # no errors
npm run knip      # no unused files or exports
```

Expected: `knip` reports nothing for `src/notes-view.js`, `closedNotePaths`, `footStem`, `subNoteRow` or `appendFootNode`. If it flags one, that export has no caller — find out why before moving on.

- [x] **Step 3: Commit and merge**

```bash
git add README.md
git commit -m "Document the collapsible notes panel"
```

Then follow the project's merge convention (`superpowers:finishing-a-development-branch`): merge to `master` locally and push — this repo does not use PRs.

- [x] **Step 4: Close the task**

```bash
task 24 done
```
