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

	// removing the last line through the position leaves the board there, on
	// a fresh line of the moves that reach it -- never no line at all
	removeLine(s, 0);
	assert.strictEqual(s.lines.length, 1);
	assert.deepStrictEqual(sans(s), ["e4", "c5"]);
	assert.strictEqual(s.at, 2);
});

test("removing the active line selects its neighbour", () => {
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5");
	goTo(s, 1); // where the two split: both on view
	removeLine(s, 1);
	assert.strictEqual(s.active, 0);
	assert.deepStrictEqual(sans(s), ["e4", "e5"]);
	assert.strictEqual(s.at, 1, "the board stays at the position");
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
	undoLabel,
	redo,
	redoLabel,
	rename,
	moveToTop,
	branchPoints,
	stepBranch,
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
	goTo(s, 0); // the start: all three on view
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
	goTo(s, 1);
	s.lines.push({ moves: [] });
	assert.match(scratchPgn(s), /1\. e4 e5 \(1\.\.\. c5\) \*/);
});

test("undo puts back what a delete took, and redo takes it again", () => {
	const s = seed("e4", "e5");
	goTo(s, 1);
	play(s, "c5");
	goTo(s, 1);
	checkpoint(s, "delete line");
	removeLine(s, 0);
	assert.strictEqual(s.lines.length, 1);
	assert.strictEqual(undoLabel(s), "delete line");
	undo(s);
	assert.strictEqual(s.lines.length, 2);
	assert.deepStrictEqual(sans(s), ["e4", "c5"]);
	assert.strictEqual(undoLabel(s), null);
	assert.strictEqual(redoLabel(s), "delete line");
	undo(s); // nothing left to undo
	assert.strictEqual(s.lines.length, 2);
	redo(s);
	assert.strictEqual(s.lines.length, 1);
	assert.strictEqual(redoLabel(s), null);
	assert.strictEqual(undoLabel(s), "delete line");
});

test("undo goes back several steps, and a new change drops the redo", () => {
	const s = seed("e4", "e5", "Nf3", "Nc6");
	goTo(s, 3);
	checkpoint(s, "delete from here");
	truncate(s);
	goTo(s, 2);
	checkpoint(s, "delete from here");
	truncate(s);
	assert.deepStrictEqual(sans(s), ["e4", "e5"]);
	undo(s);
	undo(s);
	assert.deepStrictEqual(sans(s), ["e4", "e5", "Nf3", "Nc6"]);
	redo(s);
	assert.deepStrictEqual(sans(s), ["e4", "e5", "Nf3"]);
	checkpoint(s, "rename");
	rename(s, 0, "Italian");
	assert.strictEqual(redoLabel(s), null, "a new change forgets what could be redone");
	undo(s);
	assert.strictEqual(activeLine(s).name, undefined);
});

test("the undo history is capped", () => {
	const s = seed("e4");
	for (let i = 0; i < 80; i++) checkpoint(s, "x" + i);
	assert.strictEqual(s.undo.length, 50);
	assert.strictEqual(undoLabel(s), "x79");
});

test("up and down step between lines at the same move", () => {
	const s = seed("e4", "e5", "Nf3");
	goTo(s, 1);
	play(s, "c5"); // line 1, at 2
	stepLine(s, -1); // in the fork, 1...e5 is off view: nothing to step to
	assert.strictEqual(s.active, 1);
	goTo(s, 1);
	stepLine(s, -1);
	assert.strictEqual(s.active, 0);
	assert.strictEqual(s.at, 1, "the same move on the other line");
	stepLine(s, -1); // no line above
	assert.strictEqual(s.active, 0);
	// a pinned line off the position: stepping onto it clamps the cursor
	const t = seed("e4", "e5");
	goTo(t, 0);
	play(t, "d4");
	pin(t, 0);
	goTo(t, 1);
	activeLine(t).moves.push({ san: "d5", ply: 1 }, { san: "c4", ply: 2 });
	goTo(t, 3);
	stepLine(t, -1);
	assert.strictEqual(t.active, 0);
	assert.strictEqual(t.at, 2, "clamped to the shorter line");
});

test("sharedPrefix counts the opening moves a line repeats from above", () => {
	const s = seed("e4", "e5", "Nf3");
	goTo(s, 2);
	play(s, "Bc4");
	goTo(s, 2);
	assert.strictEqual(sharedPrefix(s, 0), 0);
	assert.strictEqual(sharedPrefix(s, 1), 2);
});

import { openAt, shown, toggleShowAll, clearShown, pin, closeBoard } from "../src/analysis.js";

