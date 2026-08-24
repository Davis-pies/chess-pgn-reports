import { test } from "node:test";
import assert from "node:assert";
import { loadState } from "./helpers.mjs";
import { footGroups } from "../src/foot-groups.js";
import {
	groupFoot,
	hostIndex,
	labelNodes,
	linesUnder,
	mergeMarks,
} from "../src/foot-nodes.js";

// Decorate the single group in a PGN, the way numberNotes does: a pre-seeded
// per-line marker map, then groupFoot with the group's divergence index.
// collectLines emits a node's variations BEFORE the node itself, so a line's
// index is variation-declaration order, not reading order.
function decorated(pgn, tags, d = 1) {
	const s = loadState(pgn, { tags });
	const { groups } = footGroups(s.lines, s.lines[0]);
	const byLine = new Map(s.lines.map((l) => [l, {}]));
	const index = hostIndex();
	const foot = groupFoot(groups[0], d, byLine, index);
	return { s, foot, index, byLine, group: groups[0] };
}

const sans = (moves) => moves.map((m) => m.san);

test("a leaf node aliases its line's marker map", () => {
	const { foot, byLine } = decorated(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3",
		{ 1: "foot", 2: "foot" },
	);
	foot.children.forEach((c) =>
		assert.strictEqual(
			c.noteByPly,
			byLine.get(c.line),
			"the same object, so a renumber in place is seen by both",
		),
	);
	assert.deepStrictEqual(sans(foot.moves), ["e4", "c5"], "the absolute stem");
});

test("labels alternate by depth and branches continue after a node's own notes", () => {
	const { foot } = decorated(
		"1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3) 2. Nf3",
		{ 1: "foot", 2: "foot", 3: "foot" },
	);
	// The group's own note takes the first label at depth 1, so the branches
	// start at the second.
	foot.subNotes.push({ label: "a", ply: 2, text: "shared" });
	labelNodes(foot);
	assert.deepStrictEqual(
		foot.children.map((c) => c.label),
		["b", "c"],
		"branches continue the depth-1 letter sequence",
	);
	const nf3 = foot.children[0];
	assert.deepStrictEqual(
		nf3.children.map((c) => c.label),
		["1", "2"],
		"numbers at depth 2",
	);
});

test("linesUnder lists every member below a node in reading order", () => {
	const { foot, group } = decorated(
		"1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3) 2. Nf3",
		{ 1: "foot", 2: "foot", 3: "foot" },
	);
	assert.deepStrictEqual(linesUnder(foot), group.members);
	assert.strictEqual(linesUnder(foot.children[0]).length, 2, "the Nf3 fork");
});

test("a shared move's symbol lands on the node that renders it, first line winning", () => {
	const { s, foot, index } = decorated(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3",
		{ 1: "foot", 2: "foot" },
	);
	const [, first, second] = s.lines;
	first.marks[1] = "!"; // the shared stem move 1... c5
	second.marks[1] = "?"; // the same move, disagreeing
	second.marks[2] = "!?"; // its own move, 2. Nc3
	// re-merge onto the already-decorated tree
	foot.marks = {};
	foot.children.forEach((c) => (c.marks = {}));
	mergeMarks(foot, index.plies);
	assert.strictEqual(foot.marks[1], "!", "the stem takes the first symbol");
	assert.strictEqual(foot.children[0].marks[1], undefined, "not on a member too");
	assert.strictEqual(foot.children[1].marks[2], "!?", "own move stays on its node");
});

test("hostFor picks the deepest node drawing the ply, and the root for an undrawn one", () => {
	const { s, foot, index } = decorated(
		"1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3) 2. Nf3",
		{ 1: "foot", 2: "foot", 3: "foot" },
	);
	const d6 = s.lines[1]; // 1... c5 2. Nf3 d6
	const nf3 = foot.children[0];
	assert.strictEqual(index.hostFor(d6, 3), index.nodeOfLine.get(d6), "own move");
	assert.strictEqual(index.hostFor(d6, 2), nf3, "the shared fork move 2. Nf3");
	assert.strictEqual(index.hostFor(d6, 1), foot, "the stem move 1... c5");
	assert.strictEqual(index.hostFor(d6, 0), foot, "a ply the group never draws");
});
