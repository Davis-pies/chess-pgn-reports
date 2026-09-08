# Analysis Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Analysis mode — an interactive board with its own scratch tree that you can explore freely, and one write operation that commits a scratch line into the notebook as a new sideline.

**Architecture:** The scratch is a parallel array of line objects in exactly the shape `current.lines` uses, so one data shape runs end to end and committing is an array push plus a PGN regeneration. All tree behaviour comes from a single rule in `play(san)`: replay-if-same, append-if-at-end, otherwise fork a sibling that copies the shared prefix. Nothing edits an existing line's moves.

**Tech Stack:** Vanilla ES modules, no build step. `chess.js` for legality and SAN. `node --test` + `jsdom` for tests. SVG boards from the existing `render.js`.

**Spec:** `docs/superpowers/specs/2026-09-07-analysis-board-design.md`

## Global Constraints

- **Plies are 0-based.** `parseSeq` starts at `ply: 0`, so within a line a move's `ply` equals its index in `moves`. The scratch cursor is named `at` (moves played so far) and is never called `ply`.
- **A line is a root-to-leaf path.** Every scratch line carries its moves from move 1. No mid-game FEN setup — a rootless line breaks `divergence()` and the table's cell maths.
- **The scratch is session-only.** `store.js` must never persist the scratch or the mode flag. A saved workbook carries neither key.
- **Commit is two writes.** Push the line onto `current.lines`, then `getCurrent().pgn = buildPgn(getCurrent())`. A workbook is `pgn` + tags-keyed-by-move; a line missing from the PGN does not survive a reload.
- **Committed lines are never `isMain`.** They land as `tag: "sideline"`, promoted afterwards with the existing ★.
- **No `?t=` cache-busting** on `src/app.js` imports in tests — it splits V8's coverage attribution and hides most of that file's real coverage. Boot once per test file with `bootApp()` and use `reset()` between scenarios.
- **Printed output must not change.** `render.js` gains attributes only; no change to geometry, fills, or element order.
- **Style:** tabs for indent in `src/*.js`, double quotes, existing comment voice (explain *why*, not *what*). Run `npm run lint` before every commit.

---

### Task 1: Align the chess.js the browser loads with the one the tests run

`index.html` pins `chess.js@1.0.0` through the esm.sh importmap while `package.json` declares `^1.4.0` and `node_modules` has 1.4.0. Tests and the deployed site therefore run different versions. Survivable for SAN parsing; not for an interactive board, which leans on `moves({ square, verbose })` and promotion handling.

**Files:**
- Modify: `index.html:11`
- Test: `tests/deps.test.mjs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. A standing guard that the two versions agree.

- [ ] **Step 1: Write the failing test**

```js
// tests/deps.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

