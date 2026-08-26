# Table Line Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a line's column in the table preview highlights every cell that makes up that line — across the Mainline column, its enclosing open group columns, and its own tail — and fades everything else.

**Architecture:** A leaf column learns its `trail` (the group columns enclosing it) during the existing `pushNode` trie walk. A new pure module `src/trace.js` turns a stored SAN-path key plus the var list into `Map(var -> Set(ply))` of lit cells, using the rule "in the line's chain AND spells that line's move at that ply". `renderTable` takes that map as an optional 4th argument and stamps `traced`/`faded` classes; only `renderTrieTable` supplies it, so the printed report is untouched.

**Tech Stack:** Vanilla ES modules, no framework. `node --test` + jsdom. `npm test`, `npm run lint`, `npm run knip`.

**Read first:** `docs/superpowers/specs/2026-08-26-table-line-trace-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/trace.js` | **Create.** Pure path resolution: `tracedKey(v)`, `tracePath(vars, key)`. No DOM. |
| `src/state.js` | **Modify.** Session-only `getTraced()` / `setTraced()`, next to `openTablePaths`. |
| `src/trie-view.js` | **Modify.** `pushNode` threads `trail`; `renderTrieTable` resolves the trace, wires the toggle, adds the Clear trace chip. |
| `src/render.js` | **Modify.** `renderTable` gains the optional `trace` argument and stamps classes / wires trace targets. |
| `style.css` | **Modify.** `--trace` in both themes; `.traced` / `.faded` rules. |
| `tests/trace.test.mjs` | **Create.** Path resolution, DOM-free where possible. |
| `tests/trie-view.test.mjs` | **Modify.** Classes, toggle, group columns still fold. |
| `tests/print.test.mjs` | **Modify.** Print emits no trace classes. |

---

### Task 1: `src/trace.js` — the SAN-path key

**Files:**
- Create: `src/trace.js`
- Test: `tests/trace.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/trace.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert";
import { tracedKey } from "../src/trace.js";

test("tracedKey is the var's SAN path", () => {
	const v = { moves: [{ san: "e4" }, { san: "c5" }, { san: "Nf3" }] };
	assert.strictEqual(tracedKey(v), "e4 c5 Nf3");
});

test("tracedKey is null for a var with no moves of its own", () => {
	// a group column stands in for its lines and has no `moves` array
	assert.strictEqual(tracedKey({ cells: {} }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/trace.test.mjs`
Expected: FAIL — `Cannot find module '.../src/trace.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/trace.js`:

```js
// Tracing a line through the grouped table preview.
//
// After elide() (see the recursive-table-collapse design) a line's own column
// carries only its tail: the moves before it live in the Mainline column and in
// each enclosing open group's column. Reading one line therefore means
// stitching three places together by eye. This module works out which cells
// make up a given line so the view can light exactly those.
//
// Pure and DOM-free on purpose — the path rule is the part worth testing on its
// own, and render.js only stamps classes from what comes out of here.

// A line's identity across renders. grid() rebuilds every var on every render,
// so a stored var reference would be stale before the next click; the SAN path
// survives. Group columns stand in for several lines and have no `moves` of
// their own, so they have no key and can never be traced.
export function tracedKey(v) {
	return v && v.moves ? v.moves.map((m) => m.san).join(" ") : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/trace.test.mjs`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/trace.js tests/trace.test.mjs
git commit -m "Add trace.js with the line-identity key"
```

---

### Task 2: `pushNode` threads the enclosing group columns

**Files:**
- Modify: `src/trie-view.js:77-104` (`pushNode`)
- Test: `tests/trie-view.test.mjs`

`pushNode` currently takes `(node, vars, depth = 0, cut = -1)`. Leaf vars need to know which group columns enclose them, because the Mainline column and the group columns above a line are where its earlier moves are actually spelled out.

- [ ] **Step 1: Write the failing test**

Append to `tests/trie-view.test.mjs`. It needs the vars, not the DOM, so it calls `grid()` + `buildTrie()` the way `renderTrieTable` does. Add these imports at the top of the file if not already present:

```js
import { buildTrie } from "../src/tree.js";
import { pushVars } from "../src/trie-view.js";
```

Then the test:

```js
test("a line column knows the group columns enclosing it", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	const g = grid(s.lines);
	const vars = pushVars(g);
	const groupCol = vars.find((v) => v.tag === "collapse");
	const lines = vars.filter((v) => v.moves && v !== vars[0]);
	assert.ok(groupCol, "the group column is on screen");
	assert.strictEqual(lines.length, 2, "both lines are on screen");
	lines.forEach((v) =>
		assert.deepStrictEqual(v.trail, [groupCol], "enclosed by the group"),
	);
	off();
});

