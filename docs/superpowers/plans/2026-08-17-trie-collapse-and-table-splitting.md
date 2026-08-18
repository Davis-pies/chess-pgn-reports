# Trie Collapse + Table Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every editor trie group collapsible (lone lines included), group the interactive table's sideline lines into collapsible trie branches with an always-visible mainline, and add a print "split table by trie" checkbox with fork-based table cutting.

**Architecture:** All changes live in `src/app.js` (trie rendering + table assembly) plus small CSS and tests. The editor and the table share `buildTrie` but keep separate expand-state sets (`openPaths` vs `openTablePaths`). The print table reuses the same trie walk for its fork-based cuts.

**Tech Stack:** Vanilla ES modules, no framework. Tests: `node --test` + `jsdom`.

## Global Constraints

- No new dependencies.
- Tabs for indentation, single quotes, semicolons (match existing files).
- Keep both light/dark themes working; use existing CSS vars.
- DOM built via the existing `el()` helper; no `innerHTML` for user content.
- The `current` object literal resets (New/Import, openNotebook, importPanel) do NOT need `showSplitTrie` — the checkbox helper defaults `undefined` to `false`.
- TESTS: jsdom's document-wide `querySelector`/`querySelectorAll` skips ALL content inside a `<details>` element (open or closed); queries scoped to the details element itself work (`detailsEl.querySelector(...)`). Any test targeting content inside a details must scope the query to that details element.
- Every task ends with `npm test` green + a commit.

---

### Task 1: Editor — lone-line groups become collapsible

`renderTrieNode` currently special-cases a lone line (leaf, no fork) as an always-open `.lgroup.open` div. Unify: every node renders as a collapsible `<details>`, collapsed by default; the single-child chain inlining stays.

**Files:**

- Modify: `src/app.js` (`renderTrieNode`)
- Test: `tests/app.test.mjs`

**Interfaces:**

- Produces: `renderTrieNode(container, node, nameCounter, path, allOpen)` now renders lone lines as `details.lgroup` too (no more `.lgroup.open` div branch). Same signature as before — nothing else consumes it.

- [ ] **Step 1: Write the failing test**

In `tests/app.test.mjs`, add (after the existing inline-boards test; reuse its setup pattern — fresh JSDOM, `global.requestAnimationFrame = dom.window.requestAnimationFrame`, cache-busted `import("../src/app.js?t=3")`, dispatch DOMContentLoaded, `tick` helper already exists):

```js
test("lone-line editor groups are collapsible details, closed by default", async () => {
 const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
  url: "http://localhost/",
  pretendToBeVisual: true,
 });
 global.window = dom.window;
 global.document = dom.window.document;
 global.requestAnimationFrame = dom.window.requestAnimationFrame;
 global.localStorage = dom.window.localStorage;
 global.alert = () => {};
 global.confirm = () => true;

 await import("../src/app.js?t=3");
 dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

 // one variation = one lone line in the trie (no fork)
 const textarea = doc("view").querySelector("textarea.pgnin");
 textarea.value = "1. e4 e5 (1... c5 2. Nf3) 2. Nf3";
 [...doc("view").querySelectorAll("button")]
  .find((b) => b.textContent.includes("Load"))
  .click();
 await tick();

 const det = doc("view").querySelector(".markup details.lgroup");
 assert.ok(det, "lone line renders as a details group");
 assert.strictEqual(det.open, false, "collapsed by default");
 assert.ok(det.querySelector("summary").textContent.includes("1 line"));

 // expanding reveals the line editor
 det.open = true;
 det.dispatchEvent(new dom.window.Event("toggle"));
 const det2 = doc("view").querySelector(".markup details.lgroup");
 assert.ok(det2.open, "expanded after toggle");
 assert.ok(det2.querySelector(".ledge"), "line editor present when open");

 delete global.window;
 delete global.document;
 delete global.requestAnimationFrame;
 delete global.localStorage;
 delete global.alert;
 delete global.confirm;
});
```

