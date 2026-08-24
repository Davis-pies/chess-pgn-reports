import { test } from "node:test";
import assert from "node:assert";
import { loadState } from "./helpers.mjs";
import { footGroups } from "../src/foot-groups.js";

// helper: the state's non-main lines, in collectLines order
const others = (s) => s.lines.filter((l) => !l.isMain);
const sans = (moves) => moves.map((m) => m.san);

test("two foot lines sharing a divergent move form one group", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const main = s.lines[0];
	const { groups, grouped } = footGroups(s.lines, main);
	assert.strictEqual(groups.length, 1);
	const g = groups[0];
	assert.deepStrictEqual(sans(g.stem), ["c5"], "shared move is the stem");
	assert.strictEqual(g.members.length, 2);
	assert.deepStrictEqual(
		g.tree.map((t) => sans(t.moves)),
		[["Nf3"], ["Nc3"]],
	);
	assert.ok(g.tree.every((t) => t.line && t.children.length === 0));
	assert.strictEqual(grouped.size, 2);
	g.members.forEach((m) => assert.ok(grouped.has(m)));
});

test("a lone foot line is not a group", () => {
	const s = loadState("1. e4 e5 (1... c5) 2. Nf3", { tags: { 1: "foot" } });
	const { groups, grouped } = footGroups(s.lines, s.lines[0]);
	assert.deepStrictEqual(groups, []);
	assert.strictEqual(grouped.size, 0);
});

test("a node with an untagged sibling still groups its foot lines", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) (1... c5 2. d4) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot" } }, // line 3 (2. d4) stays a sideline
	);
	const { groups, grouped } = footGroups(s.lines, s.lines[0]);
	assert.strictEqual(groups.length, 1);
	assert.strictEqual(groups[0].members.length, 2, "only the foot lines");
	const sideline = others(s)[2];
	assert.ok(!grouped.has(sideline));
});

test("an inner fork becomes a nested child, not a flattened sibling", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "foot" } },
	);
	const { groups } = footGroups(s.lines, s.lines[0]);
	assert.strictEqual(groups.length, 1);
	const g = groups[0];
	assert.deepStrictEqual(sans(g.stem), ["c5"]);
	assert.deepStrictEqual(
		g.tree.map((t) => sans(t.moves)),
		[["Nf3"], ["Nc3"]],
	);
	const nf3 = g.tree[0];
	assert.strictEqual(nf3.line, null, "an inner fork has no line of its own");
	assert.deepStrictEqual(
		nf3.children.map((t) => sans(t.moves)),
		[["d6"], ["Nc6"]],
	);
});

test("the stem runs down a single-child chain to the first fork", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 d6 3. d4) (1... c5 2. Nf3 d6 3. Bb5+) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const { groups } = footGroups(s.lines, s.lines[0]);
	assert.deepStrictEqual(sans(groups[0].stem), ["c5", "Nf3", "d6"]);
	assert.deepStrictEqual(
		groups[0].tree.map((t) => sans(t.moves)),
		[["d4"], ["Bb5+"]],
	);
});

test("a member ending at the stem becomes a moveless child", () => {
	const s = loadState("1. e4 e5 (1... c5) (1... c5 2. Nf3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const { groups } = footGroups(s.lines, s.lines[0]);
	const g = groups[0];
	assert.deepStrictEqual(sans(g.stem), ["c5"]);
	assert.deepStrictEqual(g.tree[0].moves, [], "the short line has no tail");
	assert.ok(g.tree[0].line, "but it still carries its line");
	assert.deepStrictEqual(sans(g.tree[1].moves), ["Nf3"]);
});

test("foot lines diverging at different moves are separate groups", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) (1... e6 2. d4) (1... e6 2. Nf3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "foot", 4: "foot" } },
	);
	const { groups } = footGroups(s.lines, s.lines[0]);
	assert.strictEqual(groups.length, 2);
	assert.deepStrictEqual(
		groups.map((g) => sans(g.stem)),
		[["c5"], ["e6"]],
	);
});

test("a member ending at an inner fork becomes a moveless child there too", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nf3 d6) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "foot" } },
	);
	const { groups } = footGroups(s.lines, s.lines[0]);
	const g = groups[0];
	assert.deepStrictEqual(sans(g.stem), ["c5"]);
	const nf3 = g.tree[0];
	assert.deepStrictEqual(sans(nf3.moves), ["Nf3"]);
	assert.strictEqual(nf3.line, null, "a fork never carries a line itself");
	assert.deepStrictEqual(
		nf3.children.map((c) => [sans(c.moves), !!c.line]),
		[
			[[], true],
			[["d6"], true],
		],
		"the line ending at the fork is demoted to a moveless first child",
	);
});
