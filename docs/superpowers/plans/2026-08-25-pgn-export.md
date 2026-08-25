# PGN Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export PGN built from the live editor state — nested variations, NAG symbols, notes and footnotes — verified by chess.js and a round-trip through our own parser, plus a Copy PGN button.

**Architecture:** A new pure module `src/pgn-out.js` takes the state object as an argument and returns a PGN string, in three stages: re-nest the flat line list into a move tree, hang NAGs and comments on its nodes, then write the movetext. A new `src/nags.js` holds the one NAG table both the exporter and the editor's symbol palette read, so the two cannot drift apart.

**Tech Stack:** Vanilla ES modules, no build step. `chess.js` for move legality and as the external PGN validator. Tests are `node --test` with jsdom for the DOM-touching modules.

**Conventions:** `src/pgn.js`, `src/tree.js`, `src/notes.js` and `src/line-editor.js` indent with TABS — new and modified code in those files and in the new modules uses tabs. Run the full suite with `npm test`, lint with `npm run lint`.

**Spec:** `docs/superpowers/specs/2026-08-25-pgn-export-design.md`

---

### Task 1: The NAG table

The single source of truth for symbol <-> NAG code, read by both the exporter
and the editor palette.

**Files:**
- Create: `src/nags.js`
- Test: `tests/nags.test.mjs`

- [x] **Step 1: Write the failing test**

Create `tests/nags.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAGS, nagFor, symFor } from "../src/nags.js";

test("maps the traditional move assessments", () => {
	assert.equal(nagFor("!"), 1);
	assert.equal(nagFor("?"), 2);
	assert.equal(nagFor("!!"), 3);
	assert.equal(nagFor("??"), 4);
	assert.equal(nagFor("!?"), 5);
	assert.equal(nagFor("?!"), 6);
});

test("maps both halves of the paired positional glyphs", () => {
	// the same glyph means White's version or Black's depending on the code,
	// so symFor is the direction that distinguishes them
	assert.equal(symFor(22), "⨀");
	assert.equal(symFor(23), "⨀");
	assert.equal(symFor(36), "↑");
	assert.equal(symFor(37), "↑");
	assert.equal(symFor(132), "⇆");
	assert.equal(symFor(133), "⇆");
});

test("maps the advantage glyphs", () => {
	assert.equal(nagFor("="), 10);
	assert.equal(nagFor("∞"), 13);
	assert.equal(nagFor("⩲"), 14);
	assert.equal(nagFor("⩱"), 15);
	assert.equal(nagFor("±"), 16);
	assert.equal(nagFor("∓"), 17);
	assert.equal(nagFor("+−"), 18);
	assert.equal(nagFor("−+"), 19);
});

test("maps the ChessPad idea and novelty codes we keep", () => {
	assert.equal(nagFor("△"), 140);
	assert.equal(nagFor("N"), 146);
});

test("normalizes the ASCII slight-advantage spellings", () => {
	assert.equal(nagFor("+="), 14);
	assert.equal(nagFor("=+"), 15);
});

test("returns undefined for a symbol with no standard code", () => {
	assert.equal(nagFor("TN"), undefined);
	assert.equal(nagFor(""), undefined);
});

test("every entry has a code, a label and a group", () => {
	for (const n of NAGS) {
		assert.equal(typeof n.code, "number", `code for ${n.sym}`);
		assert.ok(n.label, `label for $${n.code}`);
		assert.ok(
			["move", "position", "time"].includes(n.group),
			`group for $${n.code} was ${n.group}`,
		);
	}
});

test("codes are unique and symbols round-trip", () => {
	const codes = new Set();
	for (const n of NAGS) {
		assert.ok(!codes.has(n.code), `duplicate code $${n.code}`);
		codes.add(n.code);
		if (n.sym) assert.equal(symFor(n.code), n.sym);
	}
});

test("marks a small common set for the palette's default row", () => {
	const common = NAGS.filter((n) => n.common);
	assert.ok(common.length >= 10 && common.length <= 18, common.length);
	assert.ok(common.some((n) => n.sym === "="));
	assert.ok(common.some((n) => n.sym === "!"));
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/nags.test.mjs`
Expected: FAIL — `Cannot find module '.../src/nags.js'`

- [x] **Step 3: Write the implementation**

Create `src/nags.js`:

