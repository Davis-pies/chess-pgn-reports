import { test } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";
import { saveNotebook } from "../src/store.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for a condition instead of guessing a duration. `withLoading` awaits a
// double requestAnimationFrame (~32ms of jsdom frames) *before* running the
// synchronous parse+render, so a fixed delay races the machine: it fits on an
// idle laptop and misses on a loaded CI runner.
const waitFor = async (pred, label, timeout = 5000) => {
	const deadline = Date.now() + timeout;
	while (!pred()) {
		if (Date.now() > deadline)
			throw new Error(`waitFor timed out after ${timeout}ms: ${label}`);
		await sleep(5);
	}
};

// Settle the UI: the loading overlay is present for exactly as long as
// `withLoading` is in flight, so its absence is the "render finished" signal.
const tick = async () => {
	await sleep(5);
	await waitFor(() => !document.getElementById("loading"), "loading overlay");
	await sleep(5);
};

test("full app flow: import PGN, tag a line, render table preview", async () => {
	const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	global.window = dom.window;
	global.document = dom.window.document;
	global.localStorage = dom.window.localStorage;
	global.alert = () => {};
	global.confirm = () => true;
	global.requestAnimationFrame = dom.window.requestAnimationFrame;

	await import("../src/app.js");
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

	let view = doc("view");
	const textarea = view.querySelector("textarea.pgnin");
	assert.ok(textarea, "import panel shown");
	textarea.value = "1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6";
	const loadBtn = [...view.querySelectorAll("button")].find((b) =>
		b.textContent.includes("Load"),
	);
	loadBtn.click();
	assert.ok(doc("loading"), "loading overlay appears synchronously on click");
	await tick();
	assert.ok(!doc("loading"), "overlay removed after render");

	// default layout is horizontal; switch to vertical so the tag badge shows
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent === "Vertical")
		.click();
	view = doc("view");
	// Now in labeling view: line editors + a live table preview
	assert.ok(view.querySelector(".markup"), "tagging panel present");
	assert.ok(view.querySelector("table.tbl"), "table preview rendered");
	// main + 1 variation -> 2 line editors
	const editors = view.querySelectorAll(".ledge");
	assert.strictEqual(editors.length, 2);
	// tag the second line as sideline
	const secondRow = editors[1];
	const sidelineBtn = [...secondRow.querySelectorAll("button")].find(
		(b) => b.textContent === "Sideline",
	);
	sidelineBtn.click();
	// a single sideline is ONE line — rendered as a plain row, always visible
	const preview = doc("view").querySelector(".pv-table");
	assert.ok(
		preview.textContent.toLowerCase().includes("sideline"),
		"sideline tag appears in table",
	);

	delete global.window;
	delete global.document;
	delete global.localStorage;
	delete global.alert;
	delete global.confirm;
	delete global.requestAnimationFrame;
});

test("inline boards: flat shows one per line; grouped shows only expanded groups", async () => {
	const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	global.window = dom.window;
	global.document = dom.window.document;
	global.requestAnimationFrame = dom.window.requestAnimationFrame;
	global.localStorage = dom.window.localStorage;
	global.alert = () => {};
	global.confirm = () => true;

	// cache-busting import so the DOMContentLoaded handler registers on
	// this test's document (the first test's handler is on the old document)
	await import("../src/app.js?t=2");
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

	// cache-busted import starts with fresh state (empty lines), so we're at
	// the import panel already — no reset needed
	const textarea = doc("view").querySelector("textarea.pgnin");
	// 3 lines: mainline + 2 variations that share a divergence fork at ply 2
	// both start 1... c5 2. Nf3 and then split into Nc6 / Nf6
	textarea.value = "1. e4 e5 (1... c5 2. Nf3 Nc6) (1... c5 2. Nf3 Nf6) 2. Nf3";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();
	// enable inline boards via the "Board diagrams" checkbox
	const label = [...doc("view").querySelectorAll("label")].find((l) =>
		l.textContent.includes("Board diagrams"),
	);
	label.querySelector("input").click();

	// grouped view is the default; the fork group starts collapsed
	assert.strictEqual(
		doc("view").querySelectorAll(".ledge-board").length,
		1,
		"only the mainline board shows while groups are collapsed",
	);

	// expand the fork group: its lone-line children are themselves collapsed,
	// so no new boards yet — expanding the line reveals its editor/board
	const fork = doc("view").querySelector(".markup details.lgroup");
	fork.open = true;
	fork.dispatchEvent(new dom.window.Event("toggle"));
	assert.strictEqual(
		doc("view").querySelectorAll(".ledge-board").length,
		1,
		"lone-line children stay collapsed: no boards until each is expanded",
	);

	// expand the first lone-line child: its editor + board appear (scoped
	// query — jsdom's document-wide querySelector skips <details> content)
	const fork2 = doc("view").querySelector(".markup details.lgroup");
	const leaf = fork2.querySelector(".lgroup-body > details.lgroup");
	assert.ok(leaf, "lone-line child rendered under the fork");
	leaf.open = true;
	leaf.dispatchEvent(new dom.window.Event("toggle"));
	const leaf2 = doc("view")
		.querySelector(".markup details.lgroup")
		.querySelector(".lgroup-body > details.lgroup");
	assert.strictEqual(
		leaf2.querySelectorAll(".ledge-board").length,
		1,
		"expanding a lone line shows its board",
	);

	// flat view shows a board for every line
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent === "Flat")
		.click();
	assert.strictEqual(doc("view").querySelectorAll(".ledge-board").length, 3);

	delete global.window;
	delete global.document;
	delete global.requestAnimationFrame;
	delete global.localStorage;
	delete global.alert;
	delete global.confirm;
});