// The browser resolves "chess.js" through index.html's importmap; the tests
// resolve it through node_modules. Nothing makes those agree on its own, and
// they silently drifted a full minor version apart -- so assert it here.
test("index.html pins the chess.js version the tests run", () => {
	const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
	const pinned = html.match(/esm\.sh\/chess\.js@([\d.]+)/);
	assert.ok(pinned, "index.html has no esm.sh chess.js pin");
	const installed = JSON.parse(
		readFileSync(
			new URL("../node_modules/chess.js/package.json", import.meta.url),
			"utf8",
		),
	).version;
	assert.strictEqual(pinned[1], installed);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/deps.test.mjs`
Expected: FAIL — `Expected values to be strictly equal: '1.0.0' !== '1.4.0'`

- [ ] **Step 3: Write minimal implementation**

In `index.html`, change the importmap entry:

```html
          "chess.js": "https://esm.sh/chess.js@1.4.0"
```

- [ ] **Step 4: Run the whole suite**

Run: `node --test tests/deps.test.mjs && npm test`
Expected: PASS. The full suite must stay green — this is a real version bump for the browser, and nothing else should move.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/deps.test.mjs
git commit -m "Load the same chess.js in the browser that the tests run"
```

---

### Task 2: The scratch model

Pure, no DOM. This is where the whole tree behaviour lives.

**Files:**
- Create: `src/analysis.js`
- Test: `tests/analysis.test.mjs` (create)

**Interfaces:**
- Consumes: `Chess` from `chess.js`; `defaultLineName` from `src/tree.js`.
- Produces:
  - `newScratch(moves = []) -> scratch` — `{ lines: [{moves}], active: 0, at: moves.length, flipped: false }`
  - `activeLine(s) -> {moves}`
  - `playedMoves(s) -> [{san, ply}]` — the active line up to the cursor
  - `fenOf(s) -> string`
  - `sanFor(s, from, to, promotion) -> string | null`
  - `play(s, san) -> s` (mutates)
  - `back(s) -> s`, `forward(s) -> s`, `goTo(s, at) -> s`, `select(s, idx) -> s`
  - `toLine(scratchLine, idx) -> line` — the committable line object

- [ ] **Step 1: Write the failing test**

```js
// tests/analysis.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import {
	newScratch,
	activeLine,
	playedMoves,
	fenOf,
	sanFor,
	play,
	back,
	forward,
	goTo,
	select,
	toLine,
} from "../src/analysis.js";

const sans = (s) => activeLine(s).moves.map((m) => m.san);

test("a new scratch holds one empty line with the cursor at the start", () => {
	const s = newScratch();
	assert.deepStrictEqual(s.lines, [{ moves: [] }]);
	assert.strictEqual(s.active, 0);
	assert.strictEqual(s.at, 0);
});

test("seeding from moves puts the cursor at the end of them", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	assert.deepStrictEqual(sans(s), ["e4", "e5"]);
	assert.strictEqual(s.at, 2);
	// ply is the index, so a seeded line is renumbered from 0 regardless of
	// what the source line's plies were
	assert.deepStrictEqual(
		activeLine(s).moves.map((m) => m.ply),
		[0, 1],
	);
});

test("playing at the end appends", () => {
	const s = newScratch([{ san: "e4" }]);
	play(s, "e5");
	assert.deepStrictEqual(sans(s), ["e4", "e5"]);
	assert.strictEqual(s.at, 2);
	assert.strictEqual(s.lines.length, 1);
});

test("replaying a move already held just advances the cursor", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 0);
	play(s, "e4");
	assert.strictEqual(s.at, 1);
	assert.strictEqual(s.lines.length, 1, "no fork for a move already there");
	assert.deepStrictEqual(sans(s), ["e4", "e5"], "the tail is untouched");
});

test("diverging mid-line forks a sibling and keeps the abandoned tail", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }, { san: "Nf3" }]);
	goTo(s, 1);
	play(s, "c5");
	assert.strictEqual(s.lines.length, 2);
	assert.strictEqual(s.active, 1);
	assert.deepStrictEqual(sans(s), ["e4", "c5"]);
	assert.strictEqual(s.at, 2);
	// the original line still has everything it had
	assert.deepStrictEqual(
		s.lines[0].moves.map((m) => m.san),
		["e4", "e5", "Nf3"],
	);
});

test("a fork copies the prefix rather than sharing it", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5");
	assert.notStrictEqual(s.lines[0].moves[0], s.lines[1].moves[0]);
	play(s, "Nf3");
	assert.deepStrictEqual(
		s.lines[0].moves.map((m) => m.san),
		["e4", "e5"],
		"appending to the fork must not reach the original",
	);
});

test("the cursor stops at both ends", () => {
	const s = newScratch([{ san: "e4" }]);
	forward(s);
	forward(s);
	assert.strictEqual(s.at, 1);
	back(s);
	back(s);
	assert.strictEqual(s.at, 0);
	goTo(s, 99);
	assert.strictEqual(s.at, 1);
	goTo(s, -5);
	assert.strictEqual(s.at, 0);
});

test("selecting a line moves the cursor to its end", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5");
	select(s, 0);
	assert.strictEqual(s.active, 0);
	assert.strictEqual(s.at, 2);
});

test("fen and played moves follow the cursor, not the whole line", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	assert.deepStrictEqual(
		playedMoves(s).map((m) => m.san),
		["e4"],
	);
	assert.ok(fenOf(s).startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR"));
});

test("sanFor turns a from/to pair into SAN, and rejects an illegal one", () => {
	const s = newScratch();
	assert.strictEqual(sanFor(s, "e2", "e4"), "e4");
	assert.strictEqual(sanFor(s, "e2", "e5"), null);
});

test("sanFor handles promotion", () => {
	const s = newScratch();
	// ...Na6 clears b8 legally; Qb8 would be its own knight's square
	["e4", "d5", "exd5", "c6", "dxc6", "Qd6", "cxb7", "Na6"].forEach((m) =>
		play(s, m),
	);
	assert.strictEqual(sanFor(s, "b7", "a8", "q"), "bxa8=Q");
	assert.strictEqual(sanFor(s, "b7", "a8", "n"), "bxa8=N");
});

test("toLine produces the shape collectLines emits", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	const l = toLine(activeLine(s), 3);
	assert.deepStrictEqual(l.moves, [
		{ san: "e4", ply: 0 },
		{ san: "e5", ply: 1 },
	]);
	assert.deepStrictEqual(l.marks, {});
	assert.deepStrictEqual(l.comments, []);
	assert.deepStrictEqual(l.meta, {});
	assert.strictEqual(l.tag, "sideline");
	assert.strictEqual(l.name, "Line 3");
	assert.strictEqual(l.ply, 1);
	assert.ok(l.fen.includes(" w "), "black moved last, so white is to move next");
	assert.ok(l.fen.startsWith("rnbqkbnr/pppp1ppp"));
	assert.strictEqual(l.isMain, undefined, "a committed line is never the mainline");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/analysis.test.mjs`
Expected: FAIL — `Cannot find module '.../src/analysis.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/analysis.js
// The Analysis mode scratch: a parallel array of line objects in exactly the
// shape current.lines uses, so committing one is an array push rather than a
// translation. Nothing here touches the notebook.
//
// Plies are 0-based (see parseSeq), so within a line a move's ply IS its index.
// The cursor is called `at` -- the number of moves played, and the ply of the
// next one -- so it is never confused with a move's own ply field.

import { Chess } from "chess.js";
import { defaultLineName } from "./tree.js";

export function newScratch(moves = []) {
	// Renumber from 0: a scratch line seeded from the middle of a notebook line
	// is still a root-to-leaf path in its own right, and its plies have to be
	// its own indices for toLine's output to match collectLines'.
	return {
		lines: [{ moves: moves.map((m, i) => ({ san: m.san, ply: i })) }],
		active: 0,
		at: moves.length,
		flipped: false,
	};
}

export function activeLine(s) {
	return s.lines[s.active];
}

export function playedMoves(s) {
	return activeLine(s).moves.slice(0, s.at);
}

function replay(moves) {
	const chess = new Chess();
	for (const m of moves) chess.move(m.san);
	return chess;
}

export function fenOf(s) {
	return replay(playedMoves(s)).fen();
}

// A from/to pair (plus a promotion piece) as SAN, or null if that is not a
// legal move here. chess.js throws on an illegal move rather than returning
// null, and a board click on an empty square is an ordinary thing to do -- so
// the throw is caught rather than propagated.
export function sanFor(s, from, to, promotion) {
	const chess = replay(playedMoves(s));
	try {
		const mv = chess.move(promotion ? { from, to, promotion } : { from, to });
		return mv ? mv.san : null;
	} catch {
		return null;
	}
}

// The one rule the whole tree comes from.
export function play(s, san) {
	const line = activeLine(s);
	const next = line.moves[s.at];
	// walking forward through a line already held
	if (next && next.san === san) {
		s.at++;
		return s;
	}
	// at the end: extend it
	if (s.at === line.moves.length) {
		line.moves.push({ san, ply: s.at });
		s.at++;
		return s;
	}
	// diverging mid-line: fork a sibling rather than discarding the tail, which
	// is what makes several lines at once possible without a tree structure.
	// The prefix is COPIED move by move -- sharing the objects would make an
	// annotation on one branch appear on the other.
	const moves = line.moves
		.slice(0, s.at)
		.map((m) => ({ san: m.san, ply: m.ply }));
	moves.push({ san, ply: s.at });
	s.lines.push({ moves });
	s.active = s.lines.length - 1;
	s.at = moves.length;
	return s;
}

export function back(s) {
	if (s.at > 0) s.at--;
	return s;
}

export function forward(s) {
	if (s.at < activeLine(s).moves.length) s.at++;
	return s;
}

export function goTo(s, at) {
	s.at = Math.max(0, Math.min(at, activeLine(s).moves.length));
	return s;
}

export function select(s, idx) {
	if (!s.lines[idx]) return s;
	s.active = idx;
	s.at = s.lines[idx].moves.length;
	return s;
}

// A scratch line as a notebook line. `idx` is the index it will occupy in
// current.lines after the push, which is what names an unnamed line.
export function toLine(scratchLine, idx) {
	const moves = scratchLine.moves.map((m) => ({ san: m.san, ply: m.ply }));
	const last = moves[moves.length - 1];
	return {
		moves,
		marks: {},
		comments: [],
		meta: {},
		fen: replay(moves).fen(),
		ply: last ? last.ply : 0,
		tag: "sideline",
		name: defaultLineName(false, idx),
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/analysis.test.mjs && npm run lint`
Expected: PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/analysis.js tests/analysis.test.mjs
git commit -m "Add the analysis scratch, where diverging forks instead of discarding"
```

---

### Task 3: Name the squares on the board SVG

`board-input.js` needs to know which square a click landed on. Adding `data-sq` to the elements `boardSvg` already draws is the whole change — no geometry, no fills, no element order, so printed output is untouched.

**Files:**
- Modify: `src/render.js:70-112` (inside `boardSvg`'s square loop)
- Test: `tests/render.test.mjs` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: every `<rect>`, `<use>` and `<text>` in a `boardSvg` carries `data-sq` with its algebraic square name (`"a8"` top-left through `"h1"` bottom-right).

- [ ] **Step 1: Write the failing test**

```js
// append to tests/render.test.mjs
test("board squares carry their algebraic names", () => {
	const done = installDom();
	const svg = boardSvg(START_FEN, 320);
	const rects = [...svg.querySelectorAll("rect")];
	assert.strictEqual(rects.length, 64);
	assert.strictEqual(rects[0].getAttribute("data-sq"), "a8");
	assert.strictEqual(rects[7].getAttribute("data-sq"), "h8");
	assert.strictEqual(rects[63].getAttribute("data-sq"), "h1");
	// a piece is addressable by its square too, so a click that lands on the
	// piece rather than the square behind it still resolves
	const e1 = [...svg.querySelectorAll("use")].find(
		(u) => u.getAttribute("data-sq") === "e1",
	);
	assert.ok(e1, "the white king's <use> is tagged e1");
	done();
});
```

`render.js` keeps `START_FEN` private, so declare the literal at the top of the test file:

```js
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/render.test.mjs`
Expected: FAIL — `null !== 'a8'`

- [ ] **Step 3: Write minimal implementation**

In `src/render.js`, inside `boardSvg`'s `for (let r...) for (let f...)` loop, compute the name once and stamp it on each element as it is created:

```js
			const name = FILES[f] + (8 - r);
```

Place that line immediately after `const light = (r + f) % 2 === 0;`, then add to each of the three elements built in the loop, right before its `svg.appendChild(...)`:

```js
			rect.setAttribute("data-sq", name);
```
```js
				u.setAttribute("data-sq", name);
```
```js
				coord.setAttribute("data-sq", name);
```

Add a comment above `const name`:

```js
			// Square names are stamped on every element in the square, not just
			// the rect: a click can land on a piece or on a rank/file coordinate
			// drawn over it, and all three should resolve to the same square.
			// Attributes only -- geometry and paint are unchanged, so the printed
			// board is byte-for-byte what it was.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/render.test.mjs tests/print.test.mjs tests/print-invariants.test.mjs && npm run lint`
Expected: PASS. The print tests are included deliberately — they are the guard that this changed nothing visible.

- [ ] **Step 5: Commit**

```bash
git add src/render.js tests/render.test.mjs
git commit -m "Name every square on a board SVG so a click can resolve one"
```

---

### Task 4: The interactive board

**Files:**
- Create: `src/board-input.js`
- Test: `tests/board-input.test.mjs` (create)

**Interfaces:**
- Consumes: `boardSvg` from `src/render.js`; `Chess` from `chess.js`.
- Produces: `interactiveBoard(fen, onMove, opts) -> HTMLElement` where `onMove(san)` fires on a completed legal move, and `opts` is `{ size = 320, flipped = false }`. The returned element is a `div.an-board` containing the SVG. Selection marks the source square `.sel` and every legal target `.target`.

Interaction model, so both a drag and a click-click work from the same two handlers: **mousedown** on a square either completes a pending move (if one is selected and this square is a legal target) or picks that square; **mouseup** on a square completes a pending move if the square differs from the source. Promotion is Task 5 — for now a promoting move is played as a queen.

- [ ] **Step 1: Write the failing test**

```js
// tests/board-input.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { installDom } from "./helpers.mjs";
import { interactiveBoard } from "../src/board-input.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Fire a real event so the handler sees the same shape the browser sends.
function on(board, sq, type) {
	const node = board.querySelector(`rect[data-sq="${sq}"]`);
	assert.ok(node, `no square ${sq}`);
	node.dispatchEvent(
		new window.MouseEvent(type, { bubbles: true, cancelable: true }),
	);
}
const marked = (board, cls) =>
	[...board.querySelectorAll(`rect.${cls}`)].map((n) => n.getAttribute("data-sq")).sort();

test("picking a piece marks it and its legal targets", () => {
	const done = installDom();
	const board = interactiveBoard(START, () => {});
	on(board, "e2", "mousedown");
	assert.deepStrictEqual(marked(board, "sel"), ["e2"]);
	assert.deepStrictEqual(marked(board, "target"), ["e3", "e4"]);
	done();
});

test("picking an empty square selects nothing", () => {
	const done = installDom();
	const board = interactiveBoard(START, () => {});
	on(board, "e5", "mousedown");
	assert.deepStrictEqual(marked(board, "sel"), []);
	assert.deepStrictEqual(marked(board, "target"), []);
	done();
});

test("a drag from source to target emits the move as SAN", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(START, (san) => seen.push(san));
	on(board, "e2", "mousedown");
	on(board, "e4", "mouseup");
	assert.deepStrictEqual(seen, ["e4"]);
	assert.deepStrictEqual(marked(board, "sel"), [], "selection clears after a move");
	done();
});

test("click-click emits the same move as a drag", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(START, (san) => seen.push(san));
	on(board, "g1", "mousedown");
	on(board, "g1", "mouseup"); // released on the source: still selected
	assert.deepStrictEqual(marked(board, "sel"), ["g1"]);
	on(board, "f3", "mousedown");
	assert.deepStrictEqual(seen, ["Nf3"]);
	done();
});

test("releasing on an illegal square emits nothing and clears the selection", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(START, (san) => seen.push(san));
	on(board, "e2", "mousedown");
	on(board, "e5", "mouseup");
	assert.deepStrictEqual(seen, []);
	assert.deepStrictEqual(marked(board, "sel"), []);
	done();
});

test("picking another of your own pieces switches the selection", () => {
	const done = installDom();
	const board = interactiveBoard(START, () => {});
	on(board, "e2", "mousedown");
	on(board, "d2", "mousedown");
	assert.deepStrictEqual(marked(board, "sel"), ["d2"]);
	done();
});

test("a click on a coordinate label resolves to its square", () => {
	const done = installDom();
	const board = interactiveBoard(START, () => {});
	const label = board.querySelector('text[data-sq="a2"]');
	assert.ok(label, "the a-file coordinate is drawn on a2");
	label.dispatchEvent(
		new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }),
	);
	assert.deepStrictEqual(marked(board, "sel"), ["a2"]);
	done();
});

test("flipping is view-only and does not renumber the squares", () => {
	const done = installDom();
	const board = interactiveBoard(START, () => {}, { flipped: true });
	assert.ok(board.querySelector("svg").classList.contains("flipped"));
	on(board, "e2", "mousedown");
	assert.deepStrictEqual(marked(board, "sel"), ["e2"]);
	done();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/board-input.test.mjs`
Expected: FAIL — `Cannot find module '.../src/board-input.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/board-input.js
// Behaviour attached to the board render.js already draws. boardSvg keeps
// drawing; nothing here changes what a board looks like, which is why the
// printed report is unaffected by any of it.
//
// One pair of handlers serves both gestures. A drag is mousedown on the source
// and mouseup on the target; a click-click is mousedown+mouseup on the source
// (the release lands on the source, so it is ignored and the selection stands)
// then a mousedown on the target, which finds a selection already pending and
// completes it. Neither gesture needs to know the other exists.

import { Chess } from "chess.js";
import { boardSvg } from "./render.js";

export function interactiveBoard(fen, onMove, { size = 320, flipped = false } = {}) {
	const wrap = document.createElement("div");
	wrap.className = "an-board";
	const svg = boardSvg(fen, size);
	// Flip is a CSS rotation of the drawing, so the squares keep their real
	// names and every hit test stays honest -- a flipped board is the same
	// board seen from the other side, not a different coordinate system.
	if (flipped) svg.classList.add("flipped");
	wrap.appendChild(svg);

	const chess = new Chess(fen);
	let from = null;

	const nodes = (sq) => svg.querySelectorAll(`[data-sq="${sq}"]`);
	const clear = () => {
		svg.querySelectorAll(".sel, .target").forEach((n) => {
			n.classList.remove("sel", "target");
		});
		from = null;
	};
	const movesFrom = (sq) => chess.moves({ square: sq, verbose: true });

	function pick(sq) {
		clear();
		const ms = movesFrom(sq);
		if (!ms.length) return; // an empty square, or a piece with nowhere to go
		from = sq;
		nodes(sq).forEach((n) => n.classList.add("sel"));
		ms.forEach((m) => nodes(m.to).forEach((n) => n.classList.add("target")));
	}

	// Returns true if the square completed a pending move.
	function drop(sq) {
		if (!from) return false;
		const cand = movesFrom(from).filter((m) => m.to === sq);
		if (!cand.length) return false;
		const san = cand[0].san;
		clear();
		onMove(san);
		return true;
	}

	function squareOf(e) {
		const t = e.target;
		return t && t.getAttribute ? t.getAttribute("data-sq") : null;
	}

	svg.addEventListener("mousedown", (e) => {
		const sq = squareOf(e);
		if (!sq) return;
		e.preventDefault();
		// A mousedown on a legal target finishes a click-click; anything else
		// starts a new selection (including clicking another of your own pieces).
		if (drop(sq)) return;
		pick(sq);
	});

	svg.addEventListener("mouseup", (e) => {
		const sq = squareOf(e);
		// Releasing on the source is the first half of a click-click, so it must
		// leave the selection alone rather than treating it as a failed drag.
		if (!sq || sq === from) return;
		if (!drop(sq)) clear();
	});

	return wrap;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/board-input.test.mjs && npm run lint`
Expected: PASS, lint clean.

- [ ] **Step 5: Add the styles**

Append to `style.css`, next to the existing `.board-svg` rules:

```css
.an-board svg.flipped { transform: rotate(180deg); }
/* the pieces would be upside-down with the board, so turn them back */
.an-board svg.flipped use,
.an-board svg.flipped text { transform: rotate(180deg); transform-origin: center; transform-box: fill-box; }
.an-board rect.sel { fill: #b9c96f; }
.an-board rect.target { fill: #cdd68a; }
.an-board rect { cursor: pointer; }
```

- [ ] **Step 6: Commit**

```bash
git add src/board-input.js tests/board-input.test.mjs style.css
git commit -m "Make a board playable with one pair of handlers for drag and click"
```

---

### Task 5: The promotion picker

Task 4 plays every promoting move as a queen. This asks.

**Files:**
- Modify: `src/board-input.js`
- Modify: `style.css`
- Test: `tests/board-input.test.mjs` (append)

**Interfaces:**
- Consumes: `interactiveBoard(fen, onMove, opts)` from Task 4 — signature unchanged.
- Produces: a promoting move opens `div.an-promo` inside the board wrapper, holding four `button.an-promo-pick` with `data-piece` of `q`, `r`, `b`, `n` in that order. `onMove` fires only once a piece is chosen. Nothing else in the board responds while the picker is open.

- [ ] **Step 1: Write the failing test**

```js
// append to tests/board-input.test.mjs

// White pawn on b7, black rook on a8: both a push and a capture promote.
const PROMO_FEN = "r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1";

test("a promoting move asks which piece before it is played", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(PROMO_FEN, (san) => seen.push(san));
	on(board, "b7", "mousedown");
	on(board, "b8", "mouseup");
	assert.deepStrictEqual(seen, [], "nothing is played until a piece is chosen");
	const picker = board.querySelector(".an-promo");
	assert.ok(picker, "the picker opened");
	assert.deepStrictEqual(
		[...picker.querySelectorAll("button")].map((b) => b.dataset.piece),
		["q", "r", "b", "n"],
	);
	done();
});

test("choosing a piece plays that promotion and closes the picker", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(PROMO_FEN, (san) => seen.push(san));
	on(board, "b7", "mousedown");
	on(board, "b8", "mouseup");
	board.querySelector('.an-promo button[data-piece="n"]').click();
	assert.deepStrictEqual(seen, ["b8=N"]);
	assert.strictEqual(board.querySelector(".an-promo"), null);
	assert.deepStrictEqual(marked(board, "sel"), []);
	done();
});

test("a promoting capture keeps the capture in the SAN", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(PROMO_FEN, (san) => seen.push(san));
	on(board, "b7", "mousedown");
	on(board, "a8", "mouseup");
	board.querySelector('.an-promo button[data-piece="q"]').click();
	assert.deepStrictEqual(seen, ["bxa8=Q"]);
	done();
});

test("the board ignores clicks while the picker is open", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(PROMO_FEN, (san) => seen.push(san));
	on(board, "b7", "mousedown");
	on(board, "b8", "mouseup");
	on(board, "e1", "mousedown");
	assert.deepStrictEqual(marked(board, "sel"), [], "the king was not selected");
	assert.ok(board.querySelector(".an-promo"), "the picker is still open");
	done();
});

test("a non-promoting move never opens the picker", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(PROMO_FEN, (san) => seen.push(san));
	on(board, "e1", "mousedown");
	on(board, "e2", "mouseup");
	assert.deepStrictEqual(seen, ["Ke2"]);
	assert.strictEqual(board.querySelector(".an-promo"), null);
	done();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/board-input.test.mjs`
Expected: FAIL — the first promotion test fails with `seen` equal to `["b8=Q"]`, because Task 4 plays a queen without asking.

- [ ] **Step 3: Write minimal implementation**

In `src/board-input.js`, add the piece list under the imports:

```js
// Queen first: it is the answer almost every time, so it is the shortest
// distance from the cursor, and the order never changes under the user.
const PROMO_PIECES = [
	["q", "Queen"],
	["r", "Rook"],
	["b", "Bishop"],
	["n", "Knight"],
];
```

Add a `pending` flag beside `from`:

```js
	let from = null;
	let pending = null; // a promotion waiting on a choice: { from, to }
```

Replace `drop` with a version that defers a promoting move, and add the picker:

```js
	// Returns true if the square completed a pending move (or opened the
	// promotion picker, which is the same thing from the caller's side: the
	// gesture is over either way).
	function drop(sq) {
		if (!from) return false;
		const cand = movesFrom(from).filter((m) => m.to === sq);
		if (!cand.length) return false;
		// Every candidate for one from/to pair is the same move except for the
		// piece promoted to, so asking once covers all four.
		if (cand.some((m) => m.promotion)) {
			pending = { from, to: sq };
			askPromotion();
			return true;
		}
		const san = cand[0].san;
		clear();
		onMove(san);
		return true;
	}

	function askPromotion() {
		const box = document.createElement("div");
		box.className = "an-promo";
		PROMO_PIECES.forEach(([piece, label]) => {
			const b = document.createElement("button");
			b.className = "an-promo-pick";
			b.dataset.piece = piece;
			b.textContent = label;
			b.onclick = () => {
				const { from: f, to } = pending;
				const m = chess
					.moves({ square: f, verbose: true })
					.find((x) => x.to === to && x.promotion === piece);
				pending = null;
				box.remove();
				clear();
				if (m) onMove(m.san);
			};
			box.appendChild(b);
		});
		wrap.appendChild(box);
	}
```

Guard both handlers so the board is inert while the picker is up — add as the first line of each listener body, before `squareOf`:

```js
		if (pending) return;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/board-input.test.mjs && npm run lint`
Expected: PASS, lint clean.

- [ ] **Step 5: Add the styles**

Append to `style.css`:

```css
.an-board { position: relative; }
.an-promo {
	position: absolute; inset: 0; display: flex; flex-direction: column;
	align-items: center; justify-content: center; gap: .35rem;
	background: color-mix(in srgb, Canvas 82%, transparent);
}
.an-promo-pick { min-width: 7rem; }
```

- [ ] **Step 6: Commit**

```bash
git add src/board-input.js tests/board-input.test.mjs style.css
git commit -m "Ask which piece a pawn promotes to instead of assuming a queen"
```

---

### Task 6: The Analysis panel

The view: board, scratch line list, navigation. No commit yet — that is Task 7.

**Files:**
- Create: `src/analysis-view.js`
- Test: `tests/analysis-view.test.mjs` (create)

**Interfaces:**
- Consumes: `interactiveBoard` (Task 4); the whole of `src/analysis.js` (Task 2); `el` from `src/dom.js`.
- Produces:
  - `analysisPanel(scratch, onChange) -> HTMLElement` — a `div.analysis` holding `.an-board`, `.an-nav` and `.an-lines`. `onChange()` fires after any mutation so the caller can re-render.
  - `movesText(line, at) -> string` is **not** reused from `render.js`; this module formats its own with `numberedMoves(moves)`.
  - `numberedMoves(moves) -> string` — `"1.e4 e5 2.Nf3"`, exported for its test.

- [ ] **Step 1: Write the failing test**

```js
// tests/analysis-view.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { installDom } from "./helpers.mjs";
import { analysisPanel, numberedMoves } from "../src/analysis-view.js";
import { newScratch, activeLine, play, goTo } from "../src/analysis.js";

const click = (root, sel) => {
	const n = root.querySelector(sel);
	assert.ok(n, `no ${sel}`);
	n.click();
	return n;
};
const mouse = (root, sq, type) =>
	root
		.querySelector(`rect[data-sq="${sq}"]`)
		.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true }));

test("numbering starts at move one and pairs the colours", () => {
	assert.strictEqual(numberedMoves([]), "");
	assert.strictEqual(
		numberedMoves([{ san: "e4" }, { san: "e5" }, { san: "Nf3" }]),
		"1.e4 e5 2.Nf3",
	);
});

test("the panel draws a board, the nav and the scratch lines", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }]);
	const panel = analysisPanel(s, () => {});
	assert.ok(panel.querySelector(".an-board svg"));
	assert.ok(panel.querySelector(".an-nav"));
	assert.strictEqual(panel.querySelectorAll(".an-line").length, 1);
	assert.match(panel.querySelector(".an-line").textContent, /1\.e4/);
	done();
});

test("playing a move on the board updates the scratch and reports the change", () => {
	const done = installDom();
	const s = newScratch();
	let changed = 0;
	const panel = analysisPanel(s, () => changed++);
	mouse(panel, "e2", "mousedown");
	mouse(panel, "e4", "mouseup");
	assert.deepStrictEqual(
		activeLine(s).moves.map((m) => m.san),
		["e4"],
	);
	assert.strictEqual(changed, 1);
	done();
});

test("the board shows the position at the cursor, not the end of the line", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 0);
	const panel = analysisPanel(s, () => {});
	// at the start position, so a white pawn is still on e2 and can be picked
	mouse(panel, "e2", "mousedown");
	assert.ok(panel.querySelector('rect[data-sq="e4"].target'));
	done();
});

test("back and forward walk the cursor", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	const panel = analysisPanel(s, () => {});
	click(panel, ".an-back");
	assert.strictEqual(s.at, 1);
	click(panel, ".an-fwd");
	assert.strictEqual(s.at, 2);
	done();
});

test("flip toggles the board and nothing else", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }]);
	const panel = analysisPanel(s, () => {});
	click(panel, ".an-flip");
	assert.strictEqual(s.flipped, true);
	assert.strictEqual(s.at, 1, "the cursor did not move");
	done();
});

test("left and right arrows step the cursor", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	const panel = analysisPanel(s, () => {});
	const key = (k) =>
		panel.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: k, bubbles: true }),
		);
	key("ArrowLeft");
	assert.strictEqual(s.at, 1);
	key("ArrowLeft");
	assert.strictEqual(s.at, 0);
	key("ArrowRight");
	assert.strictEqual(s.at, 1);
	done();
});

test("the panel is focusable so the arrow keys can reach it", () => {
	const done = installDom();
	const panel = analysisPanel(newScratch(), () => {});
	assert.strictEqual(panel.tabIndex, -1);
	done();
});

test("a fork shows as a second line, and clicking one selects it", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5");
	const panel = analysisPanel(s, () => {});
	const rows = panel.querySelectorAll(".an-line");
	assert.strictEqual(rows.length, 2);
	assert.ok(rows[1].classList.contains("active"), "the fork is the active line");
	rows[0].click();
	assert.strictEqual(s.active, 0);
	done();
});

test("clicking a move in a line jumps the cursor to it", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }, { san: "Nf3" }]);
	const panel = analysisPanel(s, () => {});
	panel.querySelectorAll(".an-line .an-move")[1].click();
	assert.strictEqual(s.active, 0);
	assert.strictEqual(s.at, 2, "the cursor sits after the clicked move");
	done();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/analysis-view.test.mjs`
Expected: FAIL — `Cannot find module '.../src/analysis-view.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/analysis-view.js
// Analysis mode's panel. It owns no state of its own: everything it draws
// comes from the scratch it is handed, and every control mutates that scratch
// and calls onChange, which is what rebuilds the panel. That keeps the view a
// pure function of the scratch, the same contract the report panels keep with
// current.lines.

import { el } from "./dom.js";
import { interactiveBoard } from "./board-input.js";
import {
	activeLine,
	back,
	fenOf,
	forward,
	goTo,
	play,
	select,
} from "./analysis.js";

// "1.e4 e5 2.Nf3". Deliberately not render.js's movesText: that one formats a
// notebook line's divergent tail against a mainline, which a scratch has no
// notion of.
export function numberedMoves(moves) {
	return moves
		.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m.san}` : m.san))
		.join(" ");
}

