// tests/engine-flavor.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { installDom } from "./helpers.mjs";
import { createFlavors } from "../src/engine-flavor.js";
import { analysisPanel } from "../src/analysis-view.js";
import { newScratch } from "../src/analysis.js";
import { createEngine } from "../src/engine.js";
import { FULL } from "../src/engine-store.js";

// jsdom's storage on the global the app code reads, as a browser has it.
function withDom() {
	const done = installDom();
	Object.defineProperty(globalThis, "localStorage", { value: window.localStorage, configurable: true, writable: true });
	return () => {
		delete globalThis.localStorage;
		done();
	};
}

// An engine that only records which worker factory it was switched to.
const fakeEngine = () => {
	const e = { swaps: [], swap: (f) => e.swaps.push(f()) };
	return e;
};

function fakeStore({ stored = null, download, file } = {}) {
	const s = {
		FULL: { size: 100, manual: "https://example.invalid/releases" },
		stored,
		forgot: 0,
		storedFull: async () => s.stored,
		downloadFull: download || (async (onProgress) => {
			onProgress(50, 100);
			onProgress(100, 100);
			return (s.stored = "BLOB");
		}),
		fileToFull: file || (async (f) => (s.stored = f)),
		forgetFull: async () => {
			s.forgot++;
			s.stored = null;
		},
	};
	return s;
}

function setup(storeOpts) {
	const engine = fakeEngine();
	const store = fakeStore(storeOpts);
	const f = createFlavors(engine, {
		store,
		makeLite: () => "lite",
		makeFull: (url) => () => "full:" + url,
		urlFor: (blob) => "blob:" + blob,
	});
	const seen = [];
	f.onUpdate = (st) => seen.push({ ...st });
	return { f, engine, store, seen };
}

test("the lite engine is the default, and choosing it again changes nothing", async () => {
	const done = withDom();
	const { f, engine } = setup();
	assert.strictEqual(f.state.flavor, "lite");
	await f.choose("lite");
	assert.deepStrictEqual(engine.swaps, []);
	done();
});

test("choosing full with nothing stored offers the download", async () => {
	const done = withDom();
	const { f, engine, seen } = setup();
	await f.choose("full");
	assert.strictEqual(seen[0].status, "checking");
	assert.strictEqual(f.state.offer, true);
	assert.strictEqual(f.state.flavor, "lite", "still lite until it is got");
	assert.deepStrictEqual(engine.swaps, []);
	f.dismiss();
	assert.strictEqual(f.state.offer, false);
	done();
});

test("the download reports progress, then runs the full engine and remembers it", async () => {
	const done = withDom();
	const { f, engine, seen } = setup();
	await f.choose("full");
	await f.download();
	assert.ok(seen.some((s) => s.status === "downloading" && s.loaded === 50));
	assert.deepStrictEqual(engine.swaps, ["full:blob:BLOB"]);
	assert.strictEqual(f.state.flavor, "full");
	assert.strictEqual(f.state.offer, false);
	assert.strictEqual(localStorage.getItem("engineFlavor"), "full");
	await f.choose("full"); // already: nothing
	assert.strictEqual(engine.swaps.length, 1);
	await f.choose("lite");
	assert.deepStrictEqual(engine.swaps, ["full:blob:BLOB", "lite"]);
	assert.strictEqual(localStorage.getItem("engineFlavor"), "lite");
	await f.choose("full"); // the blob URL is kept for the page: no store read
	assert.deepStrictEqual(engine.swaps.at(-1), "full:blob:BLOB");
	done();
});

test("a stored engine is used straight away", async () => {
	const done = withDom();
	const { f, engine } = setup({ stored: "OLD" });
	await f.choose("full");
	assert.deepStrictEqual(engine.swaps, ["full:blob:OLD"]);
	assert.strictEqual(f.state.offer, false);
	done();
});

test("a failed download says why and leaves the lite engine running", async () => {
	const done = withDom();
	const { f, engine } = setup({
		download: async () => {
			throw new Error("unpkg.com answered 403");
		},
	});
	await f.choose("full");
	await f.download();
	assert.strictEqual(f.state.status, "error");
	assert.strictEqual(f.state.error, "unpkg.com answered 403");
	assert.deepStrictEqual(engine.swaps, []);
	done();
});

test("a file can stand in for the download, and a bad one is refused", async () => {
	const done = withDom();
	const bad = setup({
		file: async () => {
			throw new Error("That file is not a WebAssembly engine.");
		},
	});
	await bad.f.loadFile("x");
	assert.strictEqual(bad.f.state.status, "error");
	assert.strictEqual(bad.f.state.offer, true);
	const good = setup();
	await good.f.loadFile("FILE");
	assert.deepStrictEqual(good.engine.swaps, ["full:blob:FILE"]);
	done();
});

test("removing the download frees it and goes back to lite", async () => {
	const done = withDom();
	const { f, engine, store } = setup({ stored: "OLD" });
	await f.choose("full");
	await f.forget();
	assert.strictEqual(store.forgot, 1);
	assert.strictEqual(f.state.flavor, "lite");
	assert.strictEqual(engine.swaps.at(-1), "lite");
	store.forgetFull = async () => {
		throw new Error("blocked");
	};
	await f.forget(); // a store that cannot delete still leaves lite running
	assert.strictEqual(f.state.flavor, "lite");
	done();
});

