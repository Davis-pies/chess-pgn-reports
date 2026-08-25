import { test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { readFileSync } from "node:fs";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import {
	treeFromLines,
	buildTree,
	writeMovetext,
	annotate,
	buildPgn,
} from "../src/pgn-out.js";

// SAN-only view of a node list, so structure assertions stay readable.
const shape = (nodes) =>
	nodes.map((n) => ({
		san: n.san,
		vars: n.variations.map(shape),
	}));

// The PGN as a reader sees it: [%...] markers are machine data that viewers
// hide, so assertions about visible text must not see them.
function visible(pgn) {
	return pgn
		.replace(/\[%[^\]]*\]\s?/g, "")
		.replace(/\{\s*\}\s?/g, ""); // a comment that held only a marker
}

function linesOf(pgn) {
	return collectLines(parsePgn(pgn).nodes);
}

test("a mainline with no sidelines is a flat node list", () => {
	const t = treeFromLines(linesOf("1. e4 e5 2. Nf3 *"));
	assert.deepEqual(shape(t), [
		{ san: "e4", vars: [] },
		{ san: "e5", vars: [] },
		{ san: "Nf3", vars: [] },
	]);
});

test("a sideline attaches as a variation on the move it replaces", () => {
	const t = treeFromLines(linesOf("1. e4 e5 (1... c5 2. Nf3) 2. Nc3 *"));
	assert.deepEqual(shape(t), [
		{ san: "e4", vars: [] },
		{
			san: "e5",
			vars: [[{ san: "c5", vars: [] }, { san: "Nf3", vars: [] }]],
		},
		{ san: "Nc3", vars: [] },
	]);
});

test("two sidelines off the same move are sibling variations", () => {
	const t = treeFromLines(linesOf("1. e4 e5 (1... c5) (1... e6) 2. Nf3 *"));
	assert.deepEqual(shape(t)[1], {
		san: "e5",
		vars: [[{ san: "c5", vars: [] }], [{ san: "e6", vars: [] }]],
	});
});

test("a sideline of a sideline nests inside its own parent", () => {
	const t = treeFromLines(linesOf("1. e4 c5 2. Nf3 d6 (2... Nc6 3. Bb5 (3. d4)) *"));
	const d6 = shape(t)[3];
	assert.equal(d6.san, "d6");
	assert.equal(d6.vars.length, 1, "both sidelines share one Nc6 branch");
	const sub = d6.vars[0];
	// Which of Bb5/d4 continues the branch and which hangs off it as a
	// variation is not recoverable: collectLines flattens both to root-to-leaf
	// lines with the same divergence point, and the two nestings describe the
	// same set of lines. What must hold is that the second nests INSIDE the
	// first rather than reappearing as another branch off d6.
	assert.equal(sub[0].san, "Nc6");
	assert.equal(sub.length, 2);
	assert.equal(sub[1].vars.length, 1);
	assert.deepEqual(
		[sub[1].san, sub[1].vars[0][0].san].sort(),
		["Bb5", "d4"],
	);
});

test("exports the user-promoted mainline as the trunk", () => {
	const lines = linesOf("1. e4 e5 (1... c5 2. Nf3) *");
	lines.forEach((l) => (l.isMain = false));
	lines[1].isMain = true;
	const t = treeFromLines(lines);
	assert.deepEqual(t.map((n) => n.san), ["e4", "c5", "Nf3"]);
	assert.deepEqual(shape(t)[1].vars, [[{ san: "e5", vars: [] }]]);
});

test("a footnote-tagged line is an ordinary variation", () => {
	const lines = linesOf("1. e4 e5 (1... c5) *");
	lines[1].tag = "foot";
	const t = treeFromLines(lines);
	assert.deepEqual(shape(t)[1].vars, [[{ san: "c5", vars: [] }]]);
});

test("no lines produces no nodes", () => {
	assert.deepEqual(treeFromLines([]), []);
});

test("numbers White's moves and runs Black's straight on", () => {
	const t = treeFromLines(linesOf("1. e4 e5 2. Nf3 Nc6 *"));
	assert.equal(writeMovetext(t, "*"), "1. e4 e5 2. Nf3 Nc6 *");
});

