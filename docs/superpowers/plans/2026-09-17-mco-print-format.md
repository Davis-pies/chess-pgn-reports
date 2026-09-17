# MCO-Style Print Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each printed table states the moves all its columns share once above it, can lay out one row per full move, and can drop its cell borders.

**Architecture:** `src/print.js` works out each packed table's stem, prints it with the Lines-card move formatter, and passes `fromPly` and `byMove` to `renderTable`. `renderTable` builds its rows from a list of ply groups, with one ply per row by default and two plies stacked as `.half` divs when `byMove` is set. Borders are a class on `.pv-htable` plus CSS.

**Tech Stack:** Vanilla ES modules. `node --test` + jsdom. `npm test`, `npm run lint`, `npm run knip`.

**Spec:** `docs/superpowers/specs/2026-09-17-mco-print-format-design.md`

## Global Constraints

- **Headers:** column header text is unchanged. The mainline keeps its label, named lines keep their names, and unnamed side lines stay blank.
- **Mainline column:** it is still repeated in every packed table, and packing is unchanged.
- **Defaults:** `printBorders` defaults to `true` (current look) and `printByMove` to `false`. Read them as `=== false` and `=== true`, because `freshState` doesn't set them.
- **Screen table:** it never passes `fromPly` or `byMove`, so its output must not change.
- **Tabs vs spaces:** follow each file as it is (`render.js` uses tabs, `print.js` spaces).

## File Structure

| File | Change |
| --- | --- |
| `src/render.js` | Export `buildCardMoves`. `td`/`moveCell` take a tag. `renderTable` gains `fromPly`, `byMove` and `tr.dataset.ply`. |
| `src/print.js` | `stemLength(vars)`, the stem element, passes the options, adds the `no-borders` class. |
| `src/export.js` | Two checkboxes in the "Table" option group. |
| `src/app.js` | Saves and restores `printBorders` and `printByMove`. |
| `style.css` | `.print-stem`, `.tbl .half`, `.no-borders` print rules. |
| `tests/print.test.mjs` | New stem, per-move and border tests. Row-count and row-index expectations updated. |
| `tests/print-invariants.test.mjs` | `rowsByPly` reads `tr.dataset.ply` and counts stem moves. |

---

### Task 1: Stem above each print table

**Files:**
- Modify: `src/render.js` (`buildCardMoves` ~445, `renderTable` row loop ~370-410)
- Modify: `src/print.js` (`appendPrintTables` ~75-106)
- Modify: `style.css` (after `.pv-htable .tbl` ~711)
- Test: `tests/print.test.mjs`, `tests/print-invariants.test.mjs`

**Interfaces:**
- Produces: `export function stemLength(vars)` in `print.js`, which returns a number of plies. `export function buildCardMoves(container, v)` in `render.js`. `renderTable` accepts `grid.fromPly` (default 0). Every data `<tr>` carries `dataset.ply`, the first ply the row covers.

- [ ] **Step 1: Write the failing tests** (append to `tests/print.test.mjs`)

