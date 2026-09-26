// tests/analysis-mode.test.mjs
import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers.mjs";
import { getCurrent } from "../src/state.js";

const app = await bootApp();
after(() => app.teardown());

const PGN = "1. e4 e5 2. Nf3 Nc6 *";

test("the analysis board opens over the report and closes back to it", async () => {
	app.reset();
	await app.loadPgn(PGN);
	assert.ok(app.view().querySelector(".pv-table"), "the report is up");
	assert.strictEqual(app.view().querySelector(".analysis"), null);

	app.view().querySelector(".an-toggle").click();
	assert.ok(app.view().querySelector(".an-overlay .analysis"), "the board is in the overlay");
	assert.ok(app.view().querySelector(".an-board svg"));
	assert.ok(app.view().querySelector(".pv-table"), "the report stays beneath it");

	app.view().querySelector(".an-close").click();
	assert.strictEqual(app.view().querySelector(".an-overlay"), null, "the ✕ closes it");

	app.view().querySelector(".an-toggle").click();
	app.view().querySelector(".an-overlay").dispatchEvent(
		new app.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	assert.strictEqual(app.view().querySelector(".an-overlay"), null, "so does Escape");

	app.view().querySelector(".an-toggle").click();
	app.view().querySelector(".an-overlay").click();
	assert.strictEqual(app.view().querySelector(".an-overlay"), null, "and a click on the backdrop");
});

test("a click inside the analysis window does not close it", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.view().querySelector(".an-toggle").click();
	app.view().querySelector(".an-start").click();
	assert.ok(app.view().querySelector(".an-overlay"));
});

test("a line added on the board shows up in the report", async () => {
	app.reset();
	await app.loadPgn(PGN);
	const before = getCurrent().lines.length;
	app.view().querySelector(".an-toggle").click();
	// play 1.d4 from the start position
	app.view().querySelector(".an-start").click();
	const sq = (s, type) =>
		app
			.view()
			.querySelector(`.an-board rect[data-sq="${s}"]`)
			.dispatchEvent(new app.dom.window.MouseEvent(type, { bubbles: true, cancelable: true }));
	sq("d2", "mousedown");
	sq("d4", "mouseup");
	app.view().querySelector(".an-add").click();
	assert.strictEqual(getCurrent().lines.length, before + 1);
	assert.strictEqual(app.view().querySelector(".an-overlay"), null, "adding closed the window");
	assert.match(app.view().querySelector(".pv-table").textContent, /d4/);
});

test("the board is saved with the workbook and comes back with it; the mode is not", async () => {
	const { getScratch } = await import("../src/state.js");
	app.reset();
	await app.loadPgn(PGN);
	app.view().querySelector(".an-toggle").click();
	const sq = (s) =>
		app
			.view()
			.querySelector(`.an-board rect[data-sq="${s}"]`)
			.dispatchEvent(new app.dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
	sq("d2");
	sq("d4"); // at the start, beside the workbook's 1.e4 line: a line of its own
	const d4 = getScratch().lines.find((l) => l.moves[0].san === "d4");
	d4.comments = [{ ply: 0, text: "queen's pawn" }];
	app.view().querySelector(".an-close").click();
	app.view().querySelector("input.name").value = "Boarded";
	app.view().querySelector("input.name").oninput();
	app.clickText("Save");
	const key = Object.keys(app.dom.window.localStorage).find((k) => k.startsWith("ott:"));
	const saved = JSON.parse(app.dom.window.localStorage.getItem(key));
	assert.deepStrictEqual(
		saved.analysis.lines.find((l) => l.moves[0] === "d4"),
		{ moves: ["d4"], comments: [{ ply: 0, text: "queen's pawn" }] },
	);
	assert.strictEqual(saved.mode, undefined, "the window's being open is not saved");
	assert.ok(Array.isArray(saved.tags) && typeof saved.pgn === "string");

	// a fresh start (the app's own button: the helper's reset clears storage),
	// then the workbook reopened from the list
	app.clickText("New / Import");
	assert.strictEqual(getScratch(), null, "New / Import leaves no board behind");
	[...app.view().querySelectorAll(".notebooks button")].find((b) => b.textContent.includes("Boarded")).click();
	await app.settle();
	const back = getScratch();
	const line = back.lines.find((l) => l.moves[0].san === "d4");
	assert.deepStrictEqual(line.comments, [{ ply: 0, text: "queen's pawn" }]);
	assert.strictEqual(app.view().querySelector(".an-overlay"), null, "opened closed, as a report");
	app.view().querySelector(".an-toggle").click();
	assert.match(app.view().querySelector(".an-lines").textContent, /1\.d4/);
});

test("a workbook saved with an empty board carries none", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.clickText("Save");
	const key = Object.keys(app.dom.window.localStorage).find((k) => k.startsWith("ott:"));
	assert.strictEqual(JSON.parse(app.dom.window.localStorage.getItem(key)).analysis, undefined);
});

