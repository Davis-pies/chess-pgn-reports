import { test } from "node:test";
import assert from "node:assert";
import { loadState } from "./helpers.mjs";
import { numberNotes, allNotes, labelFor } from "../src/notes.js";
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
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const foot = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	// shared with the mainline, so it stays a global numbered note the footnote
	// references by number
	s.lines[0].comments = [{ ply: 2, text: "shared" }];
	foot.comments = [{ ply: 2, text: "shared" }];
	const { entries } = numberNotes(s.lines);
	const footEntry = entries.find((e) => e.foot);
	const innerEntry = entries.find((e) => e.text === "shared");
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
	// Invariant 1 (numbers): every NUMERIC marker resolves to a global note
	// anchored at the same ply, and nothing numbered goes unmarked.
	const numeric = (x) => typeof x === "number";
	[...vars, ...footNotes].forEach((v) => {
		Object.entries(v.noteByPly).forEach(([ply, marks]) => {
			marks.filter(numeric).forEach((n) => {
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
		Object.values(v.noteByPly).forEach((marks) =>
			marks.filter(numeric).forEach((n) => marked.add(n)),
		),
	);
	assert.deepStrictEqual(
		[...marked].sort((a, b) => a - b),
		notes.map((n) => n.n),
		"every numbered note is marked somewhere",
	);
	// Invariant 2 (letters): every LETTER marker inside a footnote matches a
	// sub-note label of that same footnote, and every sub-note is marked on
	// exactly the ply it belongs to — so a sub-note can neither go unmarked nor
	// point at the wrong move.
	feet.forEach((f) => {
		const byLabel = new Map(f.foot.subNotes.map((x) => [x.label, x]));
		Object.entries(f.foot.noteByPly).forEach(([ply, marks]) => {
			marks
				.filter((x) => !numeric(x))
				.forEach((label) => {
					assert.ok(byLabel.has(label), `sub-note ${label} resolves`);
					assert.strictEqual(byLabel.get(label).ply, Number(ply));
				});
		});
		f.foot.subNotes.forEach((sub) =>
			assert.ok(
				(f.foot.noteByPly[sub.ply] || []).includes(sub.label),
				`sub-note ${sub.label} is marked on ply ${sub.ply}`,
			),
		);
	});
	// the footnote's inner note is a lettered sub-note of its own footnote,
	// and is nowhere in the global list
	assert.ok(
		!notes.some((n) => n.text === "knight"),
		"the inner note left the global list",
	);
	const withInner = feet.find((f) =>
		f.foot.subNotes.some((x) => x.text === "knight"),
	);
	assert.ok(withInner, "it is a sub-note of the footnote that owns it");
	const inner = withInner.foot.subNotes.find((x) => x.text === "knight");
	assert.deepStrictEqual(withInner.foot.noteByPly[inner.ply], [inner.label]);
});

test("a footnote's own note becomes a lettered sub-note, not a global entry", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const { entries } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 1, "only the footnote is a global entry");
	const foot = entries[0].foot;
	assert.deepStrictEqual(
		foot.subNotes.map((x) => [x.label, x.text]),
		[["a", "knight move"]],
	);
	// and the marker inside the footnote's move text is the letter
	const ply = foot.subNotes[0].ply;
	assert.deepStrictEqual(foot.noteByPly[ply], ["a"]);
});

test("sub-note letters restart per footnote", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 {sicilian note}) (1... e6 2. d4 {french note}) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const feet = numberNotes(s.lines).entries.filter((e) => e.foot);
	assert.strictEqual(feet.length, 2);
	feet.forEach((f) =>
		assert.deepStrictEqual(
			f.foot.subNotes.map((x) => x.label),
			["a"],
			"each footnote starts its own lettering at a",
		),
	);
});