```js
import { stemLength } from "../src/print.js";

test("a print table states its shared moves once, above it", () => {
  const off = installDom();
  const box = printTables(
    "1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) (2... e6 3. d4) 3. d4 *",
  );
  const stem = box.querySelector(".print-stem");
  assert.ok(stem, "a stem is printed");
  assert.strictEqual(stem.nextElementSibling.tagName, "TABLE");
  assert.match(stem.textContent, /1\. e4\s+c5\s+2\. Nf3/);
  const first = box.querySelectorAll("table.tbl tr")[1];
  assert.strictEqual(first.dataset.ply, "3", "rows start where the lines differ");
  off();
});

test("the stem never swallows a whole line", () => {
  const off = installDom();
  // the side line 2. Nc3 ends where the mainline carries on
  const box = printTables("1. e4 e5 2. Nf3 (2. Nc3) Nc6 *");
  const cells = [...box.querySelectorAll("table.tbl td")].map((c) => c.textContent);
  assert.ok(cells.includes("Nc3"), "the short line still states its move");
  off();
});

test("stemLength caps at one short of the shortest column", () => {
  const v = (s) => ({ moves: s.split(" ").map((san, ply) => ({ san, ply })) });
  assert.strictEqual(stemLength([v("e4 e5 Nf3")]), 0, "a lone column has no stem");
  assert.strictEqual(stemLength([v("e4 e5"), v("d4 d5")]), 0);
  assert.strictEqual(stemLength([v("e4 e5 Nf3"), v("e4 e5 Nf3 Nc6")]), 2);
  assert.strictEqual(stemLength([v("e4 c5 Nf3 d6"), v("e4 c5 Nf3 Nc6")]), 3);
});

test("a mainline alone prints no stem and starts at move one", () => {
  const off = installDom();
  const box = printTables("1. e4 e5 2. Nf3 *");
  assert.strictEqual(box.querySelector(".print-stem"), null);
  assert.strictEqual(box.querySelectorAll("table.tbl tr")[1].dataset.ply, "0");
  off();
});

test("a note on a stem move keeps its marker in the stem", () => {
  const off = installDom();
  const s = loadState("1. e4 c5 2. Nf3 d6 (2... Nc6) *");
  s.lines.forEach((l) => (l.comments = [{ ply: 2, text: "develops" }]));
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  assert.ok(box.querySelector(".print-stem sup"), "the stem carries the marker");
  off();
});

test("the stem leaves the column headers as they were", () => {
  const off = installDom();
  const box = printTables("1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 *");
  const head = [...box.querySelectorAll("table.tbl tr")[0].children].map(
    (th) => th.textContent,
  );
  assert.deepStrictEqual(head, ["ply", "Mainline", ""]);
  off();
});
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `node --test tests/print.test.mjs`
Expected: FAIL. `stemLength` is not exported, and there is no `.print-stem` or `dataset.ply`.

- [ ] **Step 3: Implement**

In `src/render.js`, change `function buildCardMoves(container, v)` to `export function buildCardMoves(container, v)`.

In `renderTable`, replace the per-ply loop `for (let ply = 0; ply <= maxPly; ply++) { const tr = ...` with a loop from `fromPly`:

```js
		// Print can start below a stem of moves every column shares (see
		// stemLength in print.js); the stem states them, so their rows go.
		const from = grid.fromPly || 0;
		for (let ply = from; ply <= maxPly; ply++) {
			const tr = document.createElement("tr");
			tr.dataset.ply = String(ply);
```

Leave the rest of the loop body as it is.

In `src/print.js`, import `buildCardMoves` from `./render.js`, then add:

```js
// How many leading plies every column of a printed table states identically:
// the stem MCO prints once above a table instead of down every column. Capped
// one short of the shortest column so no line is swallowed whole and left with
// nothing to say below it. A lone column is not a table of alternatives, so it
// has no stem.
export function stemLength(vars) {
  if (vars.length < 2) return 0;
  const shortest = Math.min(...vars.map((v) => v.moves.length));
  let n = 0;
  while (
    n < shortest - 1 &&
    vars.every((v) => v.moves[n].san === vars[0].moves[n].san)
  )
    n++;
  return n;
}
```

In `appendPrintTables`, inside the `forEach`, replace the `renderTable(...)` call with:

```js
    const stem = stemLength([mainV, ...lines]);
    if (stem) {
      const s = el("div", { className: "print-stem" });
      // the mainline's own moves, marks and note markers: every column states
      // these moves, and the rows that carried the markers are gone
      buildCardMoves(s, { ...mainV, moves: mainV.moves.slice(0, stem) });
      wrap.appendChild(s);
    }
    renderTable(wrap, { ...g, vars: pv, spans: pv.spans, maxPly, fromPly: stem });
```

In `style.css`, after the `.pv-htable .tbl` rule:

```css
/* the moves every column of a print table shares, stated once above it */
.print-stem {
  margin: 0 0 4px;
  break-after: avoid;
  page-break-after: avoid;
}
```

- [ ] **Step 4: Update the existing expectations the stem changes**

Run: `node --test tests/print.test.mjs tests/print-invariants.test.mjs` and fix each failure in the way given here. Don't loosen any assertion beyond that.
- `the first print table runs the mainline out`: first table `16` becomes `15` (the stem is `e4`).
- `opens every group`: `col(2)` becomes `["c5", "Nf3", "Nc6", "Bb5"]` and `col(3)` becomes `["", "", "", "a4"]`.
- `a group draws a rule`: `rows.indexOf(row)` changes from `4` to `3`.
- `groups nested inside a group`: the mainline's branch rule sat on the `e4` row, which is now in the stem, so `ends` and `marked.length` go from `3` to `2`. Update the messages to match.
- In `tests/print-invariants.test.mjs`, `rowsByPly` must key rows by `Number(tr.dataset.ply)` instead of their index. Also, in the missing-move test, a move counts as printed when some table's `.print-stem` sibling (`table.previousElementSibling`) has `textContent` that includes the move's SAN and `m.ply` is below that table's first `dataset.ply`:

```js
function stemsOf(box) {
  return [...box.querySelectorAll("table.tbl")].map((t) => {
    const prev = t.previousElementSibling;
    const from = Number(t.querySelectorAll("tr")[1]?.dataset.ply || 0);
    return prev?.classList.contains("print-stem")
      ? { from, text: prev.textContent }
      : { from: 0, text: "" };
  });
}
```

and the assertion becomes:

```js
      assert.ok(
        byPly.some((t) => t.get(m.ply)?.has(m.san)) ||
          stems.some((s) => m.ply < s.from && s.text.includes(m.san)),
        `${m.san} at ply ${m.ply} is printed nowhere`,
      );
```

with `const stems = stemsOf(box);` next to `byPly`.

- [ ] **Step 5: Run the full suite and lint**

Run: `npm test && npm run lint && npm run knip`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/render.js src/print.js style.css tests/print.test.mjs tests/print-invariants.test.mjs
git commit -m "State the moves a print table's columns share once, above it"
```

---

### Task 2: One row per move

**Files:**
- Modify: `src/render.js` (`td` ~172, `moveCell` ~192, `renderTable` row loop)
- Modify: `src/print.js` (the `renderTable` call)
- Modify: `src/export.js:136` (the "Table" group)
- Modify: `style.css` (next to `.print-stem`)
- Test: `tests/print.test.mjs`

**Interfaces:**
- Consumes: `grid.fromPly` and `tr.dataset.ply` from Task 1.
- Produces: `renderTable` accepts `grid.byMove`. With it set, each data row covers plies `[2n, 2n+1]` and each data `<td>` holds two `div.half` elements, one per ply. `getCurrent().printByMove` is the option key.

- [ ] **Step 1: Write the failing tests**

```js
import { getCurrent } from "../src/state.js";

test("one row per move stacks White's and Black's moves in a cell", () => {
  const off = installDom();
  const s = loadState("1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 cxd4 *");
  s.printByMove = true;
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  const rows = [...box.querySelectorAll("table.tbl tr")].slice(1);
  // stem 1. e4 c5 2. Nf3 (plies 0-2); the rows cover plies 3..5, which are
  // moves 2 (Black half only) and 3
  assert.deepStrictEqual(rows.map((r) => r.children[0].textContent), ["2.", "3."]);
  const main = rows.map((r) => [...r.children[1].querySelectorAll(".half")].map((h) => h.textContent));
  assert.deepStrictEqual(main, [["", "d6"], ["d4", "cxd4"]]);
  off();
});

test("rows stay per ply unless the option is on", () => {
  const off = installDom();
  const box = printTables("1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 cxd4 *");
  assert.strictEqual(box.querySelectorAll(".half").length, 0);
  off();
});
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `node --test tests/print.test.mjs`
Expected: FAIL, because no `.half` elements are rendered.

- [ ] **Step 3: Implement**

In `src/render.js`, give `td` and `moveCell` a tag parameter:

```js
function td(text, cls, tag = "td") {
	const e = document.createElement(tag);
```

```js
function moveCell(c, ply, noteByPly, tag = "td") {
	const e = td(c ? c.text : "", c ? c.cls : "", tag);
```

In `renderTable`, replace the whole Task 1 row loop (`for (let ply = from; ...) { ... }`) with:

```js
		// Print can start below a stem of moves every column shares (see
		// stemLength in print.js); the stem states them, so their rows go.
		const from = grid.fromPly || 0;
		// One ply at a time, or (print's "one row per move") a full move whose
		// two plies stack in each cell, White's over Black's. A ply outside the
		// table's range still takes its half, so the halves line up across a row.
		const rows = [];
		if (grid.byMove)
			for (let n = Math.floor(from / 2); 2 * n <= maxPly; n++)
				rows.push([2 * n, 2 * n + 1]);
		else for (let ply = from; ply <= maxPly; ply++) rows.push([ply]);
		const cellAt = (i, ply, tag) => {
			const v = vars[i];
			const shown = ply >= from && ply <= maxPly;
			const rule = shown && ruleAt.get(ply + ":" + i);
			// The rule replaces whatever the cell would have said, which at this
			// ply is only an ellipsis: the line has no move here, and the rule
			// says what the ellipsis was failing to.
			const c = moveCell(
				rule || !shown ? null : v.cells[ply],
				ply,
				v.noteByPly,
				tag,
			);
			if (rule) {
				// The marks hang off a span INSIDE the cell, never off the cell
				// itself. A positioned <td> breaks border-collapse rendering in
				// the print engine and the walls come out missing -- the same
				// fault the sticky reference columns have, which print.css
				// already works around by making them static.
				c.className += " grp-rule";
				const m = document.createElement("span");
				m.className = "gm gm-" + rule;
				c.appendChild(m);
			}
			return c;
		};
		for (const plies of rows) {
			const ply = plies[0];
			const tr = document.createElement("tr");
			tr.dataset.ply = String(ply);
			const num = document.createElement("th");
			num.className = "ply-col sticky-col";
			if (labels[ply]) num.textContent = labels[ply];
			tr.appendChild(num);
			for (let i = 0; i < vars.length; i++) {
				const v = vars[i];
				let c;
				if (plies.length === 1) {
					c = cellAt(i, ply, "td");
					cellTrace(c, v, ply);
					wireTrace(c, v);
					// only where the column actually has a move at this ply
					if (v.cells[ply]) wireMenu(c, v, ply);
				} else {
					// print only: no trace or menu to wire
					c = document.createElement("td");
					plies.forEach((p) => {
						const h = cellAt(i, p, "div");
						h.classList.add("half");
						c.appendChild(h);
					});
				}
				c.className += groupClass(v);
				if (v === vars[0]) c.classList.add("main-col", "sticky-col");
				tr.appendChild(c);
			}
			table.appendChild(tr);
		}
```

When the rows are grouped by move, `labels[ply]` for an even ply is the move number (`"2."`).

In `src/print.js`, add `byMove: getCurrent().printByMove === true` to the `renderTable` grid object.

In `src/export.js`, change the "Table" group to:

```js
    group("Table", [
      ["include in print", "printTables", true],
      ["one row per move", "printByMove", false],
    ]),
```

In `style.css`, after `.print-stem`:

```css
/* one row per move: White's ply over Black's in each cell. An empty half
   keeps its line so the two halves stay level across the row. */
.tbl .half {
  min-height: 1.3em;
}
```

- [ ] **Step 4: Run the tests and check that they pass**

Run: `npm test && npm run lint && npm run knip`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/render.js src/print.js src/export.js style.css tests/print.test.mjs
git commit -m "Offer one row per move in the printed table"
```

---

### Task 3: Cell borders option, and saving both options

**Files:**
- Modify: `src/print.js` (the wrapper `className`)
- Modify: `src/export.js` (the "Table" group)
- Modify: `src/app.js:236-245` (`workbookState`) and `src/app.js:~478` (restore)
- Modify: `style.css` (the `@media print` block)
- Test: `tests/print.test.mjs`

**Interfaces:**
- Consumes: `printByMove` from Task 2.
- Produces: `getCurrent().printBorders`. When it is `false`, `.pv-htable` gets the `no-borders` class.

- [ ] **Step 1: Write the failing test**

```js
test("cell borders can be left off the printed table", () => {
  const off = installDom();
  const s = loadState("1. e4 c5 2. Nf3 (2. c3) *");
  let box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  assert.ok(!box.querySelector(".pv-htable.no-borders"), "on by default");
  s.printBorders = false;
  box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  assert.ok(box.querySelector(".pv-htable.no-borders"));
  off();
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `node --test tests/print.test.mjs`
Expected: FAIL on the second assertion.

- [ ] **Step 3: Implement**

In `src/print.js`, change the wrapper:

```js
  const wrap = el("div", {
    className:
      "pv-htable" +
      (getCurrent().printTables === false ? " noprint" : "") +
      (getCurrent().printBorders === false ? " no-borders" : ""),
  });
```

In `src/export.js`, add `["cell borders", "printBorders", true],` to the "Table" group, between "include in print" and "one row per move".

In `src/app.js` `workbookState().view`, add `printBorders: c.printBorders,` and `printByMove: c.printByMove,` after `printTables`. In the restore call, after `printTables: ...`, add:

```js
      printBorders: view.printBorders ?? getCurrent().printBorders,
      printByMove: view.printByMove ?? getCurrent().printByMove,
```

In `style.css`, inside `@media print`, after the `.pv-htable table.tbl` rule:

```css
  /* "cell borders" off: MCO's look, with only a rule under the headers. The
     group rules are spans of their own and stay. */
  .pv-htable.no-borders .tbl th,
  .pv-htable.no-borders .tbl td {
    border: none;
  }
  .pv-htable.no-borders .tbl tr:first-child th {
    border-bottom: 1px solid var(--text);
  }
```

- [ ] **Step 4: Run the tests and check that they pass**

Run: `npm test && npm run lint && npm run knip`
Expected: all pass. If a workbook or app test asserts the exact `view` keys, add the two new keys to its expectation.

- [ ] **Step 5: Commit**

```bash
git add src/print.js src/export.js src/app.js style.css tests/print.test.mjs
git commit -m "Let the printed table drop its cell borders, and save both table options"
```