test("re-numbers a Black move that follows a variation", () => {
	const t = treeFromLines(linesOf("1. e4 e5 (1... c5) 2. Nf3 *"));
	assert.equal(writeMovetext(t, "*"), "1. e4 e5 (1... c5) 2. Nf3 *");
});

test("re-numbers a Black move that follows a comment", () => {
	const t = treeFromLines(linesOf("1. e4 e5 *"));
	t[0].comments.push("a strong start");
	assert.equal(writeMovetext(t, "*"), "1. e4 {a strong start} 1... e5 *");
});

test("writes NAG tokens after the move they annotate", () => {
	const t = treeFromLines(linesOf("1. e4 e5 *"));
	t[0].nags.push(1);
	t[1].nags.push(16);
	assert.equal(writeMovetext(t, "*"), "1. e4 $1 1... e5 $16 *");
});

test("writes the result token given", () => {
	const t = treeFromLines(linesOf("1. e4 e5 1-0"));
	assert.equal(writeMovetext(t, "1-0"), "1. e4 e5 1-0");
});

test("wraps at 80 columns on token boundaries", () => {
	const long =
		"1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 " +
		"7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 *";
	const out = writeMovetext(treeFromLines(linesOf(long)), "*");
	for (const line of out.split("\n")) assert.ok(line.length <= 80, line);
	assert.equal(out.split(/\s+/).join(" "), long.replace(/\s+/g, " "));
});

test("escapes a closing brace inside a comment", () => {
	const t = treeFromLines(linesOf("1. e4 *"));
	t[0].comments.push("a } brace and\na newline");
	assert.equal(writeMovetext(t, "*"), "1. e4 {a ) brace and a newline} *");
});

// treeFromLines + annotate, returning the trunk, with the per-line index the
// tests need to attach marks first.
function annotated(pgn, decorate = () => {}, notes = []) {
	const lines = linesOf(pgn);
	decorate(lines);
	const built = buildTree(lines);
	annotate(built, lines, notes);
	return { tree: built.trunk, lines, built };
}

test("a per-move mark becomes a NAG on that move", () => {
	const { tree } = annotated("1. e4 e5 *", (lines) => {
		lines[0].marks = { 0: "!" };
	});
	assert.deepEqual(tree[0].nags, [1]);
	assert.deepEqual(tree[1].nags, []);
});

test("a mark with no standard code becomes a comment", () => {
	const { tree } = annotated("1. e4 *", (lines) => {
		lines[0].marks = { 0: "TN" };
	});
	assert.deepEqual(tree[0].nags, []);
	assert.deepEqual(tree[0].comments, ["TN"]);
});

test("a mark on a sideline lands on the sideline's node", () => {
	const { tree } = annotated("1. e4 e5 (1... c5) *", (lines) => {
		lines[1].marks = { 1: "\u00b1" };
	});
	assert.deepEqual(tree[1].nags, []);
	assert.deepEqual(tree[1].variations[0][0].nags, [16]);
});

test("a line's eval comments its first divergent move, without the name", () => {
	// names are gated; the eval is not — it says something the moves do not
	const { tree } = annotated("1. e4 e5 (1... c5) *", (lines) => {
		lines[1].name = "Sicilian";
		lines[1].meta = { eval: "\u221e" };
	});
	const comments = tree[1].variations[0][0].comments;
	// the round-trip marker rides along; the human-readable part is the eval
	assert.deepEqual(
		comments.filter((c) => !c.startsWith("[%")),
		["\u221e"],
	);
});

test("a sideline's name is exported only when the notebook asks for it", () => {
	// a plain sideline, not a footnote: its name was exported unconditionally,
	// so a line whose only content was its name became a bare {Line 7} comment
	const build = (showFootNames) => {
		const lines = linesOf("1. e4 e5 (1... c5 2. Nf3) *");
		lines[1].name = "Line 7";
		return buildPgn({ name: "T", lines, showFootNames });
	};
	// the marker still carries the name so our own importer gets it back; what
	// must not appear is human-readable text outside a [%...] marker
	assert.doesNotMatch(visible(build(false)), /Line 7/, build(false));
	assert.match(visible(build(true)), /\{Line 7\}/, build(true));
});

