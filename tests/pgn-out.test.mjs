import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { treeFromLines, writeMovetext } from "../src/pgn-out.js";

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
	const d6 = shape(t)[3];
	assert.equal(d6.san, "d6");
	assert.equal(d6.vars.length, 1, "both sidelines share one Nc6 branch");
	const sub = d6.vars[0];
	// Which of Bb5/d4 continues the branch and which hangs off it as a
	// variation is not recoverable: collectLines flattens both to root-to-leaf
	// lines with the same divergence point, and the two nestings describe the
	// same set of lines. What must hold is that the second nests INSIDE the
	// first rather than reappearing as another branch off d6.
	assert.equal(sub[0].san, "Nc6");
	assert.equal(sub.length, 2);
	assert.equal(sub[1].vars.length, 1);
	assert.deepEqual(
		[sub[1].san, sub[1].vars[0][0].san].sort(),
		["Bb5", "d4"],
	);
});

test("exports the user-promoted mainline as the trunk", () => {
	const lines = linesOf("1. e4 e5 (1... c5 2. Nf3) *");
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

test("numbers White's moves and runs Black's straight on", () => {
	const t = treeFromLines(linesOf("1. e4 e5 2. Nf3 Nc6 *"));
	assert.equal(writeMovetext(t, "*"), "1. e4 e5 2. Nf3 Nc6 *");
});

test("re-numbers a Black move that follows a variation", () => {
	const t = treeFromLines(linesOf("1. e4 e5 (1... c5) 2. Nf3 *"));
	assert.equal(writeMovetext(t, "*"), "1. e4 e5 (1... c5) 2. Nf3 *");
});

test("re-numbers a Black move that follows a comment", () => {
	const t = treeFromLines(linesOf("1. e4 e5 *"));
	t[0].comments.push("a strong start");
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
	assert.equal(out.split(/\s+/).join(" "), long.replace(/\s+/g, " "));
});

test("escapes a closing brace inside a comment", () => {
	const t = treeFromLines(linesOf("1. e4 *"));
	t[0].comments.push("a } brace and\na newline");
	assert.equal(writeMovetext(t, "*"), "1. e4 {a ) brace and a newline} *");
});
