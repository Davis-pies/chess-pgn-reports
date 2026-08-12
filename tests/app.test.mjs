import { test } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";

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
});

function doc(id) {
	return global.document.getElementById(id);
}
