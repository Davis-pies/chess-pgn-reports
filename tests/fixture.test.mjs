import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";

const fixture = fileURLToPath(
	new URL("./fixtures/capablanca.pgn", import.meta.url),
);

test("parses a real annotated game with headers, comments, and null moves", () => {
	const pgn = fs.readFileSync(fixture, "utf8");
	const { nodes, result } = parsePgn(pgn);
	assert.strictEqual(result, "1-0");
	// mainline should be the full game (91 plies, matching [PlyCount "91"])
	assert.strictEqual(nodes.length, 91);
	assert.strictEqual(nodes[0].san, "e4");
	assert.strictEqual(nodes[nodes.length - 1].san, "g6");
});

test("headers are stripped and variations become separate lines", () => {
	const pgn = fs.readFileSync(fixture, "utf8");
	const lines = collectLines(parsePgn(pgn).nodes);
	assert.ok(lines.length >= 2, "game has variations");
	// first node is a real move, not a header token like '[Event'
	assert.ok(lines[0].moves.length > 0);
	assert.strictEqual(lines[0].moves[0].san, "e4");
});

test("null moves are preserved and do not break turn alternation", () => {
const pgn = fs.readFileSync(fixture, "utf8");
const lines = collectLines(parsePgn(pgn).nodes);
const nullVar = lines.find((l) => l.moves.some((m) => m.san === "--"));
assert.ok(nullVar, "a variation containing a null move exists");
// the null-move line: ... Be6 (-- Bc4)
const idx = nullVar.moves.findIndex((m) => m.san === "--");
assert.strictEqual(nullVar.moves[idx - 1].san, "Be6");
assert.strictEqual(nullVar.moves[idx + 1].san, "Bc4");
});

test("comments are captured and exposed on the parse result", () => {
const pgn = fs.readFileSync(fixture, "utf8");
const { comments } = parsePgn(pgn);
assert.ok(comments.length > 0, "game has prose comments");
assert.ok(
comments.every((c) => typeof c.ply === "number" && c.text.length > 0),
);
// a known comment from the game
const solid = comments.find((c) => c.text.includes("very solid development"));
assert.ok(solid, "the 5.d3 comment is present");
assert.strictEqual(solid.ply, 8); // 5.d3 -> ply 8 (0-based)
});
