import { test } from "node:test";
import assert from "node:assert";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";

test("collects mainline plus each variation as a line", () => {
	const { nodes } = parsePgn(
		"1. e4 c5 (1... e5 2. Nf3 Nc6) (1... e6 2. d4) 2. Nf3 d6",
	);
	const lines = collectLines(nodes);
	// mainline + 2 variations
	assert.strictEqual(lines.length, 3);
	assert.strictEqual(lines[0].isMain, true);
	assert.strictEqual(
		lines[0].moves.map((m) => m.san).join(" "),
		"e4 c5 Nf3 d6",
	);
	// variation lines each carry the full path, branching from c5
	const v1 = lines.find((l) => l.moves.some((m) => m.san === "e5"));
	assert.ok(v1);
	assert.strictEqual(v1.moves.map((m) => m.san).join(" "), "e4 c5 e5 Nf3 Nc6");
	const v2 = lines.find((l) => l.moves.some((m) => m.san === "e6"));
	assert.ok(v2);
	assert.strictEqual(v2.moves.map((m) => m.san).join(" "), "e4 c5 e6 d4");
});

test("recurses through nested variations into distinct lines", () => {
	const { nodes } = parsePgn("1. d4 Nf6 (1... d5 (1... f5) 2. c4) 2. c4");
	const lines = collectLines(nodes);
	// main + d5 var + f5 sub-var = 3
	assert.strictEqual(lines.length, 3);
	const f5 = lines.find((l) => l.moves.some((m) => m.san === "f5"));
	assert.ok(f5);
	assert.strictEqual(f5.moves.map((m) => m.san).join(" "), "d4 Nf6 d5 f5");
});
