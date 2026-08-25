import { test } from "node:test";
import assert from "node:assert/strict";
import {
	visibleLines,
	hiddenLines,
	setHidden,
	hideAll,
	showAll,
	solo,
	focus,
	focusSet,
	isFocused,
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

// A tree with a real parent line: "e4 c5" stops where "e4 c5 Nf3" and
// "e4 c5 Nc3" carry on, so it is the line those two branched out of.
const mv = (sans) => ({ moves: sans.map((san, i) => ({ san, ply: i })) });
const tree = () => {
	const lines = [
		{ isMain: true, ...mv(["e4", "e5"]), name: "Mainline" },
		{ ...mv(["e4", "c5"]), name: "Parent" },
		{ ...mv(["e4", "c5", "Nf3"]), name: "Child A" },
		{ ...mv(["e4", "c5", "Nc3"]), name: "Child B" },
		{ ...mv(["e4", "e6"]), name: "Unrelated" },
	];
	return { lines, byName: (n) => lines.find((l) => l.name === n) };
};

test("focusSet keeps the parent lines a focused line hangs off", () => {
	const { lines, byName } = tree();
	assert.deepEqual(
		focusSet(lines, [byName("Child A")])
			.map((l) => l.name)
			.sort(),
		["Child A", "Parent"],
	);
});

test("focusSet never includes the mainline, which is never hidden anyway", () => {
	const { lines, byName } = tree();
	// the mainline shares "e4" but is not a proper prefix; even if it were, it
	// has no business in a set whose purpose is deciding what to hide
	assert.ok(!focusSet(lines, [byName("Child A")]).some((l) => l.isMain));
	assert.ok(!focusSet(lines, lines).some((l) => l.isMain));
});

test("focus hides the siblings and the unrelated lines, not the parent", () => {
	const { lines, byName } = tree();
	focus(lines, [byName("Child A")]);
	assert.deepEqual(
		lines.filter((l) => l.hidden).map((l) => l.name),
		["Child B", "Unrelated"],
	);
	assert.ok(!byName("Parent").hidden, "the parent line stays");
	assert.ok(!byName("Mainline").hidden, "the mainline is never hidden");
});

test("focus on a group keeps the parent of the whole group", () => {
	const { lines, byName } = tree();
	focus(lines, [byName("Child A"), byName("Child B")]);
	assert.deepEqual(
		lines.filter((l) => l.hidden).map((l) => l.name),
		["Unrelated"],
	);
});

test("isFocused reads the current focus back off the lines", () => {
	const { lines, byName } = tree();
	assert.ok(!isFocused(lines, [byName("Child A")]), "nothing focused yet");
	focus(lines, [byName("Child A")]);
	assert.ok(isFocused(lines, [byName("Child A")]), "now it is");
	assert.ok(
		!isFocused(lines, [byName("Child B")]),
		"its sibling is not focused",
	);
	// a manual hide breaks the focus, and the chip must stop claiming it
	setHidden([byName("Parent")], true);
	assert.ok(
		!isFocused(lines, [byName("Child A")]),
		"hiding the parent by hand ends the focus",
	);
});

test("isFocused is false when nothing could be focused", () => {
	const { lines } = tree();
	assert.ok(!isFocused(lines, []), "an empty selection focuses nothing");
});