Run: `node --test tests/app.test.mjs`
Expected: FAIL — the lone line currently renders as a `div.lgroup.open`, so `.markup details.lgroup` matches nothing → assertion fails.

- [ ] **Step 2: Implement the unified `renderTrieNode`**

In `src/app.js`, replace the whole `renderTrieNode` function with:

```js
function renderTrieNode(container, node, nameCounter, path, allOpen) {
 const nextPath = path
  ? path + "  " + branchLabel(node.move)
  : branchLabel(node.move);
 const boards = current.showBoards; // inline-boards master toggle
 // single-child chain: inline it, accumulating the path so a long shared
 // continuation shows as one compressed header, not nested single groups
 if (!node.leaf && node.children.size === 1) {
  node.children.forEach((c) =>
   renderTrieNode(container, c, nameCounter, nextPath, allOpen),
  );
  return;
 }
 // every node — fork OR lone line — is a collapsible group, closed by
 // default; header shows the full shared path up to this node
 const det = el("details", { className: "lgroup" });
 det.open = openPaths.has(node.key);
 det.addEventListener("toggle", () => {
  // only rebuild when the open-state actually changed; jsdom fires a toggle
  // when a rebuilt element gets open=true, and without this guard that
  // rebuild re-schedules another toggle forever
  const had = openPaths.has(node.key);
  if (det.open && !had) openPaths.add(node.key);
  else if (!det.open && had) openPaths.delete(node.key);
  else return;
  renderApp(); // boards appear/disappear with expansion
  // ponytail: whole-app re-render; if toggling feels slow on huge files,
  // scope the rebuild to the markup panel only
 });
 const count = countLeaves(node);
 det.appendChild(
  el("summary", {
   className: "lg-head",
   textContent: `${nextPath} \u00b7 ${count} line${count === 1 ? "" : "s"}`,
  }),
 );
 const body = el("div", { className: "lgroup-body" });
 const open = det.open;
 if (node.leaf)
  body.appendChild(
   lineEditor(node.leaf, nameCounter.n++, allOpen && open && boards),
  );
 node.children.forEach((c) =>
  renderTrieNode(body, c, nameCounter, "", allOpen && open),
 );
 det.appendChild(body);
 container.appendChild(det);
}
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: 26/26 pass. NOTE: the pre-existing inline-boards test must be updated in the same task — its old expectation (expanding a fork immediately shows its leaves' boards) is obsolete now that fork children are collapsed lone-line groups, and its board queries must be SCOPED to the details element (see the jsdom `<details>` selector constraint). Updated expectations: fork collapsed → 1 board (mainline only); fork expanded → still 1 (children collapsed); expanding a lone-line child → its board appears (scoped query); flat view → 3 boards.

- [ ] **Step 4: Commit**

```bash
git add src/app.js tests/app.test.mjs
git commit -m "feat: lone-line editor groups are collapsible details like forks"
```

---

### Task 2: Interactive table — trie-collapsible branches + always-visible mainline

The left-panel table (`pv-table`) becomes: mainline always visible, then one collapsible `<details>` per top-level trie branch (collapsed by default, its own expand-state set). Also add "Expand all / Collapse all" controls above the table and above the editor groups.

**Files:**

- Modify: `src/app.js` (new `openTablePaths` set; `renderTrieTable` + `renderTblGroup` + `leavesOf` + `tblPath` + `collectKeys` helpers; replace the `renderTable(t, g, orientation)` call in `viewRoot`; expand/collapse-all buttons in `markupPanel`)
- Modify: `style.css` (`.tbl-main` caption + controls row)
- Test: `tests/app.test.mjs` (update full-flow test + inline-boards test scoping; new table test)

**Interfaces:**

- Consumes: `buildTrie(lines, main)` (already in app.js; note `g.vars` entries have no `isMain`, so pass only the sideline vars and the mainline var as `main`), `countLeaves(node)`, `renderTable(container, grid, orientation)` (render.js), `el()`.
- Produces:
  - `renderTrieTable(container, g, orientation)` — renders the mainline block + branch groups into the `pv-table` container.
  - `leavesOf(node) -> [lines]` — all descendant lines of a trie node, depth-first.
  - `tblPath(node) -> string` — shared path through the single-child chain (e.g. `1... c5 2. Nf3`).
  - `collectKeys(node, into)` — adds `node.key` and all descendants' keys to a Set.
  - Module-level `const openTablePaths = new Set()`.

- [ ] **Step 1: Update the two existing tests that the change breaks**

In `tests/app.test.mjs`:

(a) The inline-boards test was already scoped to `.markup` in Task 1 (when the fork's children became details) — verify its query is `.markup details.lgroup` and leave it.

(b) The full-flow test's last assertions check the table preview text for "sideline", but branch rows are now hidden until expanded. Replace the tail of that test:

```js
 // preview should now carry a sideline tag label
 const view2 = doc("view");
 const preview = view2.querySelector("table.tbl");
 assert.ok(
  preview.textContent.toLowerCase().includes("sideline"),
  "sideline tag appears in table",
 );
