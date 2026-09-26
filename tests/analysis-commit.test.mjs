// tests/analysis-commit.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { getCurrent } from "../src/state.js";
import { commitLine, commitAll } from "../src/analysis-commit.js";
import { newScratch, play, goTo } from "../src/analysis.js";

const PGN = "1. e4 e5 2. Nf3 Nc6 *";

test("a committed line lands in current.lines as a sideline", () => {
	const done = installDom();
	loadState(PGN);
	const before = getCurrent().lines.length;
	const r = commitLine({ moves: [{ san: "e4", ply: 0 }, { san: "c5", ply: 1 }] });
	assert.strictEqual(r.ok, true);
	assert.strictEqual(getCurrent().lines.length, before + 1);
	const added = getCurrent().lines[getCurrent().lines.length - 1];
	assert.strictEqual(added.tag, "sideline");
	assert.strictEqual(added.isMain, undefined);
	assert.deepStrictEqual(added.marks, {});
	done();
});

test("committing rewrites the notebook's PGN so the line survives a reload", () => {
	const done = installDom();
	loadState(PGN);
	commitLine({ moves: [{ san: "e4", ply: 0 }, { san: "c5", ply: 1 }] });
	assert.match(getCurrent().pgn, /c5/);
	assert.match(getCurrent().pgn, /e5/, "the lines already there are still in it");
	done();
});

test("committing a line the notebook already has is refused, not duplicated", () => {
	const done = installDom();
	loadState(PGN);
	const before = getCurrent().lines.length;
	const r = commitLine({
		moves: [
			{ san: "e4", ply: 0 },
			{ san: "e5", ply: 1 },
			{ san: "Nf3", ply: 2 },
			{ san: "Nc6", ply: 3 },
		],
	});
	assert.strictEqual(r.ok, false);
	assert.match(r.reason, /already/i);
	assert.strictEqual(getCurrent().lines.length, before);
	done();
});

test("an empty scratch line is refused", () => {
	const done = installDom();
	loadState(PGN);
	const r = commitLine({ moves: [] });
	assert.strictEqual(r.ok, false);
	assert.match(r.reason, /no moves/i);
	done();
});

test("commitAll adds every new line and counts what it skipped", () => {
	const done = installDom();
	loadState(PGN);
	const before = getCurrent().lines.length;
	const s = newScratch([{ san: "e4" }, { san: "e5" }, { san: "Nf3" }, { san: "Nc6" }]);
	goTo(s, 1);
	play(s, "c5"); // a fork: e4 c5
	goTo(s, 1);
	play(s, "e6"); // another fork off the same point: e4 e6
	const r = commitAll(s);
	assert.strictEqual(r.added, 2, "both forks are new");
	assert.strictEqual(r.skipped, 1, "the seeded line is already the mainline");
	assert.strictEqual(getCurrent().lines.length, before + 2);
	done();
});

test("committed lines are numbered by where they land", () => {
	const done = installDom();
	loadState(PGN);
	const r = commitLine({ moves: [{ san: "d4", ply: 0 }] });
	const idx = getCurrent().lines.indexOf(r.line);
	assert.strictEqual(r.line.name, `Line ${idx}`);
	done();
});

test("a line can be committed as a footnote", () => {
	const done = installDom();
	loadState(PGN);
	const r = commitLine({ moves: [{ san: "e4", ply: 0 }, { san: "c5", ply: 1 }] }, { tag: "foot" });
	assert.strictEqual(r.ok, true);
	assert.strictEqual(r.line.tag, "foot");
	done();
});

test("the first line into an empty notebook is its mainline", () => {
	const done = installDom();
	loadState("1. e4 *");
	getCurrent().lines = [];
	const r = commitLine({ moves: [{ san: "d4", ply: 0 }, { san: "d5", ply: 1 }] }, { tag: "foot" });
	assert.strictEqual(r.ok, true);
	const [main] = getCurrent().lines;
	assert.strictEqual(main.isMain, true);
	assert.strictEqual(main.name, "Mainline");
	assert.strictEqual(main.tag, undefined);
	assert.match(getCurrent().pgn, /1\. d4 d5/);
	commitLine({ moves: [{ san: "d4", ply: 0 }, { san: "Nf6", ply: 1 }] });
	assert.strictEqual(getCurrent().lines[1].tag, "sideline");
	done();
});