test("lone-line editor groups are collapsible details, closed by default", async () => {
	const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	global.window = dom.window;
	global.document = dom.window.document;
	global.requestAnimationFrame = dom.window.requestAnimationFrame;
	global.localStorage = dom.window.localStorage;
	global.alert = () => {};
	global.confirm = () => true;

	await import("../src/app.js?t=3");
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

	// one variation = one lone line in the trie (no fork)
	const textarea = doc("view").querySelector("textarea.pgnin");
	textarea.value = "1. e4 e5 (1... c5 2. Nf3) 2. Nf3";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	const det = doc("view").querySelector(".markup details.lgroup");
	assert.ok(det, "lone line renders as a details group");
	assert.strictEqual(det.open, false, "collapsed by default");
	assert.ok(det.querySelector("summary").textContent.includes("1 line"));

	// expanding reveals the line editor
	det.open = true;
	det.dispatchEvent(new dom.window.Event("toggle"));
	const det2 = doc("view").querySelector(".markup details.lgroup");
	assert.ok(det2.open, "expanded after toggle");
	assert.ok(det2.querySelector(".ledge"), "line editor present when open");

	delete global.window;
	delete global.document;
	delete global.requestAnimationFrame;
	delete global.localStorage;
	delete global.alert;
	delete global.confirm;
});

test("print table: split-by-trie checkbox toggles per-branch tables", async () => {
	const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	global.window = dom.window;
	global.document = dom.window.document;
	global.requestAnimationFrame = dom.window.requestAnimationFrame;
	global.localStorage = dom.window.localStorage;
	global.alert = () => {};
	global.confirm = () => true;

	await import("../src/app.js?t=5");
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

	const textarea = doc("view").querySelector("textarea.pgnin");
	// two variations with DIFFERENT first moves = two top-level branches
	textarea.value = "1. e4 e5 (1... c5 2. Nf3) (1... e6 2. d4) 2. Nf3";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	// default: split off, fits -> one print table
	assert.strictEqual(
		doc("view").querySelectorAll(".pv-htable table.tbl").length,
		1,
		"one table when split-by-trie is off",
	);

	const lab = [...doc("view").querySelectorAll("label")].find((l) =>
		l.textContent.includes("split table by trie"),
	);
	lab.querySelector("input").click();

	// split ON still packs tiny branches into ONE shared table (no per-branch
	// tables for single-line tries) — compactness over per-branch sections
	assert.strictEqual(
		doc("view").querySelectorAll(".pv-htable table.tbl").length,
		1,
		"single-line branches pack into one table even with split on",
	);

	delete global.window;
	delete global.document;
	delete global.requestAnimationFrame;
	delete global.localStorage;
	delete global.alert;
	delete global.confirm;
});

