import { test } from "node:test";
import assert from "node:assert/strict";
import { NAGS, nagFor, symFor, markSym, markOf } from "../src/nags.js";

test("maps the traditional move assessments", () => {
	assert.equal(nagFor("!"), 1);
	assert.equal(nagFor("?"), 2);
	assert.equal(nagFor("!!"), 3);
	assert.equal(nagFor("??"), 4);
	assert.equal(nagFor("!?"), 5);
	assert.equal(nagFor("?!"), 6);
});

test("maps both halves of the paired positional glyphs", () => {
	assert.equal(symFor(22), "⊙");
	assert.equal(symFor(23), "⊙");
	assert.equal(symFor(36), "↑");
	assert.equal(symFor(37), "↑");
	assert.equal(symFor(132), "⇄");
	assert.equal(symFor(133), "⇄");
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

// --- glyphs are a rendering choice, codes are the data ----------------------
// Three glyphs were changed for how they RENDER, not what they mean: two n-ary
// large operators sized to stand next to a ∑, and a pair of arrows written the
// other way round. Marks store the code, so nothing saved had to
// change -- but a notebook written before the swap still holds the old glyph,
// and must still migrate.

test("a mark written with a superseded glyph still maps to its code", () => {
	const old = {
		"⨀": 22, // n-ary circled dot -> ⊙ zugzwang
		"⨁": 138, // n-ary circled plus -> ⊕ severe time trouble
		"⇆": 132, // the arrows the other way round -> ⇄ counterplay
	};
	for (const [glyph, code] of Object.entries(old))
		assert.strictEqual(nagFor(glyph), code, glyph + " still maps");
});

test("a superseded glyph renders as the glyph we draw now", () => {
	assert.strictEqual(markSym(markOf(nagFor("⨀"))), "⊙");
	assert.strictEqual(markSym(markOf(nagFor("⯹"))), "⯹", "compensation is unchanged");
	assert.strictEqual(markSym(markOf(nagFor("=/∞"))), "⯹", "and the ASCII spelling maps to it");
});

test("no glyph is an n-ary large operator", () => {
	// U+2A00-U+2AFF are sized to stand beside a ∑, so they came out oversized
	// and off-baseline in a chip. ⩲ (U+2A72) and ⩱ (U+2A71) are the exception:
	// they are the notation's own symbols and have no smaller equivalent.
	const keep = new Set(["⩱", "⩲"]);
	const bad = NAGS.filter(
		(n) =>
			n.sym &&
			[...n.sym].some(
				(c) =>
					c.codePointAt(0) >= 0x2a00 &&
					c.codePointAt(0) <= 0x2aff &&
					!keep.has(c),
			),
	);
	assert.deepStrictEqual(bad.map((n) => n.sym), []);
});

test("the crushing advantage pair is offered alongside the decisive one", () => {
	const sym = (code) => NAGS.find((n) => n.code === code).sym;
	assert.strictEqual(sym(18), "+−", "White winning");
	assert.strictEqual(sym(19), "−+", "Black winning");
	assert.strictEqual(sym(20), "+−−", "White crushing");
	assert.strictEqual(sym(21), "−−+", "Black crushing");
	// distinct codes, so the two are never confused on export
	assert.strictEqual(nagFor("+−"), 18);
	assert.strictEqual(nagFor("+−−"), 20);
});
