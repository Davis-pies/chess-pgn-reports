// src/audit-store.js
// What the repertoire audit found, kept in this browser by position, so a
// reload or a second run does not search again what was searched before. An
// eval belongs to the position, not to a workbook: every workbook that
// reaches the position shares it. Only the lite engine audits, so its evals
// are the only ones kept; a deeper one replaces a shallower one.
//
// Storage is a convenience here, not the record: anything that fails (no
// IndexedDB, a private window, a full disk) leaves the audit to search again.

const DB = "chess-pgn-audit";
const STORE = "evals";

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
		const out = fn(t.objectStore(STORE));
		t.oncomplete = () => {
			db.close();
			resolve(out);
		};
		t.onerror = t.onabort = () => {
			db.close();
			reject(t.error);
		};
	});
}

export const evalStore = {
	// key -> eval for those of `keys` that are stored
	async load(keys) {
		try {
			return await tx("readonly", (s) => {
				const out = new Map();
				for (const k of keys) {
					const req = s.get(k);
					req.onsuccess = () => req.result && out.set(k, req.result);
				}
				return out;
			});
		} catch {
			return new Map();
		}
	},
	// [key, eval] pairs; a stored eval at least as deep is kept
	async save(entries) {
		try {
			await tx("readwrite", (s) => {
				for (const [k, ev] of entries) {
					const req = s.get(k);
					req.onsuccess = () => {
						if (!req.result || req.result.depth < ev.depth) s.put(ev, k);
					};
				}
			});
		} catch {
			// not kept: the next run searches it again
		}
	},
};