test("a line added on the board survives a save and reload", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.view().querySelector(".an-toggle").click();
	app.view().querySelector(".an-start").click();
	const sq = (s, type) =>
		app
			.view()
			.querySelector(`.an-board rect[data-sq="${s}"]`)
			.dispatchEvent(
				new app.dom.window.MouseEvent(type, { bubbles: true, cancelable: true }),
			);
	sq("d2", "mousedown");
	sq("d4", "mouseup");
	app.view().querySelector(".an-add").click();
	app.clickText("Save");

	// Reload the way the app does: re-parse the saved PGN and re-apply the
	// tags onto it. This is the whole reason commit rewrites current.pgn --
	// a line that lives only in current.lines is not in the PGN to re-parse.
	const { parsePgn } = await import("../src/pgn.js");
	const { collectLines } = await import("../src/tree.js");
	const { applyNotebook } = await import("../src/store.js");
	const key = Object.keys(app.dom.window.localStorage).find((k) =>
		k.startsWith("ott:"),
	);
	const saved = JSON.parse(app.dom.window.localStorage.getItem(key));
	const reloaded = applyNotebook(saved, collectLines(parsePgn(saved.pgn).nodes));
	assert.ok(
		reloaded.some((l) => l.moves.length === 1 && l.moves[0].san === "d4"),
		"the added line came back",
	);
	assert.ok(
		reloaded.some((l) => l.moves.some((m) => m.san === "Nc6")),
		"and so did the imported ones",
	);
});

test("a line added into an existing branch opens that branch in the table", async () => {
	app.reset();
	await app.loadPgn("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 *");
	app.view().querySelector(".an-toggle").click();
	const sq = (s, type) =>
		app
			.view()
			.querySelector(`.an-board rect[data-sq="${s}"]`)
			.dispatchEvent(new app.dom.window.MouseEvent(type, { bubbles: true, cancelable: true }));
	for (const [a, b] of [["e2", "e4"], ["c7", "c5"], ["b1", "c3"]]) {
		sq(a, "mousedown");
		sq(b, "mouseup");
	}
	app.view().querySelector(".an-add").click();
	const head = app.view().querySelector(".pv-table tr").textContent;
	assert.match(head, /▾ 2 lines/, "the branch is open, not folded to ▸");
	assert.match(app.view().querySelector(".pv-table").textContent, /Nc3/);
});

test("a refused add keeps the window open and says why", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.view().querySelector(".an-toggle").click();
	// every line on view is the workbook's own: badged, with no add of its own
	assert.strictEqual(app.view().querySelector(".an-line .an-add"), null);
	assert.ok(app.view().querySelector(".an-line .an-badge"));
	app.view().querySelector(".an-add-all").click();
	assert.ok(app.view().querySelector(".an-overlay"), "still open");
	assert.match(app.view().querySelector(".an-msg").textContent, /Nothing added/);
});

test("with no notebook, a board can be the start: the first line added opens one", async () => {
	app.reset();
	const start = app.view().querySelector(".an-fromboard");
	assert.ok(start, "offered on the import screen");
	start.click();
	assert.ok(app.view().querySelector(".an-overlay .an-board svg"), "the board opens over it");
	for (const [a, b] of [["e2", "e4"], ["c7", "c5"]]) {
		for (const s of [a, b])
			app.view()
				.querySelector(`.an-board rect[data-sq="${s}"]`)
				.dispatchEvent(new app.dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
	}
	app.view().querySelector(".an-add").click();
	assert.strictEqual(app.view().querySelector(".an-overlay"), null, "adding closed the window");
	const lines = getCurrent().lines;
	assert.strictEqual(lines.length, 1);
	assert.strictEqual(lines[0].isMain, true);
	assert.ok(app.view().querySelector(".pv-table"), "the notebook opened around it");
});

test("typing in the window is not cancelled: only Escape is the window's", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.view().querySelector(".an-toggle").click();
	const ov = app.view().querySelector(".an-overlay");
	for (const key of ["a", "e", "f", " ", "ArrowLeft"]) {
		const ev = new app.dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
		// dispatched from inside a text box, as a keystroke there would be
		const input = app.dom.window.document.createElement("input");
		ov.querySelector(".analysis").appendChild(input);
		input.dispatchEvent(ev);
		input.remove();
		assert.strictEqual(ev.defaultPrevented, false, `"${key}" reached the text box`);
	}
	assert.ok(app.view().querySelector(".an-overlay"), "and the window stayed open");
});