test("a line outside any open group has an empty trail", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear(); // group shut: no line columns under it at all
	const vars = pushVars(grid(s.lines));
	vars
		.filter((v) => v.moves && v !== vars[0])
		.forEach((v) => assert.deepStrictEqual(v.trail, []));
	off();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/trie-view.test.mjs`
Expected: FAIL — `pushVars` is not exported (`SyntaxError: The requested module '../src/trie-view.js' does not provide an export named 'pushVars'`)

- [ ] **Step 3: Write minimal implementation**

In `src/trie-view.js`, replace the whole `pushNode` function (currently at line 77) with this, and add the `pushVars` export directly above it:

```js
// The var list the screen preview renders: the mainline column, then each
// top-level branch by pushNode's rule. Exported so the trace rules can be
// tested against the same columns the view builds, without a DOM.
export function pushVars(g) {
	const mainV = g.vars[0];
	const trie = buildTrie(g.vars.slice(1), mainV);
	const vars = [mainV];
	trie.children.forEach((c) => pushNode(c, vars));
	return vars;
}

function pushNode(node, vars, depth = 0, cut = -1, trail = []) {
	// one line under it: just that line's column, with nothing to fold
	if (countLeaves(node) === 1) {
		leavesOf(node).forEach((l) =>
			vars.push(tag(elide(l, cut), depth, trail)),
		);
		return;
	}
	const open = openTablePaths.has(node.key);
	const v = branchVar(node, open);
	// A shut branch belongs to whatever block encloses it; an open one opens a
	// block of its own and shares that block with its children.
	const d = open ? depth + 1 : depth;
	if (d) v.gdepth = d;
	if (open) v.gstart = true;
	vars.push(v);
	if (!open) return;
	// Down to the first real fork before recursing: sharedMoves already put the
	// single-child chain in the column above, so opening one level per shared
	// move would reveal nothing new. It also means an open group never has a
	// single child — the fork has at least two things under it.
	const fork = forkOf(node);
	// ...and the group column is now carrying those shared moves on screen, so
	// everything under it starts where the group left off.
	const inner = fork.move.ply;
	// An open group's column is where its shared moves are spelled out, so it
	// joins the trail of everything beneath it: a line traced from here has to
	// light cells in this column, not just in its own.
	const below = [...trail, v];
	// a line ending exactly at the fork is a column beside its continuations
	if (fork.leaf) vars.push(tag(elide(fork.leaf, inner), d, below));
	fork.children.forEach((c) => pushNode(c, vars, d, inner, below));
}
```

Then replace `tag` (immediately below `pushNode`) with:

```js
function tag(v, depth, trail) {
	return { ...v, ...(depth ? { gdepth: depth } : {}), trail };
}
```

Finally, in `renderTrieTable` (around line 53-56), replace the var-list construction:

```js
	// build the single table's var list: mainline + each branch, one level of
	// the trie at a time (see pushNode)
	const vars = [mainV];
	trie.children.forEach((c) => pushNode(c, vars));
```

with a call to the extracted helper:

```js
	// build the single table's var list: mainline + each branch, one level of
	// the trie at a time (see pushNode)
	const vars = pushVars(g);
```

Note `renderTrieTable` still needs `trie` for its Expand all button, so leave the `buildTrie` call above it in place.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, no failures. The two new tests pass and the existing trie-view/app/print tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/trie-view.js tests/trie-view.test.mjs
git commit -m "Give a line column the group columns enclosing it"
```

---

### Task 3: `tracePath` — which cells make up a line

**Files:**
- Modify: `src/trace.js`
- Test: `tests/trace.test.mjs`

The rule from the spec: a cell is lit if it belongs to a column in the line's chain (`[mainV, ...v.trail, v]`) **and** it spells that line's move at that ply.

- [ ] **Step 1: Write the failing tests**

Add to `tests/trace.test.mjs`. Add these imports at the top of the file:

```js
import { installDom, loadState } from "./helpers.mjs";
import { grid } from "../src/table.js";
import { pushVars } from "../src/trie-view.js";
import { openTablePaths } from "../src/state.js";
import { tracePath } from "../src/trace.js";
```

```js
// Two sidelines sharing 1...c5 2. Nf3 d6 and forking on move 3, so an open
// group column carries c5, Nf3 and d6 while each line column carries its tail.
const GROUP = "1. e4 e5 (1... c5 2. Nf3 d6 3. d4 (3. Bb5+)) 2. Nf3";
const GROUP_KEY = "1:c5";

function cols(pgn, open = []) {
	const s = loadState(pgn);
	openTablePaths.clear();
	open.forEach((k) => openTablePaths.add(k));
	return pushVars(grid(s.lines));
}
const named = (vars, san) =>
	vars.find((v) => v.moves && v.moves.some((m) => m.san === san));

test("a traced line lights the mainline prefix, its group column and its tail", () => {
	const off = installDom();
	const vars = cols(GROUP, [GROUP_KEY]);
	const [mainV] = vars;
	const groupCol = vars.find((v) => v.tag === "collapse");
	const line = named(vars, "d4");
	const lit = tracePath(vars, tracedKey(line));
	assert.deepStrictEqual([...lit.get(mainV)], [0], "only the shared 1. e4");
	assert.deepStrictEqual([...lit.get(groupCol)].sort(), [1, 2, 3]);
	assert.deepStrictEqual([...lit.get(line)], [4], "its own tail");
	off();
});

test("the mainline column goes dark the moment the line diverges", () => {
	const off = installDom();
	const vars = cols(GROUP, [GROUP_KEY]);
	const lit = tracePath(vars, tracedKey(named(vars, "d4")));
	// the mainline plays e5 at ply 1 and the traced line plays c5 — no match,
	// so no divergence index has to be stored or consulted
	assert.ok(!lit.get(vars[0]).has(1));
	off();
});

test("a sibling line is not lit", () => {
	const off = installDom();
	const vars = cols(GROUP, [GROUP_KEY]);
	const sibling = named(vars, "Bb5+");
	const lit = tracePath(vars, tracedKey(named(vars, "d4")));
	assert.ok(!lit.has(sibling), "the sibling column contributes nothing");
	off();
});

test("an unresolvable key traces nothing", () => {
	const off = installDom();
	const vars = cols(GROUP, [GROUP_KEY]);
	assert.strictEqual(tracePath(vars, "e4 h6 Nf3"), null, "no such line");
	assert.strictEqual(tracePath(vars, null), null, "nothing traced");
	off();
});

test("tracing the mainline lights only the mainline column", () => {
	const off = installDom();
	const vars = cols(GROUP, [GROUP_KEY]);
	const lit = tracePath(vars, tracedKey(vars[0]));
	assert.deepStrictEqual([...lit.keys()], [vars[0]]);
	assert.deepStrictEqual([...lit.get(vars[0])].sort((a, b) => a - b), [0, 1, 2]);
	off();
});
```

Also add `tracedKey` to the existing import of `../src/trace.js` at the top so it reads:

```js
import { tracedKey, tracePath } from "../src/trace.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/trace.test.mjs`
Expected: FAIL — `tracePath` is not exported

- [ ] **Step 3: Write the implementation**

Append to `src/trace.js`:

```js
// Which cells make up the line `key` names: Map(var -> Set(ply)).
//
// A cell is lit when it belongs to a column in the line's CHAIN and it spells
// that line's move at that ply. Both halves are load-bearing:
//
//   - The chain — the mainline column, the open group columns enclosing the
//     line, then the line itself — keeps an unrelated branch that happens to
//     play the same move at the same ply from lighting up.
//   - The move check is what lights the mainline column for the shared prefix
//     and darkens it the moment the line diverges. No divergence index is
//     stored or consulted; the moves either match or they do not.
//
// A line ending exactly at its group's fork keeps its last move (elide's rule),
// so that move is spelled on both the group column and the line's own. Both
// light: they are the same move, and lighting one of them would read as a bug.
//
// Returns null when the key names no column on screen — the group folded over
// it, or the line was hidden. Nothing to dim, and no stale state to clear,
// which is why the fold, hide and focus handlers need no hook into this.
export function tracePath(vars, key) {
	if (!key) return null;
	const line = vars.find((v) => tracedKey(v) === key);
	if (!line) return null;
	const san = new Map(line.moves.map((m) => [m.ply, m.san]));
	const lit = new Map();
	for (const v of [vars[0], ...(line.trail || []), line]) {
		const plies = new Set();
		for (const [k, c] of Object.entries(v.cells || {})) {
			const ply = Number(k);
			if (c.cls !== "ellip" && c.text === san.get(ply)) plies.add(ply);
		}
		if (plies.size) lit.set(v, plies);
	}
	return lit;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/trace.test.mjs`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/trace.js tests/trace.test.mjs
git commit -m "Work out which cells make up a traced line"
```

---

### Task 4: Session state for the traced line

**Files:**
- Modify: `src/state.js`
- Modify: `src/app.js` (the two reset sites that clear `openTablePaths`)

- [ ] **Step 1: Find the reset sites**

Run: `grep -n "openTablePaths" src/app.js`
Expected: two lines calling `openTablePaths.clear()`.

- [ ] **Step 2: Add the state accessors**

In `src/state.js`, directly below the `openTablePaths` block, add:

```js
// The line the table preview is tracing — its SAN path (see trace.js), or null.
// Session-only, like openTablePaths: a highlight is something you did a moment
// ago, not a property of the notebook, so store.js does not save it.
let traced = null;
export function getTraced() {
	return traced;
}
export function setTraced(v) {
	traced = v;
	return traced;
}
```

- [ ] **Step 3: Clear it where the notebook resets**

In `src/app.js`, at BOTH sites found in Step 1, add `setTraced(null);` immediately after the `openTablePaths.clear();` line. Add `setTraced` to the existing import from `./state.js` at the top of `app.js`.

- [ ] **Step 4: Verify nothing broke**

Run: `npm test && npm run lint`
Expected: all tests pass, no lint output.

- [ ] **Step 5: Commit**

```bash
git add src/state.js src/app.js
git commit -m "Hold the traced line in session state"
```

---

### Task 5: `renderTable` stamps the trace classes

**Files:**
- Modify: `src/render.js:186-300` (`renderTable`)
- Test: `tests/trie-view.test.mjs`

`renderTable` gains an optional 4th argument. It is supplied only by `renderTrieTable`, so the print path is untouched.

- [ ] **Step 1: Write the failing test**

Append to `tests/trie-view.test.mjs`:

```js
test("a traced line's cells are lit and the rest fade", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	setTraced("e4 c5 Nf3 d6 d4");
	const box = document.createElement("div");
	renderTrieTable(box, grid(s.lines), "horizontal");
	const lit = [...box.querySelectorAll("td.traced")].map(moveOf).sort();
	assert.deepStrictEqual(lit, ["Nf3", "c5", "d4", "d6", "e4"].sort());
	assert.ok(
		box.querySelector("td.faded"),
		"the cells that are not on the line fade back",
	);
	setTraced(null);
	off();
});