```js
// The one NAG (Numeric Annotation Glyph) table, read by the PGN exporter
// (symbol -> $code) and by the line editor's symbol palette (which entries to
// offer, and how to group them). Keeping both readers on one table is what
// stops the palette from offering a symbol the exporter cannot encode.
//
// Contents: every standard NAG from $1 to $139 that carries a typographic
// symbol, plus the four symbol-less move assessments ($8, $9, $11, $12) that
// the palette shows by label, plus $140 (with the idea) and $146 (novelty),
// which are ChessPad extensions in wide enough use to be worth keeping.
//
// `group` is the PGN spec's own classification: $1-$9 move assessments,
// $10-$135 positional assessments, $136-$139 time pressure.
// `common` marks the entries the palette shows without opening its drawer.
//
// Several positional glyphs come in White/Black pairs sharing one symbol (e.g.
// $22/$23 zugzwang, both "⨀"). Going code -> symbol is exact; going symbol ->
// code cannot distinguish the pair, so nagFor returns the FIRST (White) code
// of the pair. The editor's palette is symbol-based, so that asymmetry is what
// the UI can express; a paired code read from an imported file still renders
// as the right glyph.
export const NAGS = [
	{ code: 1, sym: "!", label: "good move", group: "move", common: true },
	{ code: 2, sym: "?", label: "mistake", group: "move", common: true },
	{ code: 3, sym: "!!", label: "brilliant move", group: "move", common: true },
	{ code: 4, sym: "??", label: "blunder", group: "move", common: true },
	{ code: 5, sym: "!?", label: "interesting move", group: "move", common: true },
	{ code: 6, sym: "?!", label: "dubious move", group: "move", common: true },
	{ code: 7, sym: "□", label: "only move", group: "move", common: true },
	{ code: 8, sym: "", label: "singular move", group: "move" },
	{ code: 9, sym: "", label: "worst move", group: "move" },
	{ code: 10, sym: "=", label: "equal", group: "position", common: true },
	{ code: 11, sym: "", label: "equal chances, quiet", group: "position" },
	{ code: 12, sym: "", label: "equal chances, active", group: "position" },
	{ code: 13, sym: "∞", label: "unclear", group: "position", common: true },
	{ code: 14, sym: "⩲", label: "White slightly better", group: "position", common: true },
	{ code: 15, sym: "⩱", label: "Black slightly better", group: "position", common: true },
	{ code: 16, sym: "±", label: "White clearly better", group: "position", common: true },
	{ code: 17, sym: "∓", label: "Black clearly better", group: "position", common: true },
	{ code: 18, sym: "+−", label: "White winning", group: "position", common: true },
	{ code: 19, sym: "−+", label: "Black winning", group: "position", common: true },
	{ code: 22, sym: "⨀", label: "White in zugzwang", group: "position" },
	{ code: 23, sym: "⨀", label: "Black in zugzwang", group: "position" },
	{ code: 26, sym: "○", label: "White has space", group: "position" },
	{ code: 27, sym: "○", label: "Black has space", group: "position" },
	{ code: 32, sym: "⟳", label: "White ahead in development", group: "position" },
	{ code: 33, sym: "⟳", label: "Black ahead in development", group: "position" },
	{ code: 36, sym: "↑", label: "White has the initiative", group: "position" },
	{ code: 37, sym: "↑", label: "Black has the initiative", group: "position" },
	{ code: 40, sym: "→", label: "White has the attack", group: "position" },
	{ code: 41, sym: "→", label: "Black has the attack", group: "position" },
	{ code: 44, sym: "⯹", label: "White has compensation", group: "position" },
	{ code: 45, sym: "⯹", label: "Black has compensation", group: "position" },
	{ code: 132, sym: "⇆", label: "White has counterplay", group: "position" },
	{ code: 133, sym: "⇆", label: "Black has counterplay", group: "position" },
	{ code: 136, sym: "", label: "White in moderate time trouble", group: "time" },
	{ code: 137, sym: "", label: "Black in moderate time trouble", group: "time" },
	{ code: 138, sym: "⨁", label: "White in severe time trouble", group: "time" },
	{ code: 139, sym: "⨁", label: "Black in severe time trouble", group: "time" },
	{ code: 140, sym: "△", label: "with the idea", group: "position", common: true },
	{ code: 146, sym: "N", label: "novelty", group: "position", common: true },
];

// Older palette spellings that mean an existing glyph. Kept so notebooks saved
// before the table existed still export their marks.
const ALIASES = { "+=": "⩲", "=+": "⩱" };

const BY_SYM = new Map();
const BY_CODE = new Map();
for (const n of NAGS) {
	BY_CODE.set(n.code, n.sym);
	if (n.sym && !BY_SYM.has(n.sym)) BY_SYM.set(n.sym, n.code);
}

// Symbol -> NAG code, or undefined when the symbol has no standard code (the
// caller then falls back to writing the symbol into a {comment}).
export function nagFor(sym) {
	if (!sym) return undefined;
	return BY_SYM.get(ALIASES[sym] || sym);
}

// NAG code -> symbol, or "" for a code we know but that has no glyph, or
// undefined for a code outside the table.
export function symFor(code) {
	return BY_CODE.get(code);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/nags.test.mjs`
Expected: PASS, 8 tests

- [x] **Step 5: Commit**

```bash
git add src/nags.js tests/nags.test.mjs
git commit -m "Add the NAG table shared by the exporter and the palette"
```

---

### Task 2: Re-nest the flat line list into a move tree

`collectLines()` flattens the imported tree into root-to-leaf lines. Exporting
needs the tree back. This task builds only the structure — no annotations yet.

**Files:**
- Create: `src/pgn-out.js`
- Test: `tests/pgn-out.test.mjs`

Node shape produced by `treeFromLines`:

```js
{ san: "e4", ply: 0, nags: [], comments: [], variations: [ [node, ...], ... ] }
```

`variations` is a list of node-lists, matching what `parsePgn` produces, so the
writer and our own parser agree on one shape.

- [x] **Step 1: Write the failing test**

Create `tests/pgn-out.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { treeFromLines } from "../src/pgn-out.js";

// SAN-only view of a node list, so structure assertions stay readable.
const shape = (nodes) =>
	nodes.map((n) => ({
		san: n.san,
		vars: n.variations.map(shape),
	}));

function linesOf(pgn) {
	return collectLines(parsePgn(pgn).nodes);
}

test("a mainline with no sidelines is a flat node list", () => {
	const t = treeFromLines(linesOf("1. e4 e5 2. Nf3 *"));
	assert.deepEqual(shape(t), [
		{ san: "e4", vars: [] },
		{ san: "e5", vars: [] },
		{ san: "Nf3", vars: [] },
	]);
});

test("a sideline attaches as a variation on the move it replaces", () => {
	const t = treeFromLines(linesOf("1. e4 e5 (1... c5 2. Nf3) 2. Nc3 *"));
	assert.deepEqual(shape(t), [
		{ san: "e4", vars: [] },
		{
			san: "e5",
			vars: [[{ san: "c5", vars: [] }, { san: "Nf3", vars: [] }]],
		},
		{ san: "Nc3", vars: [] },
	]);
});

test("two sidelines off the same move are sibling variations", () => {
	const t = treeFromLines(linesOf("1. e4 e5 (1... c5) (1... e6) 2. Nf3 *"));
	assert.deepEqual(shape(t)[1], {
		san: "e5",
		vars: [[{ san: "c5", vars: [] }], [{ san: "e6", vars: [] }]],
	});
});

test("a sideline of a sideline nests inside its own parent", () => {
	const t = treeFromLines(linesOf("1. e4 c5 2. Nf3 d6 (2... Nc6 3. Bb5 (3. d4)) *"));
	// the mainline's d6 carries the Nc6 variation; Bb5 inside it carries d4
	const d6 = shape(t)[3];
	assert.equal(d6.san, "d6");
	assert.equal(d6.vars.length, 1);
	const sub = d6.vars[0];
	assert.deepEqual(sub.map((n) => n.san), ["Nc6", "Bb5"]);
	assert.deepEqual(sub[1].vars, [[{ san: "d4", vars: [] }]]);
});

test("exports the user-promoted mainline as the trunk", () => {
	const lines = linesOf("1. e4 e5 (1... c5 2. Nf3) *");
	// promote the sideline, as the editor's promote button does
	lines.forEach((l) => (l.isMain = false));
	lines[1].isMain = true;
	const t = treeFromLines(lines);
	assert.deepEqual(t.map((n) => n.san), ["e4", "c5", "Nf3"]);
	assert.deepEqual(shape(t)[1].vars, [[{ san: "e5", vars: [] }]]);
});

test("a footnote-tagged line is an ordinary variation", () => {
	const lines = linesOf("1. e4 e5 (1... c5) *");
	lines[1].tag = "foot";
	const t = treeFromLines(lines);
	assert.deepEqual(shape(t)[1].vars, [[{ san: "c5", vars: [] }]]);
});

test("no lines produces no nodes", () => {
	assert.deepEqual(treeFromLines([]), []);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/pgn-out.test.mjs`
