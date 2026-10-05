// tests/prefs.test.mjs
import { test, beforeEach, after } from "node:test";
import assert from "node:assert";
import {
	loadPrefs,
	savePrefs,
	clearPrefs,
	loadTheme,
	saveTheme,
	cleanWidth,
	rememberWorkbook,
	workbookToRestore,
} from "../src/prefs.js";

// A Map-backed Storage: enough of the interface for prefs.js.
function memStorage() {
	const m = new Map();
	return {
		getItem: (k) => (m.has(k) ? m.get(k) : null),
		setItem: (k, v) => m.set(k, String(v)),
		removeItem: (k) => m.delete(k),
		clear: () => m.clear(),
	};
}

beforeEach(() => {
	global.localStorage = memStorage();
});
after(() => {
	delete global.localStorage;
});

test("defaults when nothing is stored", () => {
	assert.deepStrictEqual(loadPrefs(), {
		orientation: "white",
		sideWidth: null,
		restore: true,
		last: null,
		wbCollapsed: false,
		engineThreads: null,
		auditDepth: 16,
		auditEngines: null,
		auditSide: "both",
		auditFlavor: "lite",
	});
});

test("saved fields round-trip and merge", () => {
	assert.ok(savePrefs({ orientation: "black" }));
	assert.ok(savePrefs({ sideWidth: 512 }));
	const p = loadPrefs();
	assert.strictEqual(p.orientation, "black");
	assert.strictEqual(p.sideWidth, 512);
	assert.strictEqual(p.restore, true);
	assert.ok(savePrefs({ wbCollapsed: true }));
	assert.strictEqual(loadPrefs().wbCollapsed, true);
	assert.strictEqual(loadPrefs().orientation, "black", "the other fields stay");
	assert.ok(savePrefs({ engineThreads: 3 }));
	assert.strictEqual(loadPrefs().engineThreads, 3);
	assert.ok(savePrefs({ auditDepth: 23, auditEngines: 11 }));
	assert.strictEqual(loadPrefs().auditDepth, 23);
	assert.strictEqual(loadPrefs().auditEngines, 11);
	assert.ok(savePrefs({ auditSide: "black", auditFlavor: "full" }));
	assert.strictEqual(loadPrefs().auditSide, "black");
	assert.strictEqual(loadPrefs().auditFlavor, "full");
});

test("junk in storage falls back to defaults field by field", () => {
	localStorage.setItem(
		"ott-prefs",
		JSON.stringify({ orientation: "sideways", sideWidth: "wide", restore: "no", last: { id: 7 }, wbCollapsed: "yes", engineThreads: 2.5, auditDepth: 41, auditEngines: 0, auditSide: "red", auditFlavor: "max" }),
	);
	assert.deepStrictEqual(loadPrefs(), {
		orientation: "white",
		sideWidth: null,
		restore: true,
		last: null,
		wbCollapsed: false,
		engineThreads: null,
		auditDepth: 16,
		auditEngines: null,
		auditSide: "both",
		auditFlavor: "lite",
	});
	for (const bad of [0, -1, 1000, "4"]) {
		localStorage.setItem("ott-prefs", JSON.stringify({ engineThreads: bad }));
		assert.strictEqual(loadPrefs().engineThreads, null, `${bad} is refused`);
	}
	localStorage.setItem("ott-prefs", "{not json");
	assert.strictEqual(loadPrefs().orientation, "white");
	localStorage.setItem("ott-prefs", "[1,2]");
	assert.strictEqual(loadPrefs().restore, true);
});

test("widths are clamped and rounded", () => {
	assert.strictEqual(cleanWidth(100), 280);
	assert.strictEqual(cleanWidth(99999), 1600);
	assert.strictEqual(cleanWidth(433.6), 434);
	assert.strictEqual(cleanWidth(NaN), null);
	assert.strictEqual(cleanWidth(null), null);
});

test("the theme keeps its original key", () => {
	assert.strictEqual(loadTheme(), null);
	saveTheme("dark");
	assert.strictEqual(localStorage.getItem("ott-theme"), "dark");
	assert.strictEqual(loadTheme(), "dark");
	localStorage.setItem("ott-theme", "purple");
	assert.strictEqual(loadTheme(), null, "an unknown theme is ignored");
});

test("clearPrefs forgets everything, theme included", () => {
	savePrefs({ orientation: "black" });
	saveTheme("dark");
	clearPrefs();
	assert.strictEqual(loadPrefs().orientation, "white");
	assert.strictEqual(loadTheme(), null);
});

test("the last workbook is reopened only if it still exists and restoring is on", () => {
	const board = { lines: [{ moves: ["e4"] }], active: 0, at: 1, flipped: true };
	rememberWorkbook("n1", { mode: "analysis", board });
	const has = new Set(["n1"]);
	assert.deepStrictEqual(workbookToRestore((id) => has.has(id)), { id: "n1", mode: "analysis", board });
	assert.strictEqual(workbookToRestore(() => false), null, "deleted since");
	savePrefs({ restore: false });
	assert.strictEqual(workbookToRestore(() => true), null, "restoring turned off");
});

test("an unsaved workbook clears the record", () => {
	rememberWorkbook("n1");
	rememberWorkbook(null);
	assert.strictEqual(loadPrefs().last, null);
});

test("blocked storage reads as defaults and refuses writes quietly", () => {
	global.localStorage = {
		getItem() {
			throw new Error("blocked");
		},
		setItem() {
			throw new Error("blocked");
		},
		removeItem() {
			throw new Error("blocked");
		},
	};
	assert.strictEqual(loadPrefs().orientation, "white");
	assert.strictEqual(savePrefs({ orientation: "black" }), false);
	assert.strictEqual(loadTheme(), null);
	saveTheme("dark");
	clearPrefs();
});
