import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { grid } from "../src/table.js";
import { renderTrieTable } from "../src/trie-view.js";
import { openTablePaths, getTraced, setTraced } from "../src/state.js";

// Two sidelines sharing 1...c5 2. Nf3 d6 and forking on move 3, so the trie
// has one group whose column carries c5, Nf3 and d6 -- the shape the note
// markers were reported missing from.
const GROUP = "1. e4 e5 (1... c5 2. Nf3 d6 3. d4 (3. Bb5+)) 2. Nf3";
const GROUP_KEY = "1:c5";

// Render the screen preview (never the print path, which is ungrouped).
function preview(pgn, { note = () => {}, open = [], orientation } = {}) {
	const s = loadState(pgn);
	note(s);
	openTablePaths.clear();
	open.forEach((k) => openTablePaths.add(k));
	const box = document.createElement("div");
	renderTrieTable(box, grid(s.lines), orientation || "horizontal");
	return box;
}

// A cell's move text and its note markers, kept apart: td() writes the move as
// a text node and the marker sup is appended after it.
const moveOf = (td) =>
	td.childNodes[0] && td.childNodes[0].nodeType === 3
		? td.childNodes[0].textContent
		: "";
const refsOf = (td) => (td.querySelector("sup") || {}).textContent || "";

// Columns of the horizontal table, by header text, each with its ply cells.
function columns(box) {
	const rows = [...box.querySelectorAll("tr")];
	return [...rows[0].children].map((h, i) => ({
		name: h.textContent,
		cells: rows.slice(1).map((r) => r.children[i]).filter(Boolean),
	}));
}
const column = (box, name) => columns(box).find((c) => c.name.includes(name));
const cell = (col, move) => col.cells.find((c) => moveOf(c) === move);

const noteOnShared = (s) =>
	s.lines
		.filter((l) => !l.isMain)
		.forEach((l) => (l.comments = [{ ply: 3, text: "shared d6 note" }]));

test("an open group's column carries the note markers for the moves it shows", () => {
	const off = installDom();
	const box = preview(GROUP, { note: noteOnShared, open: [GROUP_KEY] });
	const grp = column(box, "2 lines");
	assert.strictEqual(refsOf(cell(grp, "d6")), "1", "the group column marks d6");
	off();
});

test("the lines under an open group drop the marker its column now shows", () => {
	const off = installDom();
	const box = preview(GROUP, { note: noteOnShared, open: [GROUP_KEY] });
	// the group column's shared moves are elided to "…" on each line; a marker
	// stranded on an ellipsis pointed at a move the column no longer spells out
	columns(box)
		.filter((c) => c.name.includes("Sideline"))
		.forEach((c) =>
			c.cells.forEach((td) =>
				assert.strictEqual(
					moveOf(td) === "…" ? refsOf(td) : "",
					"",
					"no marker on an elided cell",
				),
			),
		);
	off();
});

test("a shut group's column shows notes on the moves it displays", () => {
	const off = installDom();
	// shut, the group column is the ONLY thing on screen carrying d6 -- with no
	// markers on it the note was numbered in the list and referenced nowhere
	const box = preview(GROUP, { note: noteOnShared, open: [] });
	const grp = column(box, "2 lines");
	assert.strictEqual(refsOf(cell(grp, "d6")), "1");
	off();
});

test("a note below the fork stays on its own line's column", () => {
	const off = installDom();
	const box = preview(GROUP, {
		note: (s) => {
			const bb5 = s.lines.find((l) => l.moves.some((m) => m.san === "Bb5+"));
			bb5.comments = [{ ply: 4, text: "only this line" }];
		},
		open: [GROUP_KEY],
	});
	const grp = column(box, "2 lines");
	assert.strictEqual(
		grp.cells.filter((c) => refsOf(c)).length,
		0,
		"the group column claims no note it does not show a move for",
	);
	const own = columns(box).find((c) => c.cells.some((x) => moveOf(x) === "Bb5+"));
	assert.strictEqual(refsOf(cell(own, "Bb5+")), "1");
	off();
});