Expected: FAIL — `Cannot find module '.../src/pgn-out.js'`

- [x] **Step 3: Write the implementation**

Create `src/pgn-out.js`:

```js
import { divergence } from "./tree.js";

// Serializes the live editor state back to PGN.
//
// The editor works on a FLAT list of root-to-leaf lines (see collectLines in
// tree.js); PGN needs the tree those lines were flattened from. treeFromLines
// rebuilds it.
//
// Which line a sideline branches off is not recorded anywhere, because
// flattening dropped it — it is recovered the same way notes.js recovers a
// note's parent: the candidate line sharing the longest prefix with it wins,
// with the mainline breaking ties. Sorting candidates by depth before
// attaching means a sideline is always attached to an already-placed parent,
// so a sideline of a sideline nests rather than landing on the trunk.

function node(m) {
	return { san: m.san, ply: m.ply, nags: [], comments: [], variations: [] };
}

// The nodes of `line` from index `d` onward — the part that is this line's own,
// not shared with its parent.
function tailNodes(line, d) {
	return line.moves.slice(d).map(node);
}

export function treeFromLines(lines) {
	if (!lines.length) return [];
	const main = lines.find((l) => l.isMain) || lines[0];
	const trunk = tailNodes(main, 0);
	// nodes[i] of a placed line, so a child can attach into its parent's nodes
	const placed = new Map([[main, trunk]]);

	// Shallowest first: a line's parent must already be placed when we get to
	// it. Depth is how far the line diverges from the mainline — a sideline of
	// a sideline necessarily diverges later than the sideline it branches off.
	const rest = lines
		.filter((l) => l !== main)
		.map((l) => ({ l, d: divergence(l, main) }))
		.sort((a, b) => a.d - b.d);

	for (const { l } of rest) {
		// the placed line sharing the most moves with l; ties go to the
		// mainline, which is first in insertion order
		let parent = main;
		let best = -1;
		for (const cand of placed.keys()) {
			const d = divergence(l, cand);
			if (d > best) {
				best = d;
				parent = cand;
			}
		}
		const pd = divergence(l, parent);
		const nodes = tailNodes(l, pd);
		if (!nodes.length) continue; // l duplicates its parent; nothing to add
		// l replaces its parent's move at index pd, so the variation hangs on
		// that move. A line running past its parent's end hangs on the last.
		const pn = placed.get(parent);
		const host = pn[Math.min(pd, pn.length - 1)];
		host.variations.push(nodes);
		placed.set(l, nodes);
	}
	return trunk;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/pgn-out.test.mjs`
Expected: PASS, 7 tests

- [x] **Step 5: Commit**

```bash
git add src/pgn-out.js tests/pgn-out.test.mjs
git commit -m "Rebuild a PGN move tree from the flat line list"
```

---

### Task 3: Write movetext from a tree

Turns the node tree into spec-conformant movetext: move numbers, variations,
NAG tokens, comments, 80-column wrapping, result token.

**Files:**
- Modify: `src/pgn-out.js`
- Test: `tests/pgn-out.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/pgn-out.test.mjs` (and add `writeMovetext` to the existing
`import` from `../src/pgn-out.js`):

```js
test("numbers White's moves and runs Black's straight on", () => {
	const t = treeFromLines(linesOf("1. e4 e5 2. Nf3 Nc6 *"));
	assert.equal(writeMovetext(t, "*"), "1. e4 e5 2. Nf3 Nc6 *");
});

test("re-numbers a Black move that follows a variation", () => {
	const t = treeFromLines(linesOf("1. e4 e5 (1... c5) 2. Nf3 *"));
	assert.equal(writeMovetext(t, "*"), "1. e4 e5 (1... c5) 2. Nf3 *");
});

test("re-numbers a Black move that follows a comment", () => {
	const t = treeFromLines(linesOf("1. e4 {a strong start} e5 *"));
	assert.equal(writeMovetext(t, "*"), "1. e4 {a strong start} 1... e5 *");
});

test("writes NAG tokens after the move they annotate", () => {
	const t = treeFromLines(linesOf("1. e4 e5 *"));
	t[0].nags.push(1);
	t[1].nags.push(16);
	assert.equal(writeMovetext(t, "*"), "1. e4 $1 1... e5 $16 *");
});

test("writes the result token given", () => {
	const t = treeFromLines(linesOf("1. e4 e5 1-0"));
	assert.equal(writeMovetext(t, "1-0"), "1. e4 e5 1-0");
});

test("wraps at 80 columns on token boundaries", () => {
	const long =
		"1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 " +
		"7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 *";
	const out = writeMovetext(treeFromLines(linesOf(long)), "*");
	for (const line of out.split("\n")) assert.ok(line.length <= 80, line);
	// no token was split across the wrap
	assert.equal(out.split(/\s+/).join(" "), long.replace(/\s+/g, " "));
});

test("escapes a closing brace inside a comment", () => {
	const t = treeFromLines(linesOf("1. e4 *"));
	t[0].comments.push("a } brace and\na newline");
	assert.equal(writeMovetext(t, "*"), "1. e4 {a ) brace and a newline} *");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/pgn-out.test.mjs`
