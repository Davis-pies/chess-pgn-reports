# Group Footnotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A trie node whose lines are all tagged Footnote renders as one numbered note — a single `[n]` on the parent line, a shared stem, and a nested indented list of the group's branches with labels alternating number/letter by depth.

**Architecture:** Pure trie primitives move from the view module `src/trie-view.js` down into `src/tree.js`. A new pure module `src/foot-groups.js` turns lines into groups (`{ members, stem, tree }`). `src/notes.js` decorates each group into one note entry with a recursive `foot.children` tree, and `src/render.js` grows a recursive renderer that all four output surfaces (screen panel, print notes, print cards, Markdown) already funnel through.

**Tech Stack:** Vanilla ES modules, no framework. Tests are `node --test` with `node:assert` and jsdom (`tests/helpers.mjs`). Lint is eslint; `npm run knip` checks for unused exports.

**Spec:** `docs/superpowers/specs/2026-08-24-group-footnotes-design.md`

**Read first:** the spec above, and `docs/superpowers/specs/2026-08-22-footnote-as-note-design.md` for how a single footnote already becomes a note.

**Pitfall (project memory):** never import `src/app.js` with a `?t=` cache-buster in tests — it hides most of app.js's coverage. Use `bootApp()` from `tests/helpers.mjs`.

---

### Task 1: Move the trie primitives into `src/tree.js`

Pure refactor, no behaviour change. `notes.js` and `foot-groups.js` need `buildTrie`, but it currently lives in `src/trie-view.js`, which imports `render.js`, `state.js` and `print.js`.

**Files:**
- Modify: `src/tree.js` (append)
- Modify: `src/trie-view.js:17-42` (remove `buildTrie`), `:137-141` (`countLeaves`), `:150-156` (`leavesOf`), and its import block at `:1-10`
- Modify: `src/app.js:25` (import site)
- Test: `tests/tree.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/tree.test.mjs`:

```js
import { buildTrie, leavesOf, countLeaves } from "../src/tree.js";

test("buildTrie groups lines by their shared divergent tail", () => {
	const main = { isMain: true, moves: [{ ply: 0, san: "e4" }, { ply: 1, san: "e5" }] };
	const a = { moves: [{ ply: 0, san: "e4" }, { ply: 1, san: "c5" }, { ply: 2, san: "Nf3" }] };
	const b = { moves: [{ ply: 0, san: "e4" }, { ply: 1, san: "c5" }, { ply: 2, san: "Nc3" }] };
	const root = buildTrie([main, a, b], main);
	assert.strictEqual(root.children.size, 1, "both branch at 1...c5");
	const c5 = [...root.children.values()][0];
	assert.strictEqual(c5.key, "1:c5");
	assert.strictEqual(countLeaves(c5), 2);
	assert.deepStrictEqual(leavesOf(c5), [a, b]);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx node --test tests/tree.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../src/tree.js' does not provide an export named 'buildTrie'`

- [x] **Step 3: Move the three functions**

Cut these from `src/trie-view.js` and paste them into `src/tree.js` (append at the end), unchanged except for adding `export` where missing. `buildTrie` already calls `divergence`, which is defined in `tree.js`, so drop that from the copied code's needs:

```js
// Trie of the side lines' divergent tails, so lines that share pieces of their
// divergence from the mainline are grouped together (nested collapsible groups).
// Lives here rather than in trie-view.js so notes.js and foot-groups.js can use
// it without importing the view layer (trie-view.js pulls in render/state/print).
export function buildTrie(lines, main) {
	const root = { children: new Map(), leaf: null };
	for (const l of lines) {
		if (l.isMain) continue;
		const d = divergence(l, main);
		let node = root;
		for (const m of l.moves.slice(d)) {
			const k = m.ply + ":" + m.san;
			let child = node.children.get(k);
			if (!child) {
				child = {
					children: new Map(),
					leaf: null,
					move: m,
					// root-relative path key: stable across renders, used to
					// remember which <details> groups are open
					key: (node.key ? node.key + "/" : "") + k,
				};
				node.children.set(k, child);
			}
			node = child;
		}
		node.leaf = l;
	}
	return root;
}

// All descendant lines of a trie node, depth-first.
export function leavesOf(node) {
	const out = [];
	if (node.leaf) out.push(node.leaf);
	node.children.forEach((c) => out.push(...leavesOf(c)));
	return out;
}

export function countLeaves(node) {
	let n = node.leaf ? 1 : 0;
	node.children.forEach((c) => (n += countLeaves(c)));
	return n;
}
```

In `src/trie-view.js`, delete those three definitions and add them to the existing `./tree.js` import:

```js
import { divergence, buildTrie, leavesOf, countLeaves } from "./tree.js";
```

In `src/app.js:25`, `buildTrie` is imported from `./trie-view.js`. Since `trie-view.js` no longer defines it, change app.js to import `buildTrie` from `./tree.js` and leave its other `trie-view.js` imports alone.

- [x] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, including the existing `tests/app.test.mjs` grouped-view tests (they exercise the moved code through `renderTrieNode`).

- [x] **Step 5: Lint and knip**

Run: `npm run lint && npm run knip`
Expected: no errors. If knip reports `leavesOf` unused from `trie-view.js`, that is the stale re-export — make sure `trie-view.js` re-exports nothing it no longer owns.

- [x] **Step 6: Commit**

