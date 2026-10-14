import { test } from "node:test";
import assert from "node:assert";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { posKey } from "../src/audit.js";
import { buildPgn } from "../src/pgn-out.js";
import { readNameCmd, namesFromNodes, setName, variationTree, trailOf } from "../src/names.js";

const PGN = `1. e4 c5 2. Nf3 d6 {[%name "...d6 Sicilians"]} (2... e6 {[%name "...e6 Sicilians"] [%tags "e6"]} 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 d6 {[%name "Scheveningen"] Small centre.}) 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 e6 {[%name "Scheveningen"]} (5... a6 {[%name "Najdorf"] [%tags "d6; Nc3 committed"]} 6. Be3 {[%name "English Attack"]}) *`;
const parsed = () => parsePgn(PGN);

test("readNameCmd reads a name and ;-separated tags", () => {
	assert.deepStrictEqual(readNameCmd('[%name "Najdorf"] [%tags "d6; Nc3 committed ;"] text'), { name: "Najdorf", tags: ["d6", "Nc3 committed"] });
	assert.deepStrictEqual(readNameCmd('[%name "Kan/Paulsen"]'), { name: "Kan/Paulsen", tags: [] });
	assert.strictEqual(readNameCmd("[%clk 0:01:00] plain"), null);
});

test("the parser puts names on nodes and keeps them out of the note text", () => {
	const { nodes, comments } = parsed();
	assert.deepStrictEqual(nodes[3].posName, { name: "...d6 Sicilians", tags: [] });
	assert.ok(!comments.some((c) => /%name/.test(c.text)));
	assert.ok(comments.some((c) => /Small centre\./.test(c.text)));
});

test("namesFromNodes keys names by position, so a transposition is one entry", () => {
	const names = namesFromNodes(parsed().nodes);
	const keys = Object.keys(names);
	assert.strictEqual(keys.filter((k) => names[k].name === "Scheveningen").length, 1);
	assert.strictEqual(keys.length, 5);
});

test("setName adds, replaces and (blank) removes", () => {
	const names = {};
	const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
	setName(names, fen, "King's pawn", ["e4"]);
	assert.deepStrictEqual(names[posKey(fen)], { name: "King's pawn", tags: ["e4"] });
	setName(names, fen, "  ");
	assert.deepStrictEqual(names, {});
});

test("variationTree: parents, also-reached-from, levels, children and move orders", () => {
	const { nodes } = parsed();
	const lines = collectLines(nodes);
	const t = variationTree(lines, namesFromNodes(nodes));
	const byName = (n) => [...t.byKey.values()].find((v) => v.name === n);
	assert.deepStrictEqual(t.roots.map((v) => v.name).sort(), ["...d6 Sicilians", "...e6 Sicilians"]);
	const sch = byName("Scheveningen");
	assert.strictEqual(sch.level, 2);
	assert.strictEqual(sch.orders.length, 2);
	assert.strictEqual(sch.parent.name, "...d6 Sicilians");
	assert.deepStrictEqual(sch.also.map((v) => v.name), ["...e6 Sicilians"]);
	assert.strictEqual(byName("English Attack").level, 3);
	assert.strictEqual(byName("English Attack").parent.name, "Najdorf");
	assert.deepStrictEqual(byName("Najdorf").children.map((v) => v.name), ["English Attack"]);
});

test("trailOf lists the named positions a move sequence passes through", () => {
	const names = namesFromNodes(parsed().nodes);
	const sans = "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5".split(" ");
	assert.deepStrictEqual(trailOf(sans, names).map((x) => x.name), ["...d6 Sicilians", "Najdorf", "English Attack"]);
	assert.deepStrictEqual(trailOf([], names), []);
});

// names live in the workbook; the PGN is only read for them on import, and an
// export stays plain PGN that any other program reads as it would any file
test("buildPgn leaves names out of the export", () => {
	const { nodes } = parsed();
	const out = buildPgn({ lines: collectLines(nodes), names: namesFromNodes(nodes) });
	assert.doesNotMatch(out, /\[%name|\[%tags/);
});