Expected: FAIL — `writeMovetext is not a function` / not exported

- [x] **Step 3: Write the implementation**

Append to `src/pgn-out.js`:

```js
// The spec's export format wraps movetext at 80 columns, breaking only
// between tokens.
const WRAP = 80;

// A comment body cannot contain '}' (it would close the comment early) and
// cannot span lines in a way readers agree on, so newlines collapse to
// spaces. A '}' becomes ')' rather than being dropped, so the text still
// reads as the user wrote it.
function commentText(s) {
	return String(s).replace(/\}/g, ")").replace(/\s+/g, " ").trim();
}

function fullmove(ply) {
	return Math.floor(ply / 2) + 1;
}

// Emits one run of moves into `out`. `forceNumber` starts true so the first
// move of a run always carries its number — a variation opening on Black's
// move must read "1... c5", not a bare "c5".
function emitSeq(nodes, out) {
	let forceNumber = true;
	for (const n of nodes) {
		if (n.ply % 2 === 0) out.push(fullmove(n.ply) + ".");
		else if (forceNumber) out.push(fullmove(n.ply) + "...");
		out.push(n.san);
		forceNumber = false;
		// Everything below annotates the move just written, and each of them
		// separates White's move from Black's reply — so Black has to re-state
		// its move number afterwards, or a reader pairs it with the wrong move.
		for (const g of n.nags) {
			out.push("$" + g);
			forceNumber = true;
		}
		for (const c of n.comments) {
			out.push("{" + commentText(c) + "}");
			forceNumber = true;
		}
		for (const v of n.variations) {
			const inner = [];
			emitSeq(v, inner);
			out.push("(" + inner.join(" ") + ")");
			forceNumber = true;
		}
	}
}

// A node's comments are written AFTER its move: a PGN comment annotates the
// move it follows, which is also how annotate() anchors notes and marks.
export function writeMovetext(nodes, result) {
	const out = [];
	emitSeq(nodes, out);
	out.push(result);
	const lines = [];
	let line = "";
	for (const tok of out) {
		if (!line) line = tok;
		else if (line.length + 1 + tok.length <= WRAP) line += " " + tok;
		else {
			lines.push(line);
			line = tok;
		}
	}
	if (line) lines.push(line);
	return lines.join("\n");
}
```

Note the parenthesised variation is pushed as ONE token; a variation longer
than 80 characters therefore overflows the wrap. The wrapping test uses a
variation-free line for that reason. Task 8 revisits it if the fixture output
trips the length assertion.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/pgn-out.test.mjs`
Expected: PASS, 14 tests

- [x] **Step 5: Commit**

```bash
git add src/pgn-out.js tests/pgn-out.test.mjs
git commit -m "Write spec-conformant movetext from a PGN tree"
```

---

### Task 4: Hang NAGs and comments on the tree

Annotates the tree from the state: per-move marks, line names and evals, and
the notes list.

**Files:**
- Modify: `src/pgn-out.js`
- Test: `tests/pgn-out.test.mjs`

`annotate(trunk, lines, notes)` takes the notes list explicitly rather than
calling `allNotes()`, so the module stays free of `state.js` and the test can
pass notes directly.

- [x] **Step 1: Write the failing test**

Append to `tests/pgn-out.test.mjs` (add `annotate` to the import):

```js
// treeFromLines + annotate, returning the trunk, with the per-line index the
// tests need to attach marks first.
function annotated(pgn, decorate = () => {}, notes = []) {
	const lines = linesOf(pgn);
	decorate(lines);
	const t = treeFromLines(lines);
	annotate(t, lines, notes);
	return { tree: t, lines };
}

test("a per-move mark becomes a NAG on that move", () => {
	const { tree } = annotated("1. e4 e5 *", (lines) => {
		lines[0].marks = { 0: "!" };
	});
	assert.deepEqual(tree[0].nags, [1]);
	assert.deepEqual(tree[1].nags, []);
});

test("a mark with no standard code becomes a comment", () => {
	const { tree } = annotated("1. e4 *", (lines) => {
		lines[0].marks = { 0: "TN" };
	});
	assert.deepEqual(tree[0].nags, []);
	assert.deepEqual(tree[0].comments, ["TN"]);
});

test("a mark on a sideline lands on the sideline's node", () => {
	const { tree } = annotated("1. e4 e5 (1... c5) *", (lines) => {
		lines[1].marks = { 1: "±" };
	});
	assert.deepEqual(tree[1].nags, []);
	assert.deepEqual(tree[1].variations[0][0].nags, [16]);
});

test("a line's name and eval comment its first divergent move", () => {
	const { tree } = annotated("1. e4 e5 (1... c5) *", (lines) => {
		lines[1].name = "Sicilian";
		lines[1].meta = { eval: "∞" };
	});
	assert.deepEqual(tree[1].variations[0][0].comments, ["Sicilian ∞"]);
});

test("a note comments the move it is anchored to", () => {
	const { tree } = annotated(
		"1. e4 e5 2. Nf3 *",
		() => {},
		[{ n: 1, ply: 2, text: "the main try", owner: null }],
	);
	assert.deepEqual(tree[2].comments, ["the main try"]);
});

test("a note owned by a sideline lands on the sideline's move", () => {
	const { tree, lines } = annotated("1. e4 e5 (1... c5) *", () => {});
	annotate(tree, lines, [
		{ n: 1, ply: 1, text: "sharper", owner: lines[1] },
	]);
	assert.deepEqual(tree[1].comments, []);
	assert.deepEqual(tree[1].variations[0][0].comments, ["sharper"]);
});

