import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { allNotes } from "../src/notes.js";
import { closedNotePaths, setRenderHooks } from "../src/state.js";
import { noteTree, collectNoteKeys, notesPanel } from "../src/notes-view.js";

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

test("a group footnote renders as an open details with its branches inside", () => {
	const off = installDom();
	closedNotePaths.clear();
	loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const box = notesPanel();
	assert.strictEqual(box.tagName, "DETAILS");
	assert.strictEqual(box.className, "notes");
	assert.ok(box.open, "expanded by default");
	const g = box.querySelector("details.nt.ngroup");
	assert.ok(g.open, "the group is expanded too");
	assert.match(g.querySelector("summary").textContent, /· 2 branches$/);
	assert.strictEqual(g.querySelectorAll(".fnode").length, 2);
	assert.strictEqual(box.querySelectorAll(".nt").length, 1, "one numbered note");
	off();
});

test("closedNotePaths collapses the group it names, and nothing else", () => {
	const off = installDom();
	closedNotePaths.clear();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const keys = collectNoteKeys(noteTree(allNotes(), s.lines), new Set());
	const groupKey = [...keys].find((k) => k.startsWith("notes/e"));
	closedNotePaths.add(groupKey);
	const box = notesPanel();
	assert.ok(box.open, "the section is still open");
	assert.strictEqual(box.querySelector("details.nt.ngroup").open, false);
	closedNotePaths.clear();
	off();
});

test("toggling a group records the key without rebuilding the panel", async () => {
	const off = installDom();
	closedNotePaths.clear();
	loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const box = notesPanel();
	const g = box.querySelector("details.nt.ngroup");
	// <details> fires `toggle` asynchronously, in a browser and in jsdom alike
	const settle = () => new Promise((r) => setTimeout(r, 0));
	g.open = false;
	await settle();
	assert.strictEqual(closedNotePaths.size, 1, "the close is recorded");
	assert.strictEqual(
		box.querySelector("details.nt.ngroup"),
		g,
		"the same element is still in place — no rebuild",
	);
	g.open = true;
	await settle();
	assert.strictEqual(closedNotePaths.size, 0, "reopening clears it");
	off();
});

test("a cluster heads its notes with the move reference, once", () => {
	const off = installDom();
	closedNotePaths.clear();
	const s = loadState("1. e4 e5 2. Nf3");
	s.lines.find((l) => l.isMain).comments = [
		{ ply: 0, text: "first" },
		{ ply: 0, text: "second" },
	];
	const box = notesPanel();
	const c = box.querySelector("details.ntcluster");
	assert.match(c.querySelector("summary").textContent, /^1\.e4 · 2 notes$/);
	assert.strictEqual(box.querySelectorAll(".nt").length, 2, "both entries");
	assert.strictEqual(
		box.textContent.match(/1\.e4/g).length,
		1,
		"the move reference is not repeated on every row",
	);
	off();
});

test("a footnote with both notes and branches counts them as items", () => {
	const off = installDom();
	closedNotePaths.clear();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	// The note sits on 1...c5, the group's SHARED stem, so the ROOT hosts it —
	// a note on a member's own move is hosted by that member's node instead,
	// leaving the root with branches only. Written onto the line rather than
	// parsed from a {comment}, because a comment inside a variation merges with
	// the moves that follow it (see parseSeq in pgn.js).
	s.lines[1].comments = [{ ply: 1, text: "sharp" }];
	const g = notesPanel().querySelector("details.nt.ngroup");
	assert.match(g.querySelector("summary").textContent, /· 3 items$/);
	off();
});

test("Collapse all closes every group, Expand all reopens them", () => {
	const off = installDom();
	closedNotePaths.clear();
	let box = null;
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	// the panel rebuilds itself in place, exactly as app.js's hook does
	const rerenderNotes = () => {
		const fresh = notesPanel();
		box.open = fresh.open;
		box.replaceChildren(...fresh.children);
	};
	setRenderHooks({
		renderApp() {},
		rerenderTable() {},
		rerenderMarkup() {},
		rerenderNotes,
	});
	box = notesPanel();
	const chip = (txt) =>
		[...box.querySelectorAll("summary .chip")].find(
			(b) => b.textContent === txt,
		);
	chip("Collapse all").click();
	const keys = collectNoteKeys(noteTree(allNotes(), s.lines), new Set());
	assert.strictEqual(closedNotePaths.size, keys.size, "every key recorded");
	assert.strictEqual(box.open, false, "the section closed too");
	assert.ok(
		[...box.querySelectorAll("details")].every((d) => !d.open),
		"nothing left open",
	);
	chip("Expand all").click();
	assert.strictEqual(closedNotePaths.size, 0);
	assert.ok(box.open, "the section reopened");
	off();
});

test("a bulk chip does not toggle the section it sits in", () => {
	const off = installDom();
	closedNotePaths.clear();
	loadState("1. e4 {solid} e5 2. Nf3");
	setRenderHooks({
		renderApp() {},
		rerenderTable() {},
		rerenderMarkup() {},
		rerenderNotes() {},
	});
	const box = notesPanel();
	const before = box.open;
	[...box.querySelectorAll("summary .chip")][0].click();
	assert.strictEqual(box.open, before, "the click was stopped at the chip");
	off();
});