test("distinct notes at one shared move are all listed on the group column", () => {
	const off = installDom();
	const box = preview(GROUP, {
		note: (s) => {
			const [a, b] = s.lines.filter((l) => !l.isMain);
			a.comments = [{ ply: 3, text: "first" }];
			b.comments = [{ ply: 3, text: "second" }];
		},
		open: [GROUP_KEY],
	});
	const grp = column(box, "2 lines");
	assert.strictEqual(refsOf(cell(grp, "d6")), "1,2");
	off();
});

test("the vertical layout marks the group row the same way", () => {
	const off = installDom();
	const box = preview(GROUP, {
		note: noteOnShared,
		open: [GROUP_KEY],
		orientation: "vertical",
	});
	// rows are variations here: find the group's row and its d6 cell
	const row = [...box.querySelectorAll("tr")].find((r) =>
		[...r.children].some((c) => moveOf(c) === "d6" && c.className.includes("collapsed")),
	);
	assert.ok(row, "the group row is on screen");
	const d6 = [...row.children].find((c) => moveOf(c) === "d6");
	assert.strictEqual(refsOf(d6), "1");
	off();
});

// --- tracing one line through the table -------------------------------------
// A line's moves are split across the Mainline column, the group columns
// enclosing it and its own tail, so reading one line means stitching three
// places together. Tracing lights exactly the cells that make up it.

const traceBox = (s, orientation = "horizontal") => {
	const box = document.createElement("div");
	renderTrieTable(box, grid(s.lines), orientation);
	return box;
};

test("a traced line's cells are lit and the rest fade", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	setTraced("e4 c5 Nf3 d6 d4");
	const box = traceBox(s);
	const lit = [...box.querySelectorAll("td.traced")].map(moveOf).sort();
	assert.deepStrictEqual(lit, ["Nf3", "c5", "d4", "d6", "e4"].sort());
	assert.ok(box.querySelector("td.faded"), "the rest of the table drops back");
	setTraced(null);
	off();
});

test("a column contributing no move to the line has a faded header", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	setTraced("e4 c5 Nf3 d6 d4");
	const heads = [...traceBox(s).querySelectorAll("th.var-head")];
	assert.strictEqual(
		heads.filter((h) => h.classList.contains("traced")).length,
		3,
		"mainline, the group column and the line's own header",
	);
	assert.strictEqual(
		heads.filter((h) => h.classList.contains("faded")).length,
		1,
		"the sibling line's header fades",
	);
	setTraced(null);
	off();
});

test("clicking a line column starts a trace, clicking it again clears it", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	setTraced(null);
	const cell = (box, san) =>
		[...box.querySelectorAll("td")].find((c) => moveOf(c) === san);
	cell(traceBox(s), "d4").onclick({});
	assert.strictEqual(getTraced(), "e4 c5 Nf3 d6 d4");
	// re-render against the new state, then click the same cell again
	cell(traceBox(s), "d4").onclick({});
	assert.strictEqual(getTraced(), null, "clicking the traced line clears it");
	off();
});

test("a group column folds rather than tracing", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	setTraced(null);
	const head = [...traceBox(s).querySelectorAll("th.var-head")].find((h) =>
		h.textContent.includes("2 lines"),
	);
	head.onclick({});
	assert.strictEqual(getTraced(), null, "no trace started");
	assert.ok(!openTablePaths.has(GROUP_KEY), "the group folded instead");
	off();
});

test("Clear trace is offered only while a line is traced", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	const chip = (n) =>
		[...n.querySelectorAll("button")].find((b) => b.textContent === "Clear trace");
	setTraced(null);
	assert.strictEqual(chip(traceBox(s)), undefined, "nothing to clear");
	setTraced("e4 c5 Nf3 d6 d4");
	const on = traceBox(s);
	assert.ok(chip(on), "offered while tracing");
	chip(on).onclick();
	assert.strictEqual(getTraced(), null);
	off();
});

