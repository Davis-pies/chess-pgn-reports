// tests/note-jump.test.mjs -- from a note in the Notes panel to its move, in
// the table and in the line editor.
import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers.mjs";
import { getCurrent, getRenderHooks, getTraced, openTablePaths } from "../src/state.js";

const app = await bootApp();
after(() => app.teardown());

// Two lines share 2... Nf6, so the table folds them into one group column and
// the note on 3. d4 starts out hidden under that fold.
const PGN = "1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4 {center}) (2... Nf6 3. Nc3) 3. Bb5 a6 *";
const notes = () => app.view().querySelector(".notes");
const row = (re) => [...notes().querySelectorAll(".nt")].find((r) => re.test(r.textContent));
const cellWith = (n) =>
	[...app.view().querySelectorAll(".pv-table td")].find((td) =>
		(td.querySelector("sup")?.textContent || "").split(",").includes(String(n)),
	);

test("a note's [n] unfolds the table to its move, traces the line and marks the cell", async () => {
	app.reset();
	await app.loadPgn(PGN);
	assert.strictEqual(cellWith(1), undefined, "folded away to begin with");
	const jump = row(/center/).querySelector(".note-jump");
	assert.strictEqual(jump.textContent, "[1]");
	assert.match(jump.title, /3\.d4 in the table/);
	jump.click();
	const cell = cellWith(1);
	assert.ok(cell, "the marker's cell is on screen");
	assert.ok(cell.classList.contains("note-hit"));
	assert.ok(cell.classList.contains("traced"), "the note's line is traced");
	assert.match(cell.textContent, /^d4/);
	assert.ok(openTablePaths.size > 0, "the group was opened");
	assert.strictEqual(getTraced(), "e4 e5 Nf3 Nf6 d4");
	assert.strictEqual(app.view().ownerDocument.activeElement, cell, "focus follows");
});

test("the pencil selects the note's move in the line editor and opens its group", async () => {
	app.reset();
	await app.loadPgn(PGN);
	assert.strictEqual(app.view().querySelector(".markup .move-chip.on"), null);
	row(/center/).querySelector(".note-edit").click();
	const sel = getCurrent().sel;
	assert.strictEqual(sel.ply, 4);
	assert.deepStrictEqual(sel.at.moves.map((m) => m.san), ["e4", "e5", "Nf3", "Nf6", "d4"]);
	const chip = app.view().querySelector(".markup .move-chip.on");
	assert.ok(chip, "the chip is drawn, so its group is open");
	assert.match(chip.textContent, /3\. d4/);
});

test("a note on a move a line shares with the mainline is selected on the mainline's row", async () => {
	app.reset();
	await app.loadPgn("1. e4 e5 2. Nf3 (2. Nc3 Nf6) Nc6 *");
	const side = getCurrent().lines.find((l) => l.moves[2].san === "Nc3");
	side.comments = [...(side.comments || []), { ply: 1, text: "symmetry" }];
	getRenderHooks().renderApp();
	row(/symmetry/).querySelector(".note-edit").click();
	const sel = getCurrent().sel;
	assert.strictEqual(sel.ply, 1);
	assert.ok(sel.at.isMain, "the stem's chip lives on the mainline");
	assert.match(app.view().querySelector(".markup .move-chip.on").textContent, /^e5/);
});

test("a footnote's [n] marks the parent move it replaces", async () => {
	app.reset();
	await app.loadPgn("1. e4 e5 2. Nf3 (2. Nc3 Nf6) Nc6 *");
	getCurrent().lines.find((l) => l.moves[2].san === "Nc3").tag = "foot";
	getRenderHooks().renderApp();
	const jump = notes().querySelector(".note-jump");
	jump.click();
	const cell = app.view().querySelector(".pv-table td.note-hit");
	assert.ok(cell);
	assert.match(cell.textContent, /^Nf3/);
});

test("the jump buttons stay off paper: print's notes keep a plain superscript", async () => {
	app.reset();
	await app.loadPgn(PGN);
	window.dispatchEvent(new window.Event("beforeprint"));
	const printed = app.view().querySelector(".print-notes");
	assert.ok(printed, "the print notes are built");
	assert.strictEqual(printed.querySelector(".note-jump, .note-edit"), null);
});