```bash
git add src/tree.js src/trie-view.js src/app.js tests/tree.test.mjs
git commit -m "Move the trie primitives into tree.js so notes can reach them"
```

---

### Task 2: `src/foot-groups.js` — turn foot-tagged lines into groups

**Files:**
- Create: `src/foot-groups.js`
- Test: `tests/foot-groups.test.mjs` (create)

The returned shape (spec §1):

```
footGroups(lines, main) -> { groups, grouped }
group = { members: [line], stem: [{ply, san}], tree }
tree node = { moves: [{ply, san}], line, children: [] }
```

`stem` is the moves every member shares. `tree` is the undecorated shape below the stem: no labels, no depths, no note maps — `notes.js` adds those. `grouped` is a Set of member lines.

A group needs at least two member lines; a lone foot line stays today's plain footnote. A line that ends exactly at the stem (its moves are a prefix of its siblings') becomes a first child with `moves: []`, so every member is reachable uniformly.

- [x] **Step 1: Write the failing tests**

Create `tests/foot-groups.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { loadState } from "./helpers.mjs";
import { footGroups } from "../src/foot-groups.js";

// helper: the state's non-main lines, in collectLines order
const others = (s) => s.lines.filter((l) => !l.isMain);
const sans = (moves) => moves.map((m) => m.san);

test("two foot lines sharing a divergent move form one group", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const main = s.lines[0];
	const { groups, grouped } = footGroups(s.lines, main);
	assert.strictEqual(groups.length, 1);
	const g = groups[0];
	assert.deepStrictEqual(sans(g.stem), ["c5"], "shared move is the stem");
	assert.strictEqual(g.members.length, 2);
	assert.deepStrictEqual(
		g.tree.map((t) => sans(t.moves)),
		[["Nf3"], ["Nc3"]],
	);
	assert.ok(g.tree.every((t) => t.line && t.children.length === 0));
	assert.strictEqual(grouped.size, 2);
	g.members.forEach((m) => assert.ok(grouped.has(m)));
});

test("a lone foot line is not a group", () => {
	const s = loadState("1. e4 e5 (1... c5) 2. Nf3", { tags: { 1: "foot" } });
	const { groups, grouped } = footGroups(s.lines, s.lines[0]);
	assert.deepStrictEqual(groups, []);
	assert.strictEqual(grouped.size, 0);
});

test("a node with an untagged sibling still groups its foot lines", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) (1... c5 2. d4) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot" } }, // line 3 (2. d4) stays a sideline
	);
	const { groups, grouped } = footGroups(s.lines, s.lines[0]);
	assert.strictEqual(groups.length, 1);
	assert.strictEqual(groups[0].members.length, 2, "only the foot lines");
	const sideline = others(s)[2];
	assert.ok(!grouped.has(sideline));
});

test("an inner fork becomes a nested child, not a flattened sibling", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "foot" } },
	);
	const { groups } = footGroups(s.lines, s.lines[0]);
	assert.strictEqual(groups.length, 1);
	const g = groups[0];
	assert.deepStrictEqual(sans(g.stem), ["c5"]);
	assert.deepStrictEqual(
		g.tree.map((t) => sans(t.moves)),
		[["Nf3"], ["Nc3"]],
	);
	const nf3 = g.tree[0];
	assert.strictEqual(nf3.line, null, "an inner fork has no line of its own");
	assert.deepStrictEqual(
		nf3.children.map((t) => sans(t.moves)),
		[["d6"], ["Nc6"]],
	);
});

test("the stem runs down a single-child chain to the first fork", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 d6 3. d4) (1... c5 2. Nf3 d6 3. Bb5+) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const { groups } = footGroups(s.lines, s.lines[0]);
	assert.deepStrictEqual(sans(groups[0].stem), ["c5", "Nf3", "d6"]);
	assert.deepStrictEqual(
		groups[0].tree.map((t) => sans(t.moves)),
		[["d4"], ["Bb5+"]],
	);
});

test("a member ending at the stem becomes a moveless child", () => {
	const s = loadState("1. e4 e5 (1... c5) (1... c5 2. Nf3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const { groups } = footGroups(s.lines, s.lines[0]);
	const g = groups[0];
	assert.deepStrictEqual(sans(g.stem), ["c5"]);
	assert.deepStrictEqual(g.tree[0].moves, [], "the short line has no tail");
	assert.ok(g.tree[0].line, "but it still carries its line");
	assert.deepStrictEqual(sans(g.tree[1].moves), ["Nf3"]);
});

test("foot lines diverging at different moves are separate groups", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) (1... e6 2. d4) (1... e6 2. Nf3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "foot", 4: "foot" } },
	);
	const { groups } = footGroups(s.lines, s.lines[0]);
	assert.strictEqual(groups.length, 2);
	assert.deepStrictEqual(
		groups.map((g) => sans(g.stem)),
		[["c5"], ["e6"]],
	);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx node --test tests/foot-groups.test.mjs`
Expected: FAIL — `Cannot find module '.../src/foot-groups.js'`

- [x] **Step 3: Write the implementation**

Create `src/foot-groups.js`:

