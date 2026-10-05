// tests/study-app.test.mjs
import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers.mjs";
import { getCurrent, getMode, getRenderHooks } from "../src/state.js";
import { loadPrefs } from "../src/prefs.js";
import { orderedLeaves } from "../src/group-cols.js";
import { mainOf } from "../src/tree.js";
import { grid } from "../src/table.js";

const app = await bootApp();
after(() => app.teardown());

const PGN = "1. e4 e5 2. Nf3 {Develops.} Nc6 (2... Nf6 3. d4) 3. Bb5 a6 *";
const win = () => app.view().querySelector(".st-window");
const key = (node, k) =>
	node.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

test("the toolbar's Study opens the study over the report, and Escape shuts it", async () => {
	app.reset();
	await app.loadPgn(PGN);
	const table = app.view().querySelector(".pv-table");
	app.button("Study").click();
	assert.strictEqual(getMode(), "study");
	assert.ok(win(), "the study window");
	assert.strictEqual(app.view().querySelector(".pv-table"), table, "the report behind it is not rebuilt");
	assert.strictEqual(win().querySelector(".st-name").textContent, "Mainline");

	// stepping redraws the window alone
	const panel = win().querySelector(".study");
	key(panel, "ArrowRight");
	key(win().querySelector(".study"), "ArrowRight");
	key(win().querySelector(".study"), "ArrowRight");
	assert.match(win().querySelector(".st-here").textContent, /Develops\./);
	assert.strictEqual(app.view().querySelector(".pv-table"), table);

	key(win().querySelector(".study"), "f");
	key(win(), "Escape");
	assert.strictEqual(getMode(), "report");
	assert.strictEqual(win(), null);
	assert.strictEqual(loadPrefs().orientation, "black", "the way up the board was left is kept");
});

test("the ✕ and the backdrop close it; a full redraw keeps it open", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.button("Study").click();
	win().querySelector(".an-close").click();
	assert.strictEqual(win(), null);

	app.button("Study").click();
	getRenderHooks().renderApp();
	assert.ok(win(), "redrawn with the page");
	const ov = app.view().querySelector(".st-overlay");
	ov.dispatchEvent(new app.dom.window.MouseEvent("click", { bubbles: true }));
	assert.strictEqual(win(), null);
	assert.strictEqual(getMode(), "report");
});

test("Study from here opens the study at the table's move", async () => {
	app.reset();
	await app.loadPgn(PGN);
	const cell = [...app.view().querySelectorAll(".pv-table td")].find((c) => /d4/.test(c.textContent));
	assert.ok(cell, "d4 is in the table");
	cell.dispatchEvent(new app.dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
	const item = [...app.dom.window.document.querySelectorAll("button")].find((b) => b.textContent === "Study from here");
	assert.ok(item);
	item.click();
	assert.strictEqual(getMode(), "study");
	assert.match(win().querySelector(".st-moves .an-move.at").textContent, /3\.d4/);
	// opening it again from the toolbar starts afresh, at the mainline's start
	key(win(), "Escape");
	app.button("Study").click();
	assert.strictEqual(win().querySelector(".st-moves .an-move.at"), null);
});

// The PGN lists 1...c5 2.Nc3 after 1...e6, but the editor draws it beside
// 1...c5 2.Nf3 (its group) and names it Line 2, so the study reads it second.
// The study once went in the PGN's order, Line 1, Line 3, Line 2, and counted
// the mainline as 1, so Line 1 was listed as "2." and counted "2 of 4".
test("the study reads the lines in the order their names count", async () => {
	app.reset();
	await app.loadPgn("1. e4 e5 (1... c5 2. Nf3) (1... e6) (1... c5 2. Nc3) 2. Nf3 *");
	app.button("Study").click();
	const options = [...win().querySelectorAll(".st-pick option")].map((o) => o.textContent);
	assert.deepStrictEqual(options, ["Mainline", "Line 1 · 2.Nf3", "Line 2 · 2.Nc3", "Line 3 · 1...e6"]);
	assert.strictEqual(win().querySelector(".st-count").textContent, "4 lines");
	const seen = [];
	for (let k = 0; k < 4; k++) {
		key(win().querySelector(".study"), "ArrowDown");
		seen.push(`${win().querySelector(".st-name").textContent} · ${win().querySelector(".st-count").textContent}`);
	}
	assert.deepStrictEqual(seen, ["Line 1 · 1 of 3", "Line 2 · 2 of 3", "Line 3 · 3 of 3", "Mainline · 4 lines"]);
});

test("a line with a typed name keeps its number in the picker", async () => {
	app.reset();
	await app.loadPgn("1. e4 e5 (1... c5 2. Nf3) (1... e6) (1... c5 2. Nc3) 2. Nf3 *");
	getCurrent().lines.find((l) => l.name === "Line 3").name = "French";
	app.button("Study").click();
	const options = [...win().querySelectorAll(".st-pick option")].map((o) => o.textContent);
	assert.deepStrictEqual(options, ["Mainline", "Line 1 · 2.Nf3", "Line 2 · 2.Nc3", "3. French · 1...e6"]);
});

// The table and the printed report lay the mainline's branches out latest-
// leaving first; the editor once listed them, and counted their names, in PGN
// order, so the table's columns read Line 4, Line 5, Line 1, ... and the study
// (which reads in the names' order) disagreed with the table.
test("the editor, the table, the print and the study count lines the same way", async () => {
	app.reset();
	await app.loadPgn("1. e4 c5 (1... e5 2. Nf3 (2. Bc4 Nf6) Nc6 (2... d6 3. d4)) 2. Nf3 d6 (2... Nc6 3. d4 (3. Bb5)) 3. d4 *");
	const lines = getCurrent().lines;
	const names = ["Mainline", "Line 1", "Line 2", "Line 3", "Line 4", "Line 5"];
	const editor = () => [...app.view().querySelectorAll(".ledge input.ln")].map((i) => i.value);
	assert.deepStrictEqual(editor(), names);
	assert.deepStrictEqual(orderedLeaves(mainOf(lines), lines).map((l) => l.name), names.slice(1), "the table's columns");
	assert.deepStrictEqual(grid(lines).vars.map((v) => v.name), names, "the print lines and the export");
	assert.deepStrictEqual(lines.find((l) => l.name === "Line 1").moves.map((m) => m.san).join(" "), "e4 c5 Nf3 Nc6 Bb5");
	getCurrent().groupView = "flat";
	getRenderHooks().renderApp();
	assert.deepStrictEqual(editor(), names, "the flat view lists them in the same order");
	app.button("Study").click();
	const picked = [...win().querySelectorAll(".st-pick option")].map((o) => o.textContent.split(" · ")[0]);
	assert.deepStrictEqual(picked, names);
});