// A board already holding these analysis lines (SAN strings), on the first.
const boardOf = (...lines) => {
	const s = newScratch();
	s.lines = lines.map((str) => ({ moves: str.split(" ").map((san, ply) => ({ san, ply })) }));
	s.at = s.lines[0].moves.length;
	return s;
};
const posOf = (str) => str.split(" ").map((san) => ({ san }));
const onView = (s) => shown(s).map((i) => s.lines[i].moves.map((m) => m.san).join(" "));

test("opening a position selects an analysis line through it, at that position", () => {
	const s = boardOf("e4 e5 Nf3", "e4 c5 Nf3 d6", "e4 c5 Nc3");
	openAt(s, posOf("e4 c5"));
	assert.strictEqual(s.active, 1, "the first line through it");
	assert.strictEqual(s.at, 2);
	assert.strictEqual(s.lines.length, 3, "nothing is added");
	select(s, 2);
	openAt(s, posOf("e4 c5"));
	assert.strictEqual(s.active, 2, "the line being played, when it passes through");
});

test("a position no analysis line passes through gets a line of its own", () => {
	const s = newScratch();
	openAt(s, posOf("c4 e5"));
	assert.deepStrictEqual(onView(s), ["c4 e5"], "the lone empty line is replaced");
	assert.strictEqual(s.at, 2);
	openAt(s, posOf("d4"));
	assert.strictEqual(s.lines.length, 2);
	assert.deepStrictEqual(onView(s), ["d4"]);
});

test("the lines on view are the ones through the position on the board", () => {
	const s = boardOf("e4 c5 Nf3 d6", "e4 e5 Nf3");
	openAt(s, posOf("e4 c5"));
	play(s, "Nc3"); // a fork after 1...c5: 2.Nf3 does not lead here
	assert.deepStrictEqual(onView(s), ["e4 c5 Nc3"]);
	back(s); // back to 1...c5: both lead from here
	assert.deepStrictEqual(onView(s), ["e4 c5 Nf3 d6", "e4 c5 Nc3"]);
	openAt(s, posOf("e4 e5"));
	assert.deepStrictEqual(onView(s), ["e4 e5 Nf3"], "the Sicilian lines are off view");
	assert.strictEqual(s.lines.length, 3, "but kept");
	goTo(s, 1); // 1.e4: everything through it
	assert.deepStrictEqual(onView(s), ["e4 c5 Nf3 d6", "e4 e5 Nf3", "e4 c5 Nc3"]);
});

test("show all puts every line on view, and toggles back", () => {
	const s = boardOf("d4 d5", "e4 c5");
	openAt(s, posOf("e4 c5"));
	assert.deepStrictEqual(onView(s), ["e4 c5"]);
	toggleShowAll(s);
	assert.deepStrictEqual(onView(s), ["d4 d5", "e4 c5"]);
	toggleShowAll(s);
	assert.deepStrictEqual(onView(s), ["e4 c5"]);
});

test("a pinned line stays on view until the board closes", () => {
	const s = boardOf("e4 c5 Nf3", "e4 c5 Nc3");
	openAt(s, posOf("e4 c5"));
	pin(s, 1); // 2.Nc3
	forward(s); // into 2.Nf3
	assert.deepStrictEqual(onView(s), ["e4 c5 Nf3", "e4 c5 Nc3"]);
	pin(s, 1); // unpinned: it goes
	assert.deepStrictEqual(onView(s), ["e4 c5 Nf3"]);
	pin(s, 1);
	toggleShowAll(s);
	s.wbAll = true;
	closeBoard(s);
	assert.deepStrictEqual(onView(s), ["e4 c5 Nf3"], "pins and show all end with the board");
	assert.strictEqual(s.wbAll, false);
	assert.strictEqual(closeBoard(null), null);
	pin(s, 9); // not a line: nothing
});

test("deleting and clearing work on the lines on view", () => {
	const s = boardOf("d4 d5", "e4 c5 Nf3", "e4 c5 Nc3");
	openAt(s, posOf("e4 c5"));
	assert.deepStrictEqual(onView(s), ["e4 c5 Nf3", "e4 c5 Nc3"]);
	removeLine(s, shown(s)[0]);
	assert.deepStrictEqual(onView(s), ["e4 c5 Nc3"], "the neighbour on view is selected, not the d4 line");
	assert.strictEqual(s.lines[s.active].moves[1].san, "c5");
	removeLine(s, s.active);
	assert.deepStrictEqual(onView(s), ["e4 c5"], "an empty board starts again at the position");
	clearShown(s);
	assert.deepStrictEqual(onView(s), ["e4 c5"]);
	toggleShowAll(s);
	assert.ok(onView(s).includes("d4 d5"), "the rest is untouched");
});

