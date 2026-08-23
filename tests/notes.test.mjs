import { test } from "node:test";
import assert from "node:assert";
import { loadState } from "./helpers.mjs";
import { numberNotes, allNotes } from "../src/notes.js";
import { grid } from "../src/table.js";

test("numberNotes numbers notes in line order and maps them back per line", () => {
	const s = loadState("1. e4 {first} e5 (1... c5 {second}) 2. Nf3");
	const { entries, byLine } = numberNotes(s.lines);
	assert.deepStrictEqual(
		entries.map((e) => [e.n, e.text]),
		[
			[1, "first"],
			[2, "second"],
		],
	);
	// the mainline owns note 1 at ply 0; the c5 variation owns note 2 at ply 1
	assert.deepStrictEqual(byLine.get(s.lines[0])[0], [1]);
	const c5 = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	assert.deepStrictEqual(byLine.get(c5)[1], [2]);
});

test("numberNotes gives identical (ply,text) notes on different lines one number", () => {
	const s = loadState("1. e4 e5 (1... c5) 2. Nf3");
	const c5 = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	s.lines[0].comments = [{ ply: 0, text: "shared" }];
	c5.comments = [{ ply: 0, text: "shared" }];
	const { entries, byLine } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 1, "one entry for the shared note");
	assert.deepStrictEqual(byLine.get(s.lines[0])[0], [1]);
	assert.deepStrictEqual(byLine.get(c5)[0], [1], "both lines point at note 1");
});

test("numberNotes lists a number once when a line repeats a note at one ply", () => {
	const s = loadState("1. e4 e5");
	s.lines[0].comments = [
		{ ply: 0, text: "twice" },
		{ ply: 0, text: "twice" },
	];
	const { entries, byLine } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 1);
	assert.deepStrictEqual(byLine.get(s.lines[0])[0], [1]);
});

test("allNotes returns the numbered entries for the current notebook", () => {
	const s = loadState("1. e4 {first} e5");
	assert.deepStrictEqual(
		allNotes().map((n) => [n.n, n.text, n.owner === s.lines[0]]),
		[[1, "first", true]],
	);
});

test("grid's note markers use the same numbers as allNotes", () => {
	const s = loadState(
		"1. e4 {opening} e5 (1... c5 {sicilian} 2. Nf3 {knight}) 2. Nf3 {develops} Nc6",
	);
	const { vars } = grid(s.lines);
	const byNumber = new Map(allNotes().map((n) => [n.n, n]));
	let checked = 0;
	vars.forEach((v) => {
		Object.entries(v.noteByPly).forEach(([ply, nums]) => {
			nums.forEach((n) => {
				assert.ok(byNumber.has(n), `note ${n} exists in the notes list`);
				assert.strictEqual(
					byNumber.get(n).ply,
					Number(ply),
					`note ${n} is anchored at the same ply in both`,
				);
				checked++;
			});
		});
	});
	assert.ok(checked >= 3, `the fixture exercised markers (got ${checked})`);
});

test("a footnote line derives a note anchored on the move it replaces", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const c5 = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	c5.name = "Sicilian";
	c5.meta = { eval: "=", note: "sharp" };
	const { entries, byLine } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 1);
	const e = entries[0];
	// the mainline plays e5 at ply 1; the footnote replaces it with c5
	assert.strictEqual(e.ply, 1, "anchored on the mainline move it replaces");
	assert.strictEqual(e.owner, s.lines[0], "owned by the mainline");
	assert.strictEqual(e.text, undefined, "a footnote entry carries no text");
	assert.strictEqual(e.foot.name, "Sicilian");
	assert.strictEqual(e.foot.eval, "=");
	assert.strictEqual(e.foot.note, "sharp");
	assert.strictEqual(e.foot.d, 1, "divergence index into its own moves");
	// the marker lands on the MAINLINE, not on the footnote line
	assert.deepStrictEqual(byLine.get(s.lines[0])[1], [1]);
});

test("a footnote past the end of the mainline anchors on its last move", () => {
	// built by hand rather than from a PGN: the point is a footnote whose
	// divergence index lands beyond the mainline's last move
	const main = {
		isMain: true,
		comments: [],
		moves: [
			{ san: "e4", ply: 0 },
			{ san: "e5", ply: 1 },
		],
	};
	const foot = {
		tag: "foot",
		comments: [],
		marks: {},
		meta: {},
		moves: [
			{ san: "e4", ply: 0 },
			{ san: "e5", ply: 1 },
			{ san: "Nf3", ply: 2 },
		],
	};
	const { entries } = numberNotes([main, foot]);
	assert.strictEqual(entries.length, 1);
	assert.strictEqual(entries[0].ply, 1, "falls back to the mainline's last move");
	assert.strictEqual(entries[0].foot.d, 2);
});

