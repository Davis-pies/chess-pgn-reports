// tests/engine-store.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
	FULL,
	downloadFull,
	fileToFull,
	forgetFull,
	isWasm,
	storedFull,
} from "../src/engine-store.js";

const WASM = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 9, 9]);

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
	const blob = await downloadFull((l, t) => seen.push([l, t]), fetch);
	assert.deepStrictEqual(seen, [[5, 10], [10, 10]]);
	assert.deepStrictEqual(await bytes(blob), [...WASM]);
	assert.deepStrictEqual(await bytes(await storedFull()), [...WASM]);
	await forgetFull();
	assert.strictEqual(await storedFull(), null);
});

test("a mirror that fails or answers with an error falls through to the next", async () => {
	const fetch = fakeFetch({ [FULL.urls[0]]: 503, [FULL.urls[1]]: WASM });
	await downloadFull(undefined, fetch);
	assert.deepStrictEqual(fetch.calls, FULL.urls);
	const down = fakeFetch({ [FULL.urls[1]]: WASM }); // the first throws
	await downloadFull(undefined, down);
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
	await downloadFull((l, t) => seen.push(t), fetch);
	assert.deepStrictEqual(seen, [FULL.size]);
});

test("a file from disk is checked before it is stored", async () => {
	await assert.rejects(fileToFull(new Blob(["nope"])), /not a WebAssembly engine/);
	assert.strictEqual(await storedFull(), null);
	await fileToFull(new Blob([WASM]));
	assert.ok(await storedFull());
});
