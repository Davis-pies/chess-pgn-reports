// tests/analysis.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import {
	newScratch,
	activeLine,
	playedMoves,
	fenOf,
	sanFor,
	play,
	back,
	forward,
	goTo,
	select,
	toLine,
	removeLine,
} from "../src/analysis.js";

const sans = (s) => activeLine(s).moves.map((m) => m.san);

test("a new scratch holds one empty line with the cursor at the start", () => {
	const s = newScratch();
	assert.deepStrictEqual(s.lines, [{ moves: [] }]);
	assert.strictEqual(s.active, 0);
	assert.strictEqual(s.at, 0);
});

test("seeding from moves puts the cursor at the end of them", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	assert.deepStrictEqual(sans(s), ["e4", "e5"]);
	assert.strictEqual(s.at, 2);
	// ply is the index, so a seeded line is renumbered from 0 regardless of
	// what the source line's plies were
	assert.deepStrictEqual(
		activeLine(s).moves.map((m) => m.ply),
		[0, 1],
	);
});

test("playing at the end appends", () => {
	const s = newScratch([{ san: "e4" }]);
	play(s, "e5");
	assert.deepStrictEqual(sans(s), ["e4", "e5"]);
	assert.strictEqual(s.at, 2);
	assert.strictEqual(s.lines.length, 1);
});

test("replaying a move already held just advances the cursor", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 0);
	play(s, "e4");
	assert.strictEqual(s.at, 1);
	assert.strictEqual(s.lines.length, 1, "no fork for a move already there");
	assert.deepStrictEqual(sans(s), ["e4", "e5"], "the tail is untouched");
});

test("diverging mid-line forks a sibling and keeps the abandoned tail", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }, { san: "Nf3" }]);
	goTo(s, 1);
	play(s, "c5");
	assert.strictEqual(s.lines.length, 2);
	assert.strictEqual(s.active, 1);
	assert.deepStrictEqual(sans(s), ["e4", "c5"]);
	assert.strictEqual(s.at, 2);
	// the original line still has everything it had
	assert.deepStrictEqual(
		s.lines[0].moves.map((m) => m.san),
		["e4", "e5", "Nf3"],
	);
});

test("a fork copies the prefix rather than sharing it", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5");
	assert.notStrictEqual(s.lines[0].moves[0], s.lines[1].moves[0]);
	play(s, "Nf3");
	assert.deepStrictEqual(
		s.lines[0].moves.map((m) => m.san),
		["e4", "e5"],
		"appending to the fork must not reach the original",
	);
});

test("the cursor stops at both ends", () => {
	const s = newScratch([{ san: "e4" }]);
	forward(s);
	forward(s);
	assert.strictEqual(s.at, 1);
	back(s);
	back(s);
	assert.strictEqual(s.at, 0);
	goTo(s, 99);
	assert.strictEqual(s.at, 1);
	goTo(s, -5);
	assert.strictEqual(s.at, 0);
});

test("selecting a line moves the cursor to its end", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5");
	select(s, 0);
	assert.strictEqual(s.active, 0);
	assert.strictEqual(s.at, 2);
});

test("fen and played moves follow the cursor, not the whole line", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	assert.deepStrictEqual(
		playedMoves(s).map((m) => m.san),
		["e4"],
	);
	assert.ok(fenOf(s).startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR"));
});

test("sanFor turns a from/to pair into SAN, and rejects an illegal one", () => {
	const s = newScratch();
	assert.strictEqual(sanFor(s, "e2", "e4"), "e4");
	assert.strictEqual(sanFor(s, "e2", "e5"), null);
});

test("sanFor handles promotion", () => {
	const s = newScratch();
	// ...Na6 clears b8 legally; Qb8 would be its own knight's square
	["e4", "d5", "exd5", "c6", "dxc6", "Qd6", "cxb7", "Na6"].forEach((m) =>
		play(s, m),
	);
	assert.strictEqual(sanFor(s, "b7", "a8", "q"), "bxa8=Q");
	assert.strictEqual(sanFor(s, "b7", "a8", "n"), "bxa8=N");
});

