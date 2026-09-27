// Regression tests from a bug hunt: unusual but real-world PGN, and the
// export -> import round trip. Each test names the input that used to break.
import { test } from "node:test";
import assert from "node:assert";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { buildPgn } from "../src/pgn-out.js";
import { setCurrent } from "../src/state.js";
import { parseWorkbook, loadNotebook } from "../src/store.js";
import { slug } from "../src/export.js";

const sans = (nodes) => nodes.map((n) => n.san).join(" ");
const keys = (lines) =>
	lines.map((l) => l.moves.map((m) => m.san).join(" ")).sort();

// Export `pgn`'s lines and import the result again.
function roundTrip(pgn) {
	const lines = collectLines(parsePgn(pgn).nodes);
	setCurrent({ lines });
	const out = buildPgn({ name: "T", lines });
	return { lines, out, again: collectLines(parsePgn(out).nodes) };
}

test("castling written with zeros (0-0, 0-0-0) is read as O-O", () => {
	const { nodes } = parsePgn(
		"1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0 Nf6 5. d3 0-0 *",
	);
	assert.strictEqual(sans(nodes), "e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 d3 O-O");
	const long = parsePgn(
		"1. d4 d5 2. Nc3 Nc6 3. Bf4 Bf5 4. Qd2 Qd7 5. 0-0-0+ *",
	).nodes;
	assert.strictEqual(long.at(-1).san, "O-O-O");
});

test("a !/? written onto the move keeps its NAG instead of being dropped", () => {
	const { nodes } = parsePgn("1. e4! e5?? 2. Nf3!? Nc6?! 3. Bb5!! a6? *");
	assert.deepStrictEqual(
		nodes.map((n) => n.nags),
		[[1], [4], [5], [6], [3], [2]],
	);
	const [line] = collectLines(nodes);
	assert.strictEqual(line.marks[0], "$1", "shows up as the line's mark");
});

test("a !/? written as its own token is a NAG, not an illegal move", () => {
	const { nodes } = parsePgn("1. e4 ! e5 ?! *");
	assert.strictEqual(sans(nodes), "e4 e5");
	assert.deepStrictEqual(nodes[0].nags, [1]);
	assert.deepStrictEqual(nodes[1].nags, [6]);
});

test("promotion without '=', long algebraic and figurines are accepted", () => {
	const promo = parsePgn(
		"1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Nbd7 5. bxa8Q *",
	).nodes;
	assert.strictEqual(promo.at(-1).san, "bxa8=Q");
	assert.strictEqual(sans(parsePgn("1. e2-e4 e7e5 2. Ng1f3 *").nodes), "e4 e5 Nf3");
	assert.strictEqual(sans(parsePgn("1. e4 e5 2. ♘f3 ♞c6 *").nodes), "e4 e5 Nf3 Nc6");
});

test("an 'e.p.' marker after an en passant capture is skipped", () => {
	const { nodes } = parsePgn("1. e4 d5 2. e5 f5 3. exf6 e.p. Nxf6 *");
	assert.strictEqual(sans(nodes), "e4 d5 e5 f5 exf6 Nxf6");
});

test("a '%' escape line is ignored", () => {
	const { nodes } = parsePgn("% exported by some tool\n1. e4 e5 *");
	assert.strictEqual(sans(nodes), "e4 e5");
});

test("an illegal move says which move number it was", () => {
	assert.throws(
		() => parsePgn("1. e4 e5 2. Nf3 Nc6 3. Nc5"),
		/Nc5 \(move 3\.\)/,
	);
	assert.throws(() => parsePgn("1. e4 e5 2. Nf3 Kd5"), /Kd5 \(move 2\.\.\.\)/);
});

test("a set-up position (FEN tag) is refused by name, not as an illegal move", () => {
	assert.throws(
		() => parsePgn('[SetUp "1"]\n[FEN "8/P7/8/8/8/8/8/k6K w - - 0 1"]\n\n1. a8=Q *'),
		/set-up position/,
	);
	// a FEN tag holding the standard start is just the normal game
	const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
	assert.strictEqual(sans(parsePgn(`[FEN "${start}"]\n\n1. e4 *`).nodes), "e4");
});

test("a ')' with no variation open is an error, not the end of the game", () => {
	// used to return at the ')' and silently drop 2. Nf3 and everything after
	assert.throws(() => parsePgn("1. e4 e5) 2. Nf3 *"), /Unmatched '\)'/);
});

test("a second game in the text is reported, not silently dropped", () => {
	const r = parsePgn('[Event "a"]\n1. e4 e5 *\n\n[Event "b"]\n1. d4 d5 *');
	assert.strictEqual(sans(r.nodes), "e4 e5");
	assert.strictEqual(r.moreGames, true);
	assert.strictEqual(parsePgn("1. e4 e5 * {trailing comment}").moreGames, false);
	assert.strictEqual(parsePgn("1. e4 e5").moreGames, false);
});

test("export: a line that runs past the end of another is written readably", () => {
	// lines "1.e4 c5" and "1.e4 c5 2.Nf3": the export used to write
	// "(1... c5 (2. Nf3))" -- an alternative to Black's move that is White's
	const { lines, out, again } = roundTrip(
		"1. e4 e5 (1... c5) (1... c5 2. Nf3) 2. Nf3 *",
	);
	assert.doesNotMatch(out, /\(2\. Nf3\)/);
	assert.deepStrictEqual(keys(again), keys(lines));
});

test("export: a chain of lines each extending the last keeps every line", () => {
	// the longest used to be placed first and swallow the shorter ones
	const { lines, again } = roundTrip(
		"1. e4 e5 (1... e5 2. Nf3 Nc6 (2... Nc6 3. Bb5 (3. Bb5 a6))) *",
	);
	assert.strictEqual(lines.length, 4);
	assert.deepStrictEqual(keys(again), keys(lines));
});

test("export: a note on a move with variations stays on that move", () => {
	// the export wrote "e5 {Main idea} (1... c5", which the importer reads as
	// the variation's lead-in, moving the note from the mainline to the sideline
	const { lines, again } = roundTrip(
		"1. e4 e5 (1... c5 2. Nf3) {Main idea} 2. Nf3 *",
	);
	assert.ok(lines.find((l) => l.isMain).comments.some((c) => c.text === "Main idea"));
	const main = again.find((l) => l.isMain);
	assert.ok(
		main.comments.some((c) => c.text === "Main idea"),
		"the note is still the mainline's",
	);
	const side = again.find((l) => !l.isMain);
	assert.ok(!side.comments.some((c) => /Main idea/.test(c.text)));
});

test("a workbook file with a junk entry in its tags list still opens", () => {
	const d = parseWorkbook('{"pgn":"1. e4 *","tags":[null, 5, {"key":"e4"}]}');
	assert.strictEqual(d.tags.length, 1);
});

test("a saved notebook of the wrong shape reads as unreadable, not a crash", () => {
	const had = globalThis.localStorage;
	globalThis.localStorage = { getItem: () => '{"pgn":5}' };
	try {
		assert.strictEqual(loadNotebook("bad"), null);
	} finally {
		globalThis.localStorage = had;
	}
});

test("file names keep non-Latin letters and never come out empty", () => {
	const name = (n) => {
		setCurrent({ name: n, lines: [] });
		return slug();
	};
	assert.strictEqual(name("Königsindisch"), "Königsindisch");
	assert.strictEqual(name("日本語"), "日本語");
	assert.strictEqual(name("///"), "opening-table");
	assert.strictEqual(name("   "), "opening-table");
	assert.strictEqual(name("a/b:c*?"), "a-b-c");
});