test("imported NAGs survive as marks and re-export", () => {
	const { tree } = annotated("1. e4 $1 e5 *");
	assert.deepEqual(tree[0].nags, [1]);
});
```

The last test depends on Task 5; it will fail until then. Note that in the
plan's order and leave it failing only for the length of that task.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/pgn-out.test.mjs`
Expected: FAIL — `annotate is not a function` / not exported

- [x] **Step 3: Write the implementation**

Append to `src/pgn-out.js` (and add the import at the top of the file:
`import { nagFor } from "./nags.js";`):

```js
// Index a tree by the line that owns each node, so an annotation belonging to
// a particular line reaches THAT line's node — a variation's first move shares
// a ply with the mainline move it replaces, so ply alone is ambiguous.
function indexByLine(trunk, lines) {
	const main = lines.find((l) => l.isMain) || lines[0];
	const idx = new Map(); // line -> Map(ply -> node)
	const walk = (nodes, owner) => {
		let per = idx.get(owner);
		if (!per) idx.set(owner, (per = new Map()));
		for (const n of nodes) {
			per.set(n.ply, n);
			for (const v of n.variations) {
				// the line whose own tail starts with this variation's moves
				const found = lines.find(
					(l) =>
						l !== owner &&
						v.every((vn, i) => {
							const m = l.moves[l.moves.length - v.length + i];
							return m && m.san === vn.san && m.ply === vn.ply;
						}),
				);
				walk(v, found || owner);
			}
		}
	};
	walk(trunk, main);
	return idx;
}

// The node carrying a line's move at `ply`: its own if it has one there,
// otherwise the trunk's (the move is in the shared prefix, which the trunk
// owns).
function nodeFor(idx, line, ply, main) {
	const own = idx.get(line);
	return (own && own.get(ply)) || (idx.get(main) && idx.get(main).get(ply));
}

export function annotate(trunk, lines, notes) {
	const main = lines.find((l) => l.isMain) || lines[0];
	const idx = indexByLine(trunk, lines);

	for (const l of lines) {
		// per-move symbols
		for (const [ply, sym] of Object.entries(l.marks || {})) {
			const n = nodeFor(idx, l, Number(ply), main);
			if (!n) continue;
			const code = nagFor(sym);
			if (code === undefined) {
				if (!n.comments.includes(sym)) n.comments.push(sym);
			} else if (!n.nags.includes(code)) n.nags.push(code);
		}
		// the line's own name and evaluation, on its first divergent move
		const label = [l.name, (l.meta || {}).eval].filter(Boolean).join(" ");
		if (label && !l.isMain) {
			const d = divergence(l, main);
			const m = l.moves[d] || l.moves[l.moves.length - 1];
			const n = m && nodeFor(idx, l, m.ply, main);
			if (n && !n.comments.includes(label)) n.comments.push(label);
		}
	}

	for (const note of notes) {
		const owner = note.owner || main;
		const n = nodeFor(idx, owner, note.ply, main);
		const text = note.foot ? note.text || "" : note.text;
		if (n && text && !n.comments.includes(text)) n.comments.push(text);
	}
	return trunk;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/pgn-out.test.mjs`
Expected: PASS except `imported NAGs survive as marks and re-export`, which
Task 5 fixes.

- [x] **Step 5: Commit**

```bash
git add src/pgn-out.js tests/pgn-out.test.mjs
git commit -m "Annotate the export tree with marks, names and notes"
```

---

### Task 5: Carry imported NAGs into line marks

`pgn.js` already parses `$n` into `node.nags`, and `tree.js` throws it away.
This makes an imported annotation survive into the editor and back out.

**Files:**
- Modify: `src/tree.js:8-11` (`chainToMoves`)
- Test: `tests/tree.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/tree.test.mjs`:

```js
test("carries a move's imported NAGs onto the line's marks", () => {
	const lines = collectLines(parsePgn("1. e4 $1 e5 $16 *").nodes);
	assert.deepEqual(lines[0].marks, { 0: "!", 1: "±" });
});

test("ignores a NAG code outside the table", () => {
	const lines = collectLines(parsePgn("1. e4 $250 *").nodes);
	assert.deepEqual(lines[0].marks, {});
});
```

Check the file's existing imports first; add `parsePgn` from `../src/pgn.js`
and `collectLines` from `../src/tree.js` only if they are not already there.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/tree.test.mjs`
Expected: FAIL — `marks` is undefined

- [x] **Step 3: Write the implementation**

In `src/tree.js`, add the import at the top:

```js
import { symFor } from "./nags.js";
```

Replace `chainToMoves` and add a marks builder:

```js
function chainToMoves(chain) {
	return chain
		.filter((x) => x && x.san)
		.map((x) => ({ san: x.san, ply: x.ply }));
}

// A line's per-move symbols, recovered from the NAG codes the PGN carried.
// pgn.js records them on the node; without this they would be parsed and then
// silently dropped, so an imported annotation could never be re-exported.
// A code outside our table has no glyph to show, so it is skipped.
function chainToMarks(chain) {
	const marks = {};
	chain.forEach((x) => {
		if (!x || !x.san || !x.nags) return;
		for (const code of x.nags) {
			const sym = symFor(code);
			if (sym) {
				marks[x.ply] = sym;
				break;
			}
		}
	});
	return marks;
}
```

Then set `marks` where lines are built. In `walk()`:

```js
			lines.push({
				moves: chainToMoves(path),
				marks: chainToMarks(path),
				fen: last.fen,
				ply: last.ply,
				comments: nodeComments(own),
			});
```

and on the mainline object:

```js
	const main = {
		moves: chainToMoves(chain),
		marks: chainToMarks(chain),
		fen: last.fen,
		ply: last.ply,
		isMain: true,
		comments: nodeComments(chain),
	};
