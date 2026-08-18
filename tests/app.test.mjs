import { test } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";

const tick = () => new Promise((r) => setTimeout(r, 60));

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

function doc(id) {
	return global.document.getElementById(id);
}
