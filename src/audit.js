// src/audit.js
// The repertoire audit: every position in the workbook searched once by the
// engine, in the background, and every move judged by what it does to the
// eval. Lines share their opening moves, so the work is counted in unique
// positions (a transposition is one position too), not in moves along lines:
// an 800-line workbook of 36,000 moves is about 15,700 positions.
//
// The audit has engines of its own, apart from the board's (engine.js
// sharedEngine), so the board and the study stay usable while it runs. They
// are single-threaded lite builds, several side by side: positions are
// independent of each other, and N engines each on one position went 3.5
// times faster than one engine on N threads (timed in Chromium, 2026-10-05;
// threads share a search, which is what one deep position needs, not this).
//
// Every position is searched to the same depth, so one move's eval can be
// set against the next. What it finds is kept by position while the workbook
// is open, so a second run after an edit searches only the positions that
// are new, and it is saved in the workbook (packEvals). Another workbook
// starts from nothing (reset): it shows only its own audit, even where it
// shares positions with the last one.
//
// The report is a pure function of the lines and the evals: drawn from the
// workbook as it stands, it never shows a line the workbook no longer has.

import { Chess } from "chess.js";
import { fenMap } from "./pgn.js";
import { liteWorker, parseInfo, uciToSan, whiteScore, whiteShare } from "./engine.js";

// Any depth the viewer types, within these. Past 40 a lite search of a single
// position runs to minutes, which over a workbook is days.
export const MIN_DEPTH = 1;
export const MAX_DEPTH = 40;
const DEFAULT_DEPTH = 16;

const START = new Chess().fen();

// A position without the move counters: two lines reaching the same position
// by different move orders reach the same key.
export const posKey = (fen) => fen.split(" ").slice(0, 4).join(" ");
const START_KEY = posKey(START);

// A line's positions as [key, fen] pairs, the start first, so each entry
// after the first is the position after that move. Kept per moves array: the
// report is drawn again and again while a run goes on, and walking 36,000
// moves each time was most of half a second on an 800-line workbook.
const walks = new WeakMap();
function walk(moves) {
	const had = walks.get(moves);
	if (had && had.length === moves.length + 1) return had;
	const fens = fenMap(moves);
	const out = [[START_KEY, START], ...moves.map((m) => [posKey(fens.get(m.ply)), fens.get(m.ply)])];
	walks.set(moves, out);
	return out;
}

// Every position the lines pass through, the start included, each once, in
// the order they are first reached by ply -- the moves every line shares are
// searched first, so the report fills in from the top of the tree down.
export function auditPositions(lines) {
	const seen = new Map(); // key -> { fen, ply }
	for (const l of lines) {
		walk(l.moves).forEach(([k, fen], i) => {
			const had = seen.get(k);
			if (!had) seen.set(k, { fen, ply: i });
			else if (i < had.ply) had.ply = i;
		});
	}
	if (!seen.size) seen.set(START_KEY, { fen: START, ply: 0 });
	return new Map([...seen].sort((a, b) => a[1].ply - b[1].ply).map(([k, v]) => [k, v.fen]));
}

// A finished game is judged without the engine: mate is all or nothing and
// stalemate is level, which "go" on such a position reports in ways that are
// easier not to provoke.
export function overEval(fen) {
	const chess = new Chess(fen);
	if (chess.moves().length) return null;
	return chess.isCheckmate()
		? { depth: Infinity, score: { mate: 0 }, best: null, mated: chess.turn() }
		: { depth: Infinity, score: { cp: 0 }, best: null };
}

// White's share of the win chances (engine.js whiteShare). A mate already on
// the board belongs to whoever is not mated, which { mate: 0 } cannot say.
export const shareOf = (ev) => (ev.mated ? (ev.mated === "w" ? 0 : 1) : whiteShare(ev.score));

// The engine's move as SAN, worked out once per eval.
const sans = new WeakMap();
function bestSan(ev, fen) {
	if (!ev.best) return null;
	if (!sans.has(ev)) sans.set(ev, uciToSan(fen, [ev.best])[0]?.san || null);
	return sans.get(ev);
}

