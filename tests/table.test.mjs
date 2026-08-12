import { test } from "node:test";
import assert from "node:assert";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { grid, divergence } from "../src/table.js";

function linesFrom(pgn) {
	return collectLines(parsePgn(pgn).nodes);
}

// A variation line carries the full root-to-leaf path INCLUDING the shared
// prefix. So finding a specific variation matches on any contained move.
test("divergence finds where a variation splits from mainline", () => {
	const lines = linesFrom("1. e4 c5 (1... e5 2. Nf3) 2. Nf3 d6");
	const main = lines[0];
	const e5var = lines.find((l) => l.moves.some((m) => m.san === "e5"));
	// main: e4 c5 Nf3 d6 ; var: e4 c5 e5 Nf3  -> differ at index 2
	assert.strictEqual(divergence(e5var, main), 2);
});

test("grid marks shared prefix as ellipsis and diverging moves with tag class", () => {
	const lines = linesFrom("1. e4 c5 (1... e5 2. Nf3 Nc6) 2. Nf3");
	lines[1].tag = "sideline";
	const { vars, maxPly, mainMoves } = grid(lines);
	assert.strictEqual(vars.length, 2);
	assert.strictEqual(mainMoves.length, 3);
	// main: e4(0) c5(1) Nf3(2); var diverges at ply1 with e5, ply2 Nf3, ply3 Nc6
	assert.strictEqual(maxPly, 3);
	const varRow = vars[1];
	// shared prefix ply0 (e4) -> ellipsis
	assert.strictEqual(varRow.cells[0].text, "\u2026");
	assert.strictEqual(varRow.cells[0].cls, "ellip");
	// diverging moves render with the tag class
	assert.strictEqual(varRow.cells[1].text, "e5");
	assert.strictEqual(varRow.cells[1].cls, "sideline");
	assert.strictEqual(varRow.cells[2].text, "Nf3");
	// main row shows real (non-ellipsis) moves
	assert.strictEqual(vars[0].cells[2].text, "Nf3");
	assert.strictEqual(vars[0].cells[2].cls, "main");
});

test("evaluation symbol rides on the variation row", () => {
	const lines = linesFrom("1. e4 e5 (1... c5) 2. Nf3");
	lines[1].meta = { eval: "=+" };
	const { vars } = grid(lines);
	assert.strictEqual(vars[1].eval, "=+");
});

test("footnote lines are pulled out of the table rows into footNotes", () => {
	const lines = linesFrom("1. e4 e5 (1... c5) (1... c6 2. Nf3) 2. Nf3");
	lines[1].tag = "foot"; // the c5 line is a footnote
	const { vars, footNotes } = grid(lines);
	// only mainline + c6 sideline remain as rows
	assert.strictEqual(vars.length, 2);
	assert.strictEqual(footNotes.length, 1);
	assert.strictEqual(footNotes[0].letter, "a");
	assert.ok(footNotes[0].moves.some((m) => m.san === "c5"));
	// the footnote move must not appear as a table row
	assert.strictEqual(
		vars.some((v) => v.cells[1] && v.cells[1].text === "c5"),
		false,
	);
});

test("a comment's note marker appears only on the line that owns it", () => {
	const pgn = "1. e4 {Central} e5 (1... c5 2. Nf3) 2. Nf3";
	const comments = parsePgn(pgn).comments;
	const lines = collectLines(parsePgn(pgn).nodes);
	const { vars } = grid(lines, comments);
	const mainVar = vars.find((v) => v.tag === "mainline");
	const sidVar = vars.find((v) => v.tag === "sideline");
	assert.deepStrictEqual(mainVar.noteByPly[0], [1]); // mainline owns the marker
	assert.ok(
		!sidVar.noteByPly[0] || sidVar.noteByPly[0].length === 0,
		"sideline carries no duplicate marker",
	);
});
