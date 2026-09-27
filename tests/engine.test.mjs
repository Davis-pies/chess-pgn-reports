// tests/engine.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import {
	createEngine,
	formatScore,
	numberedFrom,
	parseInfo,
	uciToSan,
	whiteScore,
	whiteShare,
} from "../src/engine.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
const MATED = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";

test("an info line with a scored pv is parsed; others are not", () => {
	assert.deepStrictEqual(
		parseInfo("info depth 12 seldepth 18 multipv 2 score cp -35 nodes 9000 nps 800000 pv e7e5 g1f3"),
		{ multipv: 2, depth: 12, score: { cp: -35 }, nodes: 9000, nps: 800000, pv: ["e7e5", "g1f3"] },
	);
	assert.deepStrictEqual(parseInfo("info depth 30 score mate 3 pv d1h5").score, { mate: 3 });
	assert.strictEqual(parseInfo("info depth 5 score cp 10 lowerbound pv e2e4").bound, "lowerbound");
	assert.strictEqual(parseInfo("info depth 5 currmove e2e4 currmovenumber 1"), null);
	assert.strictEqual(parseInfo("info string NNUE evaluation enabled"), null);
	assert.strictEqual(parseInfo("bestmove e2e4"), null);
});

test("uci moves become SAN, stopping at the first illegal one", () => {
	const out = uciToSan(START, ["e2e4", "e7e5", "g1f3", "e1e8"]);
	assert.deepStrictEqual(out.map((m) => m.san), ["e4", "e5", "Nf3"]);
	assert.deepStrictEqual([out[0].from, out[0].to], ["e2", "e4"]);
	const promo = uciToSan("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", ["b7b8n"]);
	assert.strictEqual(promo[0].san, "b8=N");
});

test("scores are turned to White's side", () => {
	assert.deepStrictEqual(whiteScore({ cp: 30 }, "w"), { cp: 30 });
	assert.deepStrictEqual(whiteScore({ cp: 30 }, "b"), { cp: -30 });
	assert.deepStrictEqual(whiteScore({ mate: 2 }, "b"), { mate: -2 });
});

test("scores print as pawns or mates", () => {
	assert.strictEqual(formatScore({ cp: 41 }), "+0.41");
	assert.strictEqual(formatScore({ cp: -120 }), "−1.20");
	assert.strictEqual(formatScore({ cp: 0 }), "0.00");
	assert.strictEqual(formatScore({ mate: 3 }), "#3");
	assert.strictEqual(formatScore({ mate: -2 }), "#-2");
	assert.strictEqual(formatScore({ mate: 0 }), "#");
});

test("the eval bar share is even at 0, and all or nothing at mate", () => {
	assert.strictEqual(whiteShare({ cp: 0 }), 0.5);
	assert.ok(whiteShare({ cp: 100 }) > 0.55 && whiteShare({ cp: 100 }) < 0.7);
	assert.ok(whiteShare({ cp: -5000 }) < 0.05);
	assert.strictEqual(whiteShare({ mate: 4 }), 1);
	assert.strictEqual(whiteShare({ mate: -1 }), 0);
});

test("move numbers continue from the position, Black's first with dots", () => {
	assert.deepStrictEqual(numberedFrom(START, ["e4", "e5", "Nf3"]), ["1.e4", "e5", "2.Nf3"]);
	assert.deepStrictEqual(numberedFrom(AFTER_E4, ["c5", "Nf3"]), ["1...c5", "2.Nf3"]);
});

// A stand-in for the Stockfish worker: it records what it is told, answers
// the handshake, and lets the test say what the search "finds".
function fakeWorker() {
	const w = {
		sent: [],
		terminated: false,
		postMessage(cmd) {
			w.sent.push(cmd);
			if (cmd === "uci") w.reply("uciok");
			if (cmd === "isready") w.reply("readyok");
		},
		reply(line) {
			w.onmessage({ data: line });
		},
		terminate() {
			w.terminated = true;
		},
		gos: () => w.sent.filter((c) => c.startsWith("go")),
		positions: () => w.sent.filter((c) => c.startsWith("position")),
	};
	return w;
}

function setup(opts = {}) {
	let w;
	const eng = createEngine(() => (w = fakeWorker()), { throttle: 0, ...opts });
	const seen = [];
	eng.onUpdate = (st) => seen.push(JSON.parse(JSON.stringify(st)));
	return { eng, w: () => w, seen };
}

test("nothing starts until the engine is switched on", () => {
	const { eng, w } = setup();
	eng.analyse(START);
	assert.strictEqual(w(), undefined, "no worker made");
	assert.strictEqual(eng.state.status, "off");
});