test("a footnote's own notes stay separate numbered entries", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const c5 = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	const { entries, byLine } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 2, "the footnote plus its inner note");
	assert.ok(entries[0].foot, "the footnote comes first");
	assert.strictEqual(entries[1].text, "knight move");
	// the inner note's marker renders inside the footnote's own move text
	const innerPly = entries[1].ply;
	assert.deepStrictEqual(byLine.get(c5)[innerPly], [2]);
	assert.deepStrictEqual(entries[0].foot.noteByPly[innerPly], [2]);
});

test("a footnote before the mainline in the lines array still marks the mainline", () => {
	// mirrors the state after promoteMainline flips isMain in place without
	// reordering lines: the mainline can end up anywhere in the array, so a
	// footnote line may be visited before it.
	const main = {
		isMain: true,
		comments: [],
		moves: [
			{ san: "e4", ply: 0 },
			{ san: "e5", ply: 1 },
		],
	};
	const foot = {
		tag: "foot",
		isMain: false,
		comments: [],
		marks: {},
		meta: {},
		moves: [
			{ san: "e4", ply: 0 },
			{ san: "c5", ply: 1 },
		],
	};
	const { byLine } = numberNotes([foot, main]);
	assert.deepStrictEqual(
		byLine.get(main)[1],
		[1],
		"the mainline's own map must not be overwritten after the footnote already wrote into it",
	);
});

test("a footnote entry's noteByPly is populated by the time numberNotes returns", () => {
	// pins the contract consumers depend on, independent of how it's wired
	// internally (the footnote entry is pushed before its own comments are
	// processed, so its noteByPly can't just alias the line's still-empty map)
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const { entries } = numberNotes(s.lines);
	const footEntry = entries.find((e) => e.foot);
	const innerEntry = entries.find((e) => e.text === "knight move");
	assert.deepStrictEqual(footEntry.foot.noteByPly[innerEntry.ply], [innerEntry.n]);
});

test("table markers and the notes list agree with footnotes in the mix", () => {
	// The footnote variation carries a single inner comment ("knight"), not
	// two: src/pgn.js merges consecutive fragment comments inside one flat
	// (non-nested) variation into a single narrative note attached to the
	// next move (see "Auto-merge if/then comment fragments within
	// variations into one note") — a pre-existing, unrelated parsing
	// feature. Two comments here would always collapse into one note
	// regardless of numbering correctness, so they wouldn't exercise the
	// invariant this test is for.
	const s = loadState(
		"1. e4 {opening} e5 (1... c5 2. Nf3 {knight}) (1... e6 2. d4) 2. Nf3 {develops} Nc6",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const { vars, footNotes } = grid(s.lines);
	const notes = allNotes();
	const byNumber = new Map(notes.map((n) => [n.n, n]));
	// every number is dense, 1..N, with no gaps left by a diverted footnote
	assert.deepStrictEqual(
		notes.map((n) => n.n),
		notes.map((_, i) => i + 1),
	);
	// two footnote entries, both owned by the mainline
	const feet = notes.filter((n) => n.foot);
	assert.strictEqual(feet.length, 2);
	feet.forEach((f) => assert.strictEqual(f.owner, s.lines[0]));
	// every marker in the table resolves to a note anchored at the same ply
	[...vars, ...footNotes].forEach((v) => {
		Object.entries(v.noteByPly).forEach(([ply, nums]) => {
			nums.forEach((n) => {
				assert.ok(byNumber.has(n), `marker ${n} resolves`);
				assert.strictEqual(byNumber.get(n).ply, Number(ply));
			});
		});
	});
	// no marker VANISHED: every number in the list is rendered somewhere. The
	// Task 4 parity test only checks that markers resolve to real notes, which
	// cannot catch a note that stopped being marked at all.
	const marked = new Set();
	[...vars, ...footNotes].forEach((v) =>
		Object.values(v.noteByPly).forEach((nums) =>
			nums.forEach((n) => marked.add(n)),
		),
	);
	assert.deepStrictEqual(
		[...marked].sort((a, b) => a - b),
		notes.map((n) => n.n),
		"every numbered note is marked somewhere",
	);
	// the footnote's inner note is its own entry, marked inside the footnote text
	const inner = notes.find((n) => n.text === "knight");
	assert.ok(inner, "the inner note survives as its own entry");
	const withInner = feet.find((f) => f.foot.noteByPly[inner.ply]);
	assert.ok(withInner, "and is marked inside its footnote's move text");
	assert.deepStrictEqual(withInner.foot.noteByPly[inner.ply], [inner.n]);
});
