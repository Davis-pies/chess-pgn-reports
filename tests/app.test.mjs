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
	// preview should now carry a sideline tag label
	const view2 = doc("view");
	const preview = view2.querySelector("table.tbl");
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
	assert.strictEqual(doc("view").querySelectorAll(".ledge-board").length, 1,
		"only the mainline board shows while groups are collapsed");

	// expand the fork group: its lines' boards appear
	const det = doc("view").querySelector("details.lgroup");
	// jsdom fires toggle synchronously on .open assignment, AND the
	// explicit dispatchEvent fires a second one, so renderApp runs twice.
	// The second render sees openPaths populated — this is intentional.
	det.open = true;
	det.dispatchEvent(new dom.window.Event("toggle"));
	assert.strictEqual(doc("view").querySelectorAll(".ledge-board").length, 3,
		"expanding the group builds its lines' boards");

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

function doc(id) {
	return global.document.getElementById(id);
}