test("switching on and analysing runs the handshake, then searches", () => {
	const { eng, w } = setup({ multiPv: 2, depth: 18 });
	eng.enable();
	eng.analyse(START);
	const sent = w().sent;
	assert.deepStrictEqual(sent.slice(0, 5), [
		"uci",
		"setoption name Hash value 64",
		"setoption name MultiPV value 2",
		"isready",
		"position fen " + START,
	]);
	assert.deepStrictEqual(w().gos(), ["go depth 18"]);
	assert.strictEqual(eng.state.status, "searching");
});

test("info lines become scored SAN lines from White's side", () => {
	const { eng, w } = setup();
	eng.enable();
	eng.analyse(AFTER_E4);
	w().reply("info depth 10 multipv 1 score cp 25 nps 500000 pv c7c5 g1f3");
	w().reply("info depth 10 multipv 2 score cp 40 pv e7e5 g1f3");
	assert.strictEqual(eng.state.depth, 10);
	assert.deepStrictEqual(eng.state.lines[0].score, { cp: -25 }, "Black to move: flipped");
	assert.deepStrictEqual(eng.state.lines[0].moves.map((m) => m.san), ["c5", "Nf3"]);
	assert.deepStrictEqual(eng.state.lines[1].moves.map((m) => m.san), ["e5", "Nf3"]);
	assert.strictEqual(eng.state.nps, 500000);
	// a new depth starts the list again from its first line
	w().reply("info depth 11 multipv 1 score cp 20 pv c7c5 g1f3");
	assert.strictEqual(eng.state.lines.length, 1);
	// bounds and junk are ignored
	w().reply("info depth 12 multipv 1 score cp 90 upperbound pv e7e6");
	w().reply("info string hello");
	assert.strictEqual(eng.state.depth, 11);
	w().reply("bestmove c7c5");
	assert.strictEqual(eng.state.status, "done");
});

test("a new position stops the search and waits for its bestmove first", () => {
	const { eng, w } = setup();
	eng.enable();
	eng.analyse(START);
	eng.analyse(AFTER_E4);
	assert.ok(w().sent.includes("stop"));
	assert.strictEqual(w().gos().length, 1, "the next search waits");
	// output from the stopping search is not read as the new position's
	w().reply("info depth 14 multipv 1 score cp 30 pv e2e4");
	assert.deepStrictEqual(eng.state.lines, []);
	w().reply("bestmove e2e4");
	assert.strictEqual(w().gos().length, 2);
	assert.strictEqual(w().positions()[1], "position fen " + AFTER_E4);
	assert.strictEqual(eng.state.fen, AFTER_E4);
});

test("asking again for the position being searched does nothing", () => {
	const { eng, w } = setup();
	eng.enable();
	eng.analyse(START);
	eng.analyse(START);
	assert.strictEqual(w().gos().length, 1);
	assert.ok(!w().sent.includes("stop"));
});

test("going back to a finished position answers from the cache without searching", () => {
	const { eng, w } = setup({ depth: 12, multiPv: 1 });
	eng.enable();
	eng.analyse(START);
	w().reply("info depth 12 multipv 1 score cp 30 pv e2e4 e7e5");
	w().reply("bestmove e2e4");
	eng.analyse(AFTER_E4);
	w().reply("info depth 3 multipv 1 score cp 10 pv c7c5");
	eng.analyse(START);
	w().reply("bestmove c7c5");
	assert.strictEqual(w().gos().length, 2, "no third search");
	assert.strictEqual(eng.state.status, "done");
	assert.strictEqual(eng.state.depth, 12);
	assert.deepStrictEqual(eng.state.lines[0].moves.map((m) => m.san), ["e4", "e5"]);
});

test("a position left mid-search resumes from the depth it reached", () => {
	const { eng, w } = setup({ depth: 20, multiPv: 1 });
	eng.enable();
	eng.analyse(START);
	w().reply("info depth 14 multipv 1 score cp 30 pv e2e4");
	eng.analyse(AFTER_E4);
	w().reply("bestmove e2e4");
	eng.analyse(START);
	w().reply("bestmove c7c5");
	// the cached depth-14 line shows at once while the search climbs again
	assert.strictEqual(eng.state.depth, 14);
	assert.deepStrictEqual(eng.state.lines[0].moves.map((m) => m.san), ["e4"]);
	w().reply("info depth 9 multipv 1 score cp -50 pv d2d4");
	assert.deepStrictEqual(eng.state.lines[0].moves.map((m) => m.san), ["e4"], "shallower output is held back");
	w().reply("info depth 15 multipv 1 score cp 25 pv d2d4");
	assert.strictEqual(eng.state.depth, 15);
	assert.deepStrictEqual(eng.state.lines[0].moves.map((m) => m.san), ["d4"]);
});

test("the cache forgets its oldest position past its size", () => {
	const { eng, w } = setup({ depth: 5, multiPv: 1, cacheSize: 1 });
	eng.enable();
	eng.analyse(START);
	w().reply("info depth 5 multipv 1 score cp 30 pv e2e4");
	w().reply("bestmove e2e4");
	eng.analyse(AFTER_E4);
	w().reply("info depth 5 multipv 1 score cp 30 pv c7c5");
	w().reply("bestmove c7c5");
	eng.analyse(START);
	assert.strictEqual(w().gos().length, 3, "searched again: it was evicted");
});