// How much of the mover's share of the win chances a move gave away, graded on
// lichess's thresholds (0.1 / 0.2 / 0.3 of winning chances on a -1..1 scale,
// which is half that of a 0..1 share).
export const GRADES = [
	{ id: "blunder", min: 0.15, sym: "??", label: "Blunder", plural: "blunders" },
	{ id: "mistake", min: 0.1, sym: "?", label: "Mistake", plural: "mistakes" },
	{ id: "inaccuracy", min: 0.05, sym: "?!", label: "Inaccuracy", plural: "inaccuracies" },
];
export const gradeOf = (loss) => GRADES.find((g) => loss >= g.min) || null;

// The report over the workbook's lines, in `order` (the table's column order,
// which is how lines are numbered everywhere). A move several lines share is
// one finding that names all of them. Evals searched shallower than `depth`
// count as not yet searched: a run at a new depth starts the report over.
// `side` ("white", "black" or "both") is whose moves are judged: the
// opponent's slips are theirs to make, not a flaw in the repertoire.
export function auditReport(lines, evals, depth, order = lines, side = "both") {
	const rank = new Map(order.map((l, i) => [l, i]));
	const ordered = [...lines].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
	const at = (k) => {
		const ev = evals.get(k);
		return ev && ev.depth >= depth ? ev : null;
	};
	const positions = auditPositions(lines);
	let done = 0;
	for (const k of positions.keys()) if (at(k)) done++;
	const found = new Map(); // before-key + SAN -> finding
	const ends = [];
	for (const l of ordered) {
		const steps = walk(l.moves);
		l.moves.forEach((m, i) => {
			const [kb, fenBefore] = steps[i];
			const a = at(kb);
			const b = at(steps[i + 1][0]);
			if (!a || !b || m.san === "--") return;
			const white = fenBefore.split(" ")[1] === "w";
			if (side !== "both" && white !== (side === "white")) return;
			const loss = white ? shareOf(a) - shareOf(b) : shareOf(b) - shareOf(a);
			const grade = gradeOf(loss);
			if (!grade) return;
			const best = bestSan(a, fenBefore);
			// the engine's own choice is not a mistake, whatever one ply more
			// of search makes of it
			if (!best || best === m.san) return;
			const key = kb + " " + m.san;
			const hit = found.get(key);
			if (hit) {
				hit.plies.push(m.ply);
				return hit.lines.push(l);
			}
			found.set(key, {
				key,
				ply: m.ply,
				san: m.san,
				white,
				grade,
				loss,
				best,
				before: a.score,
				after: b.score,
				// the moves to the position the move was played from
				moves: l.moves.slice(0, i),
				lines: [l],
				// the move's ply on each of `lines`: a transposition reaches the
				// same move at a ply of its own
				plies: [m.ply],
			});
		});
		const end = at(steps[steps.length - 1][0]);
		ends.push({ line: l, score: end ? end.score : null, mated: end?.mated || null });
	}
	const severity = (f) => GRADES.indexOf(f.grade);
	const findings = [...found.values()].sort(
		(x, y) => severity(x) - severity(y) || rank.get(x.lines[0]) - rank.get(y.lines[0]) || x.ply - y.ply,
	);
	return { total: positions.size, done, findings, ends };
}

// The eval after each move of `moves`, by ply, where it is searched to
// `depth`: what the table shows under each move once the audit has been.
export function evalsAlong(moves, evals, depth) {
	const steps = walk(moves);
	const out = new Map();
	moves.forEach((m, i) => {
		const ev = evals.get(steps[i + 1][0]);
		if (ev && ev.depth >= depth) out.set(m.ply, ev);
	});
	return out;
}

// The assessment glyph an eval suggests, White's view: within a third of a
// pawn is level, under a pawn slightly better, under two clearly better,
// and past that winning. A mate either way is winning.
export function assessOf(score, mated = null) {
	if (mated) return mated === "w" ? "−+" : "+−";
	if (score.mate != null) return score.mate > 0 ? "+−" : "−+";
	const p = Math.abs(score.cp);
	const w = score.cp > 0;
	if (p < 35) return "=";
	if (p < 90) return w ? "⩲" : "⩱";
	if (p < 200) return w ? "±" : "∓";
	return w ? "+−" : "−+";
}

