// src/engine.js
// A chess engine running on the viewer's own machine: Stockfish, compiled to
// WebAssembly, in a Web Worker so a search never blocks the page. Nothing is
// sent anywhere; the worker and its .wasm are served next to the app from
// vendor/stockfish/ and fetched only when the engine is first switched on.
//
// The worker speaks UCI, a line-based text protocol. This module owns the
// conversation -- the handshake, stopping one search before the next, turning
// "info ... pv e2e4 e7e5" into SAN from White's side -- and hands the view
// plain objects. The pure helpers are exported for the tests; the controller
// takes its worker from a factory so the tests can hand it a fake.

import { Chess } from "chess.js";

// One UCI "info" line, or null for one that carries no scored line (the
// engine also reports currmove, hashfull, strings and so on).
export function parseInfo(text) {
	const t = text.trim().split(/\s+/);
	if (t[0] !== "info") return null;
	const out = { multipv: 1 };
	for (let i = 1; i < t.length; i++) {
		const k = t[i];
		if (k === "depth") out.depth = +t[++i];
		else if (k === "multipv") out.multipv = +t[++i];
		else if (k === "nodes") out.nodes = +t[++i];
		else if (k === "nps") out.nps = +t[++i];
		else if (k === "score") {
			const kind = t[++i];
			const v = +t[++i];
			out.score = kind === "mate" ? { mate: v } : { cp: v };
			// a bound is an interim guess from an aspiration window, not a result
			if (t[i + 1] === "lowerbound" || t[i + 1] === "upperbound") out.bound = t[++i];
		} else if (k === "pv") {
			out.pv = t.slice(i + 1);
			break;
		}
	}
	if (!out.score || !out.pv || !out.pv.length || out.depth == null) return null;
	return out;
}

// UCI moves ("e7e8q") as SAN from `fen`, stopping at the first that is not
// legal there -- a line reported for a position the board has since left.
export function uciToSan(fen, uci) {
	const chess = new Chess(fen);
	const out = [];
	for (const u of uci) {
		try {
			const mv = chess.move({
				from: u.slice(0, 2),
				to: u.slice(2, 4),
				promotion: u[4] || undefined,
			});
			out.push({ san: mv.san, uci: u, from: mv.from, to: mv.to });
		} catch {
			break;
		}
	}
	return out;
}

// UCI scores are from the side to move. Everything the view shows is from
// White's side, the way an eval bar and a printed "+0.3" are read.
export function whiteScore(score, turn) {
	if (turn === "w") return { ...score };
	return score.mate != null ? { mate: -score.mate } : { cp: -score.cp };
}

export function formatScore(score) {
	if (score.mate != null) {
		if (score.mate === 0) return "#";
		return (score.mate > 0 ? "#" : "#-") + Math.abs(score.mate);
	}
	const p = score.cp / 100;
	return (p > 0 ? "+" : p < 0 ? "−" : "") + Math.abs(p).toFixed(2);
}

// White's share of the eval bar, 0..1. The same logistic curve lichess uses
// for win chances, so +1 is a clear edge and +5 is nearly the whole bar
// without a pawn up ever reading as a won game.
export function whiteShare(score) {
	if (score.mate != null) return score.mate > 0 ? 1 : 0;
	const cp = Math.max(-1000, Math.min(1000, score.cp));
	return 1 / (1 + Math.exp(-0.00368208 * cp));
}

// Numbered SAN starting mid-game: "12...Nf6 13.Bg5" from a black-to-move FEN.
export function numberedFrom(fen, sans) {
	const [, turn, , , , full] = fen.split(" ");
	let n = +full || 1;
	let black = turn === "b";
	return sans.map((san, i) => {
		let s = san;
		if (!black) s = `${n}.${san}`;
		else if (i === 0) s = `${n}...${san}`;
		if (black) n++;
		black = !black;
		return s;
	});
}

// depth 0 means "until stopped". Hash is in MB; 64 is roomy for analysis
// and small beside the engine itself.
const DEFAULTS = { multiPv: 3, depth: 22, throttle: 120, hash: 64, cacheSize: 2000 };

