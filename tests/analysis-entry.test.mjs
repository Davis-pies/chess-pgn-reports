// tests/analysis-entry.test.mjs
import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers.mjs";
import { getScratch, getMode } from "../src/state.js";

const app = await bootApp();
after(() => app.teardown());

const PGN = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *";

const rightClick = (node) =>
	node.dispatchEvent(
		new app.dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
	);
const menuItem = (text) =>
	[...app.dom.window.document.querySelectorAll("button")].find((b) =>
		b.textContent.includes(text),
	);

test("analysing from a table move seeds the scratch with its prefix", async () => {
	app.reset();
	await app.loadPgn(PGN);
	// the mainline's third move (1-based: e4, e5, Nf3)
	const cells = [...app.view().querySelectorAll(".pv-table td")].filter((c) =>
		c.textContent.trim(),
	);
	const nf3 = cells.find((c) => c.textContent.includes("Nf3"));
	assert.ok(nf3, "Nf3 is in the table");
	rightClick(nf3);
	const item = menuItem("Analyse from here");
	assert.ok(item, "the menu offers it");
	item.click();

	assert.strictEqual(getMode(), "analysis");
	const s = getScratch();
	assert.deepStrictEqual(
		s.lines[0].moves.map((m) => m.san),
		["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"],
		"the notebook line through the move comes whole",
	);
	assert.strictEqual(s.at, 3, "the cursor is after the clicked move, ready to branch");
	assert.ok(app.view().querySelector(".an-board svg"));
});

test("the seeded scratch is a copy, so exploring cannot reach the notebook line", async () => {
	app.reset();
	await app.loadPgn(PGN);
	const cells = [...app.view().querySelectorAll(".pv-table td")].filter((c) =>
		c.textContent.includes("e4"),
	);
	rightClick(cells[0]);
	menuItem("Analyse from here").click();
	const s = getScratch();
	s.lines[0].moves[0].san = "MUTATED";
	const { getCurrent } = await import("../src/state.js");
	assert.strictEqual(getCurrent().lines[0].moves[0].san, "e4");
});

test("the line editor's move panel offers the same entry", async () => {
	app.reset();
	await app.loadPgn(PGN);
	// moveStrip renders each move as a .move-chip labelled "1. e4"
	const move = [...app.view().querySelectorAll(".markup .move-chip")].find((b) =>
		b.textContent.includes("e4"),
	);
	assert.ok(move, "the move strip has e4");
	move.click(); // select it, which opens the move panel
	const btn = [...app.view().querySelectorAll("button")].find(
		(b) => b.textContent === "Analyse from here",
	);
	assert.ok(btn, "the move panel offers it");
	btn.click();
	assert.strictEqual(getMode(), "analysis");
	assert.deepStrictEqual(
		getScratch().lines[0].moves.map((m) => m.san),
		["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"],
	);
	assert.strictEqual(getScratch().at, 1);
});

test("the toolbar opens the whole workbook at the start; analysing a move shows only that position's lines", async () => {
	app.reset();
	await app.loadPgn("1. e4 e5 2. Nf3 (2. Bc4) Nc6 3. Bb5 a6 *");
	app.view().querySelector(".an-toggle").click();
	const s = getScratch();
	assert.strictEqual(s.at, 0, "at the start");
	assert.deepStrictEqual(
		s.lines.map((l) => l.moves.map((m) => m.san).join(" ")),
		["e4 e5 Nf3 Nc6 Bb5 a6", "e4 e5 Bc4"],
		"every workbook line is on the board",
	);
	assert.strictEqual(s.active, 0, "on the mainline");
	assert.strictEqual(app.view().querySelectorAll(".an-line").length, 2);
	// explore 1.d4 from the start: kept, and on view from the start
	s.lines.push({ moves: [{ san: "d4", ply: 0 }] });
	app.view().querySelector(".an-close").click();
	app.view().querySelector(".an-toggle").click();
	assert.strictEqual(getScratch(), s, "the same board");
	assert.strictEqual(s.lines.length, 3, "nothing doubled");
	app.view().querySelector(".an-close").click();
	rightClick([...app.view().querySelectorAll(".pv-table td")].find((c) => c.textContent.includes("Nf3")));
	menuItem("Analyse from here").click();
	// a board of that position only: the 1.d4 line explored before is off view
	const { shown } = await import("../src/analysis.js");
	const now = getScratch();
	assert.deepStrictEqual(shown(now).map((i) => now.lines[i].moves[0].san), ["e4"]);
	assert.strictEqual(now.at, 3);
	assert.ok(!app.view().querySelector(".an-lines").textContent.includes("d4"));
	// kept, though: "show all" brings it back
	app.view().querySelector(".an-showall").click();
	assert.ok(app.view().querySelector(".an-lines").textContent.includes("1.d4"));
});

test("every notebook line through the position comes onto the board, with its notes", async () => {
	app.reset();
	await app.loadPgn(
		"1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) (2... e6 3. d4 {the Taimanov idea}) 3. d4 cxd4 4. Nxd4 Nf6 *",
	);
	// right-click White's 2nd: every line goes through it
	const nf3 = [...app.view().querySelectorAll(".pv-table td")].find((c) => c.textContent.trim() === "Nf3");
	rightClick(nf3);
	menuItem("Analyse from here").click();
	const s = getScratch();
	assert.deepStrictEqual(
		s.lines.map((l) => l.moves.map((m) => m.san).join(" ")),
		["e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6", "e4 c5 Nf3 Nc6 d4", "e4 c5 Nf3 e6 d4"],
	);
	assert.strictEqual(s.at, 3);
	assert.deepStrictEqual(s.lines[2].comments, [{ ply: 4, text: "the Taimanov idea" }], "notes come along");
	// analysing from the same place again doubles nothing
	app.view().querySelector(".an-close").click();
	rightClick([...app.view().querySelectorAll(".pv-table td")].find((c) => c.textContent.trim() === "Nf3"));
	menuItem("Analyse from here").click();
	assert.strictEqual(getScratch().lines.length, 3);
});