// What the audit found, as a workbook carries it (store.js): the evals of
// the workbook's own positions, per build, so they go wherever the workbook
// goes -- a file, another browser, another device. Each is [depth, score, best]: the score a number of
// centipawns or "#n" for a mate, White's view. A finished game is left out;
// it is judged again without the engine (overEval), and its depth of
// Infinity is not JSON. Null when there is nothing to carry.
export function packEvals(maps, positions) {
	const out = {};
	for (const [flavor, map] of Object.entries(maps)) {
		const got = {};
		let any = false;
		for (const k of positions.keys()) {
			const ev = map.get(k);
			if (!ev || !Number.isFinite(ev.depth)) continue;
			got[k] = [ev.depth, ev.score.mate != null ? "#" + ev.score.mate : ev.score.cp, ev.best ?? null];
			any = true;
		}
		if (any) out[flavor] = got;
	}
	return Object.keys(out).length ? out : null;
}

// The other way: { lite: Map, full: Map } of evals. A workbook can be edited
// by hand, so an entry that is not one is dropped rather than shown.
export function unpackEvals(packed) {
	const out = { lite: new Map(), full: new Map() };
	if (!packed || typeof packed !== "object") return out;
	for (const flavor of Object.keys(out)) {
		const got = packed[flavor];
		if (!got || typeof got !== "object") continue;
		for (const [k, e] of Object.entries(got)) {
			if (!Array.isArray(e)) continue;
			const [depth, s, best] = e;
			if (!Number.isInteger(depth) || depth < 1) continue;
			let score;
			if (typeof s === "number" && Number.isFinite(s)) score = { cp: s };
			else if (typeof s === "string" && /^#-?\d+$/.test(s)) score = { mate: +s.slice(1) };
			else continue;
			out[flavor].set(k, { depth, score, best: typeof best === "string" ? best : null });
		}
	}
	return out;
}

// How many engines the audit can run: one per logical core, which is the
// most that run at once.
export const maxAuditWorkers = (g = globalThis) => Math.max(1, Math.floor(g.navigator?.hardwareConcurrency) || 2);

// How many it runs: the viewer's own choice if it still fits this machine,
// otherwise one per core but one (left for the page), and no more than four
// -- each engine is its own copy of Stockfish in memory, which a phone feels.
export function auditWorkers(saved = null, g = globalThis) {
	const max = maxAuditWorkers(g);
	if (Number.isInteger(saved) && saved >= 1) return Math.min(saved, max);
	return Math.max(1, Math.min(4, max - 1));
}

// The audit's controller. `makeWorker` returns something with postMessage /
// onmessage / onerror / terminate, as for engine.js createEngine.
//
// The engines are started for a run and shut when it ends, so an audit that
// is not running holds no memory and no cores.
export function createAudit({
	makeWorker = liteWorker,
	workers = auditWorkers(),
	throttle = 1000,
	now = () => Date.now(),
} = {}) {
	// key -> { depth, score, best, mated? }, one map per build: the full
	// engine's evals are not the lite one's, and neither stands in for the other
	const evalsBy = { lite: new Map(), full: new Map() };
	const state = {
		status: "idle",
		depth: DEFAULT_DEPTH,
		flavor: "lite",
		queued: 0,
		searched: 0,
		error: null,
		startedAt: 0,
		source: null,
	};
	const ev = () => evalsBy[state.flavor];
	let queue = []; // [key, fen], next first
	let pool = [];
	let run = 0; // which run a worker's answer belongs to
	let listener = () => {};
	let timer = null;

	const emitNow = () => {
		timer = null;
		listener(state);
	};
	const emit = (urgent) => {
		if (urgent || !throttle) {
			if (timer) clearTimeout(timer);
			emitNow();
		} else if (!timer) timer = setTimeout(emitNow, throttle);
	};
	const known = (k) => {
		const e = ev().get(k);
		return e && e.depth >= state.depth;
	};

	function finish(status, error = null) {
		run++;
		pool.forEach((w) => {
			w.postMessage("quit");
			w.terminate();
		});
		pool = [];
		queue = [];
		state.status = status;
		state.error = error;
		state.queued = 0;
		emit(true);
	}

	// One engine: the handshake, then a position at a time off the shared
	// queue until it is empty.
	function spawn(id) {
		let w;
		try {
			w = makeWorker();
		} catch (e) {
			return finish("error", e?.message || "The engine could not be started.");
		}
		pool.push(w);
		let key = null;
		let fen = null;
		let score = null;
		const take = () => {
			// a finished game is judged here, not searched; here rather than when
			// queued, where checking 15,000 positions at once held the page up
			// for most of a second
			let next;
			while ((next = queue.shift())) {
				const over = overEval(next[1]);
				if (!over) break;
				ev().set(next[0], over);
			}
			state.queued = queue.length;
			if (!next) {
				key = null;
				// the last engine to go quiet ends the run
				if (pool.every((p) => p.busy === false)) finish("done");
				return;
			}
			[key, fen] = next;
			score = null;
			w.busy = true;
			w.postMessage("position fen " + fen);
			w.postMessage("go depth " + state.depth);
		};
		w.onmessage = (e) => {
			if (id !== run) return;
			const line = String(e.data ?? e);
			if (line === "uciok") {
				// small: a search to depth 12-16 fills little of it, and there
				// are several engines
				w.postMessage("setoption name Hash value 16");
				w.postMessage("isready");
			} else if (line === "readyok") {
				w.busy = false;
				take();
			} else if (line.startsWith("info") && key) {
				const info = parseInfo(line);
				if (info && !info.bound && info.multipv === 1) score = info.score;
			} else if (line.startsWith("bestmove") && key) {
				const best = line.split(/\s+/)[1];
				w.busy = false;
				if (score) {
					const found = { depth: state.depth, score: whiteScore(score, fen.split(" ")[1]), best };
					ev().set(key, found);
					state.searched++;
					emit(false);
				}
				take();
			}
		};
		w.onerror = (e) => {
			if (id === run) finish("error", (e && (e.message || e.type)) || "The engine stopped.");
		};
		w.postMessage("uci");
	}

	// Queue what is not known yet at this depth.
	function enqueue(positions) {
		const have = new Set(queue.map(([k]) => k));
		for (const [k, fen] of positions) if (!known(k) && !have.has(k)) queue.push([k, fen]);
		state.queued = queue.length;
	}

	function begin(positions, depth, source, engines) {
		workers = engines;
		Object.assign(state, { depth, source, searched: 0, startedAt: now(), error: null });
		enqueue(positions);
		if (!queue.length) {
			state.status = "done";
			emit(true);
			return;
		}
		state.status = "running";
		run++;
		const n = Math.min(workers, queue.length);
		for (let i = 0; i < n && state.status === "running"; i++) spawn(run);
		emit(true);
	}

	return {
		state,
		// what is known for the build chosen
		get evals() {
			return ev();
		},
		set onUpdate(fn) {
			listener = fn || (() => {});
		},
		// Every build's evals, as packEvals takes them.
		get all() {
			return evalsBy;
		},
		// Evals a workbook brought with it (unpackEvals): a deeper one than
		// is known replaces it.
		absorb(maps) {
			for (const [flavor, map] of Object.entries(maps)) {
				const into = evalsBy[flavor];
				if (!into) continue;
				map.forEach((e, k) => {
					const had = into.get(k);
					if (!had || had.depth < e.depth) into.set(k, e);
				});
			}
			emit(true);
		},
		// Another workbook: nothing found, nothing running. What the last one
		// found is not this one's, even where they share positions.
		reset() {
			if (state.status === "running") finish("stopped");
			evalsBy.lite.clear();
			evalsBy.full.clear();
			Object.assign(state, { status: "idle", searched: 0, error: null, source: null });
			emit(true);
		},
		// Search every position of `positions` (auditPositions) not yet known at
		// `depth`. `source` is what the run is for (the workbook), so the view
		// can tell a run for a workbook since closed.
		start(
			positions,
			{ depth = state.depth, source = null, engines = workers, flavor = state.flavor, factory = makeWorker } = {},
		) {
			if (state.status === "running") finish("stopped");
			state.flavor = flavor;
			makeWorker = factory;
			begin(positions, depth, source, engines);
		},
		get workers() {
			return workers;
		},
		// Show another build's evals; a run of the old one is stopped.
		setFlavor(f) {
			if (f === state.flavor) return;
			if (state.status === "running") finish("stopped");
			state.flavor = f;
		},
		// Lines added while it runs: their new positions join the queue.
		add(positions) {
			if (state.status === "running") enqueue(positions);
		},
		stop() {
			if (state.status === "running") finish("stopped");
		},
		// A rough time to go from the pace so far, in ms; null before there
		// is a pace to go on.
		remaining() {
			if (state.status !== "running" || state.searched < 4) return null;
			const busy = pool.filter((w) => w.busy).length;
			return ((now() - state.startedAt) / state.searched) * (state.queued + busy);
		},
	};
}

// The app's audit: one per page, created on first use.
let shared = null;
export function sharedAudit() {
	if (!shared) shared = createAudit();
	return shared;
}