```

with:

```js
 // the sideline rows live in a collapsed trie branch; expand it
 const tb = doc("view").querySelector(".pv-table details.tbl-group");
 tb.open = true;
 tb.dispatchEvent(new dom.window.Event("toggle"));
 const preview = doc("view").querySelector(".pv-table");
 assert.ok(
  preview.textContent.toLowerCase().includes("sideline"),
  "sideline tag appears in table",
 );
```

Run: `node --test tests/app.test.mjs`
Expected: FAIL — `details.tbl-group` doesn't exist yet (and the table still renders as one flat grid).

- [ ] **Step 2: Add `openTablePaths` and the helpers**

In `src/app.js`, next to `const openPaths = new Set();` (module scope, line ~38):

```js
// trie groups the user expanded in the TABLE preview — separate from the
// editor's openPaths: expanding a table branch does not expand the editor
const openTablePaths = new Set();
```

After the `branchLabel` function, add:

```js
// All descendant lines of a trie node, depth-first (the flat row/column set
// a table branch contributes to the preview).
function leavesOf(node) {
 const out = [];
 if (node.leaf) out.push(node.leaf);
 node.children.forEach((c) => out.push(...leavesOf(c)));
 return out;
}

// Shared move path of a branch, accumulated through its single-child chain
// (e.g. "1... c5 2. Nf3") for the group header.
function tblPath(node) {
 let p = branchLabel(node.move);
 let n = node;
 while (!n.leaf && n.children.size === 1) {
  n = [...n.children.values()][0];
  p += "  " + branchLabel(n.move);
 }
 return p;
}

// Collect a node's key and every descendant's key (for "Expand all").
function collectKeys(node, into) {
 if (node.key) into.add(node.key);
 node.children.forEach((c) => collectKeys(c, into));
}
```

- [ ] **Step 3: Implement `renderTrieTable` + `renderTblGroup`**

In `src/app.js`, after the helpers above:

```js
// Left-panel preview: mainline always visible (left column strip in horizontal
// layout), then one collapsible section per top-level trie branch. Branches
// start collapsed; expanding shows that branch's lines as its own table slice.
function renderTrieTable(container, g, orientation) {
 const mainV = g.vars[0]; // mainline sorts first
 const others = g.vars.slice(1);
 const trie = buildTrie(others, mainV);
 const controls = el("div", { className: "orow tbl-controls" });
 controls.appendChild(el("span", { textContent: "Branches: " }));
 const ex = el("button", { className: "chip mini", textContent: "Expand all" });
 ex.onclick = () => {
  openTablePaths.clear();
  trie.children.forEach((c) => collectKeys(c, openTablePaths));
  renderApp();
 };
 const col = el("button", {
  className: "chip mini",
  textContent: "Collapse all",
 });
 col.onclick = () => {
  openTablePaths.clear();
  renderApp();
 };
 controls.append(ex, col);
 container.appendChild(controls);
 if (!mainV) return;
 // the reference row/column, always visible
 const mainBlock = el("div", { className: "tbl-main" });
 mainBlock.appendChild(
  el("h4", { className: "tbl-group", textContent: "Mainline" }),
 );
 renderTable(mainBlock, { ...g, vars: [mainV] }, orientation);
 container.appendChild(mainBlock);
 trie.children.forEach((c) => renderTblGroup(container, c, g, mainV, orientation));
}

