import { test } from "node:test";
import assert from "node:assert";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { grid } from "../src/table.js";

function linesFrom(pgn) {
	return collectLines(parsePgn(pgn).nodes);
}

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

test("per-move marks ride on the correct cell", () => {
	const lines = linesFrom("1. e4 e5 (1... c5) 2. Nf3");
	lines[0].marks = { 2: "\u00b1" }; // Nf3 at ply2
	const { vars } = grid(lines);
	const mainVar = vars.find((v) => v.tag === "mainline");
	assert.strictEqual(mainVar.cells[2].mark, "\u00b1");
	assert.strictEqual(mainVar.cells[0].mark, "");
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

test("footnote letters fall back to a double-letter scheme past z", () => {
	const main = { isMain: true, moves: [], comments: [] };
	const feet = Array.from({ length: 28 }, (_, i) => ({
		tag: "foot",
		moves: [],
		comments: [],
		name: "f" + i,
	}));
	const { footNotes } = grid([main, ...feet]);
	assert.strictEqual(footNotes.length, 28);
	assert.strictEqual(footNotes[0].letter, "a");
	assert.strictEqual(footNotes[25].letter, "z");
	assert.strictEqual(footNotes[26].letter, "aa");
	assert.strictEqual(footNotes[27].letter, "ab");
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

test("a repeated note keeps its original number even after a distinct note is assigned in between", () => {
	const lines = linesFrom(
		"1. e4 e5 2. Nf3 Nc6 (2... Nf6) (2... Bc5)",
	);
	// mainline carries "REPEAT" at ply 2, the first sideline carries a
	// distinct "UNIQUE" note at ply 3, and the second sideline repeats
	// "REPEAT" at ply 2 again — it must be numbered 1 (its original number),
	// not whatever noteNum has advanced to since (2, from "UNIQUE").
	lines[0].comments = [{ ply: 2, text: "REPEAT" }];
	lines[1].comments = [{ ply: 3, text: "UNIQUE" }];
	lines[2].comments = [{ ply: 2, text: "REPEAT" }];
	const { vars } = grid(lines);
	const mainVar = vars.find((v) => v.tag === "mainline");
	const repeatAgainVar = vars.find(
		(v) => v.tag !== "mainline" && v.moves.some((m) => m.san === "Bc5"),
	);
	assert.deepStrictEqual(mainVar.noteByPly[2], [1]);
	assert.deepStrictEqual(repeatAgainVar.noteByPly[2], [1]);
});

test("a variation's note shows only on the variation, not the mainline branch move", () => {
	const pgn = "1. e4 e5 ( {var note} 1... c5 2. Nf3) 2. Nf3";
	const comments = parsePgn(pgn).comments;
	const lines = collectLines(parsePgn(pgn).nodes);
	const { vars } = grid(lines, comments);
	const note = comments.find((c) => c.text.includes("var note"));
	assert.strictEqual(note.inVar, true, "in-variation comment is flagged inVar");
	const mainVar = vars.find((v) => v.tag === "mainline");
	const sidVar = vars.find((v) => v.tag === "sideline");
	// both sit at the branch ply (1), but the note must not show on the mainline
	assert.ok(
		!mainVar.noteByPly[note.ply],
		"mainline shows no variation-note marker",
	);
	assert.ok(
		sidVar.noteByPly[note.ply] && sidVar.noteByPly[note.ply].length,
		"the variation shows its own note",
	);
});
