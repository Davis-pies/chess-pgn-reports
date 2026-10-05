// tests/audit-view.test.mjs
// The audit's chip and panel in the app. Workers are a fake on the global
// Worker (engine.js liteWorker makes them with `new Worker`), which scores
// every position from the side to move's point of view: White to move is
// level, Black to move is -8 -- so every move but the engine's own gives
// the mover's edge away, and is a blunder.
import { test, after } from "node:test";
import assert from "node:assert";
import { Chess } from "chess.js";
import { bootApp, captureDownloads } from "./helpers.mjs";
import { getCurrent, getMode, getRenderHooks } from "../src/state.js";
import { sharedAudit } from "../src/audit.js";
import { loadPrefs, savePrefs } from "../src/prefs.js";
import { genPgn } from "../tools/gen-pgn.mjs";
import "fake-indexeddb/auto";
import { fileToFull } from "../src/engine-store.js";

let made = 0;
let hold = false; // answer "go" only when released, so a run can be watched mid-way
const held = [];
const urls = []; // the scripts workers were started from
globalThis.Worker = class {
	constructor(url) {
		made++;
		urls.push(String(url));
		this.fen = null;
	}
	postMessage(cmd) {
		const say = (...lines) => setTimeout(() => !this.dead && lines.forEach((l) => this.onmessage({ data: l })));
		if (cmd === "uci") say("uciok");
		else if (cmd === "isready") say("readyok");
		else if (cmd.startsWith("position fen ")) this.fen = cmd.slice(13);
		else if (cmd.startsWith("go")) {
			const best = new Chess(this.fen).moves({ verbose: true })[0].lan;
			const cp = this.fen.split(" ")[1] === "w" ? 0 : 800; // side to move's view
			const answer = () => say(`info depth 12 score cp ${cp} pv ${best}`, "bestmove " + best);
			if (hold) held.push(Object.assign(answer, { worker: this }));
			else answer();
		}
	}
	terminate() {
		this.dead = true;
	}
};

const app = await bootApp();
after(() => {
	app.teardown();
	delete globalThis.Worker;
});

const audit = sharedAudit();
const panel = () => app.view().querySelector(".audit");
const chip = () => app.view().querySelector(".audit-toggle");
const until = async (fn) => {
	const deadline = Date.now() + 20000; // generous: the whole suite runs at once in CI
	while (!fn()) {
		if (Date.now() > deadline) throw new Error("never happened");
		await new Promise((r) => setTimeout(r, 5));
	}
};
const finished = () => until(() => audit.state.status !== "running");
const paint = () => audit.state && new Promise((r) => setTimeout(r, 1100)); // the audit's throttle