test("toLine produces the shape collectLines emits", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	const l = toLine(activeLine(s), 3);
	assert.deepStrictEqual(l.moves, [
		{ san: "e4", ply: 0 },
		{ san: "e5", ply: 1 },
	]);
	assert.deepStrictEqual(l.marks, {});
	assert.deepStrictEqual(l.comments, []);
	assert.deepStrictEqual(l.meta, {});
	assert.strictEqual(l.tag, "sideline");
	assert.strictEqual(l.name, "Line 3");
	assert.strictEqual(l.ply, 1);
	assert.ok(l.fen.includes(" w "), "black moved last, so white is to move next");
	assert.ok(l.fen.startsWith("rnbqkbnr/pppp1ppp"));
	assert.strictEqual(l.isMain, undefined, "a committed line is never the mainline");
});

test("removeLine drops a scratch line and keeps the cursor on a real one", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5"); // forks line 1: e4 c5
	assert.strictEqual(s.lines.length, 2);

	// removing a line before the active one shifts the active index down with it
	removeLine(s, 0);
	assert.strictEqual(s.lines.length, 1);
	assert.deepStrictEqual(sans(s), ["e4", "c5"]);
	assert.strictEqual(s.at, 2, "the cursor stays where it was");

	// removing the last line leaves one empty line, never none
	removeLine(s, 0);
	assert.strictEqual(s.lines.length, 1);
	assert.deepStrictEqual(sans(s), []);
	assert.strictEqual(s.at, 0);
});

test("removing the active line selects its neighbour", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5");
	removeLine(s, 1);
	assert.strictEqual(s.active, 0);
	assert.deepStrictEqual(sans(s), ["e4", "e5"]);
	assert.strictEqual(s.at, 2);
});

test("a fork keeps the notes on the moves it shares and none after", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	activeLine(s).comments = [
		{ ply: 0, text: "best by test" },
		{ ply: 1, text: "symmetrical" },
	];
	goTo(s, 1);
	play(s, "c5");
	assert.deepStrictEqual(activeLine(s).comments, [{ ply: 0, text: "best by test" }]);
	activeLine(s).comments[0].text = "changed";
	assert.strictEqual(s.lines[0].comments[0].text, "best by test", "copied, not shared");
});

test("toLine carries the notes", () => {
	const s = newScratch([{ san: "e4" }]);
	activeLine(s).comments = [{ ply: 0, text: "best by test" }];
	assert.deepStrictEqual(toLine(activeLine(s), 1).comments, [{ ply: 0, text: "best by test" }]);
});

// ---- position status, cutting, reordering, undo

import {
	positionOf,
	playAll,
	truncate,
	moveLine,
	scratchPgn,
	checkpoint,
	undo,
	stepLine,
	sharedPrefix,
} from "../src/analysis.js";

const seed = (...m) => newScratch(m.map((san) => ({ san })));

test("the position knows whose move it is, the last move and a check", () => {
	const s = seed("e4", "f5", "Qh5+");
	const p = positionOf(s);
	assert.strictEqual(p.turn, "b");
	assert.deepStrictEqual(p.lastMove, { from: "d1", to: "h5" });
	assert.strictEqual(p.check, "e8");
	assert.strictEqual(p.over, null);
	assert.strictEqual(positionOf(newScratch()).lastMove, null);
});

test("the ends of a game are named", () => {
	assert.strictEqual(positionOf(seed("f3", "e5", "g4", "Qh4#")).over, "Black wins by checkmate");
	assert.strictEqual(positionOf(seed("e3", "a5", "Qh5", "Ra6", "Qxa5", "h5", "h4", "Rah6", "Qxc7", "f6", "Qxd7+", "Kf7", "Qxb7", "Qd3", "Qxb8", "Qh7", "Qxc8", "Kg6", "Qe6")).over, "Draw by stalemate");
	assert.strictEqual(positionOf(seed("Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8")).over, "Draw by threefold repetition");
});

test("playAll plays a line and stops at a move that is not legal", () => {
	const s = seed("e4");
	playAll(s, ["e5", "Nf3", "Ke7", "Qxf7"]);
	assert.deepStrictEqual(sans(s), ["e4", "e5", "Nf3", "Ke7"]);
});

test("truncate cuts the line after the cursor, with its notes", () => {
	const s = seed("e4", "e5", "Nf3");
	activeLine(s).comments = [{ ply: 0, text: "best by test" }, { ply: 2, text: "gone" }];
	goTo(s, 1);
	truncate(s);
	assert.deepStrictEqual(sans(s), ["e4"]);
	assert.deepStrictEqual(activeLine(s).comments, [{ ply: 0, text: "best by test" }]);
	assert.strictEqual(s.at, 1);
});

