import { test } from "node:test";
import assert from "node:assert";
import { parsePgn, fenAt, fenMap } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";

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

test("a comment at the end of a variation attaches to its last move", () => {
	const { nodes } = parsePgn(
		"1. e4 e5 (1... c5 2. Nf3 Nc6 3. Bb5 {sicilian}) 2. Nf3",
	);
	const lines = collectLines(nodes);
	const varLine = lines.find((l) => !l.isMain);
	assert.ok(varLine, "variation line exists");
	const note = varLine.comments.find((c) => c.text === "sicilian");
	assert.ok(note, "trailing variation comment is attached to the line");
	const bb5 = varLine.moves.find((m) => m.san === "Bb5");
	assert.strictEqual(note.ply, bb5.ply, "note sits on the move it follows");
});

test("rejects illegal moves", () => {
	assert.throws(
		() => parsePgn("1. e4 e5 2. Nf3 e6 3. Qh5 Nf6 4. Nc5 d6"),
		/Illegal|ambiguous/,
	);
	// Nc5 is an illegal move for the knight (not reachable)
});

test("NAG tokens ($1, $6, ...) are skipped without crashing the parser", () => {
	const { nodes } = parsePgn("1. e4 $1 e5 2. Nf3 $6 Nc6");
	assert.strictEqual(nodes.map((n) => n.san).join(" "), "e4 e5 Nf3 Nc6");
});

test("a standalone spaced ellipsis (move-number then '...' as its own token) is skipped", () => {
	// Same shape as the tight-ellipsis variation test above ("1... e5"), but
	// with a space between the move number's dot and the ellipsis dots -- a
	// spacing convention some PGN exporters use.
	const { nodes } = parsePgn("1. e4 c5 (1. ... e5 2. Nf3) 2. Nf3 d6");
	assert.strictEqual(nodes.map((n) => n.san).join(" "), "e4 c5 Nf3 d6");
	const varLine = nodes[1].variations[0];
	assert.strictEqual(varLine.map((n) => n.san).join(" "), "e5 Nf3");
	assert.strictEqual(varLine[0].ply, 1); // black's first move -> ply 1
});

test("an unterminated { comment throws a clear, specific error", () => {
	assert.throws(
		() => parsePgn("1. e4 e5 {oops 2. Nf3"),
		/[Uu]nterminated comment/,
	);
});

test("an unclosed ( variation throws instead of silently swallowing the rest of the game", () => {
	assert.throws(
		() => parsePgn("1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4 1-0"),
		/[Uu]nclosed variation/,
	);
});

test("fenMap records the FEN after every ply, matching fenAt (incl. null moves)", () => {
	const { nodes } = parsePgn("1. d4 d5 2. c4 e6 (2... dxc4 -- e5) 3. Nc3");
	const lines = collectLines(nodes);
	assert.ok(lines.length >= 2, "mainline + variation");
	for (const l of lines) {
		const map = fenMap(l.moves);
		assert.strictEqual(map.size, l.moves.length, "one FEN per move");
		l.moves.forEach((m) =>
			assert.strictEqual(map.get(m.ply), fenAt(l.moves, m.ply)),
		);
	}
});

test("strips tag-pair lines without eating [%...] markers inside comments", () => {
	// The header strip used to match ANY bracketed text anywhere, so a marker
	// inside a comment was deleted before tokenizing -- taking an imported
	// file's [%eval] / [%clk] annotations with it, and any bracketed aside the
	// annotator wrote. Only whole tag-pair lines should go.
	const { nodes, tags } = parsePgn(
		'[Event "Test"]\n[Result "*"]\n\n1. e4 {[%eval 0.3] a good start} e5 *',
	);
	assert.strictEqual(tags.Event, "Test");
	assert.strictEqual(nodes.length, 2);
	// the marker is still stripped from the visible prose, as before
	assert.deepStrictEqual(nodes[0].comments, ["a good start"]);
});

test("keeps a bracketed aside that is not a tag pair", () => {
	const { nodes } = parsePgn("1. e4 {see [Kasparov 1985] for more} e5 *");
	assert.deepStrictEqual(nodes[0].comments, ["see [Kasparov 1985] for more"]);
});

test("unescapes quotes and backslashes in a tag value", () => {
	const { tags } = parsePgn('[Event "the \\"sharp\\" \\\\ line"]\n\n1. e4 *');
	assert.strictEqual(tags.Event, 'the "sharp" \\ line');
});