test("a column that contributes no lit cell has a faded header", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	setTraced("e4 c5 Nf3 d6 d4");
	const box = document.createElement("div");
	renderTrieTable(box, grid(s.lines), "horizontal");
	const heads = [...box.querySelectorAll("th.var-head")];
	const sib = heads.find((h) => h.textContent.includes("Sideline") &&
		h.classList.contains("faded"));
	assert.ok(sib, "the sibling line's header fades");
	assert.strictEqual(
		heads.filter((h) => h.classList.contains("traced")).length,
		3,
		"mainline, group and the traced line's own header",
	);
	setTraced(null);
	off();
});
```

Add `setTraced` to the `../src/state.js` import at the top of `tests/trie-view.test.mjs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/trie-view.test.mjs`
Expected: FAIL — no `td.traced` elements; the lit array is empty.

- [ ] **Step 3: Implement in `render.js`**

Change the signature at line 187 from:

```js
export function renderTable(container, grid, orientation) {
	const { vars, maxPly } = grid;
```

to:

```js
// `trace` is the line the preview is highlighting: { litByVar, onTrace }, where
// litByVar is trace.js's Map(var -> Set(ply)) and onTrace(v) toggles a column.
// Supplied ONLY by renderTrieTable — appendPrintTables passes nothing, so the
// printed report carries no dimming and no click handlers, the same containment
// the grouping itself has.
export function renderTable(container, grid, orientation, trace) {
	const { vars, maxPly } = grid;
	// A column's header follows its cells: lit when the column contributes at
	// least one move to the traced line, so the two can never disagree.
	const traceClass = (v) =>
		!trace ? "" : trace.litByVar.has(v) ? " traced" : " faded";
	const cellTrace = (c, v, ply) => {
		if (!trace) return;
		c.classList.add(trace.litByVar.get(v)?.has(ply) ? "traced" : "faded");
	};
	// A line column is a trace target: clicking any of its cells or its header
	// toggles the highlight. Group columns are left alone — their click folds,
	// and a group is not one line. The toggle reads the RESOLVED trace rather
	// than the stored key, so clicking a line whose trace is currently
	// invisible sets it rather than clearing it.
	const wireTrace = (el, v) => {
		if (!trace || !v.moves || v.onclick) return;
		el.classList.add("clickable");
		el.tabIndex = 0;
		el.setAttribute("role", "button");
		el.setAttribute("aria-pressed", String(trace.litByVar.has(v)));
		const go = (e) => {
			e.stopPropagation();
			trace.onTrace(v);
		};
		el.onclick = go;
		el.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
				e.preventDefault();
				go(e);
			}
		};
	};