test("the toolbar's Audit shows and hides the panel; Run searches the workbook in the background", async () => {
	app.reset();
	await app.loadPgn("1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 *");
	assert.ok(panel().hidden, "hidden until asked for");
	chip().click();
	assert.ok(!panel().hidden);
	assert.strictEqual(chip().getAttribute("aria-expanded"), "true");
	assert.match(panel().querySelector(".audit-status").textContent, /each of the workbook's 8 positions/);
	const run = panel().querySelector(".audit-run");
	assert.strictEqual(run.textContent, "Run audit");

	hold = true;
	run.click();
	await until(() => audit.state.status === "running");
	await until(() => held.length);
	assert.strictEqual(panel().querySelector(".audit-run").textContent, "Stop");
	// the report stays usable: the study opens over it while the run goes on
	app.button("Study").click();
	assert.strictEqual(getMode(), "study");
	app.view().querySelector(".st-window .an-close").click();
	assert.strictEqual(getMode(), "report");

	hold = false;
	held.splice(0).forEach((f) => f());
	await finished();
	await paint();
	assert.strictEqual(audit.state.status, "done");
	assert.strictEqual(chip().textContent, "Audit");
	assert.match(panel().querySelector(".audit-status").textContent, /All 8 positions searched at depth 16/);
	assert.strictEqual(panel().querySelector(".audit-run"), null, "nothing left to run at this depth");
	assert.match(panel().querySelector(".audit-sum").textContent, /blunder/);
	const rows = [...panel().querySelectorAll(".audit-body > .audit-list .audit-row")];
	assert.ok(rows.length > 0);
	assert.strictEqual(rows[0].querySelector(".audit-sym").textContent, "??");
	assert.match(rows[0].querySelector(".audit-best").textContent, /^best /);

	// a finding opens the study at the position it was played from
	const first = rows[0];
	const black = first.querySelector(".audit-move").textContent.includes("...");
	first.querySelector(".audit-study").click();
	assert.strictEqual(getMode(), "study");
	assert.strictEqual(
		app.view().querySelector(".st-window .an-status").textContent,
		black ? "Black to move" : "White to move",
	);
	assert.notStrictEqual(
		app.view().querySelector(".st-window .st-name").textContent,
		"",
	);
	app.view().querySelector(".st-window .an-close").click();

	// hidden with ✕; a redraw keeps it the way it was left
	panel().querySelector(".audit-close").click();
	assert.ok(panel().hidden);
	chip().click();
	getRenderHooks().renderApp();
	assert.ok(!panel().hidden);
	assert.ok(panel().querySelector(".audit-sum"), "the report is drawn again from what was found");
});

test("the line ends fold out, in column order, each with a way to the study", async () => {
	const ends = panel().querySelector(".audit-ends");
	assert.match(ends.querySelector("summary").textContent, /Where each line ends \(2\)/);
	ends.open = true;
	ends.dispatchEvent(new app.dom.window.Event("toggle"));
	const box = panel().querySelector(".audit-ends");
	assert.ok(box.open);
	const names = [...box.querySelectorAll(".audit-row .audit-lines")].map((n) => n.textContent);
	assert.deepStrictEqual(names, ["Mainline", "Line 1"]);
	assert.match(box.querySelector(".audit-evals").textContent, /^[+−]?\d|^0\.00$/);
	box.querySelector(".audit-study").click();
	assert.strictEqual(getMode(), "study");
	// the mainline's end, after 3.Bb5
	assert.strictEqual(app.view().querySelector(".st-window .an-status").textContent, "Black to move");
	app.view().querySelector(".st-window .an-close").click();
	panel().querySelector(".audit-ends").open = false;
	panel().querySelector(".audit-ends").dispatchEvent(new app.dom.window.Event("toggle"));
	assert.ok(!panel().querySelector(".audit-ends").open);
});

test("any depth can be typed: it starts the report over, and is remembered", async () => {
	const typed = (v) => {
		const d = panel().querySelector(".audit-depth");
		d.value = v;
		d.dispatchEvent(new app.dom.window.Event("change"));
	};
	typed("0");
	assert.strictEqual(panel().querySelector(".audit-depth").value, "16", "out of range is put back");
	typed("99");
	assert.strictEqual(loadPrefs().auditDepth, 16);
	typed("20");
	assert.strictEqual(loadPrefs().auditDepth, 20);
	const head = panel().querySelector(".audit-head");
	typed("20"); // the same again, as a blur sends it: nothing is redrawn
	assert.strictEqual(panel().querySelector(".audit-head"), head);
	assert.strictEqual(panel().querySelector(".audit-run").textContent, "Run audit");
	assert.strictEqual(panel().querySelector(".audit-sum"), null);
	// stopped part way, it offers to carry on
	hold = true;
	panel().querySelector(".audit-run").click();
	await until(() => held.length >= 2);
	held.shift()();
	await until(() => audit.state.searched >= 1);
	// changing the depth mid-run starts again at the new one
	const d2 = panel().querySelector(".audit-depth");
	d2.value = "23";
	d2.dispatchEvent(new app.dom.window.Event("change"));
	await until(() => audit.state.depth === 23 && audit.state.status === "running");
	// and so does a new engine count, which is remembered
	const engines = panel().querySelector(".audit-engines");
	assert.ok(engines.options.length >= 1);
	engines.value = "1";
	engines.dispatchEvent(new app.dom.window.Event("change"));
	assert.strictEqual(loadPrefs().auditEngines, 1);
	await until(() => audit.state.status === "running" && audit.workers === 1);
	// one answer from this run's engines (the first run's were shut)
	await until(() => held.some((f) => !f.worker.dead));
	held.find((f) => !f.worker.dead)();
	await until(() => audit.state.searched >= 1);
	panel().querySelector(".audit-run").click(); // Stop
	held.splice(0);
	hold = false;
	await paint();
	assert.strictEqual(audit.state.status, "stopped");
	assert.match(panel().querySelector(".audit-run").textContent, /^Continue \(\d+ left\)$/);
	assert.match(panel().querySelector(".audit-status").textContent, /of 8 positions searched at depth 23/);
	panel().querySelector(".audit-run").click();
	await until(() => audit.state.status === "running");
	await finished();
	const d3 = panel().querySelector(".audit-depth");
	d3.value = "16";
	d3.dispatchEvent(new app.dom.window.Event("change"));
});

test("a long list shows its worst first and the rest on asking; a run for a closed workbook stops", async () => {
	app.reset();
	await app.loadPgn(genPgn({ vars: 12, len: 12, depth: 2 }));
	assert.ok(!panel().hidden, "left open, it is open on the next workbook too");
	hold = true;
	panel().querySelector(".audit-run").click();
	await until(() => held.length);
	held.shift()();
	await until(() => audit.state.searched);
	await paint();
	assert.match(chip().textContent, /^Audit \d+%$/, "the chip shows how far it has got");
	assert.match(panel().querySelector(".audit-status").textContent, /^Searching: \d+ of \d+ positions, depth 16, \d engines?/);
	hold = false;
	held.splice(0).forEach((f) => f());
	await finished();
	await paint();
	const rows = () => panel().querySelectorAll(".audit-body > .audit-list > .audit-row").length;
	assert.strictEqual(rows(), 50);
	const all = [...panel().querySelectorAll(".audit-more button")].find((b) => b.textContent.startsWith("Show all"));
	all.click();
	assert.ok(rows() > 50);
	const lines = panel().querySelector(".audit-lines");
	assert.ok(lines.title.length >= lines.textContent.replace(/ \+\d+$/, "").length);

	// a run under way for a workbook no longer open is stopped at its next report
	const madeBefore = made;
	app.reset();
	await app.loadPgn("1. d4 d5 2. c4 e6 3. Nc3 Nf6 *");
	hold = true;
	panel().querySelector(".audit-run").click();
	await until(() => audit.state.status === "running");
	assert.ok(made > madeBefore);
	audit.state.source = {}; // as if it were started for another workbook
	await until(() => held.length);
	held.splice(0).forEach((f) => f());
	await until(() => audit.state.status !== "running");
	assert.strictEqual(audit.state.status, "stopped");
	hold = false;
	assert.ok(getCurrent().lines.length);
});

test("a workbook with no losing moves says so, and the panel picks up an earlier visit's results", async () => {
	app.reset();
	await app.loadPgn("1. a3 *");
	panel().querySelector(".audit-run").click();
	await finished();
	await paint();
	// 1.a3 is the fake engine's own first move: no finding
	assert.match(panel().querySelector(".audit-sum").textContent, /No move loses ground/);
	chip().click();
	assert.ok(panel().hidden);
});

test("only the chosen side's moves are listed, and the choice is remembered", async () => {
	app.reset();
	await app.loadPgn("1. c4 e5 2. Nc3 Nf6 3. g3 *");
	if (panel().hidden) chip().click();
	panel().querySelector(".audit-run").click();
	await finished();
	await paint();
	const movers = () =>
		[...panel().querySelectorAll(".audit-body > .audit-list .audit-move")].map((m) =>
			m.textContent.includes("...") ? "b" : "w",
		);
	const both = movers();
	assert.ok(both.includes("w") && both.includes("b"), "both sides err against the fake engine");
	const side = (v) => {
		const sel = panel().querySelector(".audit-side");
		sel.value = v;
		sel.dispatchEvent(new app.dom.window.Event("change"));
	};
	side("white");
	assert.strictEqual(loadPrefs().auditSide, "white");
	assert.ok(movers().length && movers().every((m) => m === "w"));
	side("black");
	assert.ok(movers().length && movers().every((m) => m === "b"));
	side("both");
	assert.deepStrictEqual(movers(), both);
});

test("the full engine runs from the stored copy, and says so when there is none", async () => {
	const flavor = (v) => {
		const sel = panel().querySelector(".audit-flavor");
		sel.value = v;
		sel.dispatchEvent(new app.dom.window.Event("change"));
	};
	flavor("full");
	assert.strictEqual(loadPrefs().auditFlavor, "full");
	assert.strictEqual(panel().querySelector(".audit-run").textContent, "Run audit", "full evals are its own");
	panel().querySelector(".audit-run").click();
	await until(() => /not on this device/.test(panel().querySelector(".audit-status").textContent));
	assert.notStrictEqual(audit.state.status, "running");

	await fileToFull(new Blob([new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])]));
	const before = urls.length;
	panel().querySelector(".audit-run").click();
	await until(() => audit.state.status === "running" || audit.state.status === "done");
	await finished();
	await paint();
	assert.ok(urls.slice(before).every((u) => /stockfish-19(-single)?\.js#blob/.test(u)), "the full build, handed the stored file");
	assert.ok(urls.length > before);
	assert.match(panel().querySelector(".audit-status").textContent, /with the full engine\.$/);
	flavor("lite");
	assert.doesNotMatch(panel().querySelector(".audit-status").textContent, /full/);
});

test("a finding's symbol and note go onto its move, one at a time or all at once", async () => {
	savePrefs({ auditDepth: 16, auditSide: "both", auditFlavor: "lite" });
	app.reset();
	await app.loadPgn("1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) 3. Bb5 *");
	if (panel().hidden) chip().click();
	// the first test searched this workbook already; what it found is kept
	panel().querySelector(".audit-run")?.click();
	await until(() => /All 8 positions/.test(panel().querySelector(".audit-status").textContent));
	await finished();
	const rows = () => [...panel().querySelectorAll(".audit-body > .audit-list .audit-row")];
	const lines = () => getCurrent().lines;
	// 1.e4 is not the fake engine's first move, so it is a blunder on both lines
	const e4 = () => rows().find((r) => r.querySelector(".audit-move").textContent === "1.e4");
	const stockfish = (l, ply) => (l.comments || []).filter((c) => c.ply === ply && c.text.startsWith("Stockfish"));

	assert.strictEqual(e4().querySelector(".audit-mark").textContent, "??");
	e4().querySelector(".audit-mark").click();
	assert.ok(lines().every((l) => l.marks[0] === "$4"), "?? on 1.e4 of every line through it");
	assert.ok(e4().querySelector(".audit-mark").classList.contains("on"));
	e4().querySelector(".audit-mark").click();
	assert.ok(lines().every((l) => !l.marks), "pressed again, it comes off");

	e4().querySelector(".audit-note").click();
	assert.ok(lines().every((l) => stockfish(l, 0).length === 1));
	assert.match(stockfish(lines()[0], 0)[0].text, /^Stockfish: 0\.00 → −8\.00 \(depth 16\), best 1\.\S+$/);
	e4().querySelector(".audit-note").click();
	assert.ok(lines().every((l) => !stockfish(l, 0).length));

	// all at once: a move the reader marked keeps their symbol, and a note
	// written twice is not stacked
	lines().forEach((l) => (l.marks = { 0: "$1" }));
	getRenderHooks().renderApp();
	const bulk = (re) => [...panel().querySelectorAll(".audit-bulk")].find((b) => re.test(b.textContent));
	bulk(/^Add symbols/).click();
	assert.ok(lines().every((l) => l.marks[0] === "$1"), "the reader's own ! stays");
	assert.ok(lines().some((l) => l.marks[2] === "$4"), "2.Nf3 is marked");
	bulk(/^Add notes/).click();
	bulk(/^Add notes/).click();
	assert.ok(lines().every((l) => stockfish(l, 0).length === 1));

	// line ends: the assessment the eval suggests, and a note on the last move
	const ends = panel().querySelector(".audit-ends");
	ends.open = true;
	ends.dispatchEvent(new app.dom.window.Event("toggle"));
	const endRow = () => panel().querySelector(".audit-ends .audit-row");
	assert.strictEqual(endRow().querySelector(".audit-mark").textContent, "−+", "the mainline ends at −8 after 3.Bb5");
	endRow().querySelector(".audit-mark").click();
	const main = lines().find((l) => l.moves.length === 5);
	assert.strictEqual(main.meta.eval, "−+");
	endRow().querySelector(".audit-note").click();
	assert.match(stockfish(main, 4)[0].text, /^Stockfish: −8\.00 \(depth 16\)$/);
	main.meta.eval = "∞";
	getRenderHooks().renderApp();
	[...panel().querySelectorAll(".audit-ends .audit-bulk")].find((b) => /^Add assessments/.test(b.textContent)).click();
	assert.strictEqual(main.meta.eval, "∞", "the reader's own assessment stays");
	assert.ok(lines().every((l) => l.meta.eval), "the other line gets one");
	panel().querySelector(".audit-ends").open = false;
	panel().querySelector(".audit-ends").dispatchEvent(new app.dom.window.Event("toggle"));
});

test("Evals in the table shows the eval after each move under it, and is remembered", async () => {
	const evals = () => [...app.view().querySelectorAll(".tbl td .mv-eval")].map((e) => e.textContent);
	assert.deepStrictEqual(evals(), []);
	const toggle = () => panel().querySelector(".audit-intable");
	assert.strictEqual(toggle().getAttribute("aria-pressed"), "false");
	toggle().click();
	assert.strictEqual(loadPrefs().auditInTable, true);
	// White to move is level; Black to move is −8
	const shown = evals();
	assert.ok(shown.includes("0.00") && shown.includes("−8.00"), shown.join(" "));
	getRenderHooks().renderApp();
	assert.deepStrictEqual(evals(), shown, "drawn again the same");
	panel().querySelector(".audit-intable").click();
	assert.deepStrictEqual(evals(), []);
	assert.strictEqual(loadPrefs().auditInTable, false);
});

test("a saved workbook carries what the audit found, and brings it to a page that never ran it", async () => {
	app.reset();
	await app.loadPgn("1. h3 h6 2. g3 *");
	getCurrent().name = "audited";
	const show = () => (!panel() || panel().hidden) && chip().click();
	show();
	panel().querySelector(".audit-run").click();
	await until(() => audit.state.status === "done" && audit.state.source === getCurrent());
	const cap = captureDownloads(app.dom.window.document);
	app.clickText("Save to file");
	cap.restore();
	const text = await cap.blobs[0].text();
	const nb = JSON.parse(text);
	assert.strictEqual(Object.keys(nb.audit.lite).length, 4, "the start and the three moves");
	assert.strictEqual(nb.version, 1, "older builds read it, ignoring the evals");

	// another device: nothing searched, nothing kept
	audit.all.lite.clear();
	app.reset();
	const input = app.view().querySelector("input.wbin");
	Object.defineProperty(input, "files", { value: [new app.dom.window.File([text], "audited.json")], configurable: true });
	input.onchange();
	await app.settle();
	assert.strictEqual(audit.evals.size, 4);
	show();
	assert.match(panel().querySelector(".audit-status").textContent, /All 4 positions searched/);
	assert.strictEqual(panel().querySelector(".audit-sum").textContent, "3 blunders", "the findings, without a run");
});
