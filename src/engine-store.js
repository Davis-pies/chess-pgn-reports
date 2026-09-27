// src/engine-store.js
// The full-strength engine, which is too big to ship with the app.
//
// The lite Stockfish (1.8 MB) is served from vendor/stockfish/ like any other
// file. The full one is the same program with the full-size neural network:
// a 99 MB .wasm, too big for the repository or a page load. Only its 21 KB
// loader is vendored; the .wasm is downloaded once, on request, and kept in
// this browser's IndexedDB, so every later visit starts it from disk. A file
// the user downloaded themselves can be loaded instead, for when the
// download is blocked.
//
// The loader takes its .wasm from the URL in its own hash, so the stored
// file is handed over as a blob: URL -- no network involved after the first
// time.

export const FULL = {
	file: "stockfish-19-single.wasm",
	size: 99102793,
	// tried in order; both are npm mirrors that send CORS headers
	urls: [
		"https://unpkg.com/stockfish@19.0.0/bin/stockfish-19-single.wasm",
		"https://cdn.jsdelivr.net/npm/stockfish@19.0.0/bin/stockfish-19-single.wasm",
	],
	// where to get it by hand if neither mirror answers
	manual: "https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.0",
};

const DB = "chess-pgn-engines";
const STORE = "files";

function open() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function tx(mode, fn) {
	const db = await open();
	return new Promise((resolve, reject) => {
		const t = db.transaction(STORE, mode);
		const req = fn(t.objectStore(STORE));
		t.oncomplete = () => {
			db.close();
			resolve(req.result);
		};
		t.onerror = t.onabort = () => {
			db.close();
			reject(t.error);
		};
	});
}

export async function storedFull() {
	try {
		return (await tx("readonly", (s) => s.get(FULL.file))) || null;
	} catch {
		return null; // no IndexedDB (private mode, blocked storage): not stored
	}
}

const storeFull = (blob) => tx("readwrite", (s) => s.put(blob, FULL.file));

export const forgetFull = () => tx("readwrite", (s) => s.delete(FULL.file));

// Every WebAssembly module starts with "\0asm". An error page or a
// truncated download does not, and is refused before it is stored.
export async function isWasm(blob) {
	const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
	return head[0] === 0 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d;
}

// Download, check and store the full engine, reporting bytes as they come.
// Each mirror is tried in turn; the error of the last is what is thrown.
export async function downloadFull(onProgress = () => {}, fetchImpl = fetch) {
	let last = null;
	for (const url of FULL.urls) {
		try {
			const res = await fetchImpl(url);
			if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
			const total = Number(res.headers.get("content-length")) || FULL.size;
			const chunks = [];
			let loaded = 0;
			const reader = res.body.getReader();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
				loaded += value.length;
				onProgress(loaded, total);
			}
			const blob = new Blob(chunks, { type: "application/wasm" });
			if (!(await isWasm(blob))) throw new Error(`${new URL(url).host} did not send the engine`);
			await storeFull(blob);
			return blob;
		} catch (e) {
			last = e;
		}
	}
	throw last;
}

// A .wasm the user picked from disk.
export async function fileToFull(file) {
	if (!(await isWasm(file))) throw new Error("That file is not a WebAssembly engine.");
	await storeFull(file);
	return file;
}