test("print table: wide notebooks pack into multiple tables, oversized forks chunk at sub-forks", async () => {
	const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	global.window = dom.window;
	global.document = dom.window.document;
	global.requestAnimationFrame = dom.window.requestAnimationFrame;
	global.localStorage = dom.window.localStorage;
	global.alert = () => {};
	global.confirm = () => true;

	await import("../src/app.js?t=7");
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

	// 16 variations share 1... c5 2. Nf3 Nc6 and fork at white's 3rd move:
	// one top-level branch of 16 lines — over the 15-line cap
	const thirds = [
		"Bb5",
		"Bc4",
		"Be2",
		"d4",
		"d3",
		"c3",
		"a3",
		"b3",
		"g3",
		"h3",
		"a4",
		"b4",
		"c4",
		"Na3",
		"Nc3",
		"Qe2",
	];
	const pgn =
		"1. e4 e5 " +
		thirds.map((t) => `(1... c5 2. Nf3 Nc6 3. ${t})`).join(" ") +
		" 2. Nf3";
	const textarea = doc("view").querySelector("textarea.pgnin");
	textarea.value = pgn;
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	// >15 lines: the wide branch is cut at its sub-forks into multiple tables,
	// each at most 16 columns (mainline + 15)
	const tables = doc("view").querySelectorAll(".pv-htable table.tbl");
	assert.ok(tables.length >= 2, "wide notebook splits into multiple tables");
	[...tables].forEach((t) =>
		assert.ok(
			t.querySelectorAll("tr:first-child th").length <= 15,
			"each printed table stays within ply + mainline + 13 lines",
		),
	);

	delete global.window;
	delete global.document;
	delete global.requestAnimationFrame;
	delete global.localStorage;
	delete global.alert;
	delete global.confirm;
});

test("table preview: mainline always visible, branches collapsed by default", async () => {
	const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	global.window = dom.window;
	global.document = dom.window.document;
	global.requestAnimationFrame = dom.window.requestAnimationFrame;
	global.localStorage = dom.window.localStorage;
	global.alert = () => {};
	global.confirm = () => true;

	await import("../src/app.js?t=4");
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

	const textarea = doc("view").querySelector("textarea.pgnin");
	textarea.value =
		"1. e4 e5 (1... c5 2. Nf3 Nc6) (1... c5 2. Nf3 Nf6) (1... e6 2. d4) 2. Nf3";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	const pv = doc("view").querySelector(".pv-table");
	// ONE single table
	assert.strictEqual(pv.querySelectorAll("table.tbl").length, 1, "one table");
	// header: ply | mainline | collapsed fork | single-line branch = 4 columns
	const headers = pv.querySelectorAll("table.tbl tr:first-child th");
	assert.strictEqual(headers.length, 4, "ply + mainline + fork + single line");
	// only the FORK is collapsible; the single-line branch is a plain column
	assert.strictEqual(
		pv.querySelectorAll("table.tbl th.clickable.collapsed").length,
		1,
		"only the multi-line fork starts collapsed",
	);
	assert.strictEqual(
		pv.querySelectorAll("table.tbl th.clickable").length,
		1,
		"single-line branch is a plain column (no collapse affordance)",
	);
	const mainTh = headers[1];
	assert.ok(
		!mainTh.classList.contains("clickable"),
		"mainline column is always visible (not collapsible)",
	);
	// a collapsed branch column holds its shared continuation moves
	assert.ok(
		pv.querySelectorAll("td.collapsed").length > 0,
		"collapsed branch shows shared moves",
	);

	// expand the fork by clicking its header
	const fork = pv.querySelector("table.tbl th.clickable.collapsed");
	fork.click();
	const pv2 = doc("view").querySelector(".pv-table");
	assert.strictEqual(
		pv2.querySelectorAll("table.tbl th.clickable.collapsed").length,
		0,
		"fork expanded",
	);
	assert.strictEqual(
		pv2.querySelectorAll("table.tbl th.clickable:not(.collapsed)").length,
		2,
		"fork's two line headers are clickable (to collapse)",
	);

	// clicking an expanded line collapses the fork again
	pv2.querySelector("table.tbl th.clickable:not(.collapsed)").click();
	assert.strictEqual(
		doc("view").querySelectorAll(".pv-table th.clickable.collapsed").length,
		1,
		"clicking an expanded line collapses its branch",
	);

	// expand all
	[...doc("view").querySelectorAll(".pv-table button")]
		.find((b) => b.textContent === "Expand all")
		.click();
	assert.strictEqual(
		doc("view").querySelectorAll(".pv-table th.clickable.collapsed").length,
		0,
		"expand all expands the fork",
	);

	// collapse all
	[...doc("view").querySelectorAll(".pv-table button")]
		.find((b) => b.textContent === "Collapse all")
		.click();
	assert.strictEqual(
		doc("view").querySelectorAll(".pv-table th.clickable.collapsed").length,
		1,
		"collapse all collapses the fork",
	);

	delete global.window;
	delete global.document;
	delete global.requestAnimationFrame;
	delete global.localStorage;
	delete global.alert;
	delete global.confirm;
});

