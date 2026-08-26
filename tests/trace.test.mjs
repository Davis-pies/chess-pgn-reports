import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { grid } from "../src/table.js";
import { pushVars } from "../src/trie-view.js";
import { openTablePaths } from "../src/state.js";
import { tracedKey, tracePath } from "../src/trace.js";

// Two sidelines sharing 1...c5 2. Nf3 d6 and forking on move 3, so an open
// group column carries c5, Nf3 and d6 while each line column carries its tail.
const GROUP = "1. e4 e5 (1... c5 2. Nf3 d6 3. d4 (3. Bb5+)) 2. Nf3";
const GROUP_KEY = "1:c5";

function cols(pgn, open = []) {
	const s = loadState(pgn);
	openTablePaths.clear();
	open.forEach((k) => openTablePaths.add(k));
	return pushVars(grid(s.lines));
}
const named = (vars, san) =>
	vars.find((v) => v.moves && v.moves.some((m) => m.san === san));

test("tracedKey is the var's SAN path", () => {
	const v = { moves: [{ san: "e4" }, { san: "c5" }, { san: "Nf3" }] };
	assert.strictEqual(tracedKey(v), "e4 c5 Nf3");
});

test("tracedKey is null for a var with no moves of its own", () => {
	// a group column stands in for its lines and has no `moves` array
	assert.strictEqual(tracedKey({ cells: {} }), null);
});

test("a traced line lights the mainline prefix, its group column and its tail", () => {
	const off = installDom();
	const vars = cols(GROUP, [GROUP_KEY]);
	const [mainV] = vars;
	const groupCol = vars.find((v) => v.tag === "collapse");
	const line = named(vars, "d4");
	const lit = tracePath(vars, tracedKey(line));
	assert.deepStrictEqual([...lit.get(mainV)], [0], "only the shared 1. e4");
	assert.deepStrictEqual([...lit.get(groupCol)].sort(), [1, 2, 3]);
	assert.deepStrictEqual([...lit.get(line)], [4], "its own tail");
	off();
});

test("the mainline column goes dark the moment the line diverges", () => {
	const off = installDom();
	const vars = cols(GROUP, [GROUP_KEY]);
	const lit = tracePath(vars, tracedKey(named(vars, "d4")));
	// the mainline plays e5 at ply 1 and the traced line plays c5 — no match,
	// so no divergence index has to be stored or consulted
	assert.ok(!lit.get(vars[0]).has(1));
	off();
});

test("a sibling line is not lit", () => {
	const off = installDom();
	const vars = cols(GROUP, [GROUP_KEY]);
	const sibling = named(vars, "Bb5+");
	const lit = tracePath(vars, tracedKey(named(vars, "d4")));
	assert.ok(!lit.has(sibling), "the sibling column contributes nothing");
	off();
});

test("an unresolvable key traces nothing", () => {
	const off = installDom();
	const vars = cols(GROUP, [GROUP_KEY]);
	assert.strictEqual(tracePath(vars, "e4 h6 Nf3"), null, "no such line");
	assert.strictEqual(tracePath(vars, null), null, "nothing traced");
	off();
});

test("tracing the mainline lights only the mainline column", () => {
	const off = installDom();
	const vars = cols(GROUP, [GROUP_KEY]);
	const lit = tracePath(vars, tracedKey(vars[0]));
	assert.deepStrictEqual([...lit.keys()], [vars[0]]);
	assert.deepStrictEqual([...lit.get(vars[0])].sort((a, b) => a - b), [0, 1, 2]);
	off();
});

test("a coincidental same-SAN move does not relight a column the line has left", () => {
	const off = installDom();
	// the mainline plays 2. Nf3 after 1... e5 and the traced line plays it after
	// 1... c5 — the same SAN from a different position. Matching ply by ply
	// would light the mainline column again after the line diverged from it.
	const vars = cols(GROUP, [GROUP_KEY]);
	const lit = tracePath(vars, tracedKey(named(vars, "d4")));
	assert.ok(!lit.get(vars[0]).has(2), "the mainline's own Nf3 stays dark");
	off();
});

// A bare 1...c5 alongside 1...c5 2.Nf3 and 1...c5 2.Nc3: the short line ends
// exactly at the fork, so elide keeps its last move rather than leaving it an
// empty column — and the group column above spells that same move too.
const FORK_END = "1. e4 e5 (1... c5) (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3";

test("a line ending at its fork lights both copies of its last move", () => {
	const off = installDom();
	const vars = cols(FORK_END, ["1:c5"]);
	const groupCol = vars.find((v) => v.tag === "collapse");
	const short = vars.find((v) => v.moves && v.moves.length === 2);
	const lit = tracePath(vars, tracedKey(short));
	assert.deepStrictEqual([...lit.get(vars[0])], [0], "1. e4 off the mainline");
	assert.deepStrictEqual([...lit.get(groupCol)], [1], "c5 on the group column");
	assert.deepStrictEqual([...lit.get(short)], [1], "and on its own column");
	off();
});
