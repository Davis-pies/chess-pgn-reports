import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { grid } from "../src/table.js";
import { renderTrieTable } from "../src/trie-view.js";
import { openTablePaths } from "../src/state.js";

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