test("a note shared with a non-footnote line stays global", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const foot = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	// the editor writes one note onto every line in an equal-position group, so
	// the same (ply,text) can sit on a footnote AND a sideline
	s.lines[0].comments = [{ ply: 2, text: "shared" }];
	foot.comments = [{ ply: 2, text: "shared" }];
	const { entries } = numberNotes(s.lines);
	const global = entries.filter((e) => !e.foot);
	assert.deepStrictEqual(
		global.map((e) => e.text),
		["shared"],
		"kept as one global numbered note",
	);
	const footEntry = entries.find((e) => e.foot);
	assert.deepStrictEqual(footEntry.foot.subNotes, [], "not lettered as well");
	assert.deepStrictEqual(
		footEntry.foot.noteByPly[2],
		[global[0].n],
		"the footnote references it by number",
	);
});

test("sub-notes leave the global list shorter and densely numbered", () => {
	const s = loadState(
		"1. e4 {opening} e5 (1... c5 2. Nf3 {inner}) 2. Nf3 {develops}",
		{ tags: { 1: "foot" } },
	);
	const { entries } = numberNotes(s.lines);
	// opening, develops, and the footnote itself — the inner note is NOT here
	assert.deepStrictEqual(
		entries.map((e) => e.n),
		[1, 2, 3],
	);
	assert.ok(
		!entries.some((e) => e.text === "inner"),
		"the footnote's own note left the global list",
	);
});

test("notes are numbered in reading order, not line order", () => {
	// The lines array visits whole lines at a time, which is NOT the order a
	// reader meets the markers in: the mainline's late comment used to take [1]
	// while a footnote anchored on an early mainline move took a higher number,
	// so the table's markers read out of sequence.
	const s = loadState("1. e4 c5 (1... e6 2. d4) 2. Nf3 d6 3. d4 {late}", {
		tags: { 1: "foot" },
	});
	const { entries, byLine } = numberNotes(s.lines);
	assert.deepStrictEqual(
		entries.map((e) => [e.n, e.ply]),
		[
			[1, 1],
			[2, 4],
		],
		"the earlier anchor gets the lower number",
	);
	// the markers rendered on the mainline are renumbered to match
	const main = byLine.get(s.lines[0]);
	assert.deepStrictEqual(main[1], [1], "the footnote's anchor marker");
	assert.deepStrictEqual(main[4], [2], "the late comment's marker");
});