test("a note comments the move it is anchored to", () => {
	const { tree } = annotated(
		"1. e4 e5 2. Nf3 *",
		() => {},
		[{ n: 1, ply: 2, text: "the main try", owner: null }],
	);
	assert.deepEqual(tree[2].comments, ["the main try"]);
});

test("a note owned by a sideline lands on the sideline's move", () => {
	const { tree, lines, built } = annotated("1. e4 e5 (1... c5) *", () => {});
	annotate(built, lines, [{ n: 1, ply: 1, text: "sharper", owner: lines[1] }]);
	assert.deepEqual(tree[1].comments, []);
	assert.deepEqual(tree[1].variations[0][0].comments, ["sharper"]);
});

test("imported NAGs survive as marks and re-export", () => {
	const { tree } = annotated("1. e4 $1 e5 *");
	assert.deepEqual(tree[0].nags, [1]);
});

test("emits a full seven tag roster", () => {
	const out = buildPgn({ name: "Ruy Lopez", lines: linesOf("1. e4 e5 *") });
	const tags = out.split("\n\n")[0].split("\n");
	assert.deepEqual(tags, [
		'[Event "Ruy Lopez"]',
		'[Site "?"]',
		'[Date "????.??.??"]',
		'[Round "?"]',
		'[White "?"]',
		'[Black "?"]',
		'[Result "*"]',
	]);
});

test("falls back to ? for an unnamed notebook", () => {
	const out = buildPgn({ lines: linesOf("1. e4 *") });
	assert.ok(out.startsWith('[Event "?"]'));
});

test("escapes quotes and backslashes in a tag value", () => {
	const out = buildPgn({
		name: 'the "sharp" \\ line',
		lines: linesOf("1. e4 *"),
	});
	assert.ok(out.includes('[Event "the \\"sharp\\" \\\\ line"]'), out);
});

test("a blank state produces a valid empty game", () => {
	const out = buildPgn({ lines: [] });
	assert.ok(out.includes('[Result "*"]'));
	assert.ok(out.trimEnd().endsWith("*"));
});

test("ends with a single trailing newline", () => {
	const out = buildPgn({ lines: linesOf("1. e4 *") });
	assert.ok(out.endsWith("*\n"));
	assert.ok(!out.endsWith("\n\n"));
});

const FIXTURE = readFileSync(
	new URL("./fixtures/capablanca.pgn", import.meta.url),
	"utf8",
);

// `nullMoves` marks a case chess.js cannot validate: it does not implement the
// PGN null move ("--"), which the Capablanca fixture uses to show what a side
// was threatening. Our export reproduces those moves faithfully — dropping them
// to satisfy the validator would lose annotation the source carried — so that
// case is checked by the round-trip alone.
const CASES = [
	["plain mainline", "1. e4 e5 2. Nf3 Nc6 *"],
	["one sideline", "1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 *"],
	["nested sidelines", "1. e4 c5 2. Nf3 d6 (2... Nc6 3. Bb5 (3. d4 cxd4)) *"],
	["comments", "1. e4 {best by test} e5 (1... c5 {sharp}) *"],
	["NAGs", "1. e4 $1 e5 $16 2. Nf3 $13 *"],
	["a decisive result", "1. e4 e5 1-0"],
	["the capablanca fixture", FIXTURE, { nullMoves: true }],
];

for (const [name, pgn, opts = {}] of CASES) {
	const exported = () => {
		const lines = linesOf(pgn);
		return { lines, out: buildPgn({ name: "T", lines, result: parsePgn(pgn).result }) };
	};

	test(`chess.js parses our export of ${name}`, { skip: opts.nullMoves && "chess.js has no null-move support" }, () => {
		const { out } = exported();
		const c = new Chess();
		assert.doesNotThrow(() => c.loadPgn(out), out);
		// the trunk actually survived, rather than loading as an empty game
		assert.ok(c.history().length > 0, out);
	});

	test(`our parser round-trips our export of ${name}`, () => {
		const { lines, out } = exported();
		const back = collectLines(parsePgn(out).nodes);
		const key = (ls) =>
			ls
				.map((l) => l.moves.map((m) => m.ply + m.san).join(" "))
				.sort()
				.join(" | ");
		assert.equal(key(back), key(lines), out);
	});
}

