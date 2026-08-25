import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { allNotes } from "../src/notes.js";
import { noteTree, collectNoteKeys } from "../src/notes-view.js";

// The tree for the state a PGN produces, which is what every case below wants.
const treeFor = (pgn, opts) => {
	const s = loadState(pgn, opts);
	return { s, tree: noteTree(allNotes(), s.lines) };
};

test("a lone note at a move stays a leaf", () => {
	const off = installDom();
	const { tree } = treeFor("1. e4 {solid} e5 2. Nf3");
	assert.strictEqual(tree.rows.length, 1);
	assert.strictEqual(tree.rows[0].kind, "note");
	assert.deepStrictEqual(tree.rows[0].rows, [], "nothing to collapse");
	assert.strictEqual(tree.rows[0].key, undefined);
	off();
});

test("two notes on one move cluster under a single move reference", () => {
	const off = installDom();
	const { s } = treeFor("1. e4 e5 2. Nf3");
	const main = s.lines.find((l) => l.isMain);
	main.comments = [
		{ ply: 0, text: "first" },
		{ ply: 0, text: "second" },
	];
	const tree = noteTree(allNotes(), s.lines);
	assert.strictEqual(tree.rows.length, 1, "one cluster, not two notes");
	const c = tree.rows[0];
	assert.strictEqual(c.kind, "cluster");
	assert.strictEqual(c.ref, "1.e4");
	assert.strictEqual(c.notes, 2);
	assert.strictEqual(c.rows.length, 2);
	assert.ok(
		c.rows.every((r) => r.kind === "note" && r.inCluster),
		"members drop the repeated move reference",
	);
	off();
});

test("notes on the same ply but different owners do not cluster", () => {
	const off = installDom();
	const { s } = treeFor("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", {
		tags: { 1: "sideline" },
	});
	s.lines.find((l) => l.isMain).comments = [{ ply: 2, text: "on the main" }];
	s.lines.find((l) => l.moves.some((m) => m.san === "c5")).comments = [
		{ ply: 2, text: "on the sideline" },
	];
	const tree = noteTree(allNotes(), s.lines);
	assert.strictEqual(tree.rows.length, 2, "two separate notes");
	assert.ok(tree.rows.every((r) => r.kind === "note"));
	off();
});

test("a group footnote becomes a node counting its branches", () => {
	const off = installDom();
	const { tree } = treeFor(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	assert.strictEqual(tree.rows.length, 1);
	const g = tree.rows[0];
	assert.strictEqual(g.kind, "foot");
	assert.strictEqual(g.branches, 2);
	assert.strictEqual(g.notes, 0);
	assert.strictEqual(g.rows.length, 2);
	assert.ok(g.rows.every((r) => r.kind === "fnode"));
	off();
});

test("a footnote with its own notes becomes a node counting them", () => {
	const off = installDom();
	const { tree } = treeFor("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const f = tree.rows.find((r) => r.kind === "foot");
	assert.strictEqual(f.notes, 1);
	assert.strictEqual(f.branches, 0);
	assert.strictEqual(f.rows.length, 1);
	assert.strictEqual(f.rows[0].kind, "subnote");
	off();
});

test("a footnote with nothing nested stays a leaf", () => {
	const off = installDom();
	const { tree } = treeFor("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const f = tree.rows.find((r) => r.kind === "foot");
	assert.deepStrictEqual(f.rows, []);
	off();
});

test("keys are unique and survive a renumbering edit", () => {
	const off = installDom();
	const { s, tree } = treeFor(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const before = new Set();
	collectNoteKeys(tree, before);
	assert.ok(before.has("notes"), "the section itself has a key");
	// the section, the group entry, and one per branch — four distinct keys,
	// which is also the check that two branches did not collide on one key
	assert.strictEqual(before.size, 4);
	assert.ok([...before].every((k) => k.startsWith("notes")), "rooted");
	// a new note earlier in the game renumbers every entry after it
	s.lines.find((l) => l.isMain).comments = [{ ply: 0, text: "a new note" }];
	const after = new Set();
	collectNoteKeys(noteTree(allNotes(), s.lines), after);
	before.forEach((k) => assert.ok(after.has(k), `key survived: ${k}`));
	off();
});
