import { test } from "node:test";
import assert from "node:assert";
import { loadState } from "./helpers.mjs";
import { grid } from "../src/table.js";
import {
	groupedVars,
	flatGroupedVars,
	orderedLeaves,
} from "../src/group-cols.js";
import { getCurrent } from "../src/state.js";

// Two sidelines sharing 1...c5 2. Nf3 d6 and forking on move 3.
const GROUP = "1. e4 e5 (1... c5 2. Nf3 d6 3. d4 (3. Bb5+)) 2. Nf3";
const GROUP_KEY = "1:c5";

// grid() the PGN, optionally after a tweak to the parsed lines, and hand back
// the reference var and the rest, as trie-view.js and print.js call in.
function cols(pgn, tweak = () => {}, opts = {}) {
	const s = loadState(pgn);
	Object.assign(s, opts);
	tweak(s.lines);
	const g = grid(s.lines);
	return { main: g.vars[0], rest: g.vars.slice(1), lines: s.lines };
}
const text = (v) =>
	Object.keys(v.cells)
		.map(Number)
		.sort((a, b) => a - b)
		.map((p) => v.cells[p].text)
		.join(" ");
const bySan = (lines, san) =>
	lines.find((l) => l.moves[l.moves.length - 1].san === san);

test("groupedVars with no options: a shut, inert group column", () => {
	const { main, rest } = cols(GROUP);
	const vars = groupedVars(main, rest);
	assert.strictEqual(vars.length, 2, "the mainline and one group stub");
	assert.strictEqual(vars[0], main, "the mainline column is the reference itself");
	const g = vars[1];
	assert.strictEqual(g.tag, "collapse");
	assert.strictEqual(g.collapsed, true);
	assert.strictEqual(text(g), "… c5 Nf3 d6", "the shared run, after an ellipsis");
	assert.strictEqual(g.name, "", "no line count without a fold handler");
	assert.strictEqual(g.onclick, undefined, "no fold control");
	assert.strictEqual(g.trail, undefined);
	assert.strictEqual(g.gdepth, undefined);
	assert.strictEqual(g.traceKey, "@" + GROUP_KEY);
	assert.deepStrictEqual(
		g.moves.map((m) => m.san),
		["e4", "c5", "Nf3", "d6"],
		"the stem is the path from ply 0 to the last shared move",
	);
	assert.strictEqual(g.groupLines.length, 2, "both lines under it");
});

test("an open group elides its children and shades the block", () => {
	const { main, rest } = cols(GROUP);
	const toggled = [];
	const vars = groupedVars(main, rest, {
		isOpen: (k) => k === GROUP_KEY,
		onToggle: (k, open) => toggled.push([k, open]),
	});
	assert.strictEqual(vars.length, 4, "mainline, group header, two lines");
	const [, g, a, b] = vars;
	assert.strictEqual(g.collapsed, false);
	assert.strictEqual(g.name, "2 lines");
	assert.strictEqual(g.gdepth, 1);
	assert.strictEqual(g.gstart, true);
	assert.deepStrictEqual(g.trail, [], "a top-level group has an empty trail");
	for (const v of [a, b]) {
		assert.strictEqual(v.gdepth, 1, "children share the group's shading");
		assert.deepStrictEqual(v.trail, [g], "children trace through the group");
		assert.strictEqual(v.gstart, undefined);
	}
	assert.deepStrictEqual(
		[text(a), text(b)].sort(),
		["… … … … Bb5+", "… … … … d4"],
		"the shared moves are elided from each child",
	);
	g.onclick();
	assert.deepStrictEqual(toggled, [[GROUP_KEY, true]], "folding passes the key and state");
});

test("a shut group under a fold handler keeps its count and no shading", () => {
	const { main, rest } = cols(GROUP);
	const [, g] = groupedVars(main, rest, { onToggle() {} });
	assert.strictEqual(g.name, "2 lines");
	assert.strictEqual(g.gdepth, undefined, "a shut top-level group opens no block");
	assert.strictEqual(g.gstart, undefined);
	assert.strictEqual(typeof g.onclick, "function");
});