```js
import { buildTrie, leavesOf, countLeaves } from "./tree.js";

// Marking a whole trie node as one footnote is derived from the hierarchy, not
// stored: a node is a group when every line under it is tagged "foot". Building
// the trie over the foot lines ALONE gives that for free — each top-level child
// of the resulting root is the maximal node whose lines are all footnotes, and
// an untagged sibling passing through the same move simply isn't in the trie.

const isFoot = (l) => !l.isMain && l.tag === "foot";

// The move run from `node` down its single-child chain to the first fork (or to
// the end of a line), plus the node it stops on.
function run(node) {
	const moves = [{ ply: node.move.ply, san: node.move.san }];
	let n = node;
	while (!n.leaf && n.children.size === 1) {
		n = [...n.children.values()][0];
		moves.push({ ply: n.move.ply, san: n.move.san });
	}
	return { moves, end: n };
}

// One branch below the stem: its own move run, the line that ends on it (leaf
// only), and its children. Undecorated — labels, depths and note maps are
// notes.js's job.
function subtree(node) {
	const { moves, end } = run(node);
	const t = { moves, line: end.leaf || null, children: [] };
	end.children.forEach((c) => t.children.push(subtree(c)));
	return t;
}

function group(node) {
	const { moves, end } = run(node);
	const tree = [];
	// A line whose moves are a prefix of its siblings' ends ON the stem. It has
	// no tail of its own, so it becomes a moveless first child rather than a
	// special case every renderer would have to know about.
	if (end.leaf) tree.push({ moves: [], line: end.leaf, children: [] });
	end.children.forEach((c) => tree.push(subtree(c)));
	return { members: leavesOf(node), stem: moves, tree };
}

// Groups of foot-tagged lines, plus the set of lines they account for. A lone
// foot line is never a group: it stays the single footnote it already is.
export function footGroups(lines, main) {
	const groups = [];
	const grouped = new Set();
	const foots = lines.filter(isFoot);
	if (!main || foots.length < 2) return { groups, grouped };
	const root = buildTrie(foots, main);
	root.children.forEach((child) => {
		if (countLeaves(child) < 2) return;
		const g = group(child);
		groups.push(g);
		g.members.forEach((l) => grouped.add(l));
	});
	return { groups, grouped };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx node --test tests/foot-groups.test.mjs`
Expected: PASS, 7 tests.

- [x] **Step 5: Commit**

```bash
git add src/foot-groups.js tests/foot-groups.test.mjs
git commit -m "Derive footnote groups from all-foot trie nodes"
```

---

### Task 3: `labelFor` — labels alternate by depth

**Files:**
- Modify: `src/notes.js:17-30` (replace `subLabel`)
- Test: `tests/notes.test.mjs`

Depth 0 is the global `[n]`. Odd depths are bijective base-26 letters (today's `subLabel`, which is what a lone footnote's sub-notes already use, so its output must not change). Even depths ≥ 2 are `1, 2, 3 …`.

- [x] **Step 1: Write the failing test**

Append to `tests/notes.test.mjs`:

```js
import { labelFor } from "../src/notes.js";

test("labelFor alternates letters and numbers by depth", () => {
	assert.deepStrictEqual(
		[0, 1, 2, 3].map((i) => labelFor(1, i)),
		["a", "b", "c", "d"],
	);
	assert.deepStrictEqual(
		[0, 1, 2].map((i) => labelFor(2, i)),
		["1", "2", "3"],
	);
	assert.strictEqual(labelFor(3, 0), "a", "letters again at depth 3");
	assert.strictEqual(labelFor(4, 1), "2", "numbers again at depth 4");
	assert.strictEqual(labelFor(1, 26), "aa", "bijective base-26 past z");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx node --test tests/notes.test.mjs`
Expected: FAIL — `does not provide an export named 'labelFor'`

- [x] **Step 3: Implement**

In `src/notes.js`, replace the `subLabel` function with:

```js
// Bijective base-26: a, b, ... z, aa, ab, ... so a 27th sibling doesn't run
// past 'z' into punctuation.
function letters(i) {
	let n = i + 1;
	let s = "";
	while (n > 0) {
		n--;
		s = String.fromCharCode(97 + (n % 26)) + s;
		n = Math.floor(n / 26);
	}
	return s;
}

// Labels alternate by nesting depth: depth 0 is the note's own global [n],
// odd depths are letters, even depths below that are numbers — [3] a) 1. a) 1.
// and so on for as deep as a group nests. Only depth 0 takes part in global
// numbering, so a label anywhere below it can never renumber a table marker.
export function labelFor(depth, i) {
	return depth % 2 === 1 ? letters(i) : String(i + 1);
}
```

Then replace the one existing call site — `subLabel(sub.length)` in the comments loop — with `labelFor(1, sub.length)`.

- [x] **Step 4: Run the tests**

