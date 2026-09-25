// src/engine-flavor.js
// Which Stockfish build the engine runs: the bundled lite one, or the full
// one fetched once and kept in the browser (see engine-store.js). This owns
// the choice, the one-time download and its progress, and the viewer's
// preference; the view draws from its state and repaints on its updates,
// the same way it follows the engine.

import * as realStore from "./engine-store.js";
import { fullWorker, liteWorker, sharedEngine } from "./engine.js";

const PREF = "engineFlavor";
const readPref = () => {
	try {
		return localStorage.getItem(PREF);
	} catch {
		return null;
	}
};
const writePref = (v) => {
	try {
		localStorage.setItem(PREF, v);
	} catch {}
};

export function createFlavors(
	engine,
	{
		store = realStore,
		makeLite = liteWorker,
		makeFull = fullWorker,
		urlFor = (blob) => URL.createObjectURL(blob),
	} = {},
) {
	// flavor: what runs. offer: the full engine was asked for and is not on
	// this device, so the download box is showing. status: of that box.
	const state = { flavor: "lite", offer: false, status: "idle", loaded: 0, total: 0, error: null };
	let listener = () => {};
	const emit = () => listener(state);
	let url = null; // the stored engine's blob: URL, made once per page

	function use(blob) {
		if (!url) url = urlFor(blob);
		engine.swap(makeFull(url));
		Object.assign(state, { flavor: "full", offer: false, status: "idle", error: null });
		writePref("full");
		emit();
	}

	return {
		state,
		set onUpdate(fn) {
			listener = fn || (() => {});
		},
		async choose(flavor) {
			if (flavor === "lite") {
				if (state.flavor !== "lite") engine.swap(makeLite);
				Object.assign(state, { flavor: "lite", offer: false, status: "idle", error: null });
				writePref("lite");
				emit();
				return;
			}
			if (state.flavor === "full") return;
			state.status = "checking";
			emit();
			const blob = url ? true : await store.storedFull();
			if (blob) use(blob);
			else {
				Object.assign(state, { offer: true, status: "idle" });
				emit();
			}
		},
		async download() {
			Object.assign(state, { status: "downloading", loaded: 0, total: store.FULL.size, error: null });
			emit();
			try {
				use(
					await store.downloadFull((loaded, total) => {
						state.loaded = loaded;
						state.total = total;
						emit();
					}),
				);
			} catch (e) {
				Object.assign(state, { status: "error", error: (e && e.message) || String(e) });
				emit();
			}
		},
		async loadFile(file) {
			try {
				use(await store.fileToFull(file));
			} catch (e) {
				Object.assign(state, { offer: true, status: "error", error: e.message });
				emit();
			}
		},
		dismiss() {
			Object.assign(state, { offer: false, status: "idle", error: null });
			emit();
		},
		// Free the 99 MB and go back to the lite engine.
		async forget() {
			try {
				await store.forgetFull();
			} catch {}
			url = null;
			await this.choose("lite");
		},
		// A viewer who chose the full engine last time gets it again, if it is
		// still stored; if not, the lite one, without asking.
		async restore() {
			if (readPref() !== "full") return;
			const blob = await store.storedFull();
			if (blob) use(blob);
		},
	};
}

let shared = null;
export function sharedFlavors() {
	if (!shared) {
		shared = createFlavors(sharedEngine());
		shared.restore();
	}
	return shared;
}