test("a lone sideline is a plain column with nothing to fold", () => {
	const { main, rest } = cols("1. e4 e5 (1... c5 2. Nf3) 2. Nf3");
	const vars = groupedVars(main, rest, { onToggle() {} });
	assert.strictEqual(vars.length, 2);
	assert.strictEqual(vars[1].tag, "sideline");
	assert.strictEqual(vars[1].gdepth, undefined, "depth 0 adds no gdepth");
	assert.deepStrictEqual(vars[1].trail, []);
	assert.notStrictEqual(vars[1], rest[0], "columns are copies");
});

test("a note on a shared move moves onto the group column", () => {
	const { main, rest } = cols(GROUP, (lines) => {
		bySan(lines, "d4").comments = [{ text: "the main try", ply: 2 }];
		bySan(lines, "Bb5+").comments = [{ text: "the main try", ply: 2 }];
	});
	const [, g, a, b] = groupedVars(main, rest, {
		isOpen: () => true,
		onToggle() {},
	});
	assert.deepStrictEqual(g.noteByPly, { 2: [1] }, "one number for the shared note");
	for (const v of [a, b])
		assert.deepStrictEqual(v.noteByPly, {}, "the elided cell drops its marker");
});

test("different notes on one shared move list both, sorted", () => {
	const { main, rest } = cols(GROUP, (lines) => {
		bySan(lines, "Bb5+").comments = [{ text: "second", ply: 3 }];
		bySan(lines, "d4").comments = [{ text: "first", ply: 3 }];
	});
	const [, g] = groupedVars(main, rest);
	assert.deepStrictEqual(g.noteByPly, { 3: [1, 2] });
});

test("a note past the shared run stays with its line, not the group", () => {
	const { main, rest } = cols(GROUP, (lines) => {
		bySan(lines, "d4").comments = [{ text: "tail note", ply: 4 }];
	});
	const [, g, ...kids] = groupedVars(main, rest, { isOpen: () => true });
	assert.deepStrictEqual(g.noteByPly, {});
	assert.ok(
		kids.some((v) => v.noteByPly[4] && v.noteByPly[4][0] === 1),
		"the tail keeps its marker",
	);
});

test("a symbol on a shared move shows on the group column, first line wins", () => {
	const { main, rest } = cols(GROUP, (lines) => {
		// collectLines puts the nested 3. Bb5+ line first in reading order
		bySan(lines, "Bb5+").marks = { 2: "$1", 4: "$3" };
		bySan(lines, "d4").marks = { 2: "$2" };
	});
	const [, g] = groupedVars(main, rest);
	assert.strictEqual(g.cells[2].mark, "!", "resolved to the glyph");
	assert.strictEqual(g.cells[1].mark, "", "an unmarked shared move stays blank");
	assert.strictEqual(g.cells[4], undefined, "no cell past the fork to carry $3");
});

test("a line ending at the fork keeps its last move beside the continuations", () => {
	const { main, rest } = cols("1. e4 e5 (1... c5 2. Nf3 (2. Nc3)) (1... c5) 2. Nf3");
	const vars = groupedVars(main, rest, { isOpen: () => true, onToggle() {} });
	const stub = vars.find((v) => v.tag !== "collapse" && text(v).endsWith("c5"));
	assert.ok(stub, "the line stopping at c5 has a column");
	assert.strictEqual(text(stub), "… c5", "its one move is not elided away");
	assert.strictEqual(stub.gdepth, 1);
});

