// tests/audit-view.test.mjs
// The audit's chip and panel in the app. Workers are a fake on the global
// Worker (engine.js liteWorker makes them with `new Worker`), which scores
// every position from the side to move's point of view: White to move is
// level, Black to move is -8 -- so every move but the engine's own gives
// the mover's edge away, and is a blunder.
import { test, after } from "node:test";
import assert from "node:assert";
import { Chess } from "chess.js";
import { bootApp } from "./helpers.mjs";
import { getCurrent, getMode, getRenderHooks } from "../src/state.js";
import { sharedAudit } from "../src/audit.js";
import { loadPrefs } from "../src/prefs.js";
import { genPgn } from "../tools/gen-pgn.mjs";

let made = 0;
let hold = false; // answer "go" only when released, so a run can be watched mid-way
const held = [];
globalThis.Worker = class {
	constructor() {
		made++;
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
	assert.match(panel().querySelector(".audit-status").textContent, /All 8 positions searched at depth 12/);
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

test("a deeper depth starts the report over, and is remembered", async () => {
	const depth = panel().querySelector(".audit-depth");
	depth.value = "14";
	depth.dispatchEvent(new app.dom.window.Event("change"));
	assert.strictEqual(loadPrefs().auditDepth, 14);
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
	d2.value = "16";
	d2.dispatchEvent(new app.dom.window.Event("change"));
	await until(() => audit.state.depth === 16 && audit.state.status === "running");
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
	assert.match(panel().querySelector(".audit-status").textContent, /of 8 positions searched at depth 16/);
	panel().querySelector(".audit-run").click();
	await until(() => audit.state.status === "running");
	await finished();
	const d3 = panel().querySelector(".audit-depth");
	d3.value = "12";
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
	assert.match(panel().querySelector(".audit-status").textContent, /^Searching: \d+ of \d+ positions, depth 12/);
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
