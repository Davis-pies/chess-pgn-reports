// tests/engine-store.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
	FULL,
	downloadFull,
	fileToFull,
	forgetFull,
	fullFor,
	isWasm,
	storedFull,
} from "../src/engine-store.js";

const WASM = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 9, 9]);
const SHA = createHash("sha256").update(WASM).digest("hex");

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory(); // a clean store per test
});

// A fetch answering from a table of url -> bytes (or a status number).
function fakeFetch(table) {
	const calls = [];
	const f = async (url) => {
		calls.push(url);
		const v = table[url];
		if (v === undefined) throw new TypeError("Failed to fetch");
		if (typeof v === "number") return { ok: false, status: v };
		const half = Math.ceil(v.length / 2);
		const parts = [v.slice(0, half), v.slice(half)];
		return {
			ok: true,
			headers: { get: (h) => (h === "content-length" ? String(v.length) : null) },
			body: {
				getReader: () => ({
					read: async () => (parts.length ? { done: false, value: parts.shift() } : { done: true }),
				}),
			},
		};
	};
	f.calls = calls;
	return f;
}

const bytes = async (blob) => [...new Uint8Array(await blob.arrayBuffer())];

test("a WebAssembly file is told from anything else by its first bytes", async () => {
	assert.strictEqual(await isWasm(new Blob([WASM])), true);
	assert.strictEqual(await isWasm(new Blob(["<html>not found"])), false);
});

test("nothing is stored at first", async () => {
	assert.strictEqual(await storedFull(), null);
});

test("with no IndexedDB at all, nothing is stored rather than an error", async () => {
	delete globalThis.indexedDB;
	assert.strictEqual(await storedFull(), null);
});

test("the download reports progress, is stored, and is there next time", async () => {
	const fetch = fakeFetch({ [FULL.urls[0]]: WASM });
	const seen = [];
	const blob = await downloadFull((l, t) => seen.push([l, t]), fetch, SHA);
	assert.deepStrictEqual(seen, [[5, 10], [10, 10]]);
	assert.deepStrictEqual(await bytes(blob), [...WASM]);
	assert.deepStrictEqual(await bytes(await storedFull()), [...WASM]);
	await forgetFull();
	assert.strictEqual(await storedFull(), null);
});

test("a mirror that fails or answers with an error falls through to the next", async () => {
	const fetch = fakeFetch({ [FULL.urls[0]]: 503, [FULL.urls[1]]: WASM });
	await downloadFull(undefined, fetch, SHA);
	assert.deepStrictEqual(fetch.calls, FULL.urls);
	const down = fakeFetch({ [FULL.urls[1]]: WASM }); // the first throws
	await downloadFull(undefined, down, SHA);
	assert.ok(await storedFull());
});

test("when every mirror fails the last reason is the error, and nothing is stored", async () => {
	const fetch = fakeFetch({ [FULL.urls[0]]: 404, [FULL.urls[1]]: new TextEncoder().encode("<html>") });
	await assert.rejects(downloadFull(undefined, fetch), /did not send the engine/);
	assert.strictEqual(await storedFull(), null);
	await assert.rejects(downloadFull(undefined, fakeFetch({ [FULL.urls[1]]: 500 })), /answered 500/);
});

test("a length the server does not give is taken from the known size", async () => {
	const fetch = async () => ({
		ok: true,
		headers: { get: () => null },
		body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: WASM })) }; } },
	});
	const seen = [];
	await downloadFull((l, t) => seen.push(t), fetch, SHA);
	assert.deepStrictEqual(seen, [FULL.size]);
});

test("a download whose checksum does not match is refused and not stored", async () => {
	const other = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 6, 6]);
	const fetch = fakeFetch({ [FULL.urls[0]]: other, [FULL.urls[1]]: other });
	await assert.rejects(downloadFull(undefined, fetch, SHA), /does not match the expected checksum/);
	assert.strictEqual(await storedFull(), null);
});

test("a file from disk is checked before it is stored", async () => {
	await assert.rejects(fileToFull(new Blob(["nope"])), /not a WebAssembly engine/);
	assert.strictEqual(await storedFull(), null);
	await fileToFull(new Blob([WASM]));
	assert.ok(await storedFull());
});

test("each build has its own file; the page's is the single-threaded one when not isolated", () => {
	assert.strictEqual(FULL, fullFor(false));
	assert.strictEqual(fullFor(false).file, "stockfish-19-single.wasm");
	assert.strictEqual(fullFor(true).file, "stockfish-19.wasm");
	for (const t of [true, false]) {
		const b = fullFor(t);
		assert.ok(b.urls.every((u) => u.endsWith("/" + b.file)), "every mirror sends that build");
		assert.match(b.sha256, /^[0-9a-f]{64}$/);
	}
	assert.notStrictEqual(fullFor(true).sha256, fullFor(false).sha256);
});

test("storing one build removes the other's file", async () => {
	const put = (key, value) =>
		new Promise((resolve, reject) => {
			const req = indexedDB.open("chess-pgn-engines", 1);
			req.onupgradeneeded = () => req.result.createObjectStore("files");
			req.onsuccess = () => {
				const t = req.result.transaction("files", "readwrite");
				t.objectStore("files").put(value, key);
				t.oncomplete = () => {
					req.result.close();
					resolve();
				};
				t.onerror = () => reject(t.error);
			};
		});
	const has = (key) =>
		new Promise((resolve) => {
			const req = indexedDB.open("chess-pgn-engines", 1);
			req.onsuccess = () => {
				const g = req.result.transaction("files").objectStore("files").get(key);
				g.onsuccess = () => {
					req.result.close();
					resolve(g.result !== undefined);
				};
			};
		});
	await put(fullFor(true).file, new Blob([WASM]));
	await fileToFull(new Blob([WASM]));
	assert.strictEqual(await has(fullFor(true).file), false);
	assert.strictEqual(await has(FULL.file), true);
});