test("nested groups carry the enclosing group in their trail", () => {
	const pgn =
		"1. e4 e5 (1... c5 2. Nf3 d6 (2... Nc6 3. d4 (3. Bb5)) 3. d4) 2. Nf3";
	const { main, rest } = cols(pgn);
	const vars = groupedVars(main, rest, { isOpen: () => true, onToggle() {} });
	const groups = vars.filter((v) => v.tag === "collapse");
	assert.strictEqual(groups.length, 2);
	const [outer, inner] = groups;
	assert.deepStrictEqual(outer.trail, []);
	assert.deepStrictEqual(inner.trail, [outer]);
	assert.strictEqual(inner.gdepth, 2, "a nested group shades one step further");
	assert.strictEqual(inner.name, "2 lines");
	assert.strictEqual(outer.name, "3 lines");
});

test("with the mainline off the synthetic reference is not a column", () => {
	const { main, rest } = cols(GROUP, () => {}, { noMain: true });
	assert.strictEqual(main.synthetic, true);
	const vars = groupedVars(main, rest);
	assert.ok(!vars.includes(main));
	assert.strictEqual(vars.length, 1, "every line sits under one group");
	getCurrent().noMain = false;
});

test("orderedLeaves: latest-leaving branch first, ties in PGN order", () => {
	const pgn = "1. e4 e5 (1... c5) (1... e6) 2. Nf3 (2. Nc3) Nc6";
	const { main, rest } = cols(pgn);
	const order = orderedLeaves(main, rest).map((v) => v.moves.at(-1).san);
	assert.deepStrictEqual(order, ["Nc3", "c5", "e6"]);
});

test("flatGroupedVars: the group's first line carries the shared run", () => {
	const { main, rest } = cols(GROUP);
	const { vars, spans } = flatGroupedVars(main, rest);
	assert.strictEqual(vars.length, 3, "no column of the group's own");
	assert.strictEqual(vars[0], main);
	assert.strictEqual(text(vars[1]), "… c5 Nf3 d6 Bb5+", "first child spells the run");
	assert.strictEqual(text(vars[2]), "… … … … d4", "siblings start after it");
	assert.deepStrictEqual(spans, [
		{ ply: 3, from: 2, to: 2, tees: [2] },
		{ ply: 0, from: 1, to: 1, tees: [1] },
	]);
});

test("flatGroupedVars: one top-level run per departure row", () => {
	const pgn = "1. e4 e5 (1... c5) (1... e6) 2. Nf3 (2. Nc3) Nc6";
	const { main, rest } = cols(pgn);
	const { vars, spans } = flatGroupedVars(main, rest);
	assert.deepStrictEqual(
		vars.slice(1).map((v) => v.moves.at(-1).san),
		["Nc3", "c5", "e6"],
	);
	assert.deepStrictEqual(spans, [
		{ ply: 1, from: 1, to: 1, tees: [1] },
		{ ply: 0, from: 1, to: 3, tees: [2, 3] },
	]);
});

test("flatGroupedVars: a sibling's note on the shared run moves to the carrier", () => {
	const { main, rest } = cols(GROUP, (lines) => {
		// d4 is the second child; its note is on a move the FIRST child spells
		bySan(lines, "Bb5+").comments = [{ text: "own", ply: 2 }];
		bySan(lines, "d4").comments = [{ text: "sibling's", ply: 2 }];
	});
	const { vars } = flatGroupedVars(main, rest);
	assert.deepStrictEqual(vars[1].noteByPly, { 2: [1, 2] });
	assert.deepStrictEqual(vars[2].noteByPly, {}, "not repeated on the elided sibling");
});

test("flatGroupedVars with the mainline off keeps only inner runs", () => {
	const { main, rest } = cols(GROUP, () => {}, { noMain: true });
	const { vars, spans } = flatGroupedVars(main, rest);
	assert.ok(!vars.includes(main));
	assert.ok(spans.length > 0, "the inner fork still draws its rule");
	assert.ok(
		spans.every((s) => s.from > 0),
		"no rule leaves a mainline row that is not there",
	);
	getCurrent().noMain = false;
});
