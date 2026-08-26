import { test } from "node:test";
import assert from "node:assert";
import { parsePgn } from "../src/pgn.js";
import {
	collectLines,
	divergence,
	buildTrie,
	leavesOf,
	countLeaves,
	forkKeys,
} from "../src/tree.js";

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
	// variation lines each carry the full path, WITHOUT the move they replaced
	const v1 = lines.find((l) => l.moves.some((m) => m.san === "e5"));
	assert.ok(v1);
	assert.strictEqual(v1.moves.map((m) => m.san).join(" "), "e4 e5 Nf3 Nc6");
	const v2 = lines.find((l) => l.moves.some((m) => m.san === "e6"));
	assert.ok(v2);
	assert.strictEqual(v2.moves.map((m) => m.san).join(" "), "e4 e6 d4");
});

test("recurses through nested variations into distinct lines", () => {
	const { nodes } = parsePgn("1. d4 Nf6 (1... d5 (1... f5) 2. c4) 2. c4");
	const lines = collectLines(nodes);
	// main + d5 var + f5 sub-var = 3
	assert.strictEqual(lines.length, 3);
	const f5 = lines.find((l) => l.moves.some((m) => m.san === "f5"));
	assert.ok(f5);
	// f5 replaces the 1...d5 move, so it is not in the line
	assert.strictEqual(f5.moves.map((m) => m.san).join(" "), "d4 f5");
});

test("returns no lines for movetext with no moves (empty or result-only)", () => {
	assert.deepStrictEqual(collectLines(parsePgn("").nodes), []);
	assert.deepStrictEqual(collectLines(parsePgn("*").nodes), []);
});

test("divergence finds where a variation splits from mainline", () => {
	const lines = collectLines(
		parsePgn("1. e4 c5 (1... e5 2. Nf3) 2. Nf3 d6").nodes,
	);
	const main = lines[0];
	const e5var = lines.find((l) => l.moves.some((m) => m.san === "e5"));
	// main: e4 c5 Nf3 d6 ; var: e4 e5 Nf3  -> differ at index 1
	assert.strictEqual(divergence(e5var, main), 1);
});

test("buildTrie groups lines by their shared divergent tail", () => {
	const main = { isMain: true, moves: [{ ply: 0, san: "e4" }, { ply: 1, san: "e5" }] };
	const a = { moves: [{ ply: 0, san: "e4" }, { ply: 1, san: "c5" }, { ply: 2, san: "Nf3" }] };
	const b = { moves: [{ ply: 0, san: "e4" }, { ply: 1, san: "c5" }, { ply: 2, san: "Nc3" }] };
	const root = buildTrie([main, a, b], main);
	assert.strictEqual(root.children.size, 1, "both branch at 1...c5");
	const c5 = [...root.children.values()][0];
	assert.strictEqual(c5.key, "1:c5");
	assert.strictEqual(countLeaves(c5), 2);
	assert.deepStrictEqual(leavesOf(c5), [a, b]);
});

test("carries a move's imported NAGs onto the line's marks, as codes", () => {
	const lines = collectLines(parsePgn("1. e4 $1 e5 $16 *").nodes);
	// the CODE, not the glyph: eight glyphs are shared by a White/Black pair,
	// so collapsing to one here threw the side away before export could read it
	assert.deepEqual(lines[0].marks, { 0: "$1", 1: "$16" });
});

test("an imported mark keeps the side its file carried", () => {
	// $23 is "Black in zugzwang"; $22 is White's. Both render "⊙".
	const lines = collectLines(parsePgn("1. e4 $23 *").nodes);
	assert.deepEqual(lines[0].marks, { 0: "$23" });
});

test("ignores a NAG code outside the table", () => {
	const lines = collectLines(parsePgn("1. e4 $250 *").nodes);
	assert.deepEqual(lines[0].marks, {});
});

test("forkKeys names the nodes that really branch, over the whole line set", () => {
	const { nodes } = parsePgn(
		"1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4 cxd4 4. Nxd4 g6 (4... e5 5. Nb5) " +
			"(4... Nf6 5. Nc3)) (2... e6 3. d4 cxd4) 3. d4",
	);
	const lines = collectLines(nodes);
	const main = lines.find((l) => l.isMain);
	const keys = forkKeys(lines, main);
	// 4.Nxd4 is where g6 / e5 / Nf6 part company
	const fork = [...keys].find((k) => k.endsWith("6:Nxd4"));
	assert.ok(fork, `a fork at Nxd4, got ${[...keys].join(", ")}`);
	// the shared run leading up to it does not branch, so it is not a fork
	assert.ok(
		![...keys].some((k) => k.endsWith("5:cxd4")),
		"a single-child continuation is not a fork",
	);
	// and a filtered trie keeps the same key for that node, which is what lets
	// the editor recognise it after hiding
	const kept = lines.filter((l) => !l.moves.some((m) => m.san === "e5"));
	assert.ok(
		[...forkKeys(kept, main)].every((k) => keys.has(k)),
		"filtering never invents a key",
	);
});
