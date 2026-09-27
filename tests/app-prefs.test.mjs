// tests/app-prefs.test.mjs
// What the app remembers between visits (see prefs.js), driven through the
// app itself. A second DOMContentLoaded stands in for the next visit: app.js
// is booted once per file, so this is how a test gets a fresh start against
// the same storage.
import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers.mjs";
import { getCurrent, getMode, getScratch } from "../src/state.js";

const app = await bootApp();
after(() => app.teardown());

const PGN = "1. e4 e5 2. Nf3 Nc6 *";
const prefs = () => JSON.parse(app.dom.window.localStorage.getItem("ott-prefs") || "{}");
const nextVisit = () => {
	// back to the import screen WITHOUT clearing storage, then boot again
	app.button("New / Import")?.click();
	app.dom.window.document.dispatchEvent(new app.dom.window.Event("DOMContentLoaded"));
};
const summary = () => app.view().querySelector(".settings > summary");
const setting = (v) => app.view().querySelector(`.settings [data-value="${v}"]`);

test("leaving the page records the saved workbook and its board, and the next visit reopens them", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.button("Save").click();
	const id = getCurrent().id;
	app.view().querySelector(".an-toggle").click();
	app.view().querySelector(".an-flip").click();
	app.dom.window.dispatchEvent(new app.dom.window.Event("pagehide"));

	const last = prefs().last;
	assert.strictEqual(last.id, id);
	assert.strictEqual(last.mode, "analysis");
	assert.strictEqual(last.board, null, "nothing played on the board, so no board to keep");
	assert.strictEqual(prefs().orientation, "black", "but its orientation is kept");

	nextVisit();
	assert.strictEqual(getCurrent().id, id, "the workbook is back");
	assert.strictEqual(getMode(), "analysis", "on the board");
	assert.strictEqual(getScratch().flipped, true, "the right way up");
	assert.ok(app.view().querySelector(".an-overlay"));
});

test("a board recorded at the last visit wins over the workbook's own", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.button("Save").click();
	const id = getCurrent().id;
	const board = { lines: [{ moves: ["d4", "d5", "c4"] }], active: 0, at: 2, flipped: false };
	app.dom.window.localStorage.setItem("ott-prefs", JSON.stringify({ last: { id, mode: "report", board } }));
	nextVisit();
	assert.strictEqual(getMode(), "report");
	assert.deepStrictEqual(getScratch().lines[0].moves.map((m) => m.san), ["d4", "d5", "c4"]);
	assert.strictEqual(getScratch().at, 2);
});

test("hiding the page records too, and an unsaved workbook is not reopened", async () => {
	app.reset();
	await app.loadPgn(PGN);
	Object.defineProperty(app.dom.window.document, "visibilityState", { value: "hidden", configurable: true });
	app.dom.window.document.dispatchEvent(new app.dom.window.Event("visibilitychange"));
	delete app.dom.window.document.visibilityState;
	assert.strictEqual(prefs().last, null);
	nextVisit();
	assert.ok(app.view().querySelector("textarea.pgnin"), "the import screen");
});

test("turning restore off in Settings starts on the import screen", async () => {
	app.reset();
	await app.loadPgn(PGN);
	app.button("Save").click();
	app.dom.window.dispatchEvent(new app.dom.window.Event("pagehide"));
	const box = app.view().querySelector("#pref-restore");
	box.checked = false;
	box.dispatchEvent(new app.dom.window.Event("change"));
	nextVisit();
	assert.ok(app.view().querySelector("textarea.pgnin"));
});

test("new boards start from the side chosen in Settings", async () => {
	app.reset();
	await app.loadPgn(PGN);
	assert.ok(summary(), "the menu is in the toolbar");
	setting("black").click();
	assert.strictEqual(prefs().orientation, "black");
	assert.match(setting("black").className, /\bon\b/);
	app.view().querySelector(".an-toggle").click();
	assert.strictEqual(getScratch().flipped, true);
});

test("the theme can be set from Settings", async () => {
	app.reset();
	await app.loadPgn(PGN);
	setting("dark").click();
	assert.strictEqual(app.dom.window.document.documentElement.dataset.theme, "dark");
	assert.strictEqual(app.dom.window.localStorage.getItem("ott-theme"), "dark");
	setting("light").click();
	assert.strictEqual(app.dom.window.document.documentElement.dataset.theme, "light");
});

test("the dragged panel width is remembered, and Settings resets it", async () => {
	app.reset();
	await app.loadPgn(PGN);
	const w = app.dom.window;
	app.view().querySelector(".side-resize").dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
	w.document.dispatchEvent(new w.MouseEvent("mousemove", { clientX: 500, bubbles: true }));
	w.document.dispatchEvent(new w.MouseEvent("mouseup", { bubbles: true }));
	assert.strictEqual(prefs().sideWidth, 500);
	// a plain click elsewhere does not overwrite it
	w.document.dispatchEvent(new w.MouseEvent("mouseup", { bubbles: true }));
	assert.strictEqual(prefs().sideWidth, 500);

	app.clickText("Reset panel width");
	assert.strictEqual(prefs().sideWidth, null);
	assert.strictEqual(getCurrent().sideWidth, 420);
});

test("Forget settings clears them all", async () => {
	app.reset();
	await app.loadPgn(PGN);
	setting("dark").click();
	setting("black").click();
	app.clickText("Forget settings");
	assert.strictEqual(app.dom.window.localStorage.getItem("ott-prefs"), null);
	assert.strictEqual(app.dom.window.localStorage.getItem("ott-theme"), null);
	assert.strictEqual(app.dom.window.document.documentElement.dataset.theme, undefined);
});

test("a remembered workbook that no longer opens leaves the import screen", async () => {
	app.reset();
	app.dom.window.localStorage.setItem("ott-prefs", JSON.stringify({ last: { id: "gone", mode: "report" } }));
	nextVisit();
	assert.ok(app.view().querySelector("textarea.pgnin"));
});