```

In the **horizontal** header loop, change:

```js
			th.className =
				"var-head" +
				(i === 0 ? " main-col sticky-col" : "") +
				(v.onclick ? " clickable" : "") +
				(v.collapsed ? " collapsed" : "") +
				groupClass(v);
```

to add the trace class and wire the header:

```js
			th.className =
				"var-head" +
				(i === 0 ? " main-col sticky-col" : "") +
				(v.onclick ? " clickable" : "") +
				(v.collapsed ? " collapsed" : "") +
				groupClass(v) +
				traceClass(v);
			wireTrace(th, v);
```

In the **horizontal** cell loop, after the existing `wireExpandControl` block, add the two trace calls:

```js
			for (const v of vars) {
				const c = moveCell(v.cells[ply], ply, v.noteByPly);
				c.className += groupClass(v);
				if (v === vars[0]) c.classList.add("main-col", "sticky-col");
				if (v.onclick && v.collapsed) {
					c.classList.add("clickable");
					wireExpandControl(c, v.onclick, false);
				}
				cellTrace(c, v, ply);
				wireTrace(c, v);
				tr.appendChild(c);
			}
```

In `varHead` (used by the vertical layout), change:

```js
		c.className =
			"var-head" +
			(v.onclick ? " clickable" : "") +
			(v.collapsed ? " collapsed" : "") +
			groupClass(v);
