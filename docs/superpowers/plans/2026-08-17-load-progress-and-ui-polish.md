# Load Progress + UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an honest loading indicator for big PGN loads, move board diagrams inline with their lines (expanded-only in grouped view), and polish the toolbar/line-editor styling while cleaning dead CSS.

**Architecture:** Three independent changes in one client-side app: (1) a one-pass FEN cache in `pgn.js` kills the quadratic replay that makes loads slow, and a CSS overlay shown around the (now fast) synchronous render gives feedback; (2) the overview board grid is deleted and each line editor gets an inline end-position board, rendered only for lines whose trie ancestor groups are all open; (3) CSS-only + tiny DOM restructuring for toolbar/line-editor polish.

**Tech Stack:** Vanilla ES modules, `chess.js` (parsing), no framework. Tests: `node --test` + `jsdom`.

## Global Constraints

- No new dependencies.
- Style: tabs for indentation, single quotes, semicolons (match existing files).
- Keep both light/dark themes working; use existing CSS vars (`--main`, `--panel`, `--bg`, `--text`, `--muted`, `--line`, `--lift`).
- DOM must be built via the existing `el()` helper (app.js) / `document.createElement` (render.js). No `innerHTML` for user content.
- Every task ends with `npm test` green + a commit.

---

### Task 1: One-pass FEN cache (`fenMap`)

The quadratic hotspot: `fenAtLine()` in `app.js` calls `fenAt(l.moves, ply)` per (line, ply), which creates a fresh `Chess` and replays the whole prefix each time. Fix: a single pass per line records the FEN after every ply; `fenAtLine` then reads from that map. Same results, O(n) instead of O(n²) Chess steps, and the per-line cache survives re-renders (line objects are stable).

**Files:**

- Modify: `src/pgn.js` (add `fenMap` export next to `fenAt`)
- Modify: `src/app.js` (import `fenMap`, rewrite `fenAtLine`)
- Test: `tests/pgn.test.mjs`

**Interfaces:**

