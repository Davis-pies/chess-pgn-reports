import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

// The browser resolves "chess.js" through index.html's importmap; the tests
// resolve it through node_modules. Nothing makes those agree on its own, and
// they silently drifted a full minor version apart -- so assert it here.
test("index.html pins the chess.js version the tests run", () => {
	const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
	const pinned = html.match(/esm\.sh\/chess\.js@([\d.]+)/);
	assert.ok(pinned, "index.html has no esm.sh chess.js pin");
	const installed = JSON.parse(
		readFileSync(
			new URL("../node_modules/chess.js/package.json", import.meta.url),
			"utf8",
		),
	).version;
	assert.strictEqual(pinned[1], installed);
});