test("ties at one ply keep first-seen order", () => {
	const s = loadState("1. e4 c5 (1... e6 2. d4) (1... g6 2. d4) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const { entries } = numberNotes(s.lines);
	assert.deepStrictEqual(
		entries.map((e) => e.n),
		[1, 2],
	);
	assert.strictEqual(entries[0].foot.moves.some((m) => m.san === "e6"), true);
	assert.strictEqual(entries[1].foot.moves.some((m) => m.san === "g6"), true);
});

test("a footnote anchors on the line it shares the most moves with", () => {
	// lines[1] (…Bc4 Bc5 Qh5) branches off lines[2] (…Bc4 Nf6), not off the
	// mainline: it shares three moves with the sideline and only two with main.
	const s = loadState("1. e4 e5 2. Nf3 (2. Bc4 Nf6 (2... Bc5 3. Qh5)) Nc6", {
		tags: { 1: "foot" },
	});
	const [main, foot, side] = s.lines;
	const { entries, byLine } = numberNotes(s.lines);
	const e = entries.find((x) => x.foot);
	assert.strictEqual(e.owner, side, "owned by its true parent, not the mainline");
	// it replaces the parent's Nf6, so it anchors there
	const nf6 = side.moves.find((m) => m.san === "Nf6");
	assert.strictEqual(e.ply, nf6.ply);
	assert.deepStrictEqual(byLine.get(side)[nf6.ply], [e.n], "marked on the parent");
	assert.deepStrictEqual(
		byLine.get(main),
		{},
		"the mainline carries no marker for it",
	);
	assert.ok(foot.tag === "foot");
});

test("a footnote off the trunk still anchors on the mainline", () => {
	// nothing shares more with it than the mainline does, so behaviour is
	// unchanged — the mainline is also the tie-break winner
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", { tags: { 1: "foot" } });
	const { entries } = numberNotes(s.lines);
	assert.strictEqual(entries.find((x) => x.foot).owner, s.lines[0]);
});

test("a footnote never anchors on another footnote", () => {
	// foot lines are pulled out of the table by grid(), so a note anchored on
	// one would have no row or card to render on
	const s = loadState("1. e4 e5 2. Nf3 (2. Bc4 Nf6 (2... Bc5 3. Qh5)) Nc6", {
		tags: { 1: "foot", 2: "foot" },
	});
	const { entries } = numberNotes(s.lines);
	entries
		.filter((x) => x.foot)
		.forEach((e) => assert.strictEqual(e.owner.tag === "foot", false));
});

test("the anchor is the divergence move, not the parent's last move", () => {
	// Discriminates the two: the parent runs on past the branch, so anchoring at
	// the divergence (Nf6) and falling back to its last move (Bc5) differ. Most
	// footnotes branch at the end of their parent, where both coincide.
	const s = loadState("1. e4 e5 2. Bc4 Nf6 (2... Bc5 3. Qh5) 3. Nc3 Bc5", {
		tags: { 1: "foot" },
	});
	const [main] = s.lines;
	const e = numberNotes(s.lines).entries.find((x) => x.foot);
	const nf6 = main.moves.find((m) => m.san === "Nf6");
	assert.strictEqual(e.foot.d, 3, "diverges at index 3");
	assert.strictEqual(e.ply, nf6.ply, "anchored on the move it replaces");
	assert.notStrictEqual(
		e.ply,
		main.moves[main.moves.length - 1].ply,
		"not on the parent's last move",
	);
});

test("a footnote extending past its parent falls back to the last move", () => {
	// the documented fallback: no parent move exists at the divergence index
	const s = loadState("1. e4 e5 2. Bc4 Nf6 (2... Nf6 3. Nc3)", {
		tags: { 1: "foot" },
	});
	const [main] = s.lines;
	const e = numberNotes(s.lines).entries.find((x) => x.foot);
	assert.strictEqual(e.foot.d, main.moves.length, "shares the parent entirely");
	assert.strictEqual(e.ply, main.moves[main.moves.length - 1].ply);
});

test("labelFor alternates letters and numbers by depth", () => {
	assert.deepStrictEqual(
		[0, 1, 2, 3].map((i) => labelFor(1, i)),
		["a", "b", "c", "d"],
	);
	assert.deepStrictEqual(
		[0, 1, 2].map((i) => labelFor(2, i)),
		["1", "2", "3"],
	);
	assert.strictEqual(labelFor(3, 0), "a", "letters again at depth 3");
	assert.strictEqual(labelFor(4, 1), "2", "numbers again at depth 4");
	assert.strictEqual(labelFor(1, 26), "aa", "bijective base-26 past z");
});

test("labelFor refuses depth 0, which is the global note number", () => {
	assert.throws(() => labelFor(0, 0), /global note number/);
});

test("a group of foot lines becomes one entry with one marker", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const { entries, byLine } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 1, "one entry for the whole group");
	const e = entries[0];
	assert.strictEqual(e.owner, s.lines[0], "anchored on the mainline");
	assert.strictEqual(e.ply, 1, "on the move the group replaces (1...e5)");
	assert.deepStrictEqual(e.foot.moves.map((m) => m.san), ["e4", "c5"]);
	assert.strictEqual(e.foot.d, 1, "tail starts at the divergence");
	assert.deepStrictEqual(
		e.foot.children.map((c) => [c.label, c.depth, c.moves.map((m) => m.san)]),
		[
			["a", 1, ["Nf3"]],
			["b", 1, ["Nc3"]],
		],
	);
	assert.deepStrictEqual(byLine.get(s.lines[0])[1], [1]);
});

