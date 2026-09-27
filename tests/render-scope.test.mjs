// tests/render-scope.test.mjs
// What each change redraws. The report behind the analysis window, and the
// parts of the page only paper shows, are the expensive parts of a big
// workbook; these pin down when they are (and are not) rebuilt.
import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers.mjs";
import { getCurrent } from "../src/state.js";

const app = await bootApp();
after(() => app.teardown());

const PGN = "1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 *";
const key = (k) =>
	app
		.view()
		.querySelector(".analysis")
		.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: k, bubbles: true }));

test("stepping on the analysis board redraws the window, not the report behind it", async () => {
	app.reset();
	await app.loadPgn(PGN);
	const table = app.view().querySelector(".pv-table");
	app.view().querySelector(".an-toggle").click();
	assert.strictEqual(app.view().querySelector(".pv-table"), table, "opening leaves the report alone");
	app.view().querySelector(".an-wb-line .an-move:last-child").click();
	const before = app.view().querySelector(".analysis");
	key("ArrowLeft");
	assert.notStrictEqual(app.view().querySelector(".analysis"), before, "the window was redrawn");
	assert.match(app.view().querySelector(".an-status").textContent, /White to move/);
	key("Home");
	assert.strictEqual(app.view().querySelector(".pv-table"), table, "the report was not");
	assert.strictEqual(app.view().querySelectorAll(".an-overlay").length, 1, "one window, replaced in place");
	app.view().querySelector(".an-close").click();
	assert.strictEqual(app.view().querySelector(".an-overlay"), null);
	assert.strictEqual(app.view().querySelector(".pv-table"), table, "closing leaves it too");
});

test("saving a note from the board redraws the report, which shows it", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.view().querySelector(".an-toggle").click();
	app.view().querySelector(".an-wb-line .an-move").click(); // 1.e4
	const box = app.view().querySelector(".an-overlay .cedit input");
	box.value = "the king's pawn";
	box.oninput();
	const markup = app.view().querySelector(".markup");
	app.view().querySelector(".an-save-note").click();
	assert.deepStrictEqual(getCurrent().lines[0].comments[0], { ply: 0, text: "the king's pawn" });
	assert.notStrictEqual(app.view().querySelector(".markup"), markup, "the report was rebuilt");
	assert.ok(app.view().querySelector(".an-overlay"), "with the window still open over it");
	assert.match(app.view().querySelector(".an-note-msg").textContent, /Note saved/);
});

test("the print tables and cards are built when the page is printed", async () => {
	app.reset();
	await app.loadPgn(PGN);
	const tables = app.view().querySelector(".pv-htable");
	assert.ok(tables, "the section is there, with its print settings");
	assert.strictEqual(tables.querySelector("table"), null, "but empty until printing");
	assert.strictEqual(app.view().querySelector(".pv-cards .card"), null);
	app.print();
	assert.ok(tables.querySelector("table.tbl"), "printing builds the tables");
	assert.strictEqual(app.view().querySelectorAll(".pv-cards .card").length, 2, "and the cards");
	app.print();
	assert.strictEqual(app.view().querySelectorAll(".pv-cards .card").length, 2, "once");
});

test("the print view is built from the notebook as it is at print time", async () => {
	app.reset();
	await app.loadPgn(PGN);
	// an edit that redraws only the table, not the whole page
	getCurrent().lines[1].name = "Philidor";
	app.print();
	assert.match(app.view().querySelector(".pv-cards").textContent, /Philidor/);
	assert.match(app.view().querySelector(".pv-htable").textContent, /Philidor/);
});

test("the card preview is built with the page, not left for printing", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.button("Lines (print)").click();
	assert.strictEqual(app.view().querySelectorAll(".pv-cards .card").length, 2);
	app.print();
	assert.strictEqual(app.view().querySelectorAll(".pv-cards .card").length, 2, "not built twice");
});

test("each card's latest-divergence board is at the first move no other line plays", async () => {
	app.reset();
	await app.loadPgn("1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 (3. Bc4) *");
	getCurrent().showFirstDivBoard = true;
	app.button("Lines (print)").click();
	const caps = [...app.view().querySelectorAll(".pv-cards .card-board-cap")].map((c) => c.textContent);
	assert.deepStrictEqual(caps.sort(), [
		"latest divergence 2...d6",
		"latest divergence 3.Bb5",
		"latest divergence 3.Bc4",
	]);
});
