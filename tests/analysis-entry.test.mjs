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
		["e4", "e5", "Nf3"],
		"seeded up to and including the clicked move",
	);
	assert.strictEqual(s.at, 3, "the cursor is after it, ready to branch");
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
		["e4"],
	);
});
