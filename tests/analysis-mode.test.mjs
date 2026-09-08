// tests/analysis-mode.test.mjs
import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers.mjs";
import { getCurrent } from "../src/state.js";

const app = await bootApp();
after(() => app.teardown());

const PGN = "1. e4 e5 2. Nf3 Nc6 *";

test("the toolbar toggles between the report and the analysis board", async () => {
	app.reset();
	await app.loadPgn(PGN);
	assert.ok(app.view().querySelector(".pv-table"), "the report is up");
	assert.strictEqual(app.view().querySelector(".analysis"), null);

	app.view().querySelector(".an-toggle").click();
	assert.ok(app.view().querySelector(".analysis"), "the analysis panel is up");
	assert.ok(app.view().querySelector(".an-board svg"));
	assert.strictEqual(app.view().querySelector(".pv-table"), null, "the report is put away");

	app.view().querySelector(".an-toggle").click();
	assert.ok(app.view().querySelector(".pv-table"), "and comes back");
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
			.querySelector(`rect[data-sq="${s}"]`)
			.dispatchEvent(new app.dom.window.MouseEvent(type, { bubbles: true, cancelable: true }));
	sq("d2", "mousedown");
	sq("d4", "mouseup");
	app.view().querySelector(".an-add").click();
	assert.strictEqual(getCurrent().lines.length, before + 1);
	app.view().querySelector(".an-toggle").click();
	assert.match(app.view().querySelector(".pv-table").textContent, /d4/);
});

test("the scratch and the mode are never saved into a workbook", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.view().querySelector(".an-toggle").click();
	app.view().querySelector(".an-toggle").click();
	app.clickText("Save");
	// store.js's PREFIX
	const key = Object.keys(app.dom.window.localStorage).find((k) =>
		k.startsWith("ott:"),
	);
	assert.ok(key, "something was saved");
	const saved = JSON.parse(app.dom.window.localStorage.getItem(key));
	assert.strictEqual(saved.scratch, undefined);
	assert.strictEqual(saved.mode, undefined);
	assert.ok(Array.isArray(saved.tags) && typeof saved.pgn === "string");
});

test("a line added on the board survives a save and reload", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.view().querySelector(".an-toggle").click();
	app.view().querySelector(".an-start").click();
	const sq = (s, type) =>
		app
			.view()
			.querySelector(`rect[data-sq="${s}"]`)
			.dispatchEvent(
				new app.dom.window.MouseEvent(type, { bubbles: true, cancelable: true }),
			);
	sq("d2", "mousedown");
	sq("d4", "mouseup");
	app.view().querySelector(".an-add").click();
	app.view().querySelector(".an-toggle").click();
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