test("a nested fork inside a group nests its labels", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "foot" } },
	);
	const [e] = numberNotes(s.lines).entries;
	const nf3 = e.foot.children[0];
	assert.deepStrictEqual([nf3.label, nf3.depth], ["a", 1]);
	assert.deepStrictEqual(
		nf3.children.map((c) => [c.label, c.depth, c.moves.map((m) => m.san)]),
		[
			["1", 2, ["d6"]],
			["2", 2, ["Nc6"]],
		],
	);
	assert.strictEqual(e.foot.children[1].label, "b");
});

test("a group carries each member's name, eval and note", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const [m1, m2] = s.lines.filter((l) => !l.isMain);
	m1.name = "Open Sicilian";
	m1.meta = { eval: "±", note: "main try" };
	m2.meta = { eval: "=" };
	const [e] = numberNotes(s.lines).entries;
	assert.deepStrictEqual(
		e.foot.children.map((c) => [c.name, c.eval, c.note]),
		[
			["Open Sicilian", "±", "main try"],
			["", "=", ""],
		],
	);
});

test("a member's own note is a numbered sub-note, not a global one", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 {pressure}) (1... c5 2. Nc3) 2. Nf3 {develops}",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const { entries } = numberNotes(s.lines);
	assert.deepStrictEqual(
		entries.map((x) => x.text || "[group]"),
		["[group]", "develops"],
		"only the mainline comment joins the global list",
	);
	const member = entries.find((x) => x.foot).foot.children[0];
	assert.deepStrictEqual(
		member.subNotes.map((sn) => [sn.label, sn.text]),
		[["1", "pressure"]],
		"depth 2: numbers",
	);
	assert.deepStrictEqual(member.noteByPly[2], ["1"]);
});

test("a note a group member shares with a sideline stays global", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) (1... e6) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "sideline" } },
	);
	const nonFoot = s.lines.filter((l) => !l.isMain)[2];
	const member = s.lines.filter((l) => !l.isMain)[0];
	nonFoot.comments = [{ ply: 1, text: "shared" }];
	member.comments = [{ ply: 1, text: "shared" }];
	const { entries } = numberNotes(s.lines);
	const global = entries.filter((x) => x.text === "shared");
	assert.strictEqual(global.length, 1, "still one global note");
	const grp = entries.find((x) => x.foot);
	assert.deepStrictEqual(grp.foot.children[0].subNotes, [], "not a sub-note");
});

test("a group anchors on the sideline it branches from", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 d6 (2... Nc6) (2... e6)) 2. Nf3",
		// collectLines emits a node's variations BEFORE the node itself, so the
		// d6 line is index 3 and its two sub-variations are 1 and 2: those are
		// the group, and d6 is the sideline it hangs off.
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const sideline = s.lines.find((l) => l.moves.some((m) => m.san === "d6"));
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	assert.strictEqual(e.owner, sideline, "parent is the line it diverges from");
	assert.strictEqual(e.ply, 3, "on 2...d6, the move the group replaces");
});

test("a deeply nested note never renumbers the global notes", () => {
	const pgn = "1. e4 {first} e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3 {last}";
	const before = numberNotes(loadState(pgn, { tags: { 1: "foot", 2: "foot" } }).lines);
	assert.deepStrictEqual(
		before.entries.map((e) => e.n),
		[1, 2, 3],
	);
	const s = loadState(pgn, { tags: { 1: "foot", 2: "foot" } });
	const member = s.lines.filter((l) => !l.isMain)[0];
	member.comments = [{ ply: 2, text: "deep" }];
	const after = numberNotes(s.lines);
	assert.deepStrictEqual(
		after.entries.map((e) => [e.n, e.text || "[group]"]),
		before.entries.map((e) => [e.n, e.text || "[group]"]),
		"the global sequence is untouched",
	);
});

test("a lone foot line alongside a group is still its own footnote", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) (1... e6) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "foot" } },
	);
	const { entries } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 2);
	assert.ok(entries.some((e) => e.foot && e.foot.children), "the group");
	assert.ok(
		entries.some((e) => e.foot && !e.foot.children),
		"the lone footnote keeps its existing shape",
	);
});

