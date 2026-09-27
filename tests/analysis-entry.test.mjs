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

test("analysing from a table move puts the board at that position", async () => {
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
		["e4", "e5", "Nf3"],
		"an analysis line of the moves up to the clicked one -- the workbook's are not copied in",
	);
	assert.strictEqual(s.at, 3, "the cursor is after the clicked move, ready to branch");
	assert.ok(app.view().querySelector(".an-board svg"));
	// the workbook's line through the position is listed beside it
	assert.match(app.view().querySelector(".an-wb").textContent, /Workbook lines through 2\.Nf3 \(1\)/);
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
	assert.deepStrictEqual(getScratch().lines[0].moves.map((m) => m.san), ["e4"]);
	assert.strictEqual(getScratch().at, 1);
});

test("the toolbar reopens the board as it was; analysing a move shows only that position's analysis", async () => {
	app.reset();
	await app.loadPgn("1. e4 e5 2. Nf3 (2. Bc4) Nc6 3. Bb5 a6 *");
	app.view().querySelector(".an-toggle").click();
	const s = getScratch();
	assert.strictEqual(s.at, 0, "a new board, at the start");
	assert.strictEqual(s.lines.length, 1, "with nothing copied onto it");
	assert.match(app.view().querySelector(".an-wb").textContent, /Workbook lines \(2\)/, "the workbook's lines are listed");
	// explore 1.d4 from the start
	s.lines[0].moves.push({ san: "d4", ply: 0 });
	app.view().querySelector(".an-close").click();
	app.view().querySelector(".an-toggle").click();
	assert.strictEqual(getScratch(), s, "the same board");
	assert.strictEqual(s.lines[0].moves[0].san, "d4");
	app.view().querySelector(".an-close").click();
	rightClick([...app.view().querySelectorAll(".pv-table td")].find((c) => c.textContent.includes("Nf3")));
	menuItem("Analyse from here").click();
	// the board at 2.Nf3: the 1.d4 analysis is off view, 1.e4 e5 2.Nf3 on it
	const { shown } = await import("../src/analysis.js");
	const now = getScratch();
	assert.deepStrictEqual(shown(now).map((i) => now.lines[i].moves.map((m) => m.san).join(" ")), ["e4 e5 Nf3"]);
	assert.strictEqual(now.at, 3);
	assert.ok(!app.view().querySelector(".an-lines").textContent.includes("d4"));
	// kept, though: the other analysis line is offered
	const more = app.view().querySelector(".an-showall");
	assert.match(more.textContent, /1 more elsewhere/);
	more.click();
	assert.ok(app.view().querySelector(".an-lines").textContent.includes("1.d4"));
});

test("the workbook's lines through the position are listed, and play on the board", async () => {
	app.reset();
	await app.loadPgn(
		"1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) (2... e6 3. d4 {the Taimanov idea}) 3. d4 cxd4 4. Nxd4 Nf6 *",
	);
	const nf3 = [...app.view().querySelectorAll(".pv-table td")].find((c) => c.textContent.trim() === "Nf3");
	rightClick(nf3);
	menuItem("Analyse from here").click();
	const wb = () => app.view().querySelector(".an-wb");
	assert.match(wb().querySelector(".an-sec").textContent, /Workbook lines through 2\.Nf3 \(3\)/);
	assert.strictEqual(wb().querySelectorAll(".an-wb-line").length, 3);
	assert.strictEqual(getScratch().lines.length, 1, "nothing copied onto the board");
	// a click on a workbook line's move plays it on the board up to there
	const e6 = [...wb().querySelectorAll(".an-move")].find((b) => b.textContent === "e6");
	e6.click();
	const s = getScratch();
	assert.deepStrictEqual(s.lines[s.active].moves.map((m) => m.san), ["e4", "c5", "Nf3", "e6"]);
	assert.match(wb().querySelector(".an-sec").textContent, /through 2\.\.\.e6 \(1\)/);
	assert.ok(wb().querySelector(".an-wb-line.active"), "the line being followed is marked");
	// its note is the workbook's, shown on the move it is on
	[...wb().querySelectorAll(".an-move")].find((b) => b.textContent === "3.d4").click();
	assert.match(app.view().querySelector(".an-note-nb").textContent, /the Taimanov idea/);
});