test("moving and stepping skip the lines off view", () => {
	const s = boardOf("e4 c5 Nf3", "d4 d5", "e4 c5 Nc3");
	openAt(s, posOf("e4 c5"));
	assert.deepStrictEqual(onView(s), ["e4 c5 Nf3", "e4 c5 Nc3"]);
	stepLine(s, 1);
	assert.strictEqual(s.lines[s.active].moves[2].san, "Nc3", "stepped over d4 d5");
	moveLine(s, s.active, -1);
	assert.deepStrictEqual(onView(s), ["e4 c5 Nc3", "e4 c5 Nf3"]);
	assert.match(scratchPgn(s), /2\. Nc3 \(2\. Nf3\)/, "the PGN is the lines on view");
	assert.doesNotMatch(scratchPgn(s), /d4/);
});

import { packScratch, unpackScratch } from "../src/analysis.js";

test("a board packs to SAN and notes, and unpacks to the same board", () => {
	const s = boardOf("e4 c5 Nf3 d6", "e4 e5 Nf3");
	openAt(s, posOf("e4 c5"));
	play(s, "Nc3");
	activeLine(s).comments = [{ ply: 2, text: "closed" }];
	s.flipped = true;
	checkpoint(s);
	s.flash = "said once";
	const packed = JSON.parse(JSON.stringify(packScratch(s)));
	assert.deepStrictEqual(packed, {
		lines: [
			{ moves: ["e4", "c5", "Nf3", "d6"] },
			{ moves: ["e4", "e5", "Nf3"] },
			{ moves: ["e4", "c5", "Nc3"], comments: [{ ply: 2, text: "closed" }] },
		],
		active: 2,
		at: 3,
		flipped: true,
	});
	const back = unpackScratch(packed);
	// an empty notes list is not written, so compare with it left out
	const bare = (ls) => ls.map((l) => (l.comments && l.comments.length ? l : { moves: l.moves }));
	assert.deepStrictEqual(back.lines, bare(s.lines));
	assert.deepStrictEqual([back.active, back.at, back.flipped], [2, 3, true]);
	assert.strictEqual(back.undo, undefined, "undo is not kept");
	assert.strictEqual(packScratch(newScratch()), null, "an empty board packs to nothing");
	assert.strictEqual(packScratch(null), null);
});

test("unpacking trusts nothing in a hand-edited file", () => {
	assert.strictEqual(unpackScratch(undefined), null);
	assert.strictEqual(unpackScratch({ lines: "no" }), null);
	assert.strictEqual(unpackScratch({ lines: [{ moves: ["Ke2"] }] }), null, "nothing legal left");
	const s = unpackScratch({
		lines: [
			{ moves: ["e4", "e5", "Qh8", "Nf3"], comments: [{ ply: 1, text: "ok" }, { ply: 3, text: "past the cut" }, { ply: "x", text: "bad" }, null] },
			null,
			{ moves: ["d4"] },
		],
		active: 9,
		at: 99,
	});
	assert.deepStrictEqual(s.lines[0].moves.map((m) => m.san), ["e4", "e5"], "cut at the illegal move");
	assert.deepStrictEqual(s.lines[0].comments, [{ ply: 1, text: "ok" }]);
	assert.deepStrictEqual(s.lines[1], { moves: [] });
	assert.strictEqual(s.active, 0, "an index that is not a line falls back");
	assert.strictEqual(s.at, 2, "clamped to the line");
	assert.strictEqual(s.flipped, false);
	const noAt = unpackScratch({ lines: [{ moves: ["e4"] }] });
	assert.strictEqual(noAt.at, 1, "no cursor: the end of the line");
});

// ---- no duplicate lines, names, move to top, branch points

test("playing a move another line already has from here follows that line", () => {
	const s = seed("e4", "e5", "Nf3");
	goTo(s, 1);
	play(s, "c5"); // line 1: e4 c5
	select(s, 0);
	goTo(s, 1);
	play(s, "c5"); // not a third line
	assert.strictEqual(s.lines.length, 2);
	assert.strictEqual(s.active, 1);
	assert.strictEqual(s.at, 2);
});

