// tests/audit.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { Chess } from "chess.js";
import {
	assessOf,
	auditPositions,
	auditReport,
	evalsAlong,
	auditWorkers,
	maxAuditWorkers,
	createAudit,
	gradeOf,
	overEval,
	posKey,
	shareOf,
} from "../src/audit.js";
import { evalStore } from "../src/audit-store.js";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";

const linesOf = (pgn) => collectLines(parsePgn(pgn).nodes);
const fenAfter = (sans) => {
	const c = new Chess();
	sans.forEach((s) => c.move(s));
	return c.fen();
};
const keyAfter = (sans) => posKey(fenAfter(sans));
const START = new Chess().fen();
const MATED = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
const STALE = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
});

test("a position's key leaves out the move counters", () => {
	assert.strictEqual(posKey(START), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
});

test("each position is listed once, shared moves and transpositions included, shallowest first", () => {
	// 1.d4 Nf6 2.c4 e6 and 1.c4 e6 2.d4 Nf6 meet after move 2
	const lines = linesOf("1. d4 Nf6 (1... e6 2. c4 Nf6) 2. c4 e6 (2... g6) *");
	const pos = auditPositions(lines);
	assert.strictEqual([...pos.keys()][0], posKey(START));
	assert.ok(pos.has(keyAfter(["d4", "Nf6", "c4", "e6"])));
	// start, d4, d4 Nf6, d4 Nf6 c4, (e6 | g6), d4 e6, d4 e6 c4 -- and d4 e6 c4 Nf6
	// is the same position as d4 Nf6 c4 e6
	assert.strictEqual(pos.size, 8);
	assert.deepStrictEqual([...auditPositions([]).keys()], [posKey(START)], "an empty workbook is the start");
});

test("a finished game is judged without the engine", () => {
	assert.strictEqual(overEval(START), null);
	const mate = overEval(MATED);
	assert.strictEqual(mate.mated, "w");
	assert.strictEqual(shareOf(mate), 0, "White is mated: no share for White");
	assert.strictEqual(shareOf({ ...mate, mated: "b" }), 1);
	assert.deepStrictEqual(overEval(STALE).score, { cp: 0 });
	assert.strictEqual(shareOf(overEval(STALE)), 0.5);
});

test("moves are graded on the share of the win chances they give away", () => {
	assert.strictEqual(gradeOf(0.04), null);
	assert.strictEqual(gradeOf(0.05).id, "inaccuracy");
	assert.strictEqual(gradeOf(0.12).id, "mistake");
	assert.strictEqual(gradeOf(0.4).id, "blunder");
});

// evals for positions reached by move lists: [sans, cp from White's side, best uci]
const evalsOf = (rows, depth = 12) =>
	new Map(rows.map(([sans, cp, best]) => [keyAfter(sans), { depth, score: { cp }, best }]));

test("the report finds the moves that lose ground, once per position, naming every line through them", () => {
	const lines = linesOf("1. e4 e5 2. Nf3 (2. Qh5 Nc6) Nc6 *");
	const [main, side] = lines;
	main.name = "Mainline";
	side.name = "Line 1";
	const evals = evalsOf([
		[[], 30, "e2e4"],
		[["e4"], 30, "e7e5"],
		[["e4", "e5"], 35, "g1f3"],
		[["e4", "e5", "Nf3"], 30, "b8c6"],
		[["e4", "e5", "Nf3", "Nc6"], 30, "f1b5"],
		// 2.Qh5 gives away about a pawn and a half
		[["e4", "e5", "Qh5"], -150, "b8c6"],
		[["e4", "e5", "Qh5", "Nc6"], -140, "f1c4"],
	]);
	const r = auditReport(lines, evals, 12, [side, main]);
	assert.strictEqual(r.total, 7);
	assert.strictEqual(r.done, 7);
	assert.strictEqual(r.findings.length, 1);
	const f = r.findings[0];
	assert.strictEqual(f.san, "Qh5");
	assert.strictEqual(f.ply, 2);
	assert.strictEqual(f.white, true);
	assert.strictEqual(f.grade.id, "blunder");
	assert.strictEqual(f.best, "Nf3");
	assert.deepStrictEqual(
		f.moves.map((m) => m.san),
		["e4", "e5"],
		"the moves to the position it was played from",
	);
	assert.deepStrictEqual(f.before, { cp: 35 });
	assert.deepStrictEqual(f.after, { cp: -150 });
	assert.deepStrictEqual(f.lines, [side]);
	// line ends, in the order given (the table's column order)
	assert.deepStrictEqual(
		r.ends.map((e) => [e.line, e.score]),
		[
			[side, { cp: -140 }],
			[main, { cp: 30 }],
		],
	);
});

test("a move two lines share is one finding, with both lines in column order", () => {
	const lines = linesOf("1. e4 f6 2. d4 (2. Nf3 g5) g5 *");
	const evals = evalsOf([
		[[], 30, "e2e4"],
		[["e4"], 30, "e7e5"],
		[["e4", "f6"], 120, "d2d4"],
		[["e4", "f6", "d4"], 120, "e7e5"],
		[["e4", "f6", "d4", "g5"], 600, "d1h5"],
		[["e4", "f6", "Nf3"], 100, "e7e5"],
		[["e4", "f6", "Nf3", "g5"], 400, "h2h4"],
	]);
	const r = auditReport(lines, evals, 12);
	const f6 = r.findings.find((f) => f.san === "f6");
	assert.deepStrictEqual(f6.lines, lines, "both lines play 1...f6");
	assert.strictEqual(f6.white, false);
	assert.strictEqual(f6.best, "e5");
	assert.deepStrictEqual(f6.plies, [1, 1], "the move's ply on each line");
	// blunders first, then by line, then by move
	assert.deepStrictEqual(
		r.findings.map((f) => f.san),
		["g5", "g5", "f6"],
	);
});

test("the engine's own move is never a finding, and shallower or missing evals do not count", () => {
	const lines = linesOf("1. e4 e5 *");
	const evals = evalsOf([
		[[], 30, "e2e4"],
		[["e4"], -200, "e7e5"],
	]);
	evals.set(keyAfter(["e4", "e5"]), { depth: 10, score: { cp: 30 }, best: "g1f3" });
	let r = auditReport(lines, evals, 12);
	assert.strictEqual(r.findings.length, 0, "1.e4 was the engine's move, however it scored after");
	assert.strictEqual(r.done, 2, "the depth-10 eval does not count at depth 12");
	assert.strictEqual(r.ends[0].score, null);
	r = auditReport(lines, evals, 10);
	assert.strictEqual(r.done, 3, "a deeper eval counts at a shallower depth");
});

test("null moves are not judged, and a mated line end reads as mate", () => {
	const lines = linesOf("1. f3 e5 2. g4 Qh4# *");
	const evals = evalsOf([
		[[], 30, "e2e4"],
		[["f3"], -60, "e7e5"],
		[["f3", "e5"], -70, "e2e4"],
		[["f3", "e5", "g4"], -10000, "d8h4"],
	]);
	evals.set(posKey(MATED), overEval(MATED));
	const r = auditReport(lines, evals, 12);
	assert.strictEqual(r.ends[0].mated, "w");
	assert.ok(r.findings.some((f) => f.san === "g4" && f.grade.id === "blunder"));

	const nul = linesOf("1. e4 -- 2. d4 *");
	const ev2 = evalsOf([
		[[], 30, "e2e4"],
		[["e4"], 30, "e7e5"],
		[["e4", "--"], 900, "d2d4"],
		[["e4", "--", "d4"], 900, "e7e5"],
	]);
	assert.strictEqual(auditReport(nul, ev2, 12).findings.length, 0);
});

test("the audit runs one engine per core but one, up to four, unless the viewer picks", () => {
	const cores = (n) => ({ navigator: { hardwareConcurrency: n } });
	assert.strictEqual(auditWorkers(null, cores(8)), 4);
	assert.strictEqual(auditWorkers(null, cores(4)), 3);
	assert.strictEqual(auditWorkers(null, cores(1)), 1);
	assert.strictEqual(auditWorkers(null, {}), 1);
	assert.strictEqual(auditWorkers(11, cores(12)), 11, "any count up to the cores");
	assert.strictEqual(auditWorkers(16, cores(12)), 12, "but no more than there are");
	assert.strictEqual(maxAuditWorkers(cores(12)), 12);
});

// A UCI engine that scores positions from a table (cp from White's side,
// by key) and answers on a later tick, as a worker does.
function fakeEngines(table = new Map(), { fail = false } = {}) {
	const made = [];
	const make = () => {
		if (fail === "throw") throw new Error("no workers here");
		const w = {
			sent: [],
			terminated: false,
			onmessage: null,
			onerror: null,
			fen: null,
			postMessage(cmd) {
				this.sent.push(cmd);
				const say = (...lines) => setTimeout(() => !w.terminated && lines.forEach((l) => w.onmessage({ data: l })));
				if (cmd === "uci") {
					if (fail === "boot") setTimeout(() => w.onerror({ message: "wasm failed" }));
					else say("id name Fake", "uciok");
				} else if (cmd === "isready") say("readyok");
				else if (cmd.startsWith("position fen ")) w.fen = cmd.slice(13);
				else if (cmd.startsWith("go depth")) {
					const cp = table.get(posKey(w.fen)) ?? 0;
					const stm = w.fen.split(" ")[1] === "w" ? cp : -cp;
					const best = new Chess(w.fen).moves({ verbose: true })[0].lan;
					say(
						"info depth 5 score cp 1 lowerbound pv " + best,
						`info depth 12 multipv 1 score cp ${stm} nodes 10 pv ${best}`,
						"bestmove " + best,
					);
				}
			},
			terminate() {
				this.terminated = true;
			},
		};
		made.push(w);
		return w;
	};
	return { make, made };
}

const settled = (audit) =>
	new Promise((resolve) => {
		const check = () => (audit.state.status === "running" ? setTimeout(check, 2) : resolve());
		check();
	});

test("a run searches each position once over several engines, and ends by shutting them", async () => {
	const lines = linesOf("1. e4 e5 2. Nf3 (2. Bc4 Nf6) Nc6 *");
	const pos = auditPositions(lines);
	const { make, made } = fakeEngines(new Map([[keyAfter(["e4"]), 40]]));
	const updates = [];
	const audit = createAudit({ makeWorker: make, workers: 3, throttle: 0 });
	audit.onUpdate = (s) => updates.push(s.status);
	await audit.start(pos, { depth: 12, source: "wb" });
	assert.strictEqual(audit.state.status, "running");
	assert.strictEqual(audit.state.source, "wb");
	assert.strictEqual(made.length, 3);
	await settled(audit);
	assert.strictEqual(audit.state.status, "done");
	assert.strictEqual(audit.state.searched, pos.size);
	assert.strictEqual(audit.evals.size, pos.size);
	assert.deepStrictEqual(audit.evals.get(keyAfter(["e4"])).score, { cp: 40 }, "turned to White's side");
	assert.ok(made.every((w) => w.terminated && w.sent.includes("quit")));
	const gos = made.flatMap((w) => w.sent.filter((c) => c.startsWith("go")));
	assert.strictEqual(gos.length, pos.size, "no position searched twice");
	assert.ok(gos.every((g) => g === "go depth 12"));
	assert.ok(made.every((w) => w.sent.includes("setoption name Hash value 16")));
	assert.strictEqual(updates.at(-1), "done");
	assert.strictEqual(audit.remaining(), null);

	// all known: a second run has nothing to do and starts no engine
	await audit.start(pos, { depth: 12 });
	assert.strictEqual(audit.state.status, "done");
	assert.strictEqual(made.length, 3);
	// deeper is a new run, on as many engines as asked for
	await audit.start(pos, { depth: 22, engines: 2 });
	assert.strictEqual(audit.state.status, "running");
	assert.strictEqual(audit.workers, 2);
	assert.strictEqual(made.length, 5);
	assert.ok(made.at(-1).sent.includes("uci"));
	audit.stop();
	assert.strictEqual(audit.state.status, "stopped");
	audit.stop(); // a second stop is nothing
	assert.strictEqual(audit.state.status, "stopped");
});

test("a finished game in the workbook is judged without asking the engine", async () => {
	const lines = linesOf("1. f3 e5 2. g4 Qh4# *");
	const { make, made } = fakeEngines();
	const audit = createAudit({ makeWorker: make, workers: 1, throttle: 0 });
	await audit.start(auditPositions(lines));
	await settled(audit);
	assert.strictEqual(audit.evals.get(posKey(MATED)).mated, "w");
	assert.ok(!made[0].sent.some((c) => c.includes(MATED.split(" ")[0])));
	assert.strictEqual(audit.state.searched, 4);
});

test("what one run finds is kept for the next visit, and a deeper eval is not overwritten", async () => {
	const lines = linesOf("1. d4 d5 2. c4 *");
	const pos = auditPositions(lines);
	const first = createAudit({ makeWorker: fakeEngines().make, workers: 2, throttle: 0, store: evalStore });
	await first.start(pos);
	await settled(first);
	await new Promise((r) => setTimeout(r, 20)); // the store's write
	const kept = await evalStore.load([...pos.keys()]);
	assert.strictEqual(kept.size, pos.size);

	await evalStore.save([[posKey(START), { depth: 8, score: { cp: 1 }, best: "a2a3" }]]);
	await new Promise((r) => setTimeout(r, 10));
	assert.strictEqual((await evalStore.load([posKey(START)])).get(posKey(START)).depth, 16, "the deeper one stays");

	const { make, made } = fakeEngines();
	const second = createAudit({ makeWorker: make, workers: 2, throttle: 0, store: evalStore });
	await second.start(pos);
	assert.strictEqual(second.state.status, "done", "everything was found before");
	assert.strictEqual(made.length, 0);
	assert.strictEqual(second.evals.size, pos.size);
});

test("storage that fails leaves the audit to search again", async () => {
	globalThis.indexedDB = undefined;
	assert.strictEqual((await evalStore.load(["x"])).size, 0);
	await evalStore.save([["x", { depth: 12 }]]); // does not throw
});

test("an engine that fails stops the run with its error, and a start that cannot make one too", async () => {
	const pos = auditPositions(linesOf("1. e4 *"));
	const a = createAudit({ makeWorker: fakeEngines(new Map(), { fail: "boot" }).make, workers: 2, throttle: 0 });
	await a.start(pos);
	await settled(a);
	assert.strictEqual(a.state.status, "error");
	assert.strictEqual(a.state.error, "wasm failed");
	const b = createAudit({ makeWorker: fakeEngines(new Map(), { fail: "throw" }).make, workers: 2, throttle: 0 });
	await b.start(pos);
	assert.strictEqual(b.state.status, "error");
	assert.strictEqual(b.state.error, "no workers here");
});

test("lines added during a run join it; a new start replaces the run; the pace gives a time to go", async () => {
	let t = 0;
	const { make } = fakeEngines();
	const audit = createAudit({ makeWorker: make, workers: 1, throttle: 5, now: () => t });
	audit.add(auditPositions(linesOf("1. a3 *"))); // not running: nothing
	const a = auditPositions(linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *"));
	// two starts at once: only the last one asked for runs
	audit.start(auditPositions(linesOf("1. h3 *")));
	await audit.start(a);
	assert.strictEqual(audit.state.queued > 0, true);
	audit.add(auditPositions(linesOf("1. d4 d5 *")));
	await new Promise((r) => {
		const check = () => (audit.state.searched >= 4 ? r() : setTimeout(check, 1));
		check();
	});
	t = 4000;
	assert.ok(audit.remaining() > 0, "a time to go once there is a pace");
	await settled(audit);
	assert.ok(audit.evals.has(keyAfter(["d4", "d5"])), "the added line was searched");
	assert.ok(!audit.evals.has(keyAfter(["h3"])), "the start replaced before it began searched nothing");
	assert.ok(!audit.evals.has(keyAfter(["a3"])));
});

test("only the chosen side's moves are judged", () => {
	// 1.e4 f6? 2.Qh5+?? (both sides err)
	const lines = linesOf("1. e4 f6 2. Qh5+ *");
	const evals = evalsOf([
		[[], 30, "e2e4"],
		[["e4"], 30, "e7e5"],
		[["e4", "f6"], 150, "d2d4"],
		[["e4", "f6", "Qh5+"], -100, "g7g6"],
	]);
	const sans = (side) => auditReport(lines, evals, 12, lines, side).findings.map((f) => f.san);
	assert.deepStrictEqual(sans("both").sort(), ["Qh5+", "f6"]);
	assert.deepStrictEqual(sans("white"), ["Qh5+"]);
	assert.deepStrictEqual(sans("black"), ["f6"]);
	assert.strictEqual(auditReport(lines, evals, 12, lines, "white").ends.length, 1, "line ends stay");
});

test("the full engine's evals are kept apart from the lite one's", async () => {
	const pos = auditPositions(linesOf("1. e4 e5 *"));
	const lite = fakeEngines(new Map([[keyAfter(["e4"]), 5]]));
	const full = fakeEngines(new Map([[keyAfter(["e4"]), 77]]));
	const audit = createAudit({ makeWorker: lite.make, workers: 1, throttle: 0, store: evalStore });
	await audit.start(pos);
	await settled(audit);
	assert.strictEqual(audit.state.flavor, "lite");
	assert.deepStrictEqual(audit.evals.get(keyAfter(["e4"])).score, { cp: 5 });

	// a run with the full engine searches again, with its own engines
	await audit.start(pos, { flavor: "full", factory: full.make });
	assert.strictEqual(audit.state.status, "running", "lite evals do not stand in for full ones");
	await settled(audit);
	assert.strictEqual(full.made.length, 1);
	assert.deepStrictEqual(audit.evals.get(keyAfter(["e4"])).score, { cp: 77 });
	await new Promise((r) => setTimeout(r, 20));
	const kept = await evalStore.load([`full|${keyAfter(["e4"])}`, keyAfter(["e4"])]);
	assert.deepStrictEqual(kept.get(`full|${keyAfter(["e4"])}`).score, { cp: 77 });
	assert.deepStrictEqual(kept.get(keyAfter(["e4"])).score, { cp: 5 }, "the lite eval is kept as it was");

	// switching back shows the lite evals; switching during a run stops it
	audit.setFlavor("lite");
	assert.deepStrictEqual(audit.evals.get(keyAfter(["e4"])).score, { cp: 5 });
	audit.setFlavor("lite"); // the same: nothing
	await audit.start(pos, { depth: 30 });
	assert.strictEqual(audit.state.status, "running");
	audit.setFlavor("full");
	assert.strictEqual(audit.state.status, "stopped");
});

test("a transposition's finding names the move's ply on each line", () => {
	const lines = linesOf("1. Nf3 (1. e4 f6) Nf6 2. Ng1 Ng8 3. e4 f6 *");
	const evals = evalsOf([
		[[], 0, "e2e4"],
		[["e4"], 0, "e7e5"],
		[["e4", "f6"], 300, "d2d4"],
		[["Nf3"], 0, "d7d5"],
		[["Nf3", "Nf6"], 0, "d2d4"],
		[["Nf3", "Nf6", "Ng1"], 0, "d7d5"],
	]);
	const f6 = auditReport(lines, evals, 12).findings.find((f) => f.san === "f6");
	assert.deepStrictEqual(
		f6.lines.map((l, i) => l.moves.find((m) => m.ply === f6.plies[i]).san),
		["f6", "f6"],
	);
	assert.deepStrictEqual(new Set(f6.plies), new Set([1, 5]));
});

test("the eval after each move, by ply, where it is deep enough", () => {
	const [line] = linesOf("1. e4 e5 2. Nf3 *");
	const evals = evalsOf([
		[["e4"], 30, "e7e5"],
		[["e4", "e5", "Nf3"], -20, "b8c6"],
	]);
	evals.set(keyAfter(["e4", "e5"]), { depth: 4, score: { cp: 10 }, best: null });
	const along = evalsAlong(line.moves, evals, 12);
	assert.deepStrictEqual([...along.keys()], [0, 2], "1...e5 was searched too shallow");
	assert.strictEqual(along.get(0), evals.get(keyAfter(["e4"])));
});

test("an eval suggests an assessment, from White's side", () => {
	const a = (cp) => assessOf({ cp });
	assert.deepStrictEqual([0, 34, -34, 50, -50, 150, -150, 250, -250].map(a), ["=", "=", "=", "⩲", "⩱", "±", "∓", "+−", "−+"]);
	assert.strictEqual(assessOf({ mate: 3 }), "+−");
	assert.strictEqual(assessOf({ mate: -2 }), "−+");
	assert.strictEqual(assessOf({ mate: 0 }, "w"), "−+", "White is mated");
	assert.strictEqual(assessOf({ mate: 0 }, "b"), "+−");
});