test("inNotebook tells a line the notebook holds from one it does not", async () => {
	const done = installDom();
	const { inNotebook } = await import("../src/analysis-commit.js");
	loadState(PGN);
	const m = (...s) => s.map((san, ply) => ({ san, ply }));
	assert.strictEqual(inNotebook(m("e4", "e5", "Nf3", "Nc6")), true);
	assert.strictEqual(inNotebook(m("e4", "e5")), false);
	assert.strictEqual(inNotebook([]), false);
	done();
});

// ---- notes straight into the notebook

import { saveNote, saveAllNotes, notebookNotes } from "../src/analysis-commit.js";
import { openAt } from "../src/analysis.js";

const SIC = "1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 cxd4 *";
const m = (...s) => s.map((san, ply) => ({ san, ply }));

test("a note on a move the notebook has goes onto every line through it", () => {
	const done = installDom();
	loadState(SIC);
	const line = { moves: m("e4", "c5", "Nf3"), comments: [{ ply: 2, text: "the Open Sicilian" }] };
	assert.deepStrictEqual(notebookNotes(line.moves, 2), []);
	assert.deepStrictEqual(saveNote(line, 2), { ok: true, notes: 1 });
	for (const l of getCurrent().lines)
		assert.deepStrictEqual(l.comments.filter((c) => c.ply === 2), [{ ply: 2, text: "the Open Sicilian" }]);
	assert.deepStrictEqual(notebookNotes(line.moves, 2), ["the Open Sicilian"]);
	// the board's notes replace the notebook's; none clears them
	line.comments = [];
	assert.deepStrictEqual(saveNote(line, 2), { ok: true, notes: 0 });
	assert.deepStrictEqual(notebookNotes(line.moves, 2), []);
	done();
});

test("a note on a move the notebook has not got is refused, and says why", () => {
	const done = installDom();
	loadState(SIC);
	const line = { moves: m("e4", "e5"), comments: [{ ply: 1, text: "x" }] };
	assert.strictEqual(notebookNotes(line.moves, 1), null);
	const r = saveNote(line, 1);
	assert.strictEqual(r.ok, false);
	assert.match(r.reason, /not in the notebook yet/);
	assert.strictEqual(notebookNotes(m("e4"), 3), null, "past the end of the moves given");
	done();
});

test("Save all saves the notes on view, counts the rest, and never clears", () => {
	const done = installDom();
	loadState(SIC);
	getCurrent().lines[0].comments = [{ ply: 0, text: "best by test" }];
	const s = newScratch();
	openAt(s, m("e4", "c5"), getCurrent().lines);
	// the board's copy of 1.e4's note is dropped, but Save all must not clear it
	s.lines.forEach((l) => (l.comments = l.comments.filter((c) => c.ply !== 0)));
	s.lines[0].comments.push({ ply: 3, text: "the Najdorf family" }, { ply: 3, text: "or the Dragon" });
	s.lines[1].comments.push({ ply: 3, text: "the Classical" });
	play(s, "a6"); // not in the notebook
	goTo(s, 1);
	s.lines[s.active].comments.push({ ply: 4, text: "not saved" });
	const r = saveAllNotes(s);
	assert.deepStrictEqual(r, { saved: 2, missing: 1 });
	assert.deepStrictEqual(notebookNotes(m("e4", "c5", "Nf3", "d6"), 3), ["the Najdorf family", "or the Dragon"]);
	assert.deepStrictEqual(notebookNotes(m("e4", "c5", "Nf3", "Nc6"), 3), ["the Classical"]);
	assert.deepStrictEqual(notebookNotes(m("e4"), 0), ["best by test"], "untouched");
	done();
});