```

to:

```js
		c.className =
			"var-head" +
			(v.onclick ? " clickable" : "") +
			(v.collapsed ? " collapsed" : "") +
			groupClass(v) +
			traceClass(v);
		wireTrace(c, v);
```

In the **vertical** cell loop, add the same two calls before `tr.appendChild(c)`:

```js
			for (let ply = 0; ply <= maxPly; ply++) {
				const c = moveCell(v.cells[ply], ply, v.noteByPly);
				c.className += groupClass(v);
				if (v.onclick && v.collapsed) {
					c.classList.add("clickable");
					wireExpandControl(c, v.onclick, false);
				}
				cellTrace(c, v, ply);
				wireTrace(c, v);
				tr.appendChild(c);
			}
```

- [ ] **Step 4: Wire it up in `renderTrieTable`**

This step is needed for the Step 1 tests to pass. In `src/trie-view.js`, add to the imports at the top:

```js
import { tracePath } from "./trace.js";
import { getTraced, setTraced } from "./state.js";
```

(fold `getTraced`/`setTraced` into the existing `./state.js` import rather than adding a second one).

Then in `renderTrieTable`, replace the final render call:

```js
	renderTable(container, { ...g, vars, maxPly: subMaxPly(vars) }, orientation);
```

with:

```js
	// The traced line, resolved against the columns actually on screen. A key
	// that no longer names a visible column resolves to null, so a trace hidden
	// by a fold simply stops showing rather than leaving stale state behind.
	const litByVar = tracePath(vars, getTraced());
	const trace = {
		litByVar: litByVar || new Map(),
		onTrace: (v) => {
			setTraced(litByVar && litByVar.has(v) ? null : tracedKey(v));
			getRenderHooks().rerenderTable();
		},
	};
	renderTable(
		container,
		{ ...g, vars, maxPly: subMaxPly(vars) },
		orientation,
		trace,
	);