function renderTblGroup(container, node, g, mainV, orientation) {
 const det = el("details", { className: "lgroup tbl-group" });
 det.open = openTablePaths.has(node.key);
 det.addEventListener("toggle", () => {
  // same state-change guard as the editor groups (see Task 1): a rebuild
  // re-sets open=true on fresh elements, and without it jsdom re-fires
  // toggle forever
  const had = openTablePaths.has(node.key);
  if (det.open && !had) openTablePaths.add(node.key);
  else if (!det.open && had) openTablePaths.delete(node.key);
  else return;
  renderApp();
 });
 const count = countLeaves(node);
 det.appendChild(
  el("summary", {
   className: "lg-head",
   textContent: `${tblPath(node)} \u00b7 ${count} line${count === 1 ? "" : "s"}`,
  }),
 );
 const body = el("div", { className: "lgroup-body" });
 const lines = leavesOf(node);
 if (lines.length) renderTable(body, { ...g, vars: lines }, orientation);
 det.appendChild(body);
 container.appendChild(det);
}
```

- [ ] **Step 4: Wire it into `viewRoot`**

In `src/app.js` `viewRoot()`, replace:

```js
 const t = el("div", { className: "pv-table" });
 t.appendChild(el("h3", { textContent: "Table" }));
 renderTable(t, g, current.orientation);
 side.appendChild(t);
```

with:

```js
 const t = el("div", { className: "pv-table" });
 t.appendChild(el("h3", { textContent: "Table" }));
 renderTrieTable(t, g, current.orientation);
 side.appendChild(t);
```

- [ ] **Step 5: Add editor expand/collapse-all**

In `src/app.js` `markupPanel()`, the view-toggle row currently ends with `row.append("View: ", grouped, flat);`. After it, add a controls span that only matters in grouped view:

```js
 row.append("View: ", grouped, flat);
 if (current.groupView !== "flat") {
  const all = el("button", {
   className: "chip mini",
   textContent: "Expand all",
   onclick: () => {
    const trie = buildTrie(current.lines, main);
    openPaths.clear();
    trie.children.forEach((c) => collectKeys(c, openPaths));
    renderApp();
   },
  });
  const none = el("button", {
   className: "chip mini",
   textContent: "Collapse all",
   onclick: () => {
    openPaths.clear();
    renderApp();
   },
  });
  row.append(all, none);
 }