test("table preview: rows span only visible columns, no trailing empty rows", async () => {
	const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	global.window = dom.window;
	global.document = dom.window.document;
	global.requestAnimationFrame = dom.window.requestAnimationFrame;
	global.localStorage = dom.window.localStorage;
	global.alert = () => {};
	global.confirm = () => true;

	await import("../src/app.js?t=6");
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

	// a forking branch whose lines reach ply 4 while the mainline stops at ply 2
	const textarea = doc("view").querySelector("textarea.pgnin");
	textarea.value =
		"1. e4 e5 (1... c5 2. Nf3 Nc6 3. Bb5) (1... c5 2. Nf3 Nc6 3. a4) 2. Nf3";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	// collapsed: rows span the deepest VISIBLE column (shared moves end at ply 3)
	const rows = doc("view").querySelectorAll(".pv-table table.tbl tr");
	assert.strictEqual(
		rows.length,
		5,
		"collapsed branch does not stretch rows to the hidden deep plies (header + ply 0..3)",
	);

	// expand the branch: rows extend to the deepest line (ply 4)
	doc("view").querySelector(".pv-table th.clickable.collapsed").click();
	const rows2 = doc("view").querySelectorAll(".pv-table table.tbl tr");
	assert.strictEqual(
		rows2.length,
		6,
		"expanded branch extends rows to its deepest ply (header + ply 0..4)",
	);

	delete global.window;
	delete global.document;
	delete global.requestAnimationFrame;
	delete global.localStorage;
	delete global.alert;
	delete global.confirm;
});

test("deleting one saved workbook removes only its row, not the whole list", async () => {
	const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	global.window = dom.window;
	global.document = dom.window.document;
	global.requestAnimationFrame = dom.window.requestAnimationFrame;
	global.localStorage = dom.window.localStorage;
	global.alert = () => {};
	global.confirm = () => true;

	// pre-seed two saved notebooks directly via store.js, so the app starts
	// with both already listed (avoids a same-millisecond id collision that
	// saving twice through the UI could hit)
	const lineFor = (san) => [{ isMain: true, moves: [{ san, ply: 0 }] }];
	saveNotebook("bookA", { name: "Book A", pgn: "1. e4", lines: lineFor("e4") });
	saveNotebook("bookB", { name: "Book B", pgn: "1. d4", lines: lineFor("d4") });

	await import("../src/app.js?t=8");
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

	let box = doc("view").querySelector(".notebooks");
	assert.ok(box, "notebooks panel present");
	assert.ok(box.querySelector(".nb-head"), "header present before delete");

	const rowA = [...box.querySelectorAll("span")].find((s) =>
		s.textContent.includes("Book A"),
	);
	assert.ok(rowA, "Book A row present");
	const delA = [...rowA.querySelectorAll("button")].find(
		(b) => b.textContent === "✕",
	);
	delA.click();

	box = doc("view").querySelector(".notebooks");
	assert.ok(box, "notebooks panel still present after deleting one entry");
	assert.ok(
		box.querySelector(".nb-head"),
		"header still present — the whole list wasn't wiped",
	);
	assert.ok(
		[...box.querySelectorAll("span")].some((s) =>
			s.textContent.includes("Book B"),
		),
		"the untouched workbook's row is still visible",
	);
	assert.ok(
		![...box.querySelectorAll("span")].some((s) =>
			s.textContent.includes("Book A"),
		),
		"the deleted workbook's row is gone",
	);

	delete global.window;
	delete global.document;
	delete global.requestAnimationFrame;
	delete global.localStorage;
	delete global.alert;
	delete global.confirm;
});