export function analysisPanel(scratch, onChange) {
	// tabIndex -1 rather than 0: the panel is focusable so the arrow keys have
	// somewhere to land, but it is not a tab stop of its own -- tabbing should
	// still walk the actual controls. app.js focuses it after appending.
	const panel = el("div", { className: "analysis", tabIndex: -1 });
	// On the panel rather than the document: the listener dies with the element,
	// so a re-render cannot leave a stack of handlers behind all stepping the
	// same cursor. Clicks land on controls inside the panel, so keydown after a
	// click still bubbles here.
	panel.onkeydown = (e) => {
		if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
		e.preventDefault();
		if (e.key === "ArrowLeft") back(scratch);
		else forward(scratch);
		onChange();
	};

	const board = interactiveBoard(
		fenOf(scratch),
		(san) => {
			play(scratch, san);
			onChange();
		},
		{ flipped: scratch.flipped },
	);
	panel.appendChild(board);

	const nav = el("div", { className: "an-nav orow" });
	const navBtn = (cls, text, title, fn) =>
		el("button", {
			className: "chip mini " + cls,
			textContent: text,
			title,
			onclick: () => {
				fn();
				onChange();
			},
		});
	nav.append(
		navBtn("an-back", "◀", "Back one move", () => back(scratch)),
		navBtn("an-fwd", "▶", "Forward one move", () => forward(scratch)),
		navBtn("an-start", "⟲", "Back to the start", () => goTo(scratch, 0)),
		// Flip is the one control that changes nothing about the scratch's
		// moves, so it is kept visually apart from the three that do.
		navBtn("an-flip", "Flip", "Show the board from the other side", () => {
			scratch.flipped = !scratch.flipped;
		}),
	);
	panel.appendChild(nav);

	const list = el("div", { className: "an-lines" });
	scratch.lines.forEach((line, i) => {
		const row = el("div", {
			className: "an-line" + (i === scratch.active ? " active" : ""),
		});
		// Clicking the row anywhere but on a move selects the line; clicking a
		// move selects the line AND puts the cursor after that move, which is
		// how you get back to a position you want to branch from again.
		row.onclick = () => {
			select(scratch, i);
			onChange();
		};
		if (!line.moves.length) {
			row.appendChild(el("span", { className: "an-empty", textContent: "(no moves yet)" }));
		}
		line.moves.forEach((m, j) => {
			const mv = el("button", {
				className:
					"an-move" +
					(i === scratch.active && j === scratch.at - 1 ? " at" : ""),
				textContent: j % 2 === 0 ? `${j / 2 + 1}.${m.san}` : m.san,
			});
			mv.onclick = (e) => {
				e.stopPropagation();
				select(scratch, i);
				goTo(scratch, j + 1);
				onChange();
			};
			row.appendChild(mv);
		});
		list.appendChild(row);
	});
	panel.appendChild(list);

	return panel;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/analysis-view.test.mjs && npm run lint`
Expected: PASS, lint clean.

- [ ] **Step 5: Add the styles**

Append to `style.css`:

```css
.analysis { display: flex; flex-direction: column; gap: .6rem; align-items: flex-start; }
.an-lines { display: flex; flex-direction: column; gap: .2rem; width: 100%; }
.an-line { padding: .2rem .35rem; border-radius: .25rem; cursor: pointer; }
.an-line.active { background: color-mix(in srgb, CanvasText 8%, transparent); }
.an-move { background: none; border: 0; padding: 0 .2rem; font: inherit; color: inherit; cursor: pointer; }
.an-move.at { font-weight: 700; text-decoration: underline; }
.an-empty { opacity: .6; }
```

- [ ] **Step 6: Commit**

```bash
git add src/analysis-view.js tests/analysis-view.test.mjs style.css
git commit -m "Draw the analysis panel as a pure function of its scratch"
```

---

### Task 7: Commit a scratch line into the notebook

The one write. Two steps, not one: push the line, then regenerate the PGN — a workbook is `pgn` plus tags keyed by move, so a line missing from the PGN does not survive a reload.

**Files:**
- Create: `src/analysis-commit.js`
- Modify: `src/analysis-view.js`
- Test: `tests/analysis-commit.test.mjs` (create)

**Interfaces:**
- Consumes: `toLine` from `src/analysis.js`; `getCurrent` from `src/state.js`; `buildPgn` from `src/pgn-out.js`; `defaultLineName` from `src/tree.js`.
- Produces:
  - `commitLine(scratchLine) -> { ok: true, line } | { ok: false, reason: string }`
  - `commitAll(scratch) -> { added: number, skipped: number }`
  - `analysisPanel` grows `.an-add` and `.an-add-all` buttons and an `.an-msg` status line.

- [ ] **Step 1: Write the failing test**

```js
// tests/analysis-commit.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { getCurrent } from "../src/state.js";
import { commitLine, commitAll } from "../src/analysis-commit.js";
import { newScratch, play, goTo } from "../src/analysis.js";

const PGN = "1. e4 e5 2. Nf3 Nc6 *";

test("a committed line lands in current.lines as a sideline", () => {
	const done = installDom();
	loadState(PGN);
	const before = getCurrent().lines.length;
	const r = commitLine({ moves: [{ san: "e4", ply: 0 }, { san: "c5", ply: 1 }] });
	assert.strictEqual(r.ok, true);
	assert.strictEqual(getCurrent().lines.length, before + 1);
	const added = getCurrent().lines[getCurrent().lines.length - 1];
	assert.strictEqual(added.tag, "sideline");
	assert.strictEqual(added.isMain, undefined);
	assert.deepStrictEqual(added.marks, {});
	done();
});

test("committing rewrites the notebook's PGN so the line survives a reload", () => {
	const done = installDom();
	loadState(PGN);
	commitLine({ moves: [{ san: "e4", ply: 0 }, { san: "c5", ply: 1 }] });
	assert.match(getCurrent().pgn, /c5/);
	assert.match(getCurrent().pgn, /e5/, "the lines already there are still in it");
	done();
});

test("committing a line the notebook already has is refused, not duplicated", () => {
	const done = installDom();
	loadState(PGN);
	const before = getCurrent().lines.length;
	const r = commitLine({
		moves: [
			{ san: "e4", ply: 0 },
			{ san: "e5", ply: 1 },
			{ san: "Nf3", ply: 2 },
			{ san: "Nc6", ply: 3 },
		],
	});
	assert.strictEqual(r.ok, false);
	assert.match(r.reason, /already/i);
	assert.strictEqual(getCurrent().lines.length, before);
	done();
});

test("an empty scratch line is refused", () => {
	const done = installDom();
	loadState(PGN);
	const r = commitLine({ moves: [] });
	assert.strictEqual(r.ok, false);
	assert.match(r.reason, /no moves/i);
	done();
});

test("commitAll adds every new line and counts what it skipped", () => {
	const done = installDom();
	loadState(PGN);
	const before = getCurrent().lines.length;
	const s = newScratch([{ san: "e4" }, { san: "e5" }, { san: "Nf3" }, { san: "Nc6" }]);
	goTo(s, 1);
	play(s, "c5"); // a fork: e4 c5
	goTo(s, 1);
	play(s, "e6"); // another fork off the same point: e4 e6
	const r = commitAll(s);
	assert.strictEqual(r.added, 2, "both forks are new");
	assert.strictEqual(r.skipped, 1, "the seeded line is already the mainline");
	assert.strictEqual(getCurrent().lines.length, before + 2);
	done();
});

test("committed lines are numbered by where they land", () => {
	const done = installDom();
	loadState(PGN);
	const r = commitLine({ moves: [{ san: "d4", ply: 0 }] });
	const idx = getCurrent().lines.indexOf(r.line);
	assert.strictEqual(r.line.name, `Line ${idx}`);
	done();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/analysis-commit.test.mjs`
Expected: FAIL — `Cannot find module '.../src/analysis-commit.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/analysis-commit.js
// The only thing in Analysis mode that writes to the notebook.
//
// Two writes, not one. A workbook is not a dump of current.lines: toNotebook
// saves the PGN plus tags keyed by move, and applyNotebook re-parses that PGN
// on load. A line pushed onto current.lines but missing from current.pgn is
// therefore gone at the next reload -- so the PGN is regenerated here, the
// same way app.js does it in the Update PGN flow.
//
// Nothing here edits an existing line. Appending is safe where mutation is
// not: pgn-out.js recovers a line's parent by longest shared prefix, so an
// appended line is parented by exactly the rule an imported sibling gets,
// while changing a move under an existing line could silently re-parent its
// siblings and strand marks keyed by a ply that moved.

import { getCurrent } from "./state.js";
import { buildPgn } from "./pgn-out.js";
import { toLine } from "./analysis.js";

const keyOf = (moves) => moves.map((m) => m.san).join(" ");

export function commitLine(scratchLine) {
	const moves = scratchLine.moves || [];
	if (!moves.length) return { ok: false, reason: "That line has no moves yet." };
	const cur = getCurrent();
	const key = keyOf(moves);
	if (cur.lines.some((l) => keyOf(l.moves) === key))
		return { ok: false, reason: "The notebook already has that line." };
	// Named for the index it is about to occupy, which is what the editor's
	// placeholder names do for every other unnamed line.
	const line = toLine(scratchLine, cur.lines.length);
	cur.lines.push(line);
	cur.pgn = buildPgn(cur);
	return { ok: true, line };
}

export function commitAll(scratch) {
	let added = 0;
	let skipped = 0;
	for (const line of scratch.lines) {
		if (commitLine(line).ok) added++;
		else skipped++;
	}
	return { added, skipped };
}
```

Then wire the buttons into `src/analysis-view.js`. Add to its imports:

```js
import { commitAll, commitLine } from "./analysis-commit.js";
```

and append this before `return panel;`:

```js
	// The commit bar. A message element rather than an alert(): adding a line
	// is a thing you do several times in a row, and a modal between each one
	// would be in the way.
	const msg = el("div", { className: "an-msg" });
	const bar = el("div", { className: "orow an-commit" });
	bar.append(
		el("button", {
			className: "chip primary an-add",
			textContent: "Add as new line",
			onclick: () => {
				const r = commitLine(activeLine(scratch));
				msg.textContent = r.ok ? `Added ${r.line.name}.` : r.reason;
				onChange();
			},
		}),
		el("button", {
			className: "chip an-add-all",
			textContent: "Add all",
			onclick: () => {
				const { added, skipped } = commitAll(scratch);
				msg.textContent =
					`Added ${added} line${added === 1 ? "" : "s"}` +
					(skipped ? `, skipped ${skipped} already in the notebook.` : ".");
				onChange();
			},
		}),
	);
	panel.append(bar, msg);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/analysis-commit.test.mjs tests/analysis-view.test.mjs && npm run lint`
Expected: PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/analysis-commit.js src/analysis-view.js tests/analysis-commit.test.mjs
git commit -m "Commit a scratch line into the notebook and back into its PGN"
```

---

### Task 8: The Report/Analysis toggle

**Files:**
- Modify: `src/state.js` (append)
- Modify: `src/app.js` — toolbar (around `src/app.js:276-292`) and `viewRoot`'s layout assembly (around `src/app.js:345-395`)
- Test: `tests/analysis-mode.test.mjs` (create)

**Interfaces:**
- Consumes: `analysisPanel` (Task 6); `newScratch` (Task 2).
- Produces:
  - `state.js`: `getMode() -> "report" | "analysis"`, `setMode(m)`, `getScratch()`, `setScratch(s)`.
  - `app.js`: `openAnalysis(moves = [])` — exported, seeds a scratch from `moves` and switches mode. Task 9's entry points call it.
  - The toolbar carries a `button.an-toggle` reading `Analysis` in report mode and `Report` in analysis mode.

- [ ] **Step 1: Write the failing test**

```js
// tests/analysis-mode.test.mjs
import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers.mjs";
import { getCurrent } from "../src/state.js";

const app = await bootApp();
after(() => app.teardown());

const PGN = "1. e4 e5 2. Nf3 Nc6 *";

test("the toolbar toggles between the report and the analysis board", async () => {
	app.reset();
	await app.loadPgn(PGN);
	assert.ok(app.view().querySelector(".pv-table"), "the report is up");
	assert.strictEqual(app.view().querySelector(".analysis"), null);

	app.view().querySelector(".an-toggle").click();
	assert.ok(app.view().querySelector(".analysis"), "the analysis panel is up");
	assert.ok(app.view().querySelector(".an-board svg"));
	assert.strictEqual(app.view().querySelector(".pv-table"), null, "the report is put away");

	app.view().querySelector(".an-toggle").click();
	assert.ok(app.view().querySelector(".pv-table"), "and comes back");
});

test("a line added on the board shows up in the report", async () => {
	app.reset();
	await app.loadPgn(PGN);
	const before = getCurrent().lines.length;
	app.view().querySelector(".an-toggle").click();
	// play 1.d4 from the start position
	app.view().querySelector(".an-start").click();
	const sq = (s, type) =>
		app
			.view()
			.querySelector(`rect[data-sq="${s}"]`)
			.dispatchEvent(new app.dom.window.MouseEvent(type, { bubbles: true, cancelable: true }));
	sq("d2", "mousedown");
	sq("d4", "mouseup");
	app.view().querySelector(".an-add").click();
	assert.strictEqual(getCurrent().lines.length, before + 1);
	app.view().querySelector(".an-toggle").click();
	assert.match(app.view().querySelector(".pv-table").textContent, /d4/);
});

test("the scratch and the mode are never saved into a workbook", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.view().querySelector(".an-toggle").click();
	app.view().querySelector(".an-toggle").click();
	app.clickText("Save");
	// store.js's PREFIX
	const key = Object.keys(app.dom.window.localStorage).find((k) =>
		k.startsWith("ott:"),
	);
	assert.ok(key, "something was saved");
	const saved = JSON.parse(app.dom.window.localStorage.getItem(key));
	assert.strictEqual(saved.scratch, undefined);
	assert.strictEqual(saved.mode, undefined);
	assert.ok(Array.isArray(saved.tags) && typeof saved.pgn === "string");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/analysis-mode.test.mjs`
Expected: FAIL — `Cannot read properties of null (reading 'click')`, because there is no `.an-toggle`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/state.js`:

```js
// Analysis mode and its scratch. Session-only, exactly like openTablePaths and
// the trace: a half-explored variation is something you are doing right now,
// not a property of the notebook, so store.js does not save either of these --
// and toNotebook, which picks its fields explicitly, never will by accident.
let mode = "report";
export function getMode() {
	return mode;
}
export function setMode(m) {
	mode = m === "analysis" ? "analysis" : "report";
	return mode;
}
let scratch = null;
export function getScratch() {
	return scratch;
}
export function setScratch(s) {
	scratch = s;
	return scratch;
}
```

In `src/app.js`, add to the imports:

```js
import { getMode, setMode, getScratch, setScratch } from "./state.js";
import { analysisPanel } from "./analysis-view.js";
import { newScratch } from "./analysis.js";
```

(fold the `state.js` names into the existing `from "./state.js"` import rather than adding a second one).

Reset the mode where the other session state is reset — beside the existing `setTraced(null);` near the top of the module body:

```js
setMode("report");
setScratch(null);
```

Add the entry point, near `promoteMainline`'s callers at module scope:

```js
// Open Analysis mode, seeded with `moves` (a line's moves up to and including
// the one to branch from). The seed is copied by newScratch, so exploring
// never reaches back into the notebook line it came from.
export function openAnalysis(moves = []) {
	setScratch(newScratch(moves));
	setMode("analysis");
	renderApp();
}
```

In `viewRoot()`, add the toggle to the toolbar — put it directly after the `New / Import` button so the two view-level controls sit together:

```js
  top.appendChild(
    el("button", {
      className: "chip an-toggle",
      textContent: getMode() === "analysis" ? "Report" : "Analysis",
      onclick: () => {
        if (getMode() === "analysis") setMode("report");
        else openAnalysis();
        renderApp();
      },
    }),
  );
```

Then branch the layout. Replace the line `const layout = el("div", { className: "app-layout" });` and what follows it with a mode check placed immediately after the toolbar is built — insert this directly *before* `const layout = ...`:

```js
  // Analysis mode replaces the whole two-column layout rather than sitting
  // beside it: the board and (later) the engine need the room, and none of the
  // report panels mean anything while you are exploring a position that is not
  // in the notebook yet.
  if (getMode() === "analysis") {
    if (!getScratch()) setScratch(newScratch());
    const wrapAn = el("div", { className: "app-layout analysis-mode" });
    wrapAn.appendChild(top);
    const an = analysisPanel(getScratch(), renderApp);
    wrapAn.appendChild(an);
    wrap.appendChild(wrapAn);
    // Focus after the tree is live, so the arrow keys work without the user
    // having to click the panel first. Re-render rebuilds and re-focuses it.
    queueMicrotask(() => an.focus());
    return wrap;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/analysis-mode.test.mjs && npm test && npm run lint`
Expected: PASS across the whole suite.

- [ ] **Step 5: Commit**

```bash
git add src/state.js src/app.js tests/analysis-mode.test.mjs
git commit -m "Give the analysis board its own mode rather than a corner of the report"
```

---

### Task 9: "Analyse from here" from the table and the line editor

The entry point that makes the board useful on an existing notebook — and that covers fixing a wrong move without any in-place mutation: analyse from the move before it, play the right move, add the line, hide the old one.

**Files:**
- Modify: `src/table-menu.js` (inside `buildInto`, `src/table-menu.js:182-213`)
- Modify: `src/line-editor.js` (inside `moveSection`'s caller — the panel built by `movePanel`, `src/line-editor.js:330`)
- Test: `tests/analysis-entry.test.mjs` (create)

**Interfaces:**
- Consumes: `openAnalysis(moves)` from `src/app.js`, reached through the render-hooks registry — **not** a static import. `table-menu.js` and `line-editor.js` are seam modules; a static `import { openAnalysis } from "./app.js"` binds to whichever app.js instance loaded first and would point at a detached DOM in later tests. See the note on `setRenderHooks` in `state.js`.
- Produces: an `Analyse from here` item in the table context menu and a matching button in the line editor's move panel.

- [ ] **Step 1: Write the failing test**

```js
// tests/analysis-entry.test.mjs
import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers.mjs";
import { getScratch, getMode } from "../src/state.js";

const app = await bootApp();
after(() => app.teardown());

const PGN = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *";

const rightClick = (node) =>
	node.dispatchEvent(
		new app.dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
	);
const menuItem = (text) =>
	[...app.dom.window.document.querySelectorAll("button")].find((b) =>
		b.textContent.includes(text),
	);

test("analysing from a table move seeds the scratch with its prefix", async () => {
	app.reset();
	await app.loadPgn(PGN);
	// the mainline's third move (1-based: e4, e5, Nf3)
	const cells = [...app.view().querySelectorAll(".pv-table td")].filter((c) =>
		c.textContent.trim(),
	);
	const nf3 = cells.find((c) => c.textContent.includes("Nf3"));
	assert.ok(nf3, "Nf3 is in the table");
	rightClick(nf3);
	const item = menuItem("Analyse from here");
	assert.ok(item, "the menu offers it");
	item.click();

	assert.strictEqual(getMode(), "analysis");
	const s = getScratch();
	assert.deepStrictEqual(
		s.lines[0].moves.map((m) => m.san),
		["e4", "e5", "Nf3"],
		"seeded up to and including the clicked move",
	);
	assert.strictEqual(s.at, 3, "the cursor is after it, ready to branch");
	assert.ok(app.view().querySelector(".an-board svg"));
});

test("the seeded scratch is a copy, so exploring cannot reach the notebook line", async () => {
	app.reset();
	await app.loadPgn(PGN);
	const cells = [...app.view().querySelectorAll(".pv-table td")].filter((c) =>
		c.textContent.includes("e4"),
	);
	rightClick(cells[0]);
	menuItem("Analyse from here").click();
	const s = getScratch();
	s.lines[0].moves[0].san = "MUTATED";
	const { getCurrent } = await import("../src/state.js");
	assert.strictEqual(getCurrent().lines[0].moves[0].san, "e4");
});

test("the line editor's move panel offers the same entry", async () => {
	app.reset();
	await app.loadPgn(PGN);
	// moveStrip renders each move as a .move-chip labelled "1. e4"
	const move = [...app.view().querySelectorAll(".markup .move-chip")].find((b) =>
		b.textContent.includes("e4"),
	);
	assert.ok(move, "the move strip has e4");
	move.click(); // select it, which opens the move panel
	const btn = [...app.view().querySelectorAll("button")].find(
		(b) => b.textContent === "Analyse from here",
	);
	assert.ok(btn, "the move panel offers it");
	btn.click();
	assert.strictEqual(getMode(), "analysis");
	assert.deepStrictEqual(
		getScratch().lines[0].moves.map((m) => m.san),
		["e4"],
	);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/analysis-entry.test.mjs`
Expected: FAIL — `the menu offers it` assertion fails; `menuItem` returns undefined.

- [ ] **Step 3: Write minimal implementation**

Add `openAnalysis` to the hooks registry. In `src/app.js`, inside the existing `setRenderHooks({...})` call, add:

```js
  openAnalysis,
```

In `src/table-menu.js`, add a shared helper above `buildInto`:

```js
// The moves of `line` up to and including `ply`, which is what seeds an
// analysis scratch: a line is a root-to-leaf path, so branching from a move
// means carrying everything before it.
function movesUpTo(line, ply) {
	return line.moves.filter((m) => m.ply <= ply);
}
```

Then, inside `buildInto`, add the item to both branches — in the group branch, directly after the `moveSection(box, target.lines[0], target.ply)` call:

```js
		if (target.ply != null)
			box.appendChild(
				item("Analyse from here", () =>
					getRenderHooks().openAnalysis(movesUpTo(target.lines[0], target.ply)),
				),
			);
```

and in the line branch, directly after `if (ply != null) moveSection(box, line, ply);`:

```js
		if (ply != null)
			box.appendChild(
				item("Analyse from here", () =>
					getRenderHooks().openAnalysis(movesUpTo(line, ply)),
				),
			);
```

If `getRenderHooks` is not already imported in `table-menu.js`, add it to the `from "./state.js"` import.

In `src/line-editor.js`, inside `movePanel(l)`, insert this directly after the
`if (!atEnd) box.appendChild(commentEditor(selPly, lines));` line and before
`const done = el("button", {`:

```js
	// Branching from a move needs every move before it, since a line is a
	// root-to-leaf path. Reached through the hooks registry rather than a
	// static import of app.js: this module is a seam, and a static binding
	// would keep pointing at the first app.js instance a test loaded.
	if (!atEnd)
		box.appendChild(
			el("button", {
				type: "button",
				className: "chip mini",
				textContent: "Analyse from here",
				onclick: () =>
					getRenderHooks().openAnalysis(
						l.moves.filter((m) => m.ply <= selPly),
					),
			}),
		);
```

`getRenderHooks` and `el` are already imported in this file; nothing new is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/analysis-entry.test.mjs && npm test && npm run lint`
Expected: PASS across the whole suite.

- [ ] **Step 5: Update the README**

Add to the numbered list in the README's "What it does", after the **Tag** step:

```markdown
3. **Analyse** — **Analysis** in the toolbar opens an interactive board, or
   right-click any move (in the table or the line editor) and choose **Analyse
   from here** to open it at that position. Play moves to explore; diverging
   from a position you have already visited keeps both continuations, so you can
   build up several lines in one sitting without losing the one you came from.
   Nothing reaches the notebook until you press **Add as new line** (or **Add
   all**), which files the line as a sideline you can then tag like any other.
   To correct a wrong move, analyse from the move before it, play the right one,
   add it, and hide the old line.
```

Renumber the steps after it.

- [ ] **Step 6: Commit**

```bash
git add src/app.js src/table-menu.js src/line-editor.js tests/analysis-entry.test.mjs README.md
git commit -m "Open the analysis board at any move in the table or the editor"
```

---

### Task 10: Final verification

- [ ] **Step 1: Whole suite, lint, and dead-code check**

```bash
npm test && npm run lint && npm run knip
```
Expected: all green. `knip` must report no new unused exports — if it flags something from `analysis.js`, that export has no caller and should be deleted rather than kept "for later".

- [ ] **Step 2: Coverage did not fall**

```bash
npm run coverage
```
Expected: the new `src/analysis*.js` and `src/board-input.js` files are all well covered, and `src/app.js` coverage has not dropped.

- [ ] **Step 3: Drive it by hand**

```bash
npm run dev
```
Load `tests/fixtures/capablanca.pgn`, then walk the whole feature: toggle to Analysis, play a few moves, take back, diverge and confirm both lines are kept, add one, toggle back and find it in the table, right-click a move and analyse from there, promote a pawn, save and reload the page and confirm the added line is still there.

- [ ] **Step 4: Stop**

Do **not** merge to master and do **not** push. Report what was built and what was verified, and wait for sign-off.