test("a viewer who chose full last time gets it back if it is still stored", async () => {
	const done = withDom();
	localStorage.setItem("engineFlavor", "full");
	const kept = setup({ stored: "OLD" });
	await kept.f.restore();
	assert.strictEqual(kept.f.state.flavor, "full");
	const gone = setup();
	await gone.f.restore();
	assert.strictEqual(gone.f.state.flavor, "lite");
	assert.strictEqual(gone.f.state.offer, false, "not asked again unprompted");
	localStorage.setItem("engineFlavor", "lite");
	const lite = setup({ stored: "OLD" });
	await lite.f.restore();
	assert.strictEqual(lite.f.state.flavor, "lite");
	done();
});

test("blocked storage is not an error for the preference", async () => {
	const done = withDom();
	Object.defineProperty(globalThis, "localStorage", {
		get() {
			throw new Error("denied");
		},
		configurable: true,
	});
	const { f } = setup({ stored: "OLD" });
	await f.restore();
	await f.choose("full");
	assert.strictEqual(f.state.flavor, "full");
	done();
});

// ---- the engine's side of a swap

function fakeWorker(name, log) {
	const w = {
		name,
		postMessage(cmd) {
			log.push(`${name}:${cmd}`);
			if (cmd === "uci") w.onmessage({ data: "uciok" });
			if (cmd === "isready") w.onmessage({ data: "readyok" });
		},
		terminate() {
			log.push(`${name}:terminated`);
		},
	};
	return w;
}
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("swapping builds ends the old worker and re-analyses on the new one", () => {
	const log = [];
	const eng = createEngine(() => fakeWorker("lite", log), { throttle: 0 });
	eng.swap(() => fakeWorker("never", log)); // off: nothing starts
	assert.deepStrictEqual(log, []);
	eng.swap(() => fakeWorker("lite", log));
	eng.enable();
	eng.analyse(START);
	eng.swap(() => fakeWorker("full", log));
	assert.ok(log.includes("lite:terminated"));
	assert.ok(log.includes("full:go depth 22"));
	assert.strictEqual(eng.state.status, "searching");
	eng.enable(false);
	eng.swap(() => fakeWorker("again", log));
	assert.ok(!log.some((l) => l.startsWith("again:")), "off: not started");
});

// ---- the download box in the panel

function panelWith(storeOpts) {
	const { f, store } = setup(storeOpts);
	const engine = createEngine(() => fakeWorker("w", []), { throttle: 0 });
	engine.enable();
	let changed = 0;
	const panel = () => analysisPanel(newScratch(), () => changed++, { engine, flavors: f });
	return { f, store, panel };
}

test("the build picker shows only while the engine is on, and picks", async () => {
	const done = withDom();
	const { f, panel } = panelWith();
	const p = panel();
	const pick = p.querySelector(".an-engine-flavor");
	assert.strictEqual(pick.value, "lite");
	assert.ok(p.querySelector(".an-full").hidden, "no box until the full engine is asked for");
	pick.value = "full";
	pick.onchange();
	await new Promise((r) => setTimeout(r, 0));
	assert.ok(!p.querySelector(".an-full").hidden);
	assert.match(p.querySelector(".an-full").textContent, /99 MB download/);
	assert.strictEqual(f.state.offer, true);
	const off = createEngine(() => null);
	assert.strictEqual(analysisPanel(newScratch(), () => {}, { engine: off, flavors: f }).querySelector(".an-engine-flavor"), null);
	done();
});

test("the box's buttons download, load a file, or back out", async () => {
	const done = withDom();
	const { f, panel } = panelWith();
	await f.choose("full");
	let p = panel();
	p.querySelector(".an-full-cancel").click();
	await new Promise((r) => setTimeout(r, 0));
	assert.strictEqual(f.state.offer, false);

	await f.choose("full");
	p = panel();
	const input = p.querySelector('.an-full input[type="file"]');
	let picked = 0;
	input.click = () => picked++;
	p.querySelector(".an-full-file").click();
	assert.strictEqual(picked, 1, "Load file opens the picker");
	Object.defineProperty(input, "files", { value: ["FILE"] });
	input.onchange();
	await new Promise((r) => setTimeout(r, 0));
	assert.strictEqual(f.state.flavor, "full");
	assert.match(p.querySelector(".an-full").textContent, /loaded from this browser/);
	p.querySelector(".an-full-forget").click();
	await new Promise((r) => setTimeout(r, 0));
	assert.strictEqual(f.state.flavor, "lite");
	done();
});

test("the box shows progress, and a failure with the way round it", async () => {
	const done = withDom();
	let fail = true;
	let release;
	const { f, panel } = panelWith({
		download: async (onProgress) => {
			onProgress(52428800, 99102793);
			await new Promise((r) => (release = r));
			if (fail) throw new Error("unpkg.com answered 403");
			return "BLOB";
		},
	});
	await f.choose("full");
	const p = panel();
	p.querySelector(".an-full-get").click();
	assert.match(p.querySelector(".an-full").textContent, /50 of 95 MB/);
	assert.match(p.querySelector(".an-progress div").style.width, /^52\.9%$/);
	release();
	await new Promise((r) => setTimeout(r, 0));
	const box = p.querySelector(".an-full");
	assert.match(box.textContent, /Could not get the full engine: unpkg.com answered 403/);
	assert.strictEqual(box.querySelector("a").href, FULL.manual);
	assert.strictEqual(box.querySelector(".an-full-get").textContent, "Try again");
	fail = false;
	box.querySelector(".an-full-get").click();
	release();
	await new Promise((r) => setTimeout(r, 0));
	assert.strictEqual(f.state.flavor, "full");
	done();
});
