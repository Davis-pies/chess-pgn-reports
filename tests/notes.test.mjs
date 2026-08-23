import { test } from "node:test";
import assert from "node:assert";
import { loadState } from "./helpers.mjs";
import { numberNotes, allNotes } from "../src/notes.js";

test("numberNotes numbers notes in line order and maps them back per line", () => {
	const s = loadState("1. e4 {first} e5 (1... c5 {second}) 2. Nf3");
	const { entries, byLine } = numberNotes(s.lines);
	assert.deepStrictEqual(
		entries.map((e) => [e.n, e.text]),
		[
			[1, "first"],
			[2, "second"],
		],
	);
	// the mainline owns note 1 at ply 0; the c5 variation owns note 2 at ply 1
	assert.deepStrictEqual(byLine.get(s.lines[0])[0], [1]);
	const c5 = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	assert.deepStrictEqual(byLine.get(c5)[1], [2]);
});

test("numberNotes gives identical (ply,text) notes on different lines one number", () => {
	const s = loadState("1. e4 e5 (1... c5) 2. Nf3");
	const c5 = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	s.lines[0].comments = [{ ply: 0, text: "shared" }];
	c5.comments = [{ ply: 0, text: "shared" }];
	const { entries, byLine } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 1, "one entry for the shared note");
	assert.deepStrictEqual(byLine.get(s.lines[0])[0], [1]);
	assert.deepStrictEqual(byLine.get(c5)[0], [1], "both lines point at note 1");
});

test("numberNotes lists a number once when a line repeats a note at one ply", () => {
	const s = loadState("1. e4 e5");
	s.lines[0].comments = [
		{ ply: 0, text: "twice" },
		{ ply: 0, text: "twice" },
	];
	const { entries, byLine } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 1);
	assert.deepStrictEqual(byLine.get(s.lines[0])[0], [1]);
});

test("allNotes returns the numbered entries for the current notebook", () => {
	const s = loadState("1. e4 {first} e5");
	assert.deepStrictEqual(
		allNotes().map((n) => [n.n, n.text, n.owner === s.lines[0]]),
		[[1, "first", true]],
	);
});