test("extending a line into one that already goes on drops the prefix", () => {
	const s = seed("e4", "e5", "Nf3");
	goTo(s, 1);
	play(s, "c5");
	truncate(s); // nothing after: no-op
	s.lines.push({ moves: [{ san: "d4", ply: 0 }] });
	// a fresh line of just 1.e4, noted and named, then 1...e5 played on it
	s.lines.push({ moves: [{ san: "e4", ply: 0 }], comments: [{ ply: 0, text: "king pawn" }], name: "KP" });
	s.active = 3;
	s.at = 1;
	play(s, "e5");
	assert.strictEqual(s.lines.length, 3, "the one-move line went");
	assert.deepStrictEqual(sans(s), ["e4", "e5", "Nf3"]);
	assert.strictEqual(s.at, 2);
	assert.deepStrictEqual(activeLine(s).comments, [{ ply: 0, text: "king pawn" }]);
	assert.strictEqual(activeLine(s).name, "KP");
});

test("a line's own note wins over the prefix's on the same move", () => {
	const s = seed("e4", "e5");
	activeLine(s).comments = [{ ply: 0, text: "mine" }];
	s.lines.push({ moves: [{ san: "e4", ply: 0 }], comments: [{ ply: 0, text: "theirs" }] });
	s.active = 1;
	s.at = 1;
	play(s, "e5");
	assert.strictEqual(s.lines.length, 1);
	assert.deepStrictEqual(activeLine(s).comments, [{ ply: 0, text: "mine" }]);
});

test("opening on an empty board follows a line that is already there", () => {
	const s = seed("e4", "e5");
	s.lines.push({ moves: [] });
	s.active = 1;
	s.at = 0;
	play(s, "e4");
	assert.strictEqual(s.lines.length, 1);
	assert.strictEqual(s.at, 1);
});

test("rename names a line, trims, and clears with an empty name", () => {
	const s = seed("e4");
	rename(s, 0, "  Open game ");
	assert.strictEqual(activeLine(s).name, "Open game");
	assert.strictEqual(toLine(activeLine(s), 3).name, "Open game", "the name goes into the notebook");
	rename(s, 0, "   ");
	assert.ok(!("name" in activeLine(s)));
	assert.strictEqual(toLine(activeLine(s), 3).name, "Line 3");
	rename(s, 9, "nothing there"); // no such line: nothing
});

test("names survive a save and load; bad ones are dropped", () => {
	const s = seed("e4");
	rename(s, 0, "KP");
	const back = unpackScratch(JSON.parse(JSON.stringify(packScratch(s))));
	assert.strictEqual(back.lines[0].name, "KP");
	assert.ok(!("name" in unpackScratch({ lines: [{ moves: ["e4"], name: 5 }] }).lines[0]));
	assert.ok(!("name" in packScratch(seed("d4")).lines[0]));
});

test("move to top makes a line the first, the selection following", () => {
	const s = seed("e4");
	goTo(s, 0);
	play(s, "d4");
	goTo(s, 0);
	play(s, "c4");
	moveToTop(s, 2);
	assert.deepStrictEqual(s.lines.map((l) => l.moves[0].san), ["c4", "e4", "d4"]);
	assert.strictEqual(s.active, 0);
	moveToTop(s, 2);
	assert.deepStrictEqual(s.lines.map((l) => l.moves[0].san), ["d4", "c4", "e4"]);
	assert.strictEqual(s.active, 1);
	moveToTop(s, 0); // already first
	assert.strictEqual(s.lines[0].moves[0].san, "d4");
});

test("branch points are where the line meets another", () => {
	const s = seed("e4", "e5", "Nf3", "Nc6", "Bb5");
	goTo(s, 1);
	play(s, "c5"); // leaves at 1
	select(s, 0);
	goTo(s, 3);
	play(s, "d6"); // leaves at 3
	select(s, 0);
	s.lines.push({ moves: [{ san: "e4", ply: 0 }, { san: "e5", ply: 1 }] }); // a prefix: no branch
	assert.deepStrictEqual(branchPoints(s), [1, 3]);
	goTo(s, 5);
	stepBranch(s, -1);
	assert.strictEqual(s.at, 3);
	stepBranch(s, -1);
	assert.strictEqual(s.at, 1);
	stepBranch(s, -1); // none before
	assert.strictEqual(s.at, 1);
	stepBranch(s, 1);
	assert.strictEqual(s.at, 3);
	stepBranch(s, 1); // none after
	assert.strictEqual(s.at, 3);
});

test("a pin carries over when its line folds into another", () => {
	const s = seed("e4", "e5");
	s.lines.push({ moves: [{ san: "e4", ply: 0 }] });
	pin(s, 1);
	s.active = 1;
	s.at = 1;
	play(s, "e5");
	assert.ok(activeLine(s).pinned);
});