Run: `npx node --test tests/notes.test.mjs`
Expected: PASS, including the pre-existing sub-note lettering tests (a lone footnote's sub-notes are depth 1, so their labels are unchanged).

- [x] **Step 5: Commit**

```bash
git add src/notes.js tests/notes.test.mjs
git commit -m "Label nested note levels by depth, alternating numbers and letters"
```

---

### Task 4: One note entry per group

**Files:**
- Modify: `src/notes.js` (`numberNotes`)
- Test: `tests/notes.test.mjs`

The entry shape (spec §2):

```
{ ply, owner, n, foot: {
    moves,          // the full move path through the stem
    d,              // divergence index against the parent line
    marks: {}, noteByPly: {}, depth: 0,
    children: [ node ]
} }

node = { label, depth, moves, d: 0, marks, noteByPly, name, eval, note,
         subNotes, line, children }
```

`d: 0` on a child because a child's `moves` is already only its tail — the renderer slices with `d`, and there is nothing to skip.

- [x] **Step 1: Write the failing tests**

Append to `tests/notes.test.mjs`:

```js
test("a group of foot lines becomes one entry with one marker", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const { entries, byLine } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 1, "one entry for the whole group");
	const e = entries[0];
	assert.strictEqual(e.owner, s.lines[0], "anchored on the mainline");
	assert.strictEqual(e.ply, 1, "on the move the group replaces (1...e5)");
	assert.deepStrictEqual(e.foot.moves.map((m) => m.san), ["e4", "c5"]);
	assert.strictEqual(e.foot.d, 1, "tail starts at the divergence");
	assert.deepStrictEqual(
		e.foot.children.map((c) => [c.label, c.depth, c.moves.map((m) => m.san)]),
		[
			["a", 1, ["Nf3"]],
			["b", 1, ["Nc3"]],
		],
	);
	// one marker on the parent, not one per member
	assert.deepStrictEqual(byLine.get(s.lines[0])[1], [1]);
});

test("a nested fork inside a group nests its labels", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "foot" } },
	);
	const [e] = numberNotes(s.lines).entries;
	const nf3 = e.foot.children[0];
	assert.deepStrictEqual([nf3.label, nf3.depth], ["a", 1]);
	assert.deepStrictEqual(
		nf3.children.map((c) => [c.label, c.depth, c.moves.map((m) => m.san)]),
		[
			["1", 2, ["d6"]],
			["2", 2, ["Nc6"]],
		],
	);
	assert.deepStrictEqual(e.foot.children[1].label, "b");
});

test("a group carries each member's name, eval and note", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const [m1, m2] = s.lines.filter((l) => !l.isMain);
	m1.name = "Open Sicilian";
	m1.meta = { eval: "±", note: "main try" };
	m2.meta = { eval: "=" };
	const [e] = numberNotes(s.lines).entries;
	assert.deepStrictEqual(
		e.foot.children.map((c) => [c.name, c.eval, c.note]),
		[
			["Open Sicilian", "±", "main try"],
			["", "=", ""],
		],
	);
});

test("a member's own note is a numbered sub-note, not a global one", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 {pressure}) (1... c5 2. Nc3) 2. Nf3 {develops}",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const { entries } = numberNotes(s.lines);
	assert.deepStrictEqual(
		entries.map((x) => x.text || "[group]"),
		["[group]", "develops"],
		"only the mainline comment joins the global list",
	);
	const member = entries.find((x) => x.foot).foot.children[0];
	assert.deepStrictEqual(
		member.subNotes.map((sn) => [sn.label, sn.text]),
		[["1", "pressure"]],
		"depth 2: numbers",
	);
	// and it is marked inside that member's moves
	assert.deepStrictEqual(member.noteByPly[2], ["1"]);
});

test("a note a group member shares with a sideline stays global", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) (1... e6) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "sideline" } },
	);
	const nonFoot = s.lines.filter((l) => !l.isMain)[2];
	const member = s.lines.filter((l) => !l.isMain)[0];
	nonFoot.comments = [{ ply: 1, text: "shared" }];
	member.comments = [{ ply: 1, text: "shared" }];
	const { entries } = numberNotes(s.lines);
	const global = entries.filter((x) => x.text === "shared");
	assert.strictEqual(global.length, 1, "still one global note");
	const grp = entries.find((x) => x.foot);
	assert.deepStrictEqual(grp.foot.children[0].subNotes, [], "not a sub-note");
});

test("a group anchors on the sideline it branches from", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 d6 (2... Nc6) (2... e6)) 2. Nf3",
		{ tags: { 2: "foot", 3: "foot" } },
	);
	const sideline = s.lines.find((l) => l.moves.some((m) => m.san === "d6"));
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	assert.strictEqual(e.owner, sideline, "parent is the line it diverges from");
	assert.strictEqual(e.ply, 3, "on 2...d6, the move the group replaces");
});

test("a deeply nested note never renumbers the global notes", () => {
	const pgn = "1. e4 {first} e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3 {last}";
	const before = numberNotes(loadState(pgn, { tags: { 1: "foot", 2: "foot" } }).lines);
	assert.deepStrictEqual(
		before.entries.map((e) => e.n),
		[1, 2, 3],
	);
	const s = loadState(pgn, { tags: { 1: "foot", 2: "foot" } });
	const member = s.lines.filter((l) => !l.isMain)[0];
	member.comments = [{ ply: 2, text: "deep" }];
	const after = numberNotes(s.lines);
	assert.deepStrictEqual(
		after.entries.map((e) => [e.n, e.text || "[group]"]),
		before.entries.map((e) => [e.n, e.text || "[group]"]),
		"the global sequence is untouched",
	);
});

test("a lone foot line alongside a group is still its own footnote", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) (1... e6) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "foot" } },
	);
	const { entries } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 2);
	assert.ok(entries.some((e) => e.foot && e.foot.children), "the group");
	assert.ok(
		entries.some((e) => e.foot && !e.foot.children),
		"the lone footnote keeps its existing shape",
	);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx node --test tests/notes.test.mjs`
Expected: FAIL — the group tests see two separate foot entries (one per line), not one.

- [x] **Step 3: Implement**

In `src/notes.js`, add the import:

```js
import { footGroups } from "./foot-groups.js";
```

Inside `numberNotes`, after `main` and `parentOf` are defined and **before** the `lines.forEach((l) => { ... })` pass, insert:

```js
	// Group footnotes. A whole all-foot trie node is ONE entry: its members are
	// nested children of that entry instead of separate notes, and the parent
	// line gets a single [n]. Built before the per-line pass so that pass can
	// route a member's comments into its node rather than into the global list.
	const { groups, grouped } = footGroups(lines, main);
	const nodeOfLine = new Map(); // member line -> its decorated node
	// The stem as a pseudo-line, so parentOf/divergence — which compare whole
	// move arrays from move 0 — can be run on the group as a unit.
	const stemLine = (g) => {
		const k = divergence(g.members[0], main) + g.stem.length;
		return { moves: g.members[0].moves.slice(0, k) };
	};
	const decorate = (nodes, depth) =>
		nodes.map((t, i) => {
			const node = {
				label: labelFor(depth, i),
				depth,
				moves: t.moves,
				d: 0, // `moves` is already only this node's tail
				marks: (t.line && t.line.marks) || {},
				noteByPly: {},
				name: (t.line && t.line.name) || "",
				eval: (t.line && t.line.meta && t.line.meta.eval) || "",
				note: (t.line && t.line.meta && t.line.meta.note) || "",
				subNotes: [],
				line: t.line,
				children: decorate(t.children, depth + 1),
			};
			if (t.line) nodeOfLine.set(t.line, node);
			return node;
		});
	groups.forEach((g) => {
		const pseudo = stemLine(g);
		const parent = parentOf(pseudo);
		const d = divergence(pseudo, parent);
		const ply = anchorPly(parent, d);
		const n = entries.length + 1;
		entries.push({
			ply,
			owner: parent,
			n,
			foot: {
				moves: pseudo.moves,
				d,
				marks: {},
				noteByPly: {},
				depth: 0,
				children: decorate(g.tree, 1),
			},
		});
		const parentMap = byLine.get(parent);
		(parentMap[ply] = parentMap[ply] || []).push(n);
	});
```

`parentOf` currently takes a line and skips `c === l`; a pseudo-line is never in `lines`, so that check simply never fires. No change needed there — but replace its "Group-footnote seam" comment with a line saying groups reach it through `stemLine`.

Then, in the per-line pass, a member line must not build its own entry and its comments must land on its node. Change the foot-entry condition from:

```js
		if (!l.isMain && l.tag === "foot" && main) {
```

to:

```js
		// A member of a group is already represented as a child of that group's
		// entry, so it does not get an entry of its own.
		if (!l.isMain && l.tag === "foot" && main && !grouped.has(l)) {
```

And in the comments loop, the sub-note branch has to work for both a lone footnote (sub-notes on `entry.foot`, depth 1) and a group member (sub-notes on its node, at the node's depth + 1). Replace:

```js
			if (isFoot(l) && !globalKeys.has(k)) {
				const sub = entry.foot.subNotes;
				let at = sub.find((x) => x.ply === c.ply && x.text === c.text);
				if (!at) {
					at = { label: labelFor(1, sub.length), ply: c.ply, text: c.text };
					sub.push(at);
				}
```

with:

```js
			if (isFoot(l) && !globalKeys.has(k)) {
				// A grouped member's notes hang off its node in the group tree, one
				// level below it; a lone footnote's hang off its own entry at depth 1.
				const host = nodeOfLine.get(l) || (entry && entry.foot);
				const depth = host === undefined ? 1 : (host.depth || 0) + 1;
				const sub = host.subNotes;
				let at = sub.find((x) => x.ply === c.ply && x.text === c.text);
				if (!at) {
					at = { label: labelFor(depth, sub.length), ply: c.ply, text: c.text };
					sub.push(at);
				}
```

A lone footnote's `entry.foot` has no `depth`, so `(host.depth || 0) + 1` gives 1 — its existing letters, unchanged.

The marker still goes into the line's own map (`map[c.ply]`), which is what a member's `noteByPly` aliases. Add that aliasing next to the existing `footEntries` line, at the end of the function before the reading-order block:

```js
	nodeOfLine.forEach((node, l) => (node.noteByPly = byLine.get(l)));
```

One caveat the renumber pass already handles: a member's markers are label strings, not numbers, so the `typeof m === "number"` guard leaves them alone.

- [x] **Step 4: Run tests to verify they pass**

Run: `npx node --test tests/notes.test.mjs`
Expected: PASS, including every pre-existing test in the file.

- [x] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. Some render/print/export tests may fail if they assert on foot entries for lines that now group — if so, they are asserting the old behaviour, and Task 5 updates them. Note which ones and carry on.

- [x] **Step 6: Commit**

```bash
git add src/notes.js tests/notes.test.mjs
git commit -m "Render an all-foot group as one note entry with nested members"
```

---

### Task 5: Recursive rendering in `src/render.js`

**Files:**
- Modify: `src/render.js:505-529` (`appendFootnote`), `:534-546` (`appendSubNotes`), `:549-551` (`subNoteLines`), `:555-571` (`footnoteText`), `:430-470` (card note rows)
- Test: `tests/render.test.mjs`

- [x] **Step 1: Write the failing tests**

Append to `tests/render.test.mjs` (match the file's existing import/DOM setup — it already installs jsdom and imports from `../src/render.js`; add `appendFootnote`, `footnoteText` and `subNoteLines` to that import if they are not there):

```js
test("appendFootnote renders a group's members as nested labelled rows", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	const box = document.createElement("div");
	appendFootnote(box, e.foot);
	// the stem is inline text, the members are nested .fnode rows
	assert.match(box.textContent, /1\.\.\.c5/, "stem rendered inline");
	const top = [...box.children].filter((c) => c.className.includes("fnode"));
	assert.strictEqual(top.length, 1, "one child: the 2.Nf3 fork");
	assert.strictEqual(top[0].querySelector("sup").textContent, "[a]");
	const inner = [...top[0].children].filter((c) =>
		c.className.includes("fnode"),
	);
	assert.deepStrictEqual(
		inner.map((r) => r.querySelector("sup").textContent),
		["[1]", "[2]"],
		"depth 2 is numbered",
	);
	assert.match(inner[0].textContent, /d6/);
	assert.match(inner[1].textContent, /Nc6/);
});

test("a group member shows its name, eval and note", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const m1 = s.lines.filter((l) => !l.isMain)[0];
	m1.name = "Open";
	m1.meta = { eval: "±", note: "critical" };
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	const box = document.createElement("div");
	appendFootnote(box, e.foot);
	const row = box.querySelector(".fnode");
	assert.match(row.textContent, /Open: /);
	assert.match(row.textContent, /±/);
	assert.match(row.textContent, /— critical/);
});

test("footnoteText and subNoteLines flatten a group for text exports", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {sharp}) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	assert.strictEqual(footnoteText(e.foot), "1...c5", "stem only");
	assert.deepStrictEqual(subNoteLines(e.foot), [
		"   a. 2.Nf3",
		"      1. sharp",
		"   b. 2.Nc3",
	]);
});

test("a lone footnote still renders exactly as before", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {sharp}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	const box = document.createElement("div");
	appendFootnote(box, e.foot);
	assert.strictEqual(box.querySelectorAll(".fnode").length, 0, "no group rows");
	assert.match(box.textContent, /1\.\.\.c5 2\.Nf3/);
	assert.deepStrictEqual(subNoteLines(e.foot), ["   a. sharp"]);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx node --test tests/render.test.mjs`
Expected: FAIL — no `.fnode` elements exist and `subNoteLines` returns `[]` for a group.

- [x] **Step 3: Implement**

In `src/render.js`, extract the move-emitting loop out of `appendFootnote` so both the stem and every nested node use it, then add the recursion:

```js
// One node's move run, with its per-move symbol marks and note markers. Shared
// by a footnote's stem and by every nested group member below it.
function appendFootMoves(container, foot) {
	const t = (s) => container.appendChild(document.createTextNode(s));
	const tail = foot.moves.slice(foot.d);
	tail.forEach((m, i) => {
		if (i) t(" ");
		t(moveNum(m.ply, i === 0) + m.san);
		if (foot.marks && foot.marks[m.ply])
			container.appendChild(markEl(foot.marks[m.ply]));
		const refs = (foot.noteByPly && foot.noteByPly[m.ply]) || [];
		if (refs.length) {
			const sup = document.createElement("sup");
			sup.textContent = refs.join(",");
			container.appendChild(sup);
		}
	});
	return tail;
}

export function appendFootnote(container, foot) {
	const t = (s) => container.appendChild(document.createTextNode(s));
	if (foot.name) t(foot.name + ": ");
	const tail = appendFootMoves(container, foot);
	if (foot.eval) t((tail.length ? " " : "") + foot.eval);
	if (foot.note) {
		// The dash separates moves from commentary. A footnote that shares
		// everything it has with its parent has no moves to separate, so the
		// commentary follows the name directly instead of a dangling dash.
		if (tail.length || foot.eval) t(" — ");
		renderInline(container, foot.note);
	}
	// A group's members hang below it as nested labelled rows, one level of
	// indentation per depth (the nesting does the indenting; see .fnode in
	// style.css). A lone footnote has no children and stops here.
	(foot.children || []).forEach((c) => appendFootNode(container, c));
}

// One member (or inner fork) of a group footnote: its label, its moves, its own
// commentary, then its own notes and its own children, recursively.
function appendFootNode(container, node) {
	const row = el("div", { className: "fnode" });
	row.appendChild(el("sup", { textContent: "[" + node.label + "]" }));
	const span = document.createElement("span");
	const t = (s) => span.appendChild(document.createTextNode(s));
	if (node.name) t(node.name + ": ");
	const tail = appendFootMoves(span, node);
	if (node.eval) t((tail.length ? " " : "") + node.eval);
	if (node.note) {
		if (tail.length || node.eval) t(" — ");
		renderInline(span, node.note);
	}
	row.appendChild(span);
	appendSubNotes(row, node);
	(node.children || []).forEach((c) => appendFootNode(row, c));
	container.appendChild(row);
}
```

`appendSubNotes` needs no change — it already reads `.subNotes` off whatever it is handed, and a node has the same field.

Replace `subNoteLines` with a recursive version that covers both shapes:

```js
// A footnote's nested content as plain indented lines, for exports with no DOM:
// its own notes, and — for a group — each member with its moves, commentary and
// notes beneath it. Three spaces per level, matching the on-screen indent.
export function subNoteLines(foot, depth = 1) {
	const pad = "   ".repeat(depth);
	const out = [];
	(foot.subNotes || []).forEach((s) => out.push(pad + s.label + ". " + s.text));
	(foot.children || []).forEach((c) => {
		out.push(pad + c.label + ". " + footnoteText(c));
		out.push(...subNoteLines(c, depth + 1));
	});
	return out;
}
```

`footnoteText` is unchanged: it already renders one node's name, moves, eval and commentary, and a group's stem node is exactly that shape.

Finally the card rows (`src/render.js:430-470`). They currently read `note.foot.subNotes` directly; switch them to the same recursive lines so a group's members show on a card:

```js
					text: note.foot ? footnoteText(note.foot) : strip(note.text),
					subNotes: note.foot ? subNoteLines(note.foot) : [],
```

and in the row loop, replace the `o.subNotes.forEach` block with:

```js
				// A footnote's nested content gets its own indented rows beneath it,
				// the same shape it has on screen and in the print block. A card row
				// is plain text, so the label is already inline in the line.
				o.subNotes.forEach((line) => {
					const s = document.createElement("div");
					s.className = "nt subnote";
					s.textContent = strip(line.trim());
					notesBox.appendChild(s);
				});
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx node --test tests/render.test.mjs`
Expected: PASS.

- [x] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. The screen panel (`export.js`), the print block (`print.js`) and Markdown all call `appendFootnote`/`footnoteText`/`subNoteLines`, so they inherit the group rendering with no edit.

- [x] **Step 6: Commit**

```bash
git add src/render.js tests/render.test.mjs
git commit -m "Render a group footnote's members as nested labelled rows"
```

---

### Task 6: Styling and the remaining surfaces

**Files:**
- Modify: `style.css:492-499` (near `.subnote`), `:640-644` (card override), and the print block
- Test: `tests/print.test.mjs`, `tests/export.test.mjs`

- [x] **Step 1: Write the failing tests**

Append to `tests/print.test.mjs`:

```js
test("the print notes block renders a group's nested members", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const box = document.createElement("div");
	appendPrintTables(box, grid(s.lines));
	const rows = box.querySelectorAll(".print-notes .fnode");
	assert.strictEqual(rows.length, 2, "both members appear under one note");
	assert.strictEqual(box.querySelectorAll(".print-notes .nt sup").length, 1,
		"one [n] marker for the whole group");
});
```

`appendPrintTables` and `grid` are already imported at the top of `tests/print.test.mjs` (`:4`), and the file's other tests use exactly this `appendPrintTables(box, grid(s.lines))` shape.

Append to `tests/export.test.mjs`:

```js
test("Markdown lists a group's members under one numbered note", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const md = buildMarkdown();
	const notes = md.slice(md.indexOf("## Notes"));
	assert.match(notes, /^1\. 1\.\.\.c5$/m);
	assert.match(notes, /^ {3}a\. 2\.Nf3$/m);
	assert.match(notes, /^ {3}b\. 2\.Nc3$/m);
	assert.strictEqual(notes.match(/^\d+\. /gm).length, 1, "one numbered note");
});

test("the screen notes panel renders a group's members", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const box = notesPanel(); // already imported at tests/export.test.mjs:7
	assert.strictEqual(box.querySelectorAll(".fnode").length, 2);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx node --test tests/print.test.mjs tests/export.test.mjs`
Expected: the Markdown and panel assertions FAIL only if Task 5 was skipped; they should now PASS, since both surfaces call the shared renderers. If they pass immediately, that is the expected outcome — keep the tests as regression cover and move to the CSS step.

- [x] **Step 3: Add the styles**

In `style.css`, next to `.subnote`:

```css
/* A group footnote's members. The rows nest, so one rule indents every depth:
   a member sits inside its parent's row and inherits its offset. */
.fnode {
  margin-left: 1.6em;
  font-size: 0.95em;
}
.fnode sup {
  margin-right: 0.3em;
}
```

And beside the existing `.card-notes .subnote` override, which exists because `.card-notes .nt`'s margin shorthand resets `margin-left` at equal specificity:

```css
.card-notes .fnode {
  margin-left: 1.6em;
}
```

Check the print stylesheet section for a `.print-notes .subnote` rule; if one exists, add the matching `.print-notes .fnode` beside it.

- [x] **Step 4: Verify in the browser**

Run: `python3 -m http.server 8000` and open `http://localhost:8000`. Paste
`1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3) 2. Nf3`,
tag all three variations Footnote, and confirm: one `[1]` on the mainline's `1...e5` cell, one note reading `1...c5` with `[a] 2.Nf3` containing `[1] d6` and `[2] Nc6`, then `[b] 2.Nc3`. Check both themes and Print preview.

- [x] **Step 5: Run the full suite**

Run: `npm test && npm run lint`
Expected: PASS, no lint errors.

- [x] **Step 6: Commit**

```bash
git add style.css tests/print.test.mjs tests/export.test.mjs
git commit -m "Indent nested group-footnote rows on screen, in print and on cards"
```

---

### Task 7: The group Footnote chip in the editor

**Files:**
- Modify: `src/trie-view.js` (`renderTrieNode`)
- Test: `tests/app.test.mjs`

A chip on a group's `<summary>`, on nodes with at least two leaves. State from the leaves: all foot → `on`; some → `partial` (dimmed); none → neither. Clicking clears all if all are foot, otherwise sets all.

- [x] **Step 1: Write the failing test**

Append to `tests/app.test.mjs`, following the file's existing `app.reset()` / `tick()` pattern:

```js
test("the group Footnote chip tags every line under the group", async () => {
	app.reset();
	const view = doc("view");
	view.querySelector("textarea.pgnin").value =
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3";
	[...view.querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	const group = doc("view").querySelector(".markup details.lgroup");
	const chip = group.querySelector("summary .chip.groupfoot");
	assert.ok(chip, "group summary carries a Footnote chip");
	assert.ok(!chip.className.includes("on"), "off to start");

	chip.click();
	await tick();
	const after = doc("view").querySelector(".markup details.lgroup");
	assert.ok(
		after.querySelector("summary .chip.groupfoot").className.includes("on"),
		"chip reads on once every line is tagged",
	);
	// one note, one marker: the group is now a single footnote
	assert.strictEqual(
		doc("view").querySelectorAll(".notes .nt").length,
		1,
		"the group renders as one note",
	);

	after.querySelector("summary .chip.groupfoot").click();
	await tick();
	assert.ok(
		!doc("view")
			.querySelector(".markup details.lgroup summary .chip.groupfoot")
			.className.includes("on"),
		"clicking again clears the whole group",
	);
});

test("the group chip reads partial when only some lines are footnotes", async () => {
	app.reset();
	const view = doc("view");
	view.querySelector("textarea.pgnin").value =
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3";
	[...view.querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();
	// tag exactly one member through the app's own state, then re-render
	const lines = getCurrent().lines.filter((l) => !l.isMain);
	lines[0].tag = "foot";
	getRenderHooks().renderApp();
	await tick();
	const chip = doc("view").querySelector(
		".markup details.lgroup summary .chip.groupfoot",
	);
	assert.ok(chip.className.includes("partial"), "dimmed, not on");
	assert.ok(!chip.className.includes("on"));
});
```

Add `import { getCurrent, getRenderHooks } from "../src/state.js";` at the top of the file if it is not already imported.

- [x] **Step 2: Run tests to verify they fail**

Run: `npx node --test tests/app.test.mjs`
Expected: FAIL — `chip` is null.

- [x] **Step 3: Implement**

In `src/trie-view.js`, inside `renderTrieNode`, after `count` is computed and before the `summary` is appended, build the chip and put it in the summary:

```js
	const count = countLeaves(node);
	const summary = el("summary", {
		className: "lg-head",
		textContent: `${nextPath} · ${count} line${count === 1 ? "" : "s"}`,
	});
	// Marking a group as a footnote is marking all its lines: the group IS one
	// footnote precisely when every line under it is tagged (see foot-groups.js).
	// A group of one is just a line, and its own editor already has the chip.
	if (count > 1) summary.appendChild(groupFootChip(node));
	det.appendChild(summary);
```

And add the chip builder next to `collapsedVar`:

```js
// The group-level Footnote chip. Its state is read back off the lines rather
// than stored: all tagged reads "on", some reads "partial" (dimmed), none reads
// off. Clicking sets every line unless they are all already set, in which case
// it clears them — so one click always changes something.
function groupFootChip(node) {
	const leaves = leavesOf(node);
	const all = leaves.every((l) => l.tag === "foot");
	const some = !all && leaves.some((l) => l.tag === "foot");
	const chip = el("button", {
		className:
			"chip tag foot groupfoot" + (all ? " on" : some ? " partial" : ""),
		textContent: "Footnote",
	});
	chip.onclick = (e) => {
		// the chip lives in the <summary>, where a click would otherwise toggle
		// the <details> open/closed as well
		e.preventDefault();
		e.stopPropagation();
		leaves.forEach((l) => (l.tag = all ? null : "foot"));
		getRenderHooks().renderApp();
	};
	return chip;
}
```

In `style.css`, beside the other `.chip.tag` rules:

```css
.chip.groupfoot {
  margin-left: 0.6em;
}
.chip.partial {
  opacity: 0.55;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx node --test tests/app.test.mjs`
Expected: PASS.

- [x] **Step 5: Run the full suite**

Run: `npm test && npm run lint && npm run knip`
Expected: PASS, no lint errors, no unused exports.

- [x] **Step 6: Commit**

```bash
git add src/trie-view.js style.css tests/app.test.mjs
git commit -m "Tag a whole group as one footnote from its group header"
```

---

### Task 8: Documentation and final verification

**Files:**
- Modify: `README.md` (the "Tag" and "Render" bullets under **What it does**)

- [x] **Step 1: Update the README**

In the **Tag** bullet, after the sentence describing a Footnote line, add:

```
   Tagging every line under a group (the ▸ headers in the editor) with the
   group's own **Footnote** chip turns the whole group into a *single*
   footnote: one `[n]` on the parent line at the move the group replaces, and
   the group's branches listed inside the note.
```

In the **Render** bullet, after the sentence about lettered sub-notes, add:

```
   A group footnote lists its branches nested inside the note, labels
   alternating by depth — `[n]`, then letters, then numbers, and so on.
```

- [x] **Step 2: Verify the whole thing**

Run: `npm test && npm run lint && npm run knip && npm run coverage`
Expected: all tests pass, no lint errors, no unused exports. Confirm `src/foot-groups.js` shows in the coverage table with high line coverage.

- [x] **Step 3: Manual check of the mixed case**

Serve the app (`python3 -m http.server 8000`) and load:

```
1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3) (1... e6) 2. Nf3
```

Tag the three `1...c5` lines Footnote via the group chip and tag `1...e6` Footnote on its own line. Expect two notes: one group note with nested members, one plain footnote — confirming a lone foot line beside a group is untouched.

- [x] **Step 4: Commit**

```bash
git add README.md
git commit -m "Document group footnotes"
```

- [x] **Step 5: Close the task**

```bash
task 21 done
```