```

- [x] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS — including `imported NAGs survive as marks and re-export` from
Task 4. If a `store.js` or `app.js` test now sees an unexpected `marks: {}`
on a saved notebook, that is a real behaviour change to reconcile there, not a
test to loosen.

- [x] **Step 5: Commit**

```bash
git add src/tree.js tests/tree.test.mjs
git commit -m "Carry imported NAGs onto a line's marks"
```

---

### Task 6: buildPgn — tags plus movetext

The one public entry point, and the fix for the actual bug.

**Files:**
- Modify: `src/pgn-out.js`
- Test: `tests/pgn-out.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/pgn-out.test.mjs` (add `buildPgn` to the import):

```js
test("emits a full seven tag roster", () => {
	const out = buildPgn({ name: "Ruy Lopez", lines: linesOf("1. e4 e5 *") });
	const tags = out.split("\n\n")[0].split("\n");
	assert.deepEqual(tags, [
		'[Event "Ruy Lopez"]',
		'[Site "?"]',
		'[Date "????.??.??"]',
		'[Round "?"]',
		'[White "?"]',
		'[Black "?"]',
		'[Result "*"]',
	]);
});

test("falls back to ? for an unnamed notebook", () => {
	const out = buildPgn({ lines: linesOf("1. e4 *") });
	assert.ok(out.startsWith('[Event "?"]'));
});

test("escapes quotes and backslashes in a tag value", () => {
	const out = buildPgn({ name: 'the "sharp" \\ line', lines: linesOf("1. e4 *") });
	assert.ok(out.includes('[Event "the \\"sharp\\" \\\\ line"]'), out);
});

test("a blank state produces a valid empty game", () => {
	const out = buildPgn({ lines: [] });
	assert.ok(out.includes('[Result "*"]'));
	assert.ok(out.trimEnd().endsWith("*"));
});

