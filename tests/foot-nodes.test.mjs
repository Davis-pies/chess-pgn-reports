import { test } from "node:test";
import assert from "node:assert";
import { loadState } from "./helpers.mjs";
import { footGroups } from "../src/foot-groups.js";
import { groupFoot, hostIndex, labelNodes, labelFor } from "../src/foot-nodes.js";

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

test("a shared move's symbol lands on the node that renders it, first line winning", () => {
	// The symbols are on the LINES before the group is decorated, which is the
	// only order production ever runs in: groupFoot merges them once, on its way
	// down. `decorated` tags lines 1 and 2 — the two members, in collectLines
	// order — so "first" here means the 2. Nf3 branch.
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const [, first, second] = s.lines;
	first.marks[1] = "!"; // the shared stem move 1... c5
	second.marks[1] = "?"; // the same move, disagreeing
	second.marks[2] = "!?"; // its own move, 2. Nc3
	const { groups } = footGroups(s.lines, s.lines[0]);
	const byLine = new Map(s.lines.map((l) => [l, {}]));
	const foot = groupFoot(groups[0], 1, byLine, hostIndex());
	assert.strictEqual(foot.marks[1], "!", "the stem takes the first symbol");
	assert.strictEqual(
		foot.children[0].marks[1],
		undefined,
		"not on a member too",
	);
	assert.strictEqual(
		foot.children[1].marks[2],
		"!?",
		"own move stays on its node",
	);
});

// hostFor's user-visible effect — a note at a shared ply landing on the move it
// is about rather than under a member that never draws that move — is asserted
// through numberNotes in tests/notes.test.mjs ("a note on a shared stem move is
// hosted by the group, not a member" and the inner-fork case beside it).

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
