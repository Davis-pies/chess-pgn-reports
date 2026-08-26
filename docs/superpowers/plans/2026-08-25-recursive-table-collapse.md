# Recursive Table Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expanding a table branch reveals its immediate children rather than every leaf, and clicking folds exactly one level.

**Architecture:** All of it lands in `renderTrieTable` in `src/trie-view.js`. `collapsedVar(node)` becomes `branchVar(node, open)`, which renders a group's column in either state; a new `pushNode(node, vars)` recurses one level at a time; `forkOf(node)` skips single-child chains so expanding never opens a pointless level. `src/render.js` is untouched — `varHead` already draws a clickable non-collapsed column as `▾ … collapse branch`.

**Tech Stack:** Vanilla ES modules, no build step. Tests are `node --test` with jsdom.

**Conventions:** `src/trie-view.js` indents with **TABS**; `tests/app.test.mjs` with **TABS**. Run `npm test`, `npm run lint`, `npm run knip`.

**Spec:** `docs/superpowers/specs/2026-08-25-recursive-table-collapse-design.md`

---

### Task 1: Recurse one level at a time

**Files:**
- Modify: `src/trie-view.js` (`renderTrieTable`'s var loop, `collapsedVar`)
- Test: `tests/app.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/app.test.mjs`:

```js
// c5 forks into Nf3 and Nc3; the Nf3 side forks again into Nc6 and Nf6, so the
// tree is deep enough to open one level at a time.
const DEEP_PGN =
	"1. e4 e5 (1... c5 2. Nf3 Nc6) (1... c5 2. Nf3 Nf6) (1... c5 2. Nc3 d6) " +
	"2. Nf3";

const pvHeads = () =>
	[...doc("view").querySelectorAll(".pv-table table.tbl tr:first-child th")];
const openable = () =>
	pvHeads().filter((h) => h.classList.contains("clickable"));

test("the table opens one level at a time", async () => {
	app.reset();
	doc("view").querySelector("textarea.pgnin").value = DEEP_PGN;
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	// one branch, shut
	const shut = openable().filter((h) => h.classList.contains("collapsed"));
	assert.strictEqual(shut.length, 1, "the c5 branch starts shut");
	assert.match(shut[0].textContent, /3 lines/);

	shut[0].click();
	// the group keeps a column of its own, now open, and its children appear —
	// the 2.Nf3 fork among them, still shut
	const open = openable().filter((h) => !h.classList.contains("collapsed"));
	assert.strictEqual(open.length, 1, "the opened group is the only ▾ control");
	const inner = openable().filter((h) => h.classList.contains("collapsed"));
	assert.strictEqual(inner.length, 1, "its 2.Nf3 child is a branch, still shut");
	assert.match(inner[0].textContent, /2 lines/);

	inner[0].click();
	assert.strictEqual(
		openable().filter((h) => h.classList.contains("collapsed")).length,
		0,
		"nothing left shut",
	);
	assert.strictEqual(
		openable().filter((h) => !h.classList.contains("collapsed")).length,
		2,
		"both group columns are open controls",
	);

	// folding the inner group leaves the outer one open
	const inners = openable().filter((h) => /2 lines/.test(h.textContent));
	inners[0].click();
	assert.strictEqual(
		openable().filter((h) => h.classList.contains("collapsed")).length,
		1,
		"the inner group folded",
	);
	assert.ok(
		openable().some(
			(h) => !h.classList.contains("collapsed") && /3 lines/.test(h.textContent),
		),
		"and the outer one is still open",
	);
});

test("a line column is never a fold control", async () => {
	app.reset();
	doc("view").querySelector("textarea.pgnin").value = DEEP_PGN;
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();
	[...doc("view").querySelectorAll(".pv-table button")]
		.find((b) => b.textContent === "Expand all")
		.click();

	// every control is a group column ("N lines"); the line columns are inert
	assert.ok(openable().length > 0, "there are controls");
	assert.ok(
		openable().every((h) => /\\d+ lines/.test(h.textContent)),
		"only group columns are clickable: " +
			openable().map((h) => h.textContent).join(" | "),
	);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — opening the c5 branch currently produces three clickable leaf columns and no group column, so "the opened group is the only ▾ control" fails.

- [ ] **Step 3: Implement the recursion**

In `src/trie-view.js`, replace the var-building loop in `renderTrieTable`:

```js
	const vars = [mainV];
	trie.children.forEach((c) => pushNode(c, vars));
```

Replace `collapsedVar` and its doc comment with:

```js
// A trie node's contribution to the column list, one level at a time.
//
// A group that is open keeps a column of ITS OWN — the moves its lines share —
// and that column is the only control in the group. Leaf columns are inert, so
// a click folds exactly one level instead of however many the reader had opened.
// It is the table's equivalent of the editor's <summary>: a group you can see
// and act on whether it is open or shut.
function pushNode(node, vars) {
	// one line under it: just that line's column, with nothing to fold
	if (countLeaves(node) === 1) {
		vars.push(...leavesOf(node));
		return;
	}
	const open = openTablePaths.has(node.key);
	vars.push(branchVar(node, open));
	if (!open) return;
	// Down to the first real fork before recursing: sharedMoves already put the
	// single-child chain in the header above, so opening one level per shared
	// move would add columns that say nothing.
	const fork = forkOf(node);
	// a line that ends exactly at the fork is a column beside its continuations
	if (fork.leaf) vars.push(fork.leaf);
	fork.children.forEach((c) => pushNode(c, vars));
}

// The end of a node's single-child chain — the node sharedMoves() stops at.
function forkOf(node) {
	let n = node;
	while (!n.leaf && n.children.size === 1) n = [...n.children.values()][0];
	return n;
}

// A branch as one column: the moves common to all its lines up to the first
// fork, with divergent cells empty and an ellipsis before its divergence.
// `open` decides which way the control points and which way a click goes.
function branchVar(node, open) {
	const shared = sharedMoves(node); // [{ ply, san }] down the single-child chain
	const cells = {};
	shared.forEach((m) => {
		cells[m.ply] = { text: m.san, cls: "collapsed" };
	});
	// ellipsis prefix before the branch's first shared move, like a sideline
	const d = shared.length ? shared[0].ply : 0;
	for (let ply = 0; ply < d; ply++) cells[ply] = { text: "…", cls: "ellip" };
	const count = countLeaves(node);
	return {
		tag: "collapse",
		label: "",
		name: `${count} lines`, // compact: the shared moves are in the column cells
		eval: "",
		cells,
		noteByPly: {},
		collapsed: !open,
		onclick: () => {
			if (open) openTablePaths.delete(node.key);
			else openTablePaths.add(node.key);
			getRenderHooks().rerenderTable();
		},
	};
}
```

- [ ] **Step 4: Update the test that pins the old shape**

`tests/app.test.mjs`, "table preview: mainline always visible, branches collapsed by default". After the fork is expanded, the two assertions about its leaf headers become one about the group column:

```js
	assert.strictEqual(
		pv2.querySelectorAll("table.tbl th.clickable:not(.collapsed)").length,
		1,
		"the opened group keeps one column, and it is the only control",
	);

	// clicking the group column folds the branch again
	pv2.querySelector("table.tbl th.clickable:not(.collapsed)").click();
```

Leave every other assertion in that test alone — the collapsed-by-default shape,
the single-line plain column, Expand all and Collapse all are all unchanged.

- [ ] **Step 5: Run the whole suite**

Run: `npm test && npm run lint && npm run knip`
Expected: all pass. In particular `tests/render.test.mjs`'s keyboard-accessibility tests must pass untouched — `render.js` did not change.

- [ ] **Step 6: Commit**

```bash
git add src/trie-view.js tests/app.test.mjs
git commit -m "Open the table one level at a time"
```

---

### Task 2: Documentation and closeout

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document it**

In `README.md`'s step-3 "Render" paragraph, the sentence about the table's
branches becomes:

> A multi-line branch shows as one collapsed column of the moves its lines
> share; opening it reveals its immediate children — lines and further branches
> — one level at a time, the way the editor's grouped view nests. The group
> keeps a column of its own while open, and clicking it folds that one level.

- [ ] **Step 2: Full verification**

```bash
npm test          # every test passes
npm run lint      # no errors
npm run knip      # no unused files or exports
```

- [ ] **Step 3: Commit, merge and close**

```bash
git add README.md
git commit -m "Document the table's nested branches"
```

Merge to `master` locally and push (this repo does not use PRs), then:

```bash
task 21 done
```