```

(Note: `main` is computed a few lines below in `markupPanel`; move `const main = current.lines.find(...)` ABOVE this row block so the closure can use it.)

- [ ] **Step 6: Add the CSS**

In `style.css` (near the `.lgroup` rules):

```css
.tbl-controls {
 margin: 4px 0;
}
.tbl-main {
 margin: 6px 0 10px;
}
.tbl-group {
 font-family: ui-monospace, Menlo, Consolas, monospace;
 font-size: 0.85rem;
 color: var(--muted);
 font-weight: 400;
 margin: 0 0 4px;
}
```

- [ ] **Step 7: Write the new table test**

In `tests/app.test.mjs`, add:

```js
test("table preview: mainline always visible, branches collapsed by default", async () => {
 const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
  url: "http://localhost/",
  pretendToBeVisual: true,
 });
 global.window = dom.window;
 global.document = dom.window.document;
 global.requestAnimationFrame = dom.window.requestAnimationFrame;
 global.localStorage = dom.window.localStorage;
 global.alert = () => {};
 global.confirm = () => true;

 await import("../src/app.js?t=4");
 dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

 const textarea = doc("view").querySelector("textarea.pgnin");
 textarea.value = "1. e4 e5 (1... c5 2. Nf3) (1... e6 2. d4) 2. Nf3";
 [...doc("view").querySelectorAll("button")]
  .find((b) => b.textContent.includes("Load"))
  .click();
 await tick();

 const pv = doc("view").querySelector(".pv-table");
 // mainline reference table is always present
 assert.ok(pv.querySelector(".tbl-main table.tbl"), "mainline block visible");
 // two branches, both collapsed by default
 const groups = pv.querySelectorAll("details.tbl-group");
 assert.strictEqual(groups.length, 2);
 assert.ok(!groups[0].open && !groups[1].open, "branches start collapsed");

 // expand the first branch -> its table slice appears
 groups[0].open = true;
 groups[0].dispatchEvent(new dom.window.Event("toggle"));
 const pv2 = doc("view").querySelector(".pv-table");
 assert.strictEqual(pv2.querySelectorAll("details.tbl-group").length, 2);
 assert.ok(pv2.querySelector("details.tbl-group[open]"), "a branch is expanded");

 // expand-all opens every branch
 [...pv2.querySelectorAll("button")]
  .find((b) => b.textContent === "Expand all")
  .click();
 assert.strictEqual(
  doc("view").querySelectorAll(".pv-table details.tbl-group[open]").length,
  2,
  "expand all opens both branches",
 );

 delete global.window;
 delete global.document;
 delete global.requestAnimationFrame;
 delete global.localStorage;
 delete global.alert;
 delete global.confirm;
});
```

Run: `node --test tests/app.test.mjs`
Expected: PASS (full-flow, inline-boards, lone-line, and table tests all pass).

- [ ] **Step 8: Full suite + commit**

Run: `npm test` — all green (now 27 tests).
Commit:

```bash
git add src/app.js style.css tests/app.test.mjs
git commit -m "feat: table preview groups lines by trie branch, mainline always visible, expand/collapse-all"
```

---

### Task 3: Print/PDF — split-by-trie checkbox + fork-based cuts

**Files:**

- Modify: `src/app.js` (`appendPrintTables` rewrite; add `chk("split table by trie", "showSplitTrie", false)` to `exportBar`'s `pOpts`)
- Test: `tests/app.test.mjs`

**Interfaces:**

- Consumes: `buildTrie`, `leavesOf`, `tblPath` (from Task 2), `renderTable`, `el()`.
- Produces: `appendPrintTables(box, g)` now branches on `current.showSplitTrie`. `current.showSplitTrie` is `undefined`→checkbox unchecked (false) by default.

- [ ] **Step 1: Write the failing test**

In `tests/app.test.mjs`:

```js
test("print table: split-by-trie checkbox toggles per-branch tables", async () => {
 const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
  url: "http://localhost/",
  pretendToBeVisual: true,
 });
 global.window = dom.window;
 global.document = dom.window.document;
 global.requestAnimationFrame = dom.window.requestAnimationFrame;
 global.localStorage = dom.window.localStorage;
 global.alert = () => {};
 global.confirm = () => true;

 await import("../src/app.js?t=5");
 dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

 const textarea = doc("view").querySelector("textarea.pgnin");
 // two variations with DIFFERENT first moves = two top-level branches
 textarea.value = "1. e4 e5 (1... c5 2. Nf3) (1... e6 2. d4) 2. Nf3";
 [...doc("view").querySelectorAll("button")]
  .find((b) => b.textContent.includes("Load"))
  .click();
 await tick();

 // default: split off, fits -> one print table
 assert.strictEqual(
  doc("view").querySelectorAll(".pv-htable table.tbl").length,
  1,
  "one table when split-by-trie is off",
 );

 const lab = [...doc("view").querySelectorAll("label")].find((l) =>
  l.textContent.includes("split table by trie"),
 );
 lab.querySelector("input").click();

 assert.strictEqual(
  doc("view").querySelectorAll(".pv-htable table.tbl").length,
  2,
  "two branch tables when split-by-trie is on",
 );

 delete global.window;
 delete global.document;
 delete global.requestAnimationFrame;
 delete global.localStorage;
 delete global.alert;
 delete global.confirm;
});
```

Run: `node --test tests/app.test.mjs`
Expected: FAIL — no "split table by trie" label yet.

- [ ] **Step 2: Add the checkbox**

In `src/app.js` `exportBar()`, `pOpts.append(...)` currently ends with the two card image checkboxes. Change it to:

```js
 pOpts.append(
  "Cards: ",
  chk("final-position image", "showFinalBoard", true),
  chk("latest-divergence image", "showFirstDivBoard", false),
  " Table: ",
  chk("split table by trie", "showSplitTrie", false),
 );