```

Add `tracedKey` to the `./trace.js` import.

Note the `litByVar: litByVar || new Map()` — with nothing traced the map is empty, so `traceClass` fades every column. That is wrong and Step 5 catches it; Task 6 fixes it properly by passing `trace` only when a line is actually traced.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: the two new tests PASS, but existing tests FAIL — with nothing traced every cell now gets `faded`. That is the bug called out above; fix it in the next step before committing.

- [ ] **Step 6: Only trace when something is traced**

In `renderTrieTable`, change the render call so `trace` is `undefined` when nothing resolves:

```js
	const litByVar = tracePath(vars, getTraced());
	const trace = {
		litByVar: litByVar || new Map(),
		onTrace: (v) => {
			setTraced(litByVar && litByVar.has(v) ? null : tracedKey(v));
			getRenderHooks().rerenderTable();
		},
	};
	renderTable(
		container,
		{ ...g, vars, maxPly: subMaxPly(vars) },
		orientation,
		trace,
	);
```

becomes:

```js
	// Resolved against the columns actually on screen. A key that no longer
	// names a visible column resolves to null, so a trace hidden by a fold
	// stops showing rather than leaving stale state behind — and with nothing
	// traced there is no `trace` object at all, so no cell is dimmed and no
	// column becomes a click target.
	const litByVar = tracePath(vars, getTraced());
	const onTrace = (v) => {
		setTraced(litByVar && litByVar.has(v) ? null : tracedKey(v));
		getRenderHooks().rerenderTable();
	};
	renderTable(
		container,
		{ ...g, vars, maxPly: subMaxPly(vars) },
		orientation,
		litByVar ? { litByVar, onTrace } : undefined,
	);
```

This leaves one gap: with nothing traced, no column is a click target, so a trace can never be STARTED. Task 6 fixes that.

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 8: Commit**

```bash
git add src/render.js src/trie-view.js tests/trie-view.test.mjs
git commit -m "Light a traced line's cells and fade the rest"
```

---

### Task 6: Starting a trace, and the Clear trace chip

**Files:**
- Modify: `src/render.js` (`wireTrace` gate)
- Modify: `src/trie-view.js` (`renderTrieTable` controls row)
- Test: `tests/trie-view.test.mjs`

After Task 5 a trace can be toggled off but never started, because `trace` is only supplied once something is already traced. Split the two concerns: cells are always click targets in the preview, dimming happens only while a trace resolves.

- [ ] **Step 1: Write the failing tests**

Append to `tests/trie-view.test.mjs`:

```js
test("clicking a line column starts a trace, clicking it again clears it", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	setTraced(null);
	const box = document.createElement("div");
	renderTrieTable(box, grid(s.lines), "horizontal");
	const d4 = [...box.querySelectorAll("td")].find((c) => moveOf(c) === "d4");
	d4.onclick({ stopPropagation() {} });
	assert.strictEqual(getTraced(), "e4 c5 Nf3 d6 d4");
	// re-render against the new state, then click the same cell again
	const box2 = document.createElement("div");
	renderTrieTable(box2, grid(s.lines), "horizontal");
	const again = [...box2.querySelectorAll("td")].find((c) => moveOf(c) === "d4");
	again.onclick({ stopPropagation() {} });
	assert.strictEqual(getTraced(), null, "clicking the traced line clears it");
	off();
});

test("a group column folds rather than tracing", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	setTraced(null);
	const box = document.createElement("div");
	renderTrieTable(box, grid(s.lines), "horizontal");
	const head = [...box.querySelectorAll("th.var-head")].find((h) =>
		h.textContent.includes("2 lines"),
	);
	head.onclick({ stopPropagation() {} });
	assert.strictEqual(getTraced(), null, "no trace started");
	assert.ok(!openTablePaths.has(GROUP_KEY), "the group folded instead");
	off();
});

test("Clear trace appears only while a line is traced", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	setTraced(null);
	const idle = document.createElement("div");
	renderTrieTable(idle, grid(s.lines), "horizontal");
	const chip = (n) =>
		[...n.querySelectorAll("button")].find((b) => b.textContent === "Clear trace");
	assert.strictEqual(chip(idle), undefined, "nothing to clear");

	setTraced("e4 c5 Nf3 d6 d4");
	const on = document.createElement("div");
	renderTrieTable(on, grid(s.lines), "horizontal");
	assert.ok(chip(on), "offered while tracing");
	chip(on).onclick();
	assert.strictEqual(getTraced(), null);
	off();
});
```

Add `getTraced` to the `../src/state.js` import at the top of `tests/trie-view.test.mjs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/trie-view.test.mjs`
Expected: FAIL — `d4.onclick is not a function` (no trace object, so no targets were wired).

- [ ] **Step 3: Always pass the trace object; gate only the dimming**

In `src/trie-view.js`, replace the render call from Task 5 Step 6 with:

```js
	// Resolved against the columns actually on screen. A key that no longer
	// names a visible column resolves to null, so a trace hidden by a fold
	// stops showing rather than leaving stale state behind.
	const litByVar = tracePath(vars, getTraced());
	renderTable(container, { ...g, vars, maxPly: subMaxPly(vars) }, orientation, {
		litByVar,
		onTrace: (v) => {
			// Against the RESOLVED trace, not the stored key: clicking a line
			// whose trace is currently invisible sets it rather than clearing it.
			setTraced(litByVar && litByVar.has(v) ? null : tracedKey(v));
			getRenderHooks().rerenderTable();
		},
	});