test("ends with a single trailing newline", () => {
	const out = buildPgn({ lines: linesOf("1. e4 *") });
	assert.ok(out.endsWith("*\n"));
	assert.ok(!out.endsWith("\n\n"));
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/pgn-out.test.mjs`
Expected: FAIL — `buildPgn is not a function`

- [x] **Step 3: Write the implementation**

Add to the top of `src/pgn-out.js`:

```js
import { allNotes } from "./notes.js";
```

Append:

```js
// A PGN tag value is a quoted string: '"' and '\' are the only characters that
// need escaping, and both escape with a backslash.
function tagValue(s) {
	return String(s || "?").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// The full Seven Tag Roster. It is not decoration: importers (lichess,
// chesstempo) reject or mangle a file that omits it, and the report has no
// player or event data to put there, so the spec's "?" / "????.??.??"
// placeholders stand in.
function tagPairs(state, result) {
	return [
		["Event", state.name || "?"],
		["Site", "?"],
		["Date", "????.??.??"],
		["Round", "?"],
		["White", "?"],
		["Black", "?"],
		["Result", result],
	]
		.map(([k, v]) => `[${k} "${tagValue(v)}"]`)
		.join("\n");
}

// The whole export: tag pairs, a blank line, movetext.
//
// `state` is passed in rather than read from state.js on purpose. The bug this
// module replaces was export.js shipping `getCurrent().pgn` — the text the user
// IMPORTED — so every edit was missing from the file. Taking the state as an
// argument keeps the serializer honest and directly testable.
export function buildPgn(state) {
	const lines = state.lines || [];
	const result = state.result || "*";
	const trunk = treeFromLines(lines);
	annotate(trunk, lines, lines.length ? allNotes() : []);
	return tagPairs(state, result) + "\n\n" + writeMovetext(trunk, result) + "\n";
}
```

`allNotes()` reads `getCurrent()`, so `buildPgn` is called with the same state
that is current — which is how `export.js` already calls `buildMarkdown()`.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/pgn-out.test.mjs`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/pgn-out.js tests/pgn-out.test.mjs
git commit -m "Assemble the PGN export from tags and movetext"
```

---

### Task 7: Wire up Export PGN and add Copy PGN

**Files:**
- Modify: `src/export.js:80-88` (the `pgn` button) and the button row at the end of `exportBar()`
- Test: `tests/export.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/export.test.mjs`, following the file's existing setup helpers
(read the top of the file for how it installs jsdom and builds state):

```js
test("Export PGN serializes the current state, not the imported text", () => {
	const teardown = installDom();
	const state = loadState("1. e4 e5 *", { name: "Test" });
	state.lines[0].marks = { 0: "!" };
	const bar = exportBar();
	const btn = [...bar.querySelectorAll("button")].find(
		(b) => b.textContent === "Export PGN",
	);
	const saved = [];
	global.URL.createObjectURL = () => "blob:x";
	global.URL.revokeObjectURL = () => {};
	global.Blob = class {
		constructor(parts) {
			saved.push(parts.join(""));
		}
	};
	btn.onclick();
	assert.ok(saved[0].includes("$1"), saved[0]);
	assert.ok(saved[0].includes('[Event "Test"]'), saved[0]);
	teardown();
});

test("Copy PGN writes the export to the clipboard", async () => {
	const teardown = installDom();
	loadState("1. e4 e5 *", { name: "Test" });
	const bar = exportBar();
	const btn = [...bar.querySelectorAll("button")].find(
		(b) => b.textContent === "Copy PGN",
	);
	let written = "";
	Object.defineProperty(global.navigator, "clipboard", {
		value: { writeText: async (t) => (written = t) },
		configurable: true,
	});
	await btn.onclick();
	assert.ok(written.includes("1. e4 e5 *"), written);
	assert.equal(btn.textContent, "Copied ✓");
	teardown();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/export.test.mjs`
Expected: FAIL — the first on the missing `$1`, the second on `btn` being
undefined

- [x] **Step 3: Write the implementation**

In `src/export.js`, add the import:

```js
import { buildPgn } from "./pgn-out.js";
```

The existing Copy report handler duplicates a clipboard-with-fallback block
that a second copy button would repeat, so lift it to a helper first — put this
next to `download()`:

```js
// Clipboard write with the execCommand fallback browsers without the async
// clipboard API (and jsdom) still need, plus the button's "Copied ✓" flash.
async function copyToClipboard(text, btn, label) {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		const ta = document.createElement("textarea");
		ta.value = text;
		document.body.appendChild(ta);
		ta.select();
		document.execCommand("copy");
		ta.remove();
	}
	btn.textContent = "Copied ✓";
	setTimeout(() => (btn.textContent = label), 1500);
}
```

Replace the `pgn.onclick` line with:

```js
	pgn.onclick = () =>
		download(slug() + ".pgn", buildPgn(getCurrent()), "application/x-chess-pgn");
```

Rewrite the existing Copy report handler to use the helper:

```js
	const copy = el("button", { className: "chip", textContent: "Copy report" });
	copy.onclick = () => copyToClipboard(buildMarkdown(), copy, "Copy report");
```

And add the new button beside it:

```js
	const copyPgn = el("button", { className: "chip", textContent: "Copy PGN" });
	copyPgn.onclick = () => copyToClipboard(buildPgn(getCurrent()), copyPgn, "Copy PGN");
```

Finally extend the append at the end of `exportBar()`:

```js
	bar.append(printBtn, pgn, copyPgn, md, copy);
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/export.test.mjs`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/export.js tests/export.test.mjs
git commit -m "Export and copy PGN built from the live state"
```

---

### Task 8: Validate against chess.js and round-trip

The verification the task calls for: output must satisfy an external parser
and survive a trip back through our own.

**Files:**
- Test: `tests/pgn-out.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/pgn-out.test.mjs`:

```js
import { Chess } from "chess.js";
import { readFileSync } from "node:fs";
import { setCurrent } from "../src/state.js";

const FIXTURE = readFileSync(
	new URL("./fixtures/capablanca.pgn", import.meta.url),
	"utf8",
);

const CASES = [
	["plain mainline", "1. e4 e5 2. Nf3 Nc6 *"],
	["one sideline", "1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 *"],
	["nested sidelines", "1. e4 c5 2. Nf3 d6 (2... Nc6 3. Bb5 (3. d4 cxd4)) *"],
	["comments", "1. e4 {best by test} e5 (1... c5 {sharp}) *"],
	["NAGs", "1. e4 $1 e5 $16 2. Nf3 $13 *"],
	["a decisive result", "1. e4 e5 1-0"],
	["the capablanca fixture", FIXTURE],
];

for (const [name, pgn] of CASES) {
	test(`chess.js parses our export of ${name}`, () => {
		const lines = linesOf(pgn);
		setCurrent({ name: "T", lines, pgn });
		const out = buildPgn({ name: "T", lines, result: parsePgn(pgn).result });
		const c = new Chess();
		assert.doesNotThrow(() => c.loadPgn(out), out);
		// the trunk actually survived, rather than loading as an empty game
		assert.ok(c.history().length > 0, out);
	});

	test(`our parser round-trips our export of ${name}`, () => {
		const lines = linesOf(pgn);
		setCurrent({ name: "T", lines, pgn });
		const out = buildPgn({ name: "T", lines, result: parsePgn(pgn).result });
		const back = collectLines(parsePgn(out).nodes);
		const key = (ls) =>
			ls
				.map((l) => l.moves.map((m) => m.ply + m.san).join(" "))
				.sort()
				.join(" | ");
		assert.equal(key(back), key(lines), out);
	});
}

test("marks survive a round-trip", () => {
	const lines = linesOf("1. e4 e5 2. Nf3 *");
	lines[0].marks = { 0: "!", 2: "±" };
	setCurrent({ name: "T", lines });
	const out = buildPgn({ name: "T", lines });
	const back = collectLines(parsePgn(out).nodes);
	assert.deepEqual(back[0].marks, { 0: "!", 2: "±" });
});
```

`setCurrent` is needed because `buildPgn` calls `allNotes()`, which reads the
current state.

- [x] **Step 2: Run the tests**

Run: `node --test tests/pgn-out.test.mjs`
Expected: some FAIL. These are the tests that earn the task — likely failures
and what they mean:
- a move-number error surfaces as chess.js rejecting the movetext
- a mis-nested variation surfaces as the round-trip line-set mismatch
- the fixture may exceed 80 columns inside a long variation; if so, teach
  `writeMovetext` to wrap inside a variation by emitting `(`, the inner tokens
  and `)` as separate tokens rather than one joined string

Fix `src/pgn-out.js` until all pass. Do not weaken an assertion to make it go
green.

- [x] **Step 3: Run the whole suite and the linter**

Run: `npm test && npm run lint`
Expected: PASS, no lint errors

- [x] **Step 4: Commit**

```bash
git add src/pgn-out.js tests/pgn-out.test.mjs
git commit -m "Verify PGN export against chess.js and a parser round-trip"
```

---

### Task 9: Rebuild the palette from the NAG table, behind a drawer

The palette grows from 23 hand-listed symbols to the full table, so the extra
entries go in a closed `<details>` and the visible row stays as dense as now.

**Files:**
- Modify: `src/line-editor.js:94-119` (`EVAL_SYMBOLS`) and `:248-262` (the `srow` loop)
- Modify: `style.css` (after the `.sympick` rule at line 203)
- Test: `tests/line-editor.test.mjs`

- [x] **Step 1: Write the failing test**

Append to `tests/line-editor.test.mjs`, matching the file's existing setup:

```js
test("the default row shows only the common symbols", () => {
	const teardown = installDom();
	const state = loadState("1. e4 e5 *");
	state.sel = { l: state.lines[0], ply: 0 };
	const panel = movePanel(state.lines[0], 0);
	const shown = [...panel.querySelectorAll(".sympick > button")].map(
		(b) => b.textContent,
	);
	assert.ok(shown.includes("!"));
	assert.ok(shown.includes("±"));
	assert.ok(!shown.includes("⨀"), "zugzwang belongs in the drawer");
	teardown();
});

test("the drawer holds the rest, grouped, and is closed by default", () => {
	const teardown = installDom();
	const state = loadState("1. e4 e5 *");
	state.sel = { l: state.lines[0], ply: 0 };
	const panel = movePanel(state.lines[0], 0);
	const drawer = panel.querySelector("details.symmore");
	assert.ok(drawer, "no drawer rendered");
	assert.equal(drawer.open, false);
	const more = [...drawer.querySelectorAll("button")].map((b) => b.textContent);
	assert.ok(more.includes("⨀"));
	assert.ok(more.includes("⇆"));
	assert.ok(drawer.querySelectorAll(".symgroup-h").length >= 2);
	teardown();
});

test("a drawer symbol applies the mark like a common one", () => {
	const teardown = installDom();
	const state = loadState("1. e4 e5 *");
	state.sel = { l: state.lines[0], ply: 0 };
	const panel = movePanel(state.lines[0], 0);
	const btn = [...panel.querySelectorAll("details.symmore button")].find(
		(b) => b.textContent === "↑",
	);
	btn.onclick();
	assert.equal(state.lines[0].marks[0], "↑");
	teardown();
});
```

Check how the file already renders and reaches `movePanel` — import whatever it
imports, and use its existing selection setup if it differs from `state.sel`.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/line-editor.test.mjs`
Expected: FAIL — no `details.symmore` element

- [x] **Step 3: Write the implementation**

In `src/line-editor.js`, add the import:

```js
import { NAGS } from "./nags.js";
```

Replace the hand-written `EVAL_SYMBOLS` array with a derivation, keeping the
leading `""` the existing callers rely on as the clear entry:

```js
// Advantage/quality symbols offered in the line editor's evaluation picker,
// derived from the NAG table so the palette can never offer a symbol the PGN
// exporter has no code for. The leading "" is the clear entry.
//
// A symbol shared by a White/Black pair (zugzwang, initiative, ...) appears
// once: the palette annotates a move with a glyph, and which side it refers to
// is what the move itself already says.
export const EVAL_SYMBOLS = [
	"",
	...new Set(NAGS.filter((n) => n.sym).map((n) => n.sym)),
	"TN", // theoretical novelty; no standard code, exported as a comment
];
```

Replace the `srow` construction (the `EVAL_SYMBOLS.forEach` block) with a
common row plus a grouped drawer:

```js
	const srow = el("span", { className: "sympick" });
	const symButton = (sym, title) => {
		const b = el("button", {
			type: "button",
			className: "chip mini" + (cur === sym ? " on" : ""),
			textContent: sym,
			title: title || sym,
		});
		b.onclick = () => {
			apply(sym);
			getRenderHooks().renderApp();
		};
		return b;
	};
	// The table is large enough that showing every glyph at once would bury the
	// handful in constant use, so the common ones stay on the visible row and
	// the rest live in a drawer, grouped the way the PGN spec groups them.
	const common = NAGS.filter((n) => n.common && n.sym);
	const commonSyms = new Set(common.map((n) => n.sym));
	common.forEach((n) => srow.appendChild(symButton(n.sym, n.label)));
	srow.appendChild(symButton("TN", "theoretical novelty"));
	const clear = el("button", {
		type: "button",
		className: "chip mini danger",
		textContent: "✕",
		title: "clear",
	});
	clear.onclick = () => {
		apply("");
		getRenderHooks().renderApp();
	};
	srow.appendChild(clear);
	box.appendChild(srow);

	const more = el("details", { className: "symmore" });
	more.appendChild(el("summary", { textContent: "More symbols" }));
	const GROUPS = [
		["move", "Move assessment"],
		["position", "Position"],
		["time", "Time pressure"],
	];
	GROUPS.forEach(([g, title]) => {
		const rest = NAGS.filter(
			(n) => n.group === g && n.sym && !commonSyms.has(n.sym),
		);
		// a paired glyph appears under one heading only
		const seen = new Set();
		const picks = rest.filter((n) => !seen.has(n.sym) && seen.add(n.sym));
		if (!picks.length) return;
		more.appendChild(el("span", { className: "symgroup-h", textContent: title }));
		const row = el("span", { className: "sympick" });
		picks.forEach((n) => row.appendChild(symButton(n.sym, n.label)));
		more.appendChild(row);
	});
	box.appendChild(more);
```

In `style.css`, after the existing `.sympick` rule, add:

```css
.symmore {
	margin-top: 0.4rem;
}
.symmore > summary {
	cursor: pointer;
	font-size: 0.85em;
	opacity: 0.75;
}
.symgroup-h {
	display: block;
	margin: 0.4rem 0 0.15rem;
	font-size: 0.8em;
	opacity: 0.7;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/line-editor.test.mjs`
Expected: PASS

- [x] **Step 5: Run the whole suite**

Run: `npm test && npm run lint && npm run knip`
Expected: PASS. `knip` should report no unused export from `nags.js` — if it
flags one, that export has no caller and should be removed rather than ignored.

- [x] **Step 6: Commit**

```bash
git add src/line-editor.js style.css tests/line-editor.test.mjs
git commit -m "Offer the full NAG palette, with the rarer symbols in a drawer"
```

---

### Task 10: Close out

**Files:**
- Modify: `docs/superpowers/plans/2026-08-25-pgn-export.md`

- [x] **Step 1: Full verification**

Run: `npm test && npm run lint && npm run knip && npm run coverage`
Expected: all pass; `src/pgn-out.js` and `src/nags.js` well covered.

Do not import `src/app.js` with a `?t=` cache-buster in any new test — it hides
most of that module's coverage.

- [x] **Step 2: Manual check**

Open `index.html`, import a PGN, add symbols and notes, promote a sideline, then
Export PGN. Paste the file into lichess's PGN import and chesstempo. Both must
load the game with its variations, symbols and comments intact.

- [x] **Step 3: Mark the plan complete and close the task**

```bash
git commit -am "Mark the PGN export plan complete"
task a3f4f9db done
```