test("a trace a fold has hidden stops showing rather than going stale", () => {
	const off = installDom();
	const s = loadState(GROUP);
	setTraced("e4 c5 Nf3 d6 d4");
	openTablePaths.clear(); // the group shuts over the traced line's column
	const box = traceBox(s);
	assert.strictEqual(box.querySelectorAll(".traced, .faded").length, 0);
	assert.strictEqual(getTraced(), "e4 c5 Nf3 d6 d4", "the key is kept");
	// re-opening brings it back, with no clearing hook in the fold handler
	openTablePaths.add(GROUP_KEY);
	assert.ok(traceBox(s).querySelector("td.traced"), "the trace returns");
	setTraced(null);
	off();
});

test("the vertical layout traces the same cells", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	setTraced("e4 c5 Nf3 d6 d4");
	// vertical puts each variation on a row, so its row header is a td too —
	// exclude the headers and compare the move cells
	const box = traceBox(s, "vertical");
	const lit = [...box.querySelectorAll("td.traced:not(.var-head)")]
		.map(moveOf)
		.sort();
	assert.deepStrictEqual(lit, ["Nf3", "c5", "d4", "d6", "e4"].sort());
	assert.strictEqual(
		box.querySelectorAll("td.var-head.traced").length,
		3,
		"and the three contributing rows are headed as traced",
	);
	setTraced(null);
	off();
});

test("clicking a move in a collapsed group traces it instead of expanding", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear(); // the group starts shut
	setTraced(null);
	const box = traceBox(s);
	const d6 = [...box.querySelectorAll("td")].find((c) => moveOf(c) === "d6");
	d6.onclick({});
	assert.ok(!openTablePaths.has(GROUP_KEY), "the group stays shut");
	assert.ok(getTraced(), "a trace started instead");
	// the traced stem: the mainline's e4, then the moves the column shows
	const lit = [...traceBox(s).querySelectorAll("td.traced")].map(moveOf).sort();
	assert.deepStrictEqual(lit, ["Nf3", "c5", "d6", "e4"].sort());
	setTraced(null);
	off();
});

test("a group's header still folds while its cells trace", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	setTraced(null);
	const head = [...traceBox(s).querySelectorAll("th.var-head")].find((h) =>
		h.textContent.includes("2 lines"),
	);
	head.onclick({});
	assert.ok(!openTablePaths.has(GROUP_KEY), "the header folded the group");
	assert.strictEqual(getTraced(), null, "and started no trace");
	off();
});

test("a group column's trace is its own, not a line's that ends at the fork", () => {
	const off = installDom();
	// a bare 1...c5 line beside 1...c5 2.Nf3 and 1...c5 2.Nc3: the group's stem
	// is exactly the short line's moves, so a SAN-path key would collide
	const s = loadState("1. e4 e5 (1... c5) (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3");
	openTablePaths.clear();
	openTablePaths.add("1:c5");
	setTraced(null);
	const box = traceBox(s);
	const groupCell = [...box.querySelectorAll("td")].find(
		(c) => moveOf(c) === "c5" && c.className.includes("collapsed"),
	);
	groupCell.onclick({});
	assert.strictEqual(getTraced(), "@1:c5", "the group traces by its own key");
	// the short line's own column is NOT part of the group's stem
	const after = traceBox(s);
	const shortCol = [...after.querySelectorAll("td.traced")].filter(
		(c) => moveOf(c) === "c5",
	);
	assert.strictEqual(shortCol.length, 1, "only the group column's c5 lights");
	setTraced(null);
	off();
});

test("tracing a group column and then a line under it swaps cleanly", () => {
	const off = installDom();
	const s = loadState(GROUP);
	openTablePaths.clear();
	openTablePaths.add(GROUP_KEY);
	setTraced(null);
	const cellOf = (box, san) =>
		[...box.querySelectorAll("td")].find((c) => moveOf(c) === san);
	cellOf(traceBox(s), "d6").onclick({}); // a group-column cell
	assert.strictEqual(getTraced(), "@" + GROUP_KEY);
	cellOf(traceBox(s), "d4").onclick({}); // now a line under it
	assert.strictEqual(getTraced(), "e4 c5 Nf3 d6 d4");
	setTraced(null);
	off();
});