```

In `src/render.js`, `litByVar` is now `null` when nothing is traced. Update the two helpers so dimming is gated on it while wiring is not:

```js
	const traceClass = (v) =>
		!trace || !trace.litByVar
			? ""
			: trace.litByVar.has(v)
				? " traced"
				: " faded";
	const cellTrace = (c, v, ply) => {
		if (!trace || !trace.litByVar) return;
		c.classList.add(trace.litByVar.get(v)?.has(ply) ? "traced" : "faded");
	};
	const wireTrace = (el, v) => {
		if (!trace || !v.moves || v.onclick) return;
		el.classList.add("clickable");
		el.tabIndex = 0;
		el.setAttribute("role", "button");
		el.setAttribute("aria-pressed", String(!!trace.litByVar?.has(v)));
		const go = (e) => {
			e.stopPropagation();
			trace.onTrace(v);
		};
		el.onclick = go;
		el.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
				e.preventDefault();
				go(e);
			}
		};
	};
```

- [ ] **Step 4: Add the Clear trace chip**

In `src/trie-view.js`, in `renderTrieTable`, the controls row currently ends with:

```js
	controls.append(ex, col);
	container.appendChild(controls);
```

The chip needs `litByVar`, which is computed further down, so move the `controls`/`container.appendChild(controls)` pair to AFTER `const litByVar = ...` and before the `renderTable` call, then append the chip conditionally:

```js
	controls.append(ex, col);
	// Offered only while a trace is actually showing: a control for something
	// that is not happening is noise, and the same click on the traced column
	// clears it anyway.
	if (litByVar) {
		const clear = el("button", {
			className: "chip mini",
			textContent: "Clear trace",
		});
		clear.onclick = () => {
			setTraced(null);
			getRenderHooks().rerenderTable();
		};
		controls.append(" ", clear);
	}
	container.appendChild(controls);
```

Verify by reading the function top to bottom that `controls` is created before `litByVar` is used and appended after — the `if (!mainV) return;` early return must still happen before either.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 6: Commit**

```bash
git add src/render.js src/trie-view.js tests/trie-view.test.mjs
git commit -m "Start and clear a trace from the table"
```

---

### Task 7: The print path stays untouched

**Files:**
- Test: `tests/print.test.mjs`

- [ ] **Step 1: Write the test**

Append to `tests/print.test.mjs`:

```js
// Tracing is a screen affordance. appendPrintTables builds from grid() and
// passes renderTable no trace object, so a trace left on when the reader hits
// Print cannot dim the report or leave click handlers in the printed DOM.
test("a trace does not reach the printed report", () => {
  const off = installDom();
  setTraced("e4 c5 Nf3");
  const box = printTables("1. e4 e5 (1... c5 2. Nf3 d6 3. d4 (3. Bb5+)) 2. Nf3");
  assert.strictEqual(box.querySelectorAll(".traced, .faded").length, 0);
  setTraced(null);
  off();
});
```

Add `setTraced` to the `../src/state.js` import at the top of `tests/print.test.mjs`.

- [ ] **Step 2: Run the test**

Run: `node --test tests/print.test.mjs`
Expected: PASS — this is a pinning test; it should pass without any source change. If it fails, `renderTable`'s trace argument is leaking into the print path and must be fixed there.

- [ ] **Step 3: Commit**

```bash
git add tests/print.test.mjs
git commit -m "Pin the printed report against the trace highlight"
```

---

### Task 8: Styling

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Add the theme variable**

In `style.css`, in the `:root` block, after `--grp-edge: #9db8e0;` add:

```css
  --trace: #cfe0fb;
```