test("a note on a shared stem move is hosted by the group, not a member", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const member = s.lines.filter((l) => !l.isMain)[0];
	member.comments = [{ ply: 1, text: "sharp gambit line" }];
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	assert.deepStrictEqual(
		e.foot.subNotes.map((sn) => [sn.label, sn.text]),
		[["a", "sharp gambit line"]],
		"the stem's own note is a level-1 item on the group",
	);
	assert.deepStrictEqual(
		e.foot.noteByPly[1],
		["a"],
		"and its marker sits on the stem move it is about",
	);
	assert.deepStrictEqual(
		e.foot.children.map((c) => c.label),
		["b", "c"],
		"the branches continue the same sequence",
	);
	assert.deepStrictEqual(e.foot.children[0].subNotes, []);
});

test("both members carrying the same stem note state it once", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	s.lines
		.filter((l) => !l.isMain)
		.forEach((l) => (l.comments = [{ ply: 1, text: "shared stem" }]));
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	assert.strictEqual(e.foot.subNotes.length, 1);
	assert.deepStrictEqual(e.foot.noteByPly[1], ["a"]);
});

test("a note on an inner fork's move is hosted by that fork", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "foot" } },
	);
	const d6 = s.lines.find((l) => l.moves.some((m) => m.san === "d6"));
	d6.comments = [{ ply: 2, text: "the fork move" }]; // 2.Nf3, owned by the fork
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	const fork = e.foot.children.find((c) => c.moves.some((m) => m.san === "Nf3"));
	assert.deepStrictEqual(
		fork.subNotes.map((sn) => [sn.label, sn.text]),
		[["1", "the fork move"]],
		"depth 2 under the fork: numbers",
	);
	assert.deepStrictEqual(fork.noteByPly[2], ["1"]);
	assert.deepStrictEqual(
		fork.children.map((c) => c.label),
		["2", "3"],
		"the fork's branches continue after its own note",
	);
});

test("a symbol on a shared move renders on the node that owns it", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const [m1, m2] = s.lines.filter((l) => !l.isMain);
	m1.marks = { 1: "!", 2: "±" };
	m2.marks = { 1: "!" };
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	assert.strictEqual(e.foot.marks[1], "!", "the stem move keeps its symbol");
	assert.strictEqual(e.foot.children[0].marks[2], "±");
});

test("a member's note on its own move is unchanged by the hosting rule", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 {pressure}) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	const member = e.foot.children[0];
	assert.deepStrictEqual(
		member.subNotes.map((sn) => [sn.label, sn.text]),
		[["1", "pressure"]],
	);
	assert.deepStrictEqual(member.noteByPly[2], ["1"]);
});

test("a note shared with a sideline marks the group's stem move", () => {
	const s = loadState(
		"1. e4 {first} e5 (1... c5 2. Nf3) (1... c5 2. Nc3) (1... e6 2. d4) 2. Nf3 Nc6 3. Bb5",
		{ tags: { 1: "foot", 2: "foot", 3: "sideline" } },
	);
	const [m1, , sideline] = s.lines.filter((l) => !l.isMain);
	sideline.comments = [{ ply: 1, text: "shared" }];
	m1.comments = [{ ply: 1, text: "shared" }];
	const { entries } = numberNotes(s.lines);
	const e = entries.find((x) => x.foot);
	const shared = entries.find((x) => x.text === "shared");
	assert.deepStrictEqual(
		e.foot.noteByPly[1],
		[shared.n],
		"the stem move carries the shared note's number",
	);
	e.foot.children.forEach((c) =>
		assert.deepStrictEqual(c.noteByPly[1], undefined, "not on a branch"),
	);
});

test("a note before the group's divergence is stated once at group level", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const member = s.lines.filter((l) => !l.isMain)[0];
	member.comments = [{ ply: 0, text: "pre-divergence" }];
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	assert.deepStrictEqual(
		e.foot.subNotes.map((sn) => sn.text),
		["pre-divergence"],
		"hosted by the group, not lettered under a branch it does not belong to",
	);
	e.foot.children.forEach((c) => assert.deepStrictEqual(c.subNotes, []));
});
