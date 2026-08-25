import { test } from "node:test";
import assert from "node:assert/strict";
import {
	visibleLines,
	hiddenLines,
	setHidden,
	hideAll,
	showAll,
	solo,
	hiddenState,
} from "../src/visibility.js";

// four lines: the mainline plus three sidelines
const mk = () => [
	{ isMain: true, name: "Mainline" },
	{ name: "Line 1" },
	{ name: "Line 2" },
	{ name: "Line 3" },
];

test("splits a line list into visible and hidden", () => {
	const ls = mk();
	ls[2].hidden = true;
	assert.deepEqual(
		visibleLines(ls).map((l) => l.name),
		["Mainline", "Line 1", "Line 3"],
	);
	assert.deepEqual(
		hiddenLines(ls).map((l) => l.name),
		["Line 2"],
	);
});

test("setHidden deletes the property rather than writing false", () => {
	const ls = mk();
	setHidden([ls[1]], true);
	assert.equal(ls[1].hidden, true);
	setHidden([ls[1]], false);
	assert.equal("hidden" in ls[1], false);
});

test("setHidden refuses to hide the mainline", () => {
	const ls = mk();
	setHidden([ls[0]], true);
	assert.equal("hidden" in ls[0], false);
});

test("hideAll hides every line but the mainline", () => {
	const ls = mk();
	hideAll(ls);
	assert.deepEqual(
		visibleLines(ls).map((l) => l.name),
		["Mainline"],
	);
});

test("showAll clears every hidden line", () => {
	const ls = mk();
	hideAll(ls);
	showAll(ls);
	assert.equal(hiddenLines(ls).length, 0);
});

test("solo hides every other line and keeps the mainline", () => {
	const ls = mk();
	solo(ls, [ls[2]]);
	assert.deepEqual(
		visibleLines(ls).map((l) => l.name),
		["Mainline", "Line 2"],
	);
});

test("solo unhides the lines it keeps", () => {
	const ls = mk();
	hideAll(ls);
	solo(ls, [ls[3]]);
	assert.equal("hidden" in ls[3], false);
	assert.deepEqual(
		visibleLines(ls).map((l) => l.name),
		["Mainline", "Line 3"],
	);
});

test("solo keeps a whole group", () => {
	const ls = mk();
	solo(ls, [ls[1], ls[2]]);
	assert.deepEqual(
		visibleLines(ls).map((l) => l.name),
		["Mainline", "Line 1", "Line 2"],
	);
});

test("hiddenState reads a group's chip state off its leaves", () => {
	const ls = mk();
	assert.equal(hiddenState([ls[1], ls[2]]), "none");
	ls[1].hidden = true;
	assert.equal(hiddenState([ls[1], ls[2]]), "some");
	ls[2].hidden = true;
	assert.equal(hiddenState([ls[1], ls[2]]), "all");
});