test("marks survive a round-trip", () => {
	const lines = linesOf("1. e4 e5 2. Nf3 *");
	lines[0].marks = { 0: "!", 2: "\u00b1" };
	const out = buildPgn({ name: "T", lines });
	const back = collectLines(parsePgn(out).nodes);
	assert.deepEqual(back[0].marks, { 0: "!", 2: "\u00b1" });
});

test("a null move survives the export", () => {
	// chess.js rejects "--", so this is checked against our own parser: the
	// fixture uses null moves to show a threat, and losing them would drop
	// annotation the source carried.
	const lines = linesOf("1. e4 e5 2. -- Bc5 *");
	const out = buildPgn({ name: "T", lines });
	assert.match(out, /2\. -- Bc5/);
	const back = collectLines(parsePgn(out).nodes);
	assert.deepEqual(
		back[0].moves.map((m) => m.san),
		["e4", "e5", "--", "Bc5"],
	);
});

test("merges a move's comments into one brace group", () => {
	const t = treeFromLines(linesOf("1. e4 *"));
	t[0].comments.push("Sicilian ∞", "a note");
	assert.equal(writeMovetext(t, "*"), "1. e4 {Sicilian ∞ a note} *");
});

// A footnote's prose lives in `foot.note` and its lettered sub-notes, not in
// `note.text` — an entry with a `foot` has no `text` at all. Reading it as a
// plain note dropped every footnote's words and left only the line's name.
test("a footnote's own note reaches the PGN", () => {
	const lines = linesOf("1. e4 e5 (1... c5 2. Nf3) *");
	lines[1].tag = "foot";
	lines[1].meta = { note: "a sharp reply" };
	const out = buildPgn({ name: "T", lines });
	assert.match(visible(out), /a sharp reply/, out);
});

test("a footnote's sub-notes reach the moves they annotate", () => {
	const lines = linesOf("1. e4 e5 (1... c5 2. Nf3 {develops} d6) *");
	lines[1].tag = "foot";
	const out = buildPgn({ name: "T", lines });
	// parsePgn merges a variation's fragment comments with the moves that
	// follow them into one note (see parseSeq), so the text arrives as
	// "develops 2... d6" anchored on d6 — inside the footnote's variation,
	// which is what matters here.
	assert.match(
		visible(out).replace(/\s+/g, " "),
		/\(1\.\.\. c5 2\. Nf3 d6 \{develops[^}]*\}\)/,
		out,
	);
});

test("a footnote line's name is omitted from the PGN unless asked for", () => {
	const build = (showFootNames) => {
		const lines = linesOf("1. e4 e5 (1... c5 2. Nf3) *");
		lines[1].tag = "foot";
		lines[1].name = "Sicilian";
		lines[1].meta = { eval: "∞" };
		return buildPgn({ name: "T", lines, showFootNames });
	};
	// the eval still rides along; only the name is gated
	// the marker still carries the name for our own importer; what is gated is
	// the human-readable text outside a [%...] marker
	assert.match(visible(build(false)), /\{∞\}/, build(false));
	assert.doesNotMatch(visible(build(false)), /Sicilian/, build(false));
	assert.match(visible(build(true)), /\{Sicilian ∞\}/, build(true));
});

test("a note on a move a line inherits stays out of the mainline's comments", () => {
	// The note's ply (3) is drawn by the sideline's own Nc6, and by the
	// MAINLINE's d6 as well — the two collide. Resolving it against the owning
	// line used to fall back to the mainline whenever that line's map came up
	// short, which piled every deep line's notes onto one early mainline move.
	const lines = linesOf("1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4 e5) 3. d4 cxd4 *");
	const deep = lines.find((l) => l.moves.some((m) => m.san === "e5"));
	deep.comments = [{ ply: 3, text: "belongs to the sideline" }];
	const out = buildPgn({ name: "T", lines });
	assert.match(out, /Nc6 \{belongs to the sideline\}/, out);
	assert.doesNotMatch(out, /d6 \{belongs to the sideline\}/, out);
});