// The controller the view talks to. `makeWorker` returns something with
// postMessage / onmessage / onerror / terminate -- a real Worker in the app.
//
// It keeps one search at a time. A new position while a search runs sends
// "stop" and waits for that search's "bestmove" before starting the next, so
// the tail of the old search's output can never be read as the new one's.
//
// Nothing a search finds is thrown away. Two layers keep it:
// - Stockfish's own hash table survives between searches (no "ucinewgame"
//   is ever sent), so going back to a position re-searches it through the
//   depths it already reached in a fraction of the time.
// - Our cache keeps the best result shown for every position, by FEN. Going
//   back shows it at once, the new search's output is held back until it
//   gets deeper than that, and a position searched to the target depth is
//   not searched again at all.
export function createEngine(makeWorker, opts = {}) {
	const o = { ...DEFAULTS, ...opts };
	let worker = null;
	let ready = false;
	let searching = false; // a "go" is out and its bestmove is not yet back
	let stopping = false; // ... and we have asked it to stop
	let searchFen = null; // what the running search is on
	let wanted = null; // what should be searched next (or now)
	let timer = null;
	let override = null; // a one-off depth for the next search ("deeper")
	let floor = 0; // the depth the cache already had when this search began
	const cache = new Map(); // fen -> { depth, lines, complete }
	const remember = (fen, complete) => {
		cache.delete(fen); // re-inserted last, so the oldest entry is the first
		cache.set(fen, { depth: state.depth, lines: state.lines.slice(), complete });
		if (cache.size > o.cacheSize) cache.delete(cache.keys().next().value);
	};
	const state = { enabled: false, status: "off", fen: null, lines: [], depth: 0, error: null, nps: 0 };
	let listener = () => {};

	const emitNow = () => {
		timer = null;
		listener(state);
	};
	const emit = (urgent) => {
		if (urgent || !o.throttle) {
			if (timer) clearTimeout(timer);
			emitNow();
		} else if (!timer) timer = setTimeout(emitNow, o.throttle);
	};
	const send = (cmd) => worker.postMessage(cmd);

	function boot() {
		state.status = "loading";
		state.error = null;
		try {
			worker = makeWorker();
		} catch (e) {
			fail(e);
			return;
		}
		worker.onmessage = (e) => receive(String(e.data ?? e));
		worker.onerror = (e) => fail(e);
		send("uci");
	}

	function fail(e) {
		state.status = "error";
		state.error = (e && (e.message || e.type)) || "The engine could not be started.";
		if (worker) worker.terminate();
		worker = null;
		wanted = null; // so asking for the same position again retries
		ready = searching = stopping = false;
		emit(true);
	}

	function receive(line) {
		if (line === "uciok") {
			send(`setoption name Hash value ${o.hash}`);
			send(`setoption name MultiPV value ${o.multiPv}`);
			send("isready");
		} else if (line === "readyok") {
			ready = true;
			next();
		} else if (line.startsWith("bestmove")) {
			// a search that ran to its depth is finished for good; one that was
			// stopped keeps what it reached, and a later visit goes on from there
			const stopped = stopping;
			if (!stopped && state.lines.length) remember(searchFen, true);
			searching = false;
			stopping = false;
			// after a stop, whatever is wanted now is searched -- even the same
			// position again, which is how a depth change restarts one
			if (wanted && (stopped || wanted !== searchFen)) next();
			else if (state.enabled) {
				state.status = "done";
				emit(true);
			}
		} else if (searching && !stopping && line.startsWith("info")) {
			const info = parseInfo(line);
			if (!info || info.bound || info.depth <= floor) return;
			const turn = searchFen.split(" ")[1];
			const moves = uciToSan(searchFen, info.pv);
			if (!moves.length) return;
			// a new depth restarts the list, so lines from different depths
			// are never shown side by side as if they were comparable
			if (info.multipv === 1 && info.depth > state.depth) {
				state.lines = state.lines.slice(0, 1);
			}
			state.depth = Math.max(state.depth, info.depth);
			if (info.nps) state.nps = info.nps;
			state.lines[info.multipv - 1] = {
				depth: info.depth,
				score: whiteScore(info.score, turn),
				moves,
			};
			remember(searchFen, false);
			emit(false);
		}
	}

	function next() {
		if (!ready || !state.enabled || !wanted) return;
		if (searching) {
			if (!stopping) {
				stopping = true;
				send("stop");
			}
			return;
		}
		searchFen = wanted;
		state.fen = wanted;
		const hit = cache.get(wanted);
		state.lines = hit ? hit.lines.slice() : [];
		state.depth = floor = hit ? hit.depth : 0;
		// a finished game has nothing to search, and the engine reports it in
		// ways ("bestmove (none)") that are easier not to provoke
		if (new Chess(wanted).moves().length === 0) {
			state.status = "over";
			emit(true);
			return;
		}
		const depth = override ?? o.depth;
		override = null;
		// already as deep as asked for (or deeper): show it, search nothing
		if (hit && depth && hit.depth >= depth && (hit.complete || hit.lines.length >= o.multiPv)) {
			state.status = "done";
			emit(true);
			return;
		}
		state.status = "searching";
		searching = true;
		send("position fen " + wanted);
		send(depth ? `go depth ${depth}` : "go infinite");
		emit(true);
	}

	return {
		state,
		set onUpdate(fn) {
			listener = fn || (() => {});
		},
		// Ask for `fen` to be analysed. Asking again for the position already
		// searched or being searched is a no-op, which is what lets the view
		// call this on every redraw.
		analyse(fen) {
			if (!state.enabled || fen === wanted) return;
			wanted = fen;
			override = null;
			if (!worker) boot();
			else next();
		},
		enable(on = true) {
			state.enabled = on;
			if (!on) {
				if (searching && !stopping) {
					stopping = true;
					send("stop");
				}
				wanted = null;
				state.status = "off";
				state.lines = [];
				state.depth = 0;
				emit(true);
			} else if (state.status === "off" || state.status === "error") {
				state.status = "idle";
			}
		},
		// Pause without forgetting the switch: the board went away. The search
		// being stopped is forgotten too, so asking for the same position again
		// starts a fresh search once the stop has landed.
		pause() {
			if (searching && !stopping) {
				stopping = true;
				send("stop");
			}
			searchFen = null;
			wanted = null;
		},
		// More lines changes what a result is, so the cache starts over; the
		// engine's hash table still makes the re-search quick.
		setMultiPv(n) {
			if (n === o.multiPv) return;
			o.multiPv = n;
			cache.clear();
			const fen = wanted;
			this.pause();
			if (worker) send(`setoption name MultiPV value ${n}`);
			if (fen) this.analyse(fen);
		},
		get multiPv() {
			return o.multiPv;
		},
		// Deeper picks up where the cache left off; shallower is answered from
		// the cache, which is already at least that deep.
		setDepth(d) {
			if (d === o.depth) return;
			o.depth = d;
			const fen = wanted;
			this.pause();
			if (fen) this.analyse(fen);
		},
		get depth() {
			return o.depth;
		},
		// Keep searching this position past the depth setting, until it moves.
		deeper() {
			if (!state.fen || !state.enabled || !worker) return;
			const fen = state.fen;
			this.pause();
			wanted = fen;
			override = 0;
			next();
		},
		// Run a different build (lite or full). Its results are not the old
		// one's, so the cache starts over; the position being analysed, if
		// any, is picked up by the new engine.
		swap(factory) {
			const fen = wanted;
			this.quit();
			makeWorker = factory;
			cache.clear();
			state.lines = [];
			state.depth = 0;
			wanted = null;
			if (state.enabled) {
				state.status = "idle";
				if (fen) this.analyse(fen);
			}
		},
		quit() {
			if (worker) {
				send("quit");
				worker.terminate();
			}
			worker = null;
			ready = searching = stopping = false;
		},
	};
}

// The app's engine: one per page, created on first use, running the lite
// build until the full one is chosen. Worker paths are resolved against this
// module, so they hold wherever the site is hosted.
const script = (name) => new URL(`../vendor/stockfish/${name}`, import.meta.url);
export const liteWorker = () => new Worker(script("stockfish-19-lite-single.js"));
// The full build's .wasm comes from browser storage, handed over by URL in
// the loader's hash (the loader reads it from there).
export const fullWorker = (wasmUrl) => () =>
	new Worker(script("stockfish-19-single.js") + "#" + encodeURIComponent(wasmUrl));

let shared = null;
export function sharedEngine() {
	if (!shared) shared = createEngine(liteWorker);
	return shared;
}