test("Save surfaces a storage failure instead of silently losing the notebook", async () => {
	const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	global.window = dom.window;
	global.document = dom.window.document;
	global.requestAnimationFrame = dom.window.requestAnimationFrame;
	global.localStorage = dom.window.localStorage;
	const alerts = [];
	global.alert = (msg) => alerts.push(msg);
	global.confirm = () => true;

	await import("../src/app.js?t=9");
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

	const textarea = doc("view").querySelector("textarea.pgnin");
	textarea.value = "1. e4 e5";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	// jsdom's Storage writes any property assignment through to the backing
	// store (named-property setter per the WebStorage spec), so a plain
	// `localStorage.setItem = fn` silently no-ops instead of overriding the
	// method — stub it on the prototype instead.
	const proto = Object.getPrototypeOf(global.localStorage);
	const origSetItem = proto.setItem;
	proto.setItem = () => {
		throw new Error("QuotaExceededError");
	};
	try {
		const saveBtn = [...doc("view").querySelectorAll("button")].find(
			(b) => b.textContent === "Save",
		);
		saveBtn.click();
		assert.strictEqual(alerts.length, 1, "failure is surfaced via alert");
		assert.notStrictEqual(
			saveBtn.textContent,
			"Saved ✓",
			"button does not falsely claim success",
		);
	} finally {
		proto.setItem = origSetItem;
	}

	delete global.window;
	delete global.document;
	delete global.requestAnimationFrame;
	delete global.localStorage;
	delete global.alert;
	delete global.confirm;
});

test("opening a saved notebook carries forward the dragged side panel width", async () => {
	const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	global.window = dom.window;
	global.document = dom.window.document;
	global.requestAnimationFrame = dom.window.requestAnimationFrame;
	global.localStorage = dom.window.localStorage;
	global.alert = () => {};
	global.confirm = () => true;

	await import("../src/app.js?t=10");
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

	const textarea = doc("view").querySelector("textarea.pgnin");
	textarea.value = "1. e4 e5";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	const nameInput = doc("view").querySelector("input.name");
	nameInput.value = "Book A";
	nameInput.dispatchEvent(new dom.window.Event("input"));
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent === "Save")
		.click();

	// drag the side-resize handle to a non-default width
	const handle = doc("view").querySelector(".side-resize");
	handle.dispatchEvent(new dom.window.Event("mousedown"));
	dom.window.document.dispatchEvent(
		new dom.window.MouseEvent("mousemove", { clientX: 555 }),
	);
	dom.window.document.dispatchEvent(new dom.window.MouseEvent("mouseup"));
	assert.strictEqual(
		dom.window.document.documentElement.style.getPropertyValue("--side-w"),
		"555px",
		"drag applied",
	);

	// back to the import panel, then reopen the notebook we just saved
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent === "New / Import")
		.click();
	const openBtn = [...doc("view").querySelectorAll("button")].find((b) =>
		b.textContent.includes("Open: Book A"),
	);
	assert.ok(openBtn, "saved notebook listed");
	openBtn.click();
	await tick();

	assert.strictEqual(
		dom.window.document.documentElement.style.getPropertyValue("--side-w"),
		"555px",
		"the dragged side panel width survives opening a saved notebook",
	);

	delete global.window;
	delete global.document;
	delete global.requestAnimationFrame;
	delete global.localStorage;
	delete global.alert;
	delete global.confirm;
});

// A note carried by several lines (either from identical PGN comment text, or
// written across a shared-position group by the note editor) is ONE note. The
// printed Notes list must show it once, not once per line carrying it.
test("print notes: a note shared by several lines is listed once", async () => {
	const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	global.window = dom.window;
	global.document = dom.window.document;
	global.requestAnimationFrame = dom.window.requestAnimationFrame;
	global.localStorage = dom.window.localStorage;
	global.alert = () => {};
	global.confirm = () => true;

	await import("../src/app.js?t=11");
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

	const textarea = doc("view").querySelector("textarea.pgnin");
	// both variations carry the identical comment at the same ply -> one note
	textarea.value =
		"1. e4 e5 2. Nf3 (2. Bc4 Nc6 {tricky bishop}) (2. d4 exd4 {tricky bishop}) Nc6";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	const boxes = [...global.document.querySelectorAll(".print-notes")];
	const tables = [...global.document.querySelectorAll(".pv-htable table.tbl")];
	const rows = [...global.document.querySelectorAll(".print-notes .nt")];
	assert.strictEqual(
		rows.length,
		1,
		`one row per distinct note, not one per line carrying it. ` +
			`boxes=${boxes.length} tables=${tables.length} rows=${rows.length} ` +
			`texts=${JSON.stringify(rows.map((r) => r.textContent))}`,
	);

	delete global.window;
	delete global.document;
	delete global.requestAnimationFrame;
	delete global.localStorage;
	delete global.alert;
	delete global.confirm;
});

function doc(id) {
	return global.document.getElementById(id);
}