test("many deep lines' notes do not collapse onto one mainline move", () => {
	const lines = linesOf(
		"1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4 e5) (2... e6 3. g3 d5) 3. d4 cxd4 (3... Nf6 4. Nc3 a6) *",
	);
	lines
		.filter((l) => !l.isMain)
		.forEach((l, i) => {
			l.comments = [{ ply: l.moves[l.moves.length - 1].ply, text: "N" + i }];
		});
	const out = buildPgn({ name: "T", lines });
	// each note sits on its own line's last move, so no comment holds two of them
	for (const body of out.match(/\{[^}]*\}/g) || [])
		assert.ok(!/N\d.*N\d/.test(body), "notes clumped into one comment: " + body);
	for (let i = 0; i < 3; i++) assert.ok(out.includes("{N" + i + "}"), out);
});

// Round-trip fidelity: re-importing our own export must not lose which lines
// are footnotes, their names, or their evaluations. The visible comment is
// gated by showFootNames and formatted for humans, so it cannot be the
// carrier — the marker has to survive independently of it.
test("a footnote tag survives an export and re-import", () => {
	const lines = linesOf("1. e4 e5 (1... c5 2. Nf3) *");
	lines[1].tag = "foot";
	lines[1].name = "Sicilian";
	lines[1].meta = { eval: "∞", note: "sharp" };
	const back = collectLines(parsePgn(buildPgn({ name: "T", lines })).nodes);
	const side = back.find((l) => l.moves.some((m) => m.san === "c5"));
	assert.equal(side.tag, "foot");
	assert.equal(side.name, "Sicilian");
	assert.equal(side.meta.eval, "∞");
	assert.equal(side.meta.note, "sharp");
});

test("the round-trip marker is invisible to a reader", () => {
	const lines = linesOf("1. e4 e5 (1... c5) *");
	lines[1].tag = "foot";
	lines[1].name = "Sicilian";
	const out = buildPgn({ name: "T", lines });
	// names are off by default, so nothing human-readable should appear —
	// the marker is metadata, not text
	assert.doesNotMatch(out, /Sicilian(?![^[]*\])/, out);
	const back = collectLines(parsePgn(out).nodes);
	assert.equal(back.find((l) => l.moves.some((m) => m.san === "c5")).name, "Sicilian");
});

test("a marker survives alongside real commentary and a NAG", () => {
	const lines = linesOf("1. e4 e5 (1... c5 2. Nf3) *");
	lines[1].tag = "foot";
	lines[1].name = "Sicilian";
	lines[1].marks = { 1: "!" };
	lines[1].comments = [{ ply: 2, text: "a real note" }]; // Nf3
	const out = buildPgn({ name: "T", lines });
	const back = collectLines(parsePgn(out).nodes);
	const side = back.find((l) => l.moves.some((m) => m.san === "c5"));
	assert.equal(side.tag, "foot");
	assert.equal(side.marks[1], "!");
	assert.deepEqual(
		side.comments.map((c) => c.text),
		["a real note"],
	);
});

test("chess.js still parses an export carrying round-trip markers", () => {
	const lines = linesOf("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *");
	lines[1].tag = "foot";
	lines[1].name = "Sicilian ]}\\ awkward";
	lines[1].meta = { eval: "∞", note: "brackets } and ] inside" };
	const out = buildPgn({ name: "T", lines });
	const c = new Chess();
	assert.doesNotThrow(() => c.loadPgn(out), out);
	assert.ok(c.history().length > 0, out);
	// and the awkward characters survive our own round-trip
	const back = collectLines(parsePgn(out).nodes);
	const side = back.find((l) => l.moves.some((m) => m.san === "c5"));
	assert.equal(side.name, "Sicilian ]}\\ awkward");
	assert.equal(side.meta.note, "brackets } and ] inside");
});
