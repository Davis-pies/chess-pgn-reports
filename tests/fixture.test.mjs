import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { namesFromNodes } from "../src/names.js";

const fixture = fileURLToPath(
	new URL("./fixtures/open-games-repertoire.pgn", import.meta.url),
);

test("parses a real annotated repertoire with headers, notes, and nested variations", () => {
	const pgn = fs.readFileSync(fixture, "utf8");
	const { nodes, result } = parsePgn(pgn);
	assert.strictEqual(result, "*");
	// mainline is the Giuoco Pianissimo, 20 plies to 10...Re8
	assert.strictEqual(nodes.length, 20);
	assert.strictEqual(nodes[0].san, "e4");
	assert.strictEqual(nodes[nodes.length - 1].san, "Re8");
});

test("headers are stripped and variations become separate lines", () => {
	const pgn = fs.readFileSync(fixture, "utf8");
	const lines = collectLines(parsePgn(pgn).nodes);
	assert.strictEqual(lines.length, 14);
	// first node is a real move, not a header token like '[Event'
	assert.ok(lines[0].moves.length > 0);
	assert.strictEqual(lines[0].moves[0].san, "e4");
});

test("[%name] commands name the positions they sit on", () => {
	const pgn = fs.readFileSync(fixture, "utf8");
	const names = Object.values(namesFromNodes(parsePgn(pgn).nodes)).map(
		(n) => n.name,
	);
	assert.strictEqual(names.length, 11);
	assert.ok(names.includes("Giuoco Pianissimo"));
	assert.ok(names.includes("Fried Liver Attack"));
});

test("comments are captured and exposed on the parse result", () => {
	const pgn = fs.readFileSync(fixture, "utf8");
	const { comments } = parsePgn(pgn);
	assert.ok(comments.length > 0, "workbook has prose comments");
	assert.ok(
		comments.every((c) => typeof c.ply === "number" && c.text.length > 0),
	);
	// each comment stays on the move it follows: the Two Knights note sits
	// on 3...Nf6 (ply 5, 0-based), not on a later move
	const twoKnights = comments.find((c) => c.text.startsWith("TWO KNIGHTS."));
	assert.ok(twoKnights, "the Two Knights note is present");
	assert.strictEqual(twoKnights.ply, 5);
	const noObjectLeak = comments.every(
		(c) => !String(c.text).includes("[object"),
	);
	assert.ok(noObjectLeak, "no [object Object] leaked into comments");
});
