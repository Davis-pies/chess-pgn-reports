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
	// the sideline rows live in a collapsed trie branch; expand it
	const tb = doc("view").querySelector(".pv-table details.tbl-group");
	tb.open = true;
	tb.dispatchEvent(new dom.window.Event("toggle"));
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

	assert.strictEqual(
		doc("view").querySelectorAll(".pv-htable table.tbl").length,
		2,
		"two branch tables when split-by-trie is on",
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
	textarea.value = "1. e4 e5 (1... c5 2. Nf3) (1... e6 2. d4) 2. Nf3";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	const pv = doc("view").querySelector(".pv-table");
	// mainline reference table is always present
	assert.ok(pv.querySelector(".tbl-main table.tbl"), "mainline block visible");
	// two branches, both collapsed by default
	const groups = pv.querySelectorAll("details.tbl-group");
	assert.strictEqual(groups.length, 2);
	assert.ok(!groups[0].open && !groups[1].open, "branches start collapsed");

	// expand the first branch -> its table slice appears
	groups[0].open = true;
	groups[0].dispatchEvent(new dom.window.Event("toggle"));
	const pv2 = doc("view").querySelector(".pv-table");
	assert.strictEqual(pv2.querySelectorAll("details.tbl-group").length, 2);
	assert.ok(pv2.querySelector("details.tbl-group[open]"), "a branch is expanded");

	// expand-all opens every branch
	[...pv2.querySelectorAll("button")]
		.find((b) => b.textContent === "Expand all")
		.click();
	assert.strictEqual(
		doc("view").querySelectorAll(".pv-table details.tbl-group[open]").length,
		2,
		"expand all opens both branches",
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

