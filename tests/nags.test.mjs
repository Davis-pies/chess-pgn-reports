import { test } from "node:test";
import assert from "node:assert/strict";
import { NAGS, nagFor, symFor } from "../src/nags.js";

test("maps the traditional move assessments", () => {
	assert.equal(nagFor("!"), 1);
	assert.equal(nagFor("?"), 2);
	assert.equal(nagFor("!!"), 3);
	assert.equal(nagFor("??"), 4);
	assert.equal(nagFor("!?"), 5);
	assert.equal(nagFor("?!"), 6);
});

test("maps both halves of the paired positional glyphs", () => {
	assert.equal(symFor(22), "⨀");
	assert.equal(symFor(23), "⨀");
	assert.equal(symFor(36), "↑");
	assert.equal(symFor(37), "↑");
	assert.equal(symFor(132), "⇆");
	assert.equal(symFor(133), "⇆");
});

test("maps the advantage glyphs", () => {
	assert.equal(nagFor("="), 10);
	assert.equal(nagFor("∞"), 13);
	assert.equal(nagFor("⩲"), 14);
	assert.equal(nagFor("⩱"), 15);
	assert.equal(nagFor("±"), 16);
	assert.equal(nagFor("∓"), 17);
	assert.equal(nagFor("+−"), 18);
	assert.equal(nagFor("−+"), 19);
});

test("maps the ChessPad idea and novelty codes we keep", () => {
	assert.equal(nagFor("△"), 140);
	assert.equal(nagFor("N"), 146);
});

test("normalizes the ASCII slight-advantage spellings", () => {
	assert.equal(nagFor("+="), 14);
	assert.equal(nagFor("=+"), 15);
});

test("returns undefined for a symbol with no standard code", () => {
	assert.equal(nagFor("TN"), undefined);
	assert.equal(nagFor(""), undefined);
});

test("every entry has a code, a label and a group", () => {
	for (const n of NAGS) {
		assert.equal(typeof n.code, "number", `code for ${n.sym}`);
		assert.ok(n.label, `label for $${n.code}`);
		assert.ok(
			["move", "position", "time"].includes(n.group),
			`group for $${n.code} was ${n.group}`,
		);
	}
});

test("codes are unique and symbols round-trip", () => {
	const codes = new Set();
	for (const n of NAGS) {
		assert.ok(!codes.has(n.code), `duplicate code $${n.code}`);
		codes.add(n.code);
		if (n.sym) assert.equal(symFor(n.code), n.sym);
	}
});

test("marks a small common set for the palette's default row", () => {
	const common = NAGS.filter((n) => n.common);
	assert.ok(common.length >= 10 && common.length <= 18, common.length);
	assert.ok(common.some((n) => n.sym === "="));
	assert.ok(common.some((n) => n.sym === "!"));
});