test("a finished game is not searched", () => {
	const { eng, w } = setup();
	eng.enable();
	eng.analyse(MATED);
	assert.strictEqual(w().gos().length, 0);
	assert.strictEqual(eng.state.status, "over");
});

test("switching off stops the search and clears the lines", () => {
	const { eng, w } = setup();
	eng.enable();
	eng.analyse(START);
	w().reply("info depth 5 multipv 1 score cp 30 pv e2e4");
	eng.enable(false);
	assert.ok(w().sent.includes("stop"));
	assert.strictEqual(eng.state.status, "off");
	assert.deepStrictEqual(eng.state.lines, []);
	w().reply("bestmove e2e4");
	eng.analyse(AFTER_E4);
	assert.strictEqual(w().gos().length, 1, "off means off");
	eng.enable();
	assert.strictEqual(eng.state.status, "idle");
	eng.analyse(AFTER_E4);
	assert.strictEqual(w().gos().length, 2);
});

test("pause stops a search, and the same position can be asked for again", () => {
	const { eng, w } = setup();
	eng.enable();
	eng.analyse(START);
	eng.pause();
	eng.analyse(START);
	w().reply("bestmove e2e4");
	assert.strictEqual(w().gos().length, 2);
	assert.strictEqual(eng.state.status, "searching");
});

test("a depth or line-count change re-searches the position", () => {
	const { eng, w } = setup({ depth: 10, multiPv: 1 });
	eng.enable();
	eng.analyse(START);
	w().reply("info depth 10 multipv 1 score cp 30 pv e2e4");
	w().reply("bestmove e2e4");
	eng.setDepth(10); // unchanged: nothing
	eng.setDepth(0);
	assert.strictEqual(eng.depth, 0);
	assert.deepStrictEqual(w().gos(), ["go depth 10", "go infinite"]);
	eng.setDepth(8); // shallower than the cache: answered from it
	w().reply("bestmove e2e4");
	assert.strictEqual(w().gos().length, 2);
	assert.strictEqual(eng.state.status, "done");
	eng.setMultiPv(1); // unchanged
	eng.setMultiPv(3);
	assert.strictEqual(eng.multiPv, 3);
	assert.ok(w().sent.includes("setoption name MultiPV value 3"));
	assert.strictEqual(w().gos().length, 3, "the cache was cleared, so it searches");
});

test("deeper searches the position with no depth limit", () => {
	const { eng, w } = setup({ depth: 10, multiPv: 1 });
	eng.deeper(); // not running: nothing
	eng.enable();
	eng.analyse(START);
	w().reply("info depth 10 multipv 1 score cp 30 pv e2e4");
	w().reply("bestmove e2e4");
	eng.deeper();
	assert.deepStrictEqual(w().gos(), ["go depth 10", "go infinite"]);
	assert.strictEqual(eng.depth, 10, "the setting itself is unchanged");
});

test("a worker that fails reports why, and switching on again retries", () => {
	let n = 0;
	const eng = createEngine(
		() => {
			n++;
			throw new Error("no wasm");
		},
		{ throttle: 0 },
	);
	eng.enable();
	eng.analyse(START);
	assert.strictEqual(eng.state.status, "error");
	assert.strictEqual(eng.state.error, "no wasm");
	eng.enable();
	eng.analyse(START);
	assert.strictEqual(n, 2);
});

test("an error from a running worker ends it", () => {
	const { eng, w } = setup();
	eng.enable();
	eng.analyse(START);
	w().onerror({ message: "boom" });
	assert.strictEqual(eng.state.status, "error");
	assert.ok(w().terminated);
});

test("quit ends the worker", () => {
	const { eng, w } = setup();
	eng.quit(); // no worker yet: fine
	eng.enable();
	eng.analyse(START);
	eng.quit();
	assert.ok(w().sent.includes("quit"));
	assert.ok(w().terminated);
});

test("a burst of info lines is drawn once, after the throttle", async () => {
	let w;
	const eng = createEngine(() => (w = fakeWorker()), { throttle: 5 });
	let n = 0;
	eng.onUpdate = () => n++;
	eng.enable();
	eng.analyse(START);
	const before = n; // the search starting is drawn at once
	w.reply("info depth 1 multipv 1 score cp 30 pv e2e4");
	w.reply("info depth 2 multipv 1 score cp 30 pv e2e4");
	w.reply("info depth 3 multipv 1 score cp 30 pv e2e4");
	assert.strictEqual(n, before);
	await new Promise((r) => setTimeout(r, 20));
	assert.strictEqual(n, before + 1);
	eng.onUpdate = null; // clearing the listener is allowed
	w.reply("bestmove e2e4");
});
