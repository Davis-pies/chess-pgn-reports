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