```

- [ ] **Step 3: Rewrite `appendPrintTables`**

Replace the whole `appendPrintTables` function in `src/app.js` with:

```js
// Print/PDF horizontal tables. When "split table by trie" is on, every
// top-level trie branch is its own table. When off (default): one table when
// it fits, otherwise split by trie branch, cutting at real forks (shared
// continuations stay together) and falling back to row-chunks only when a
// branch has no sub-fork.
function appendPrintTables(box, g) {
 const wrap = el("div", { className: "pv-htable" });
 wrap.appendChild(el("h3", { textContent: "Table" }));
 const mainV = g.vars[0]; // mainline sorts first
 const others = g.vars.slice(1);
 const size = 15; // mainline + 15 = 16 columns per slice
 if (!mainV) {
  box.appendChild(wrap);
  return;
 }
 const trie = buildTrie(others, mainV);
 const split = current.showSplitTrie === true;
 if (!split && others.length <= size) {
  renderTable(wrap, g, "horizontal");
 } else {
  trie.children.forEach((c) => printBranch(wrap, c, g, mainV, size));
 }
 box.appendChild(wrap);
}

function printBranch(wrap, node, g, mainV, size) {
 const lines = leavesOf(node);
 const count = lines.length;
 wrap.appendChild(
  el("h4", {
   className: "print-group",
   textContent: `${count} lines \u00b7 ${tblPath(node)}`,
  }),
 );
 if (count <= size) {
  renderTable(wrap, { ...g, vars: [mainV, ...lines] }, "horizontal");
 } else if (node.children.size) {
  // too wide: cut at the branch's real forks, not arbitrary rows
  node.children.forEach((c) => printBranch(wrap, c, g, mainV, size));
 } else {
  // a leaf-heavy branch with no sub-fork: row-chunk as a last resort
  for (let i = 0; i < lines.length; i += size) {
   const vars = [mainV, ...lines.slice(i, i + size)];
   renderTable(wrap, { ...g, vars }, "horizontal");
  }
 }
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: 28/28 pass.

- [ ] **Step 5: Commit**

```bash
git add src/app.js tests/app.test.mjs
git commit -m "feat: print split-by-trie checkbox; wide tables cut at trie forks not row counts"
```

---

### Task 4: Final verification

- [ ] **Step 1: Full suite**

Run: `npm test` — green.

- [ ] **Step 2: Manual smoke (user-verifiable — no browser in this environment)**

Serve (`python3 -m http.server`), load a multi-variation PGN, then:

1. Editor grouped view: lone-line groups are collapsed `<details>`; expand reveals editor + board; Expand all / Collapse all work; mainline editor always visible.
2. Table: mainline column always visible on the left; branches collapsed; expand shows each branch's slice; Expand all works; both orientations.
3. Print preview: split-by-trie checkbox off → one table when small; on → per-branch tables; a >15-line notebook splits at forks.

- [ ] **Step 3: Commit any stragglers**

```bash
git add -A
git commit -m "chore: final verification" || echo "nothing to commit"
```
