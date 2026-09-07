import { JSDOM } from "jsdom";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { fenMap } from "../src/pgn.js";
import { setCurrent, setRenderHooks, setSharedInfo } from "../src/state.js";

// A jsdom window installed on the globals the view modules read directly
// (`document`, `window`, `navigator`). Returns a teardown that removes them
// again so tests don't leak a detached DOM into the next file.
export function installDom(html = '<!DOCTYPE html><main id="view"></main>') {
	const dom = new JSDOM(html, { url: "http://localhost/" });
	global.window = dom.window;
	global.document = dom.window.document;
	// Node 22 defines `globalThis.navigator` as a getter-only accessor, so it
	// has to be redefined rather than assigned.
	Object.defineProperty(global, "navigator", {
		value: dom.window.navigator,
		configurable: true,
		writable: true,
	});
	return () => {
		delete global.window;
		delete global.document;
		delete global.navigator;
	};
}

// Build the `current` state object the view modules expect from a PGN string,
// tagging lines by index via `tags` (e.g. { 1: "sideline", 2: "foot" }).
// Untagged lines keep the mainline/sideline split collectLines produced.
export function loadState(pgn, { tags = {}, name = "", renderHooks = {} } = {}) {
	const { nodes } = parsePgn(pgn);
	const lines = collectLines(nodes);
	lines.forEach((l, i) => {
		if (tags[i]) l.tag = tags[i];
		l.marks = l.marks || {};
		l.meta = l.meta || {};
	});
	const state = { name, pgn, lines, sel: { ply: null, lines: null } };
	setCurrent(state);
	setRenderHooks({
		renderApp() {},
		rerenderTable() {},
		rerenderMarkup() {},
		rerenderNotes() {},
		...renderHooks,
	});
	computeShared(lines);
	return state;
}

// Mirror of app.js's private computeShared(): group moves that reach an
// identical position by the same SAN, which is what moveStrip/movePanel read
// to decide that annotating one move annotates the whole group.
function computeShared(lines) {
	const byLine = new Map();
	const idLines = new Map();
	const byFenSan = new Map();
	let next = 0;
	lines.forEach((l) => {
		const fens = fenMap(l.moves);
		const per = new Map();
		l.moves.forEach((m) => {
			const k = fens.get(m.ply) + "\u0000" + m.san;
			let id = byFenSan.get(k);
			if (!id) {
				id = "s" + ++next;
				byFenSan.set(k, id);
				idLines.set(id, []);
			}
			per.set(m.ply, id);
			const arr = idLines.get(id);
			if (!arr.includes(l)) arr.push(l);
		});
		byLine.set(l, per);
	});
	setSharedInfo({ byLine, idLines });
}

// Boot app.js against a fresh jsdom.
//
// Deliberately imports "../src/app.js" with NO cache-busting query string.
// A query string would give a fresh module instance, but V8 then tracks each
// instance as its own script and the coverage report attributes only one of
// them to src/app.js -- so a file full of cache-busted boots reports far less
// coverage than it actually exercises. Boot once per test FILE instead (the
// runner already gives each file its own process) and use `reset()` between
// scenarios, which drives the app's own "New / Import" path.
export async function bootApp({ onAlert } = {}) {
	const dom = new JSDOM('<!DOCTYPE html><main id="view"></main>', {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const alerts = [];
	global.window = dom.window;
	global.document = dom.window.document;
	global.localStorage = dom.window.localStorage;
	global.requestAnimationFrame = dom.window.requestAnimationFrame;
	global.alert = (m) => {
		alerts.push(m);
		if (onAlert) onAlert(m);
	};
	global.confirm = () => true;
	// Answers whatever the app asks for next via prompt(); `null` stands for
	// the user pressing Cancel. Defaults to echoing the prefilled value, which
	// is what pressing Enter on an untouched prompt does.
	let promptReply;
	global.prompt = (_msg, def) => (promptReply === undefined ? def : promptReply);
	const prompts = [];
	const origPrompt = global.prompt;
	global.prompt = (msg, def) => {
		prompts.push({ msg, def });
		return origPrompt(msg, def);
	};

	await import("../src/app.js");
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));

	const view = () => dom.window.document.getElementById("view");
	const buttons = (txt) =>
		[...view().querySelectorAll("button")].filter((b) => b.textContent === txt);
	const button = (txt) => buttons(txt)[0];
	const clickText = (txt) => {
		const b = [...view().querySelectorAll("button")].find((b) =>
			b.textContent.includes(txt),
		);
		if (!b) throw new Error(`no button containing "${txt}"`);
		b.click();
		return b;
	};

	// `withLoading` awaits two animation frames before rendering, so settle on
	// the overlay's absence rather than a fixed delay.
	const settle = async () => {
		const deadline = Date.now() + 5000;
		await new Promise((r) => setTimeout(r, 5));
		while (dom.window.document.getElementById("loading")) {
			if (Date.now() > deadline) throw new Error("render never settled");
			await new Promise((r) => setTimeout(r, 5));
		}
		await new Promise((r) => setTimeout(r, 5));
	};

	// Load a PGN through the import panel, leaving the app in the editor view.
	const loadPgn = async (pgn) => {
		view().querySelector("textarea.pgnin").value = pgn;
		clickText("Load");
		await settle();
	};

	// Back to the import panel, as the user would via the toolbar button.
	const reset = () => {
		alerts.length = 0;
		promptReply = undefined;
		prompts.length = 0;
		dom.window.localStorage.clear();
		const b = [...view().querySelectorAll("button")].find(
			(x) => x.textContent === "New / Import",
		);
		if (b) b.click();
	};

	return {
		dom,
		alerts,
		reset,
		view,
		button,
		buttons,
		clickText,
		settle,
		loadPgn,
		prompts,
		answerPrompt(v) {
			promptReply = v;
		},
		teardown() {
			delete global.window;
			delete global.document;
			delete global.localStorage;
			delete global.requestAnimationFrame;
			delete global.alert;
			delete global.confirm;
			delete global.prompt;
		},
	};
}

// The download path builds a Blob and clicks a synthetic <a>. Stubbing
// URL.createObjectURL is enough to observe filename, MIME type and payload
// without a real download. `doc` defaults to the ambient global `document`,
// which is what installDom() sets up; bootApp callers pass their own.
export function captureDownloads(doc = globalThis.document) {
	const seen = [];
	// download() calls the bare `URL` global, which resolves to Node's URL
	// here rather than the jsdom window's.
	const origUrl = { c: URL.createObjectURL, r: URL.revokeObjectURL };
	URL.createObjectURL = (blob) => {
		seen.push(blob);
		return "blob:stub";
	};
	URL.revokeObjectURL = () => {};
	const origCreate = doc.createElement.bind(doc);
	const anchors = [];
	doc.createElement = (tag) => {
		const node = origCreate(tag);
		if (tag === "a") {
			node.click = () => {};
			anchors.push(node);
		}
		return node;
	};
	return {
		blobs: seen,
		anchors,
		restore: () => {
			doc.createElement = origCreate;
			URL.createObjectURL = origUrl.c;
			URL.revokeObjectURL = origUrl.r;
		},
	};
}
