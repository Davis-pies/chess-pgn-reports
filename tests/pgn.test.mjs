import { test } from "node:test";
import assert from "node:assert";
import { parsePgn } from "../src/pgn.js";

test("parses a simple mainline with a parenthesized variation", () => {
	const pgn = "1. e4 c5 (1... e5 2. Nf3) 2. Nf3 d6";
	const { nodes, result } = parsePgn(pgn);
	assert.strictEqual(result, "*");
	// trunk: e4 c5 2.Nf3 d6 -> 4 nodes
	assert.strictEqual(nodes.length, 4);
	assert.strictEqual(nodes[0].san, "e4");
	assert.strictEqual(nodes[1].san, "c5");
	assert.strictEqual(nodes[1].variations.length, 1);
	const varLine = nodes[1].variations[0];
	// variation e5, Nf3
	assert.strictEqual(varLine.length, 2);
	assert.strictEqual(varLine[0].san, "e5");
	assert.strictEqual(varLine[0].ply, 1); // black's first move -> ply 1
	assert.strictEqual(varLine[1].san, "Nf3");
	// trunk continues after variation at ply 2 (white's second move)
	assert.strictEqual(nodes[2].san, "Nf3");
	assert.strictEqual(nodes[2].ply, 2);
});

test("skips comments and move numbers correctly", () => {
	const pgn = "1. e4 {best by test} e5 2. Nf3 Nc6; semi-comment line";
	const { nodes } = parsePgn(pgn);
	assert.strictEqual(nodes.map((n) => n.san).join(" "), "e4 e5 Nf3 Nc6");
});

test("handles nested variations and result", () => {
	const pgn = "1. d4 Nf6 (1... d5 2. c4 (2. e4) 2... e6) 2. c4 1-0";
	const { nodes, result } = parsePgn(pgn);
	assert.strictEqual(result, "1-0");
	// trunk: d4 Nf6 c4
	assert.strictEqual(nodes.length, 3);
	const v = nodes[1].variations[0]; // d5 c4 e6
	assert.strictEqual(v.map((n) => n.san).join(" "), "d5 c4 e6");
	// first variation move is an alternative at the same ply as the replaced move
	assert.strictEqual(v[0].ply, 1); // black's move 1, same ply as Nf6
	// c4 inside the variation carries the 2. e4 sub-variation
	const subVarNode = v[1];
	assert.strictEqual(subVarNode.san, "c4");
	assert.strictEqual(subVarNode.variations.length, 1);
	assert.strictEqual(subVarNode.variations[0][0].san, "e4");
	assert.strictEqual(subVarNode.variations[0][0].ply, 2);
});

test("rejects illegal moves", () => {
	assert.throws(
		() => parsePgn("1. e4 e5 2. Nf3 e6 3. Qh5 Nf6 4. Nc5 d6"),
		/Illegal|ambiguous/,
	);
	// Nc5 is an illegal move for the knight (not reachable)
});