In the `[data-theme="dark"]` block, after `--grp-edge: #4a5f85;` add:

```css
  --trace: #2f4470;
```

- [ ] **Step 2: Add the rules**

In `style.css`, immediately after the `.tbl:not(.tbl-h) tr th.grp-start` rule (the end of the group-shading block, around line 363), add:

```css
/* Tracing one line through the table: the cells that make up it are filled,
   everything else drops back. Written as `tr td` / `tr th` for the same reason
   the group shading above is — it has to outrank the zebra striping and the
   group tint, which are otherwise more specific. */
.tbl tr td.traced,
.tbl tr th.traced {
  background: var(--trace);
  color: var(--text);
  font-weight: 700;
}
/* Dimmed with color, never opacity: the sticky mainline and ply columns have
   opaque backgrounds that scrolled content would show through if the cell were
   made translucent. The traced cells' fill carries the contrast anyway. */
.tbl tr td.faded,
.tbl tr th.faded {
  color: var(--muted);
}
```

- [ ] **Step 3: Verify**

Run: `npm test && npm run lint && npm run knip`
Expected: all tests pass, no lint output, no knip output.

- [ ] **Step 4: Commit**

```bash
git add style.css
git commit -m "Style the traced line and the cells that fade behind it"
```

---

### Task 9: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the feature**

In `README.md`, in the numbered item 3 (**Render**), after the sentence ending `A note on one of those shared moves is marked on the group's own column, which is where the move is shown — open or shut.` add:

```
   Clicking a line's column traces it: every cell that makes up that line lights
   up — its opening moves in the Mainline column, the shared moves in whatever
   group columns enclose it, and its own tail — and the rest of the table drops
   back. Click it again, or **Clear trace**, to stop. The trace is a reading
   aid: it isn't saved with the notebook and never reaches the printed report.
```

- [ ] **Step 2: Verify the surrounding text still reads correctly**

Run: `sed -n '30,50p' README.md`
Expected: the new sentences sit inside item 3 and the following sentence about `[n]` markers is untouched.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document tracing a line through the table"
```

---

### Task 10: Final verification and push

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: 0 failures. (1 pre-existing skip in `pgn-out.test.mjs` for chess.js null-move support is expected.)

- [ ] **Step 2: Lint and dead-code check**

Run: `npm run lint && npm run knip`
Expected: no output from either.

- [ ] **Step 3: Confirm the feature end to end**

Run:

```bash
node -e '
(async () => {
  const h = await import("./tests/helpers.mjs");
  const off = h.installDom();
  const { grid } = await import("./src/table.js");
  const { renderTrieTable } = await import("./src/trie-view.js");
  const { openTablePaths, setTraced } = await import("./src/state.js");
  const s = h.loadState("1. e4 e5 (1... c5 2. Nf3 d6 3. d4 (3. Bb5+)) 2. Nf3");
  openTablePaths.add("1:c5");
  setTraced("e4 c5 Nf3 d6 d4");
  const box = document.createElement("div");
  renderTrieTable(box, grid(s.lines), "horizontal");
  [...box.querySelectorAll("tr")].forEach((r) =>
    console.log("|" + [...r.children].map((c) => {
      const t = (c.textContent || "").padEnd(8);
      return c.classList.contains("traced") ? "[" + t + "]" : " " + t + " ";
    }).join("|") + "|"));
  off();
})();'
```

Expected: `e4` in the Mainline column, `c5`/`Nf3`/`d6` in the group column and `d4` in its own column are bracketed; nothing else is.

- [ ] **Step 4: Push**

```bash
git push origin master
```

---

## Self-Review

**Spec coverage:** §3 rule → Task 3. §4 chain → Task 2. §5 module → Tasks 1, 3. §6 rendering → Task 5. §7 interaction → Tasks 5, 6. §8 styling → Task 8. §9 testing → Tasks 1, 3, 5, 6, 7. §10 out-of-scope items appear in no task, correctly.

**Naming consistency:** `tracedKey`, `tracePath`, `getTraced`/`setTraced`, `litByVar`, `onTrace`, `traceClass`, `cellTrace`, `wireTrace`, `pushVars`, `--trace`, `.traced`, `.faded` — used identically in every task.

**Known ordering trap:** Task 5 deliberately lands in a broken intermediate state (everything faded) and fixes it within the same task; Task 6 then reverses part of Task 5's gating. Both are called out inline so an engineer reading tasks out of order does not commit the intermediate.