- Produces: `fenMap(moves) -> Map<ply, fen>` where `moves` is an array of `{san, ply}` (a line's moves). Reproduces `fenAt(moves, ply)` for every ply, including null-move (`--`) lines.

- [ ] **Step 1: Write the failing test**

Add to `tests/pgn.test.mjs` (add `fenMap` to the existing pgn.js import; add `import { collectLines } from "../src/tree.js";`):

```js
test("fenMap records the FEN after every ply, matching fenAt (incl. null moves)", () => {
 const { nodes } = parsePgn(
  "1. d4 d5 2. c4 e6 (2... dxc4 -- e5) 3. Nc3",
 );
 const lines = collectLines(nodes);
 assert.ok(lines.length >= 2, "mainline + variation");
 for (const l of lines) {
  const map = fenMap(l.moves);
  assert.strictEqual(map.size, l.moves.length, "one FEN per move");
  l.moves.forEach((m) =>
   assert.strictEqual(map.get(m.ply), fenAt(l.moves, m.ply)),
  );
 }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pgn.test.mjs`
Expected: FAIL — `fenMap` is not exported.

- [ ] **Step 3: Implement `fenMap`**

In `src/pgn.js`, directly after the `fenAt` function:

```js
// One-pass variant of fenAt: replay a line's moves once and record the FEN
// after each ply. Turns per-(line,ply) replays (O(n²) Chess steps) into O(n).
export function fenMap(moves) {
 const chess = new Chess();
 const map = new Map();
 for (const m of moves) {
  if (m.san === "--") chess.load(flipToMove(chess.fen()));
  else chess.move(m.san);
  map.set(m.ply, chess.fen());
 }
 return map;
}
```

- [ ] **Step 4: Wire it into app.js**

In `src/app.js`: change `import { parsePgn, fenAt } from "./pgn.js";` to `import { parsePgn, fenAt, fenMap } from "./pgn.js";` and replace the body of `fenAtLine`:

```js
function fenAtLine(l, ply) {
 let m = fenCache.get(l);
 if (!m) fenCache.set(l, (m = fenMap(l.moves)));
 return m.get(ply);
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests pass (including the existing app-flow test — `fenAtLine` behavior is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/pgn.js src/app.js tests/pgn.test.mjs
git commit -m "perf: one-pass FEN cache per line kills the quadratic shared-move replay"
```

---

### Task 2: Loading overlay

Show an overlay (spinner + "Loading…") around the slow synchronous parse+render in the Load & Tag handler and `openNotebook()`. It paints via a double-`requestAnimationFrame` await before the blocking work runs, then is removed. No chunking, no percentage — small loads flash it sub-frame, big files get real feedback.

**Files:**

- Modify: `src/app.js` (overlay helpers, wrap two handlers)
- Modify: `style.css` (overlay + spinner styles)
- Test: `tests/app.test.mjs`

**Interfaces:**

- Produces: `withLoading(fn)` — appends overlay to `document.body`, awaits two rAF frames, runs `fn()` synchronously, removes the overlay in `finally`. The `#loading` element is in the DOM synchronously when `withLoading` is called (so tests can assert it immediately after a click).

- [ ] **Step 1: Write the failing test**

In `tests/app.test.mjs`, add a `tick` helper near the top and update the existing full-flow test (the Load click now returns before rendering finishes):

```js
const tick = () => new Promise((r) => setTimeout(r, 60));
```

In the full-flow test, replace `loadBtn.click();` with:

```js
 loadBtn.click();
 assert.ok(doc("loading"), "loading overlay appears synchronously on click");
 await tick();
 assert.ok(!doc("loading"), "overlay removed after render");
```

(Keep the existing assertions that follow; they run after the `await`, when `current.lines` is set.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/app.test.mjs`
Expected: FAIL — no element with id `loading`, and the flow test hangs/errors because render happens after the synchronous assertions.

- [ ] **Step 3: Add overlay helpers to app.js**

In `src/app.js`, near the `$` helper (module scope):

```js
// Full-viewport loading feedback. Painted via double-rAF before the slow
// synchronous parse+render runs, then removed. No fake progress: after the
// fenMap fix most loads flash it sub-frame.
const paintFrame = () =>
 new Promise((r) =>
  requestAnimationFrame(() => requestAnimationFrame(() => r())),
 );
async function withLoading(fn) {
 const ov = el("div", { id: "loading", className: "loading-overlay" });
 ov.appendChild(el("div", { className: "spinner" }));
 ov.appendChild(el("span", { textContent: "Loading\u2026" }));
 document.body.appendChild(ov);
 await paintFrame();
 try {
  fn();
 } finally {
  ov.remove();
 }
}
```

- [ ] **Step 4: Wrap the two slow handlers**

In `src/app.js`, the Load & Tag handler (`go.onclick`) currently starts `go.onclick = () => { try { ... } catch (e) { alert(...) } };` — wrap the whole body:

```js
 go.onclick = () => {
  withLoading(() => {
   try {
    const { nodes } = parsePgn(ta.value);
    if (!nodes.length) {
     alert("No moves found in PGN");
     return;
    }
    openPaths.clear();
    current = {
      id: current.id,
      name: "",
      pgn: ta.value,
      lines: collectLines(nodes),
      orientation: "horizontal",
      showBoards: false,
      preview: "table",
      boardSize: current.boardSize,
      showFinalBoard: true,
      showFirstDivBoard: false,
      sideWidth: current.sideWidth,
      sel: null,
    };
    renderApp();
   } catch (e) {
    alert("Could not read PGN: " + e.message);
   }
  });
 };
```

Same for `openNotebook(id)`: wrap the entire existing body (from `const nb = loadNotebook(id);` through `renderApp();`) in `withLoading(() => { ... });` — the early `alert(...); return;` paths become `alert(...); return;` inside the closure (harmless: `finally` still removes the overlay).

- [ ] **Step 5: Add overlay CSS**

In `style.css` (before the print block):

```css
.loading-overlay {
 position: fixed;
 inset: 0;
 display: flex;
 flex-direction: column;
 gap: 14px;
 align-items: center;
 justify-content: center;
 background: color-mix(in srgb, var(--bg) 82%, transparent);
 z-index: 50;
 font-size: 0.95rem;
 color: var(--muted);
}
.spinner {
 width: 34px;
 height: 34px;
 border: 3px solid var(--line);
 border-top-color: var(--main);
 border-radius: 50%;
 animation: spin 0.8s linear infinite;
}
@keyframes spin {
 to {
  transform: rotate(360deg);
 }
}
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app.js style.css tests/app.test.mjs
git commit -m "feat: loading overlay during PGN import and workbook open"
```

---

### Task 3: Inline board diagrams (overview grid removed, expanded-only in grouped view)

Delete `renderBoardOverview` and give each line editor an inline end-position board. Flat view: every line shows one. Grouped (trie) view: a line's board renders only when every ancestor group is open — collapsed groups build no SVG DOM at all. The `<details>` toggle handler gains a re-render so boards appear/disappear with expansion. The existing "Board diagrams" checkbox becomes the master toggle (default off); the 220/300/400 size chips keep working. Cards/print view and the selected-move board in `movePanel` are untouched.

**Files:**

- Modify: `src/render.js` (delete `renderBoardOverview` + its export)
- Modify: `src/app.js` (remove overview call/import; `lineEditor(l, idx, showBoard)`; thread `allOpen` through `renderTrieNode`; toggle re-render)
- Modify: `style.css` (`.boards` / `figure.board` removal)
- Test: `tests/render.test.mjs`, `tests/app.test.mjs`

**Interfaces:**

- Consumes: `appendBoard(container, fen, size)` (render.js, unchanged).
- Produces: `lineEditor(l, idx, showBoard)` — third param bool; when true, appends a `.ledge-board` div containing the line's end-position board (`appendBoard(bw, l.fen, current.boardSize)`). `renderTrieNode(container, node, nameCounter, path, allOpen)` — `allOpen` starts `true` at the trie root.

- [ ] **Step 1: Update the render test (delete overview usage)**

In `tests/render.test.mjs`: remove `renderBoardOverview,` from the render.js import, and delete these lines from the vertical-table test:

```js
 // the board overview is a separate function, one diagram per line
 renderBoardOverview(container, grid(lines), 200);
 const boards = container.querySelectorAll("figure.board svg.board-svg");
 assert.strictEqual(boards.length, 2);
```

- [ ] **Step 2: Write the failing app test for inline boards**

In `tests/app.test.mjs`, add this test (reuses the full-flow setup pattern):

```js
test("inline boards: flat shows one per line; grouped shows only expanded groups", async () => {
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

 await import("../src/app.js");
 dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

 // module state persists between tests in this file: the full-flow test above
 // leaves lines loaded, so reset via the toolbar's New/Import button first
 const resetBtn = [...doc("view").querySelectorAll("button")].find((b) =>
  b.textContent.includes("New / Import"),
 );
 resetBtn.click();

 const textarea = doc("view").querySelector("textarea.pgnin");
 // 3 lines: mainline + 2 variations that share a divergence fork at ply 1
 textarea.value = "1. e4 e5 (1... c5 2. Nf3 Nc6) (1... e5 2. Nf3) 2. Nf3";
 [...doc("view").querySelectorAll("button")]
  .find((b) => b.textContent.includes("Load"))
  .click();
 await tick();
 // enable inline boards via the "Board diagrams" checkbox
 const label = [...doc("view").querySelectorAll("label")].find((l) =>
  l.textContent.includes("Board diagrams"),
 );
 label.querySelector("input").click();

 // grouped view is the default; the fork group starts collapsed
 assert.strictEqual(doc("view").querySelectorAll(".ledge-board").length, 1,
  "only the mainline board shows while groups are collapsed");

 // expand the fork group: its lines' boards appear
 const det = doc("view").querySelector("details.lgroup");
 det.open = true;
 det.dispatchEvent(new dom.window.Event("toggle"));
 assert.strictEqual(doc("view").querySelectorAll(".ledge-board").length, 3,
  "expanding the group builds its lines' boards");

 // flat view shows a board for every line
 [...doc("view").querySelectorAll("button")]
  .find((b) => b.textContent === "Flat")
  .click();
 assert.strictEqual(doc("view").querySelectorAll(".ledge-board").length, 3);

 delete global.window;
 delete global.document;
 delete global.requestAnimationFrame;
 delete global.localStorage;
 delete global.alert;
 delete global.confirm;
});
```

Run: `node --test tests/app.test.mjs`
Expected: FAIL — `.ledge-board` never exists yet.

- [ ] **Step 3: Delete `renderBoardOverview`**

In `src/render.js`, delete the whole `renderBoardOverview` function (the `// it lives in the main panel...` comment through its closing brace) and remove `renderBoardOverview,` from the export list.

- [ ] **Step 4: Remove the overview call from app.js**

In `src/app.js`: remove `renderBoardOverview,` from the render.js import and delete:

```js
 // board-diagram overview lives here (full width, next to its controls)
 if (current.showBoards) renderBoardOverview(main, g, current.boardSize);
```

- [ ] **Step 5: Add `showBoard` to `lineEditor`**

In `src/app.js`, change the signature to `function lineEditor(l, idx, showBoard = false)`. Replace the opening of the function (name + tags assembly) with a header wrapper:

```js
 const name = el("input", { className: "ln", value: l.name });
 name.oninput = () => {
  l.name = name.value;
 };
 // reflect the (renamed) line in the table/cards once the field is blurred
 name.onchange = () => renderApp();
 const tags = el("div", { className: "tags" });
 if (isMain) {
  tags.appendChild(
   el("span", { className: "maintag", textContent: "Mainline" }),
  );
 } else {
  tags.append(btn("sideline", "Sideline"), btn("foot", "Footnote"));
  const promote = el("button", {
   className: "chip",
   textContent: "\u2605 Make mainline",
  });
  promote.onclick = () => {
   promoteMainline(l);
  };
  tags.appendChild(promote);
 }
 const head = el("div", { className: "ledge-head" });
 head.append(name, tags);
 row.appendChild(head);
 row.appendChild(moveStrip(l));
```

Then, after the existing `note` input is appended to `row`, add the inline board:

```js
 // the line's end-position board, next to its line (inline boards toggle)
 if (showBoard) {
  const bw = el("div", { className: "ledge-board" });
  appendBoard(bw, l.fen, current.boardSize || 220);
  row.appendChild(bw);
 }
 return row;
```

(Keep the existing `movePanel` and `note` code between — order stays: head, moves, movePanel?, note, board.)

- [ ] **Step 6: Thread `allOpen` through the trie + re-render on toggle**

In `src/app.js`, replace the entire `renderTrieNode` function with:

```js
function renderTrieNode(container, node, nameCounter, path, allOpen) {
 const nextPath = path
  ? path + "  " + branchLabel(node.move)
  : branchLabel(node.move);
 const boards = current.showBoards; // inline-boards master toggle
 // a lone line (leaf, no fork): a non-collapsible block; header shows the
 // full shared path up to this move
 if (!node.children.size && node.leaf) {
  const box = el("div", { className: "lgroup open" });
  box.appendChild(
   el("div", {
    className: "lg-head",
    textContent: `${nextPath} \u00b7 1 line`,
   }),
  );
  const body = el("div", { className: "lgroup-body" });
  body.appendChild(
   lineEditor(node.leaf, nameCounter.n++, allOpen && boards),
  );
  box.appendChild(body);
  container.appendChild(box);
  return;
 }
 // single-child chain: inline it, accumulating the path so a long shared
 // continuation shows as one compressed header, not nested single groups
 if (!node.leaf && node.children.size === 1) {
  node.children.forEach((c) =>
   renderTrieNode(container, c, nameCounter, nextPath, allOpen),
  );
  return;
 }
 // a fork: a collapsible group, all closed by default; header shows the full
 // shared path up to the fork
 const det = el("details", { className: "lgroup" });
 det.open = openPaths.has(node.key);
 det.addEventListener("toggle", () => {
  if (det.open) openPaths.add(node.key);
  else openPaths.delete(node.key);
  renderApp(); // boards appear/disappear with expansion
  // ponytail: whole-app re-render; if toggling feels slow on huge files,
  // scope the rebuild to the markup panel only
 });
 const count = countLeaves(node);
 det.appendChild(
  el("summary", {
   className: "lg-head",
   textContent: `${nextPath} \u00b7 ${count} lines`,
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

- [ ] **Step 7: Update the `markupPanel` call sites**

In `src/app.js` `markupPanel()`:

```js
 box.appendChild(lineEditor(main, 0, current.showBoards));
```

and the flat branch:

```js
 if (current.groupView === "flat") {
  current.lines.forEach((l) => {
   if (!l.isMain)
    box.appendChild(lineEditor(l, counter.n++, current.showBoards));
  });
 } else {
  trie.children.forEach((c) => renderTrieNode(box, c, counter, "", true));
 }
```

- [ ] **Step 8: Remove overview CSS**

In `style.css`, delete the whole `.boards { ... }`, `figure.board { ... }`, and `figure.board .board-svg { ... }` blocks (keep `.board-svg` and `.card-board .board-svg`, which the cards view uses).

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/render.js src/app.js style.css tests/render.test.mjs tests/app.test.mjs
git commit -m "feat: board diagrams inline with their line; grouped view renders boards only in expanded groups"
```

---

### Task 4: Paint — toolbar buttons, line-editor card, dead-code cleanup

**Files:**

- Modify: `src/app.js` (Save button gets `primary` class; dedupe doubled comment)
- Modify: `style.css` (`.chip.primary`, `.ledge` card + `.ledge-head`/`.ledge-board`, remove dead rules + duplicate `@media` block)

- [ ] **Step 1: Style the Save button as primary**

In `src/app.js`, change the Save button to `el("button", { className: "chip primary", textContent: "Save" })`.

Also delete the duplicated comment — remove the second of these two consecutive lines (keep one):

```js
// Explicit move reference for a note, e.g. "7.Nbd2" / "7...Nbd7" (number + SAN).
```

- [ ] **Step 2: Add the primary button + line-editor card CSS**

In `style.css`:

```css
.chip.primary {
 background: var(--main);
 border-color: var(--main);
 color: #fff;
 font-weight: 600;
}
```

Replace the `.ledge` rule with the card layout (plus the two new helpers; the `.hidden` rule below it stays):

```css
.ledge {
 display: flex;
 flex-wrap: wrap;
 gap: 8px;
 align-items: center;
 padding: 10px 12px;
 margin: 8px 0;
 border: 1px solid var(--line);
 border-radius: 10px;
 background: var(--panel);
}
.ledge-head {
 display: flex;
 flex: 1 1 100%;
 gap: 8px;
 align-items: center;
}
.ledge-board {
 flex: 1 1 100%;
 display: flex;
 justify-content: center;
}
```

- [ ] **Step 3: Remove dead CSS**

In `style.css`, delete exactly these rules (verified unused — `current.preview` in app.js is a data field, not a class):

- `.addbar { ... }`
- `.symbols, .sympick { ... }` → rewrite as `.sympick { display: inline-flex; gap: 4px; flex-wrap: wrap; align-items: center; margin: 4px 0; }` (the existing `.sympick { margin: 0; }` override below stays)
- `.lmoves { ... }`
- `.le { ... }`
- `.preview { ... }`
- The second (duplicate) `@media (max-width: 1000px) { ... }` block — the pair of identical blocks near the top; keep the first, delete the second.

- [ ] **Step 4: Run the full suite + manual check**

Run: `npm test` — all pass (DOM classes used by tests — `.ledge`, `.ledge-head` wrapper — are intact).

Manual (serve via `python3 -m http.server`, open `http://localhost:8000`):

- Import a PGN → Save/New-Import buttons are styled; line editors read as cards with name+tags on top, moves + note grouped inside.
- Both themes look consistent.

- [ ] **Step 5: Commit**

```bash
git add src/app.js style.css
git commit -m "style: primary save button, line-editor cards, drop dead CSS"
```

---

### Task 5: Final verification

- [ ] **Step 1: Full suite**

Run: `npm test` — green.

- [ ] **Step 2: Manual smoke test**

Serve and verify, with a many-variation PGN:

1. Load & Tag → overlay appears only if render is slow; UI renders correctly either way.
2. Board diagrams checkbox on → flat view shows one board per line; grouped view shows none inside collapsed groups, boards appear on expand.
3. Toolbar buttons styled; line editors cohesive in both themes; print/cards view unchanged.

- [ ] **Step 3: Commit any stragglers**

```bash
git add -A
git commit -m "chore: final verification" || echo "nothing to commit"
```