test("a cut that leaves a line inside another drops it for that line", () => {
	const s = seed("e4", "e5", "Nf3");
	goTo(s, 1);
	play(s, "c5"); // line 1: e4 c5
	goTo(s, 1);
	truncate(s); // "e4" is already the start of line 0
	assert.strictEqual(s.lines.length, 1);
	assert.strictEqual(s.active, 0);
	assert.strictEqual(s.at, 1);
	assert.deepStrictEqual(sans(s), ["e4", "e5", "Nf3"]);
});

test("a cut on an earlier line keeps the cursor on it as the list shifts", () => {
	const s = seed("e4", "c5");
	goTo(s, 1);
	play(s, "e5"); // line 1: e4 e5
	select(s, 0);
	goTo(s, 1);
	truncate(s); // line 0 becomes "e4", inside line 1
	assert.strictEqual(s.lines.length, 1);
	assert.deepStrictEqual(sans(s), ["e4", "e5"]);
	assert.strictEqual(s.at, 1);
});

test("lines move up and down, and the selection follows its line", () => {
	const s = seed("e4");
	goTo(s, 0);
	play(s, "d4");
	goTo(s, 0);
	play(s, "c4");
	assert.strictEqual(s.active, 2);
	moveLine(s, 2, -1);
	assert.deepStrictEqual(s.lines.map((l) => l.moves[0].san), ["e4", "c4", "d4"]);
	assert.strictEqual(s.active, 1);
	moveLine(s, 0, -1); // off the top: nothing
	assert.deepStrictEqual(s.lines.map((l) => l.moves[0].san), ["e4", "c4", "d4"]);
});

test("the scratch as PGN: the first line is the trunk, the rest variations", () => {
	const s = seed("e4", "e5");
	goTo(s, 1);
	play(s, "c5");
	s.lines.push({ moves: [] });
	assert.match(scratchPgn(s), /1\. e4 e5 \(1\.\.\. c5\) \*/);
});

test("undo puts back what a delete took, once", () => {
	const s = seed("e4", "e5");
	checkpoint(s);
	removeLine(s, 0);
	assert.deepStrictEqual(sans(s), []);
	undo(s);
	assert.deepStrictEqual(sans(s), ["e4", "e5"]);
	assert.strictEqual(s.undo, null);
	undo(s); // nothing left to undo
	assert.deepStrictEqual(sans(s), ["e4", "e5"]);
});

test("up and down step between lines at the same move", () => {
	const s = seed("e4", "e5", "Nf3");
	goTo(s, 1);
	play(s, "c5"); // line 1, at 2
	stepLine(s, -1);
	assert.strictEqual(s.active, 0);
	assert.strictEqual(s.at, 2);
	stepLine(s, -1); // no line above
	assert.strictEqual(s.active, 0);
	goTo(s, 3);
	stepLine(s, 1);
	assert.strictEqual(s.at, 2, "clamped to the shorter line");
});

test("sharedPrefix counts the opening moves a line repeats from above", () => {
	const s = seed("e4", "e5", "Nf3");
	goTo(s, 2);
	play(s, "Bc4");
	assert.strictEqual(sharedPrefix(s, 0), 0);
	assert.strictEqual(sharedPrefix(s, 1), 2);
});

import { seedLine } from "../src/analysis.js";

test("seeding a scratch with work in it keeps that work", () => {
	const s = seed("e4", "e5", "Nf3");
	seedLine(s, [{ san: "e4" }, { san: "e5" }]); // on line 0 already
	assert.strictEqual(s.lines.length, 1);
	assert.strictEqual(s.at, 2);
	seedLine(s, [{ san: "d4" }]);
	assert.strictEqual(s.lines.length, 2);
	assert.strictEqual(s.active, 1);
	assert.deepStrictEqual(sans(s), ["d4"]);
	assert.strictEqual(s.at, 1);
	const empty = newScratch();
	seedLine(empty, [{ san: "c4" }]);
	assert.strictEqual(empty.lines.length, 1, "the empty line is filled, not kept");
	assert.deepStrictEqual(sans(empty), ["c4"]);
});
