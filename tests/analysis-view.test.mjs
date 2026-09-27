// tests/analysis-view.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { getCurrent } from "../src/state.js";
import { analysisPanel, numberedMoves } from "../src/analysis-view.js";
import { newScratch, activeLine, play, goTo, forward } from "../src/analysis.js";

const click = (root, sel) => {
	const n = root.querySelector(sel);
	assert.ok(n, `no ${sel}`);
	n.click();
	return n;
};
const mouse = (root, sq, type) =>
	root
		.querySelector(`rect[data-sq="${sq}"]`)
		.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true }));

test("numbering starts at move one and pairs the colours", () => {
	assert.strictEqual(numberedMoves([]), "");
	assert.strictEqual(
		numberedMoves([{ san: "e4" }, { san: "e5" }, { san: "Nf3" }]),
		"1.e4 e5 2.Nf3",
	);
});

test("the panel draws a board, the nav and the scratch lines", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }]);
	const panel = analysisPanel(s, () => {});
	assert.ok(panel.querySelector(".an-board svg"));
	assert.ok(panel.querySelector(".an-nav"));
	assert.strictEqual(panel.querySelectorAll(".an-line").length, 1);
	assert.match(panel.querySelector(".an-line").textContent, /1\.e4/);
	done();
});

test("playing a move on the board updates the scratch and reports the change", () => {
	const done = installDom();
	const s = newScratch();
	let changed = 0;
	const panel = analysisPanel(s, () => changed++);
	mouse(panel, "e2", "mousedown");
	mouse(panel, "e4", "mouseup");
	assert.deepStrictEqual(
		activeLine(s).moves.map((m) => m.san),
		["e4"],
	);
	assert.strictEqual(changed, 1);
	done();
});

test("the board shows the position at the cursor, not the end of the line", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 0);
	const panel = analysisPanel(s, () => {});
	// at the start position, so a white pawn is still on e2 and can be picked
	mouse(panel, "e2", "mousedown");
	assert.ok(panel.querySelector('rect[data-sq="e4"].target'));
	done();
});

test("back and forward walk the cursor", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	// redrawn after each step, as the app does: a button at its limit is disabled
	click(analysisPanel(s, () => {}), ".an-back");
	assert.strictEqual(s.at, 1);
	click(analysisPanel(s, () => {}), ".an-fwd");
	assert.strictEqual(s.at, 2);
	assert.ok(analysisPanel(s, () => {}).querySelector(".an-fwd").disabled, "nothing to go forward to");
	done();
});

test("flip toggles the board and nothing else", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }]);
	const panel = analysisPanel(s, () => {});
	click(panel, ".an-flip");
	assert.strictEqual(s.flipped, true);
	assert.strictEqual(s.at, 1, "the cursor did not move");
	done();
});

test("left and right arrows step the cursor", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	const panel = analysisPanel(s, () => {});
	const key = (k) =>
		panel.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: k, bubbles: true }),
		);
	key("ArrowLeft");
	assert.strictEqual(s.at, 1);
	key("ArrowLeft");
	assert.strictEqual(s.at, 0);
	key("ArrowRight");
	assert.strictEqual(s.at, 1);
	done();
});

test("the panel is focusable so the arrow keys can reach it", () => {
	const done = installDom();
	const panel = analysisPanel(newScratch(), () => {});
	assert.strictEqual(panel.tabIndex, -1);
	done();
});

test("a fork shows as a second line, and clicking one selects it", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5");
	// in the fork, the line it left does not lead here
	assert.strictEqual(analysisPanel(s, () => {}).querySelectorAll(".an-line").length, 1);
	goTo(s, 1); // back where they split
	const panel = analysisPanel(s, () => {});
	const rows = panel.querySelectorAll(".an-line");
	assert.strictEqual(rows.length, 2);
	assert.ok(rows[1].classList.contains("active"), "the fork is the active line");
	rows[0].click();
	assert.strictEqual(s.active, 0);
	assert.strictEqual(s.at, 1, "picking a line keeps the position, so the list stays");
	done();
});

test("clicking a move in a line jumps the cursor to it", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }, { san: "Nf3" }]);
	const panel = analysisPanel(s, () => {});
	panel.querySelectorAll(".an-line .an-move")[1].click();
	assert.strictEqual(s.active, 0);
	assert.strictEqual(s.at, 2, "the cursor sits after the clicked move");
	done();
});

test("each scratch line has a delete button", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5");
	goTo(s, 1);
	let changed = 0;
	const panel = analysisPanel(s, () => changed++);
	panel.querySelectorAll(".an-del")[0].click();
	assert.strictEqual(s.lines.length, 1);
	assert.deepStrictEqual(activeLine(s).moves.map((m) => m.san), ["e4", "c5"]);
	assert.strictEqual(changed, 1);
	done();
});

test("the board's note boxes are the notebook's, on the move just played", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	let changed = 0;
	const panel = analysisPanel(s, () => changed++);
	const box = panel.querySelector(".cedit .nt.new input");
	box.value = "symmetrical";
	box.oninput();
	assert.deepStrictEqual(activeLine(s).comments, [{ ply: 1, text: "symmetrical" }]);
	// A redraw here would replace the button a click is on its way to, which
	// is how a first click on Add used to be swallowed.
	assert.strictEqual(changed, 0);
	assert.strictEqual(panel.querySelectorAll(".cedit .nt").length, 2, "another box opened");

	const again = analysisPanel(s, () => {});
	assert.strictEqual(again.querySelector(".cedit input").value, "symmetrical");
	assert.ok(again.querySelector(".an-move.has-note"), "the move shows it has a note");
	done();
});

test("Add takes a note that was typed but never left", () => {
	const done = installDom();
	loadState("1. e4 e5 2. Nf3 Nc6 *");
	const s = newScratch([{ san: "e4" }, { san: "c5" }]);
	const panel = analysisPanel(s, () => {});
	const box = panel.querySelector(".cedit .nt.new input");
	box.value = "the Sicilian";
	box.oninput();
	click(panel, ".an-add");
	const added = getCurrent().lines[getCurrent().lines.length - 1];
	assert.deepStrictEqual(added.moves.map((m) => m.san), ["e4", "c5"]);
	assert.deepStrictEqual(added.comments, [{ ply: 1, text: "the Sicilian" }]);
	done();
});

test("there is no note to write before the first move", () => {
	const done = installDom();
	const panel = analysisPanel(newScratch(), () => {});
	assert.strictEqual(panel.querySelector(".cedit"), null);
	assert.ok(panel.querySelector(".an-note-hint"));
	done();
});

test("Add as footnote files the line as a footnote", () => {
	const done = installDom();
	loadState("1. e4 e5 2. Nf3 Nc6 *");
	const s = newScratch([{ san: "e4" }, { san: "c5" }]);
	const panel = analysisPanel(s, () => {});
	click(panel, ".an-add-foot");
	const added = getCurrent().lines[getCurrent().lines.length - 1];
	assert.deepStrictEqual(added.moves.map((m) => m.san), ["e4", "c5"]);
	assert.strictEqual(added.tag, "foot");
	done();
});

test("the arrow keys move the caret in a note box, not the board", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	let changed = 0;
	const panel = analysisPanel(s, () => changed++);
	panel
		.querySelector(".cedit input")
		.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
	assert.strictEqual(s.at, 2);
	assert.strictEqual(changed, 0);
	done();
});

test("each add button reports a line added, and nothing when refused", () => {
	const done = installDom();
	loadState("1. e4 e5 2. Nf3 Nc6 *");
	for (const [btn, reply] of [[".an-add", "d5"], [".an-add-foot", "Nf6"], [".an-add-all", "f5"]]) {
		let added = 0;
		const s = newScratch([{ san: "d4" }, { san: reply }]);
		click(analysisPanel(s, () => {}, { onAdded: () => added++ }), btn);
		assert.strictEqual(added, 1, `${btn} reports the add`);
	}
	let added = 0;
	let changed = 0;
	const empty = analysisPanel(newScratch(), () => changed++, { onAdded: () => added++ });
	click(empty, ".an-add");
	assert.strictEqual(added, 0);
	assert.strictEqual(changed, 0, "no redraw, so the reason stays on screen");
	assert.match(empty.querySelector(".an-msg").textContent, /no moves/);
	done();
});

// ---- navigation, line tools, copying, and the engine box

import { createEngine } from "../src/engine.js";

const keyOn = (panel, key, target = panel) =>
	target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

test("status says whose move it is, a check, and a finished game", () => {
	const done = installDom();
	assert.strictEqual(analysisPanel(newScratch(), () => {}).querySelector(".an-status").textContent, "White to move");
	const check = newScratch(["e4", "f5", "Qh5+"].map((san) => ({ san })));
	assert.match(analysisPanel(check, () => {}).querySelector(".an-status").textContent, /Black to move — check/);
	const mate = newScratch(["f3", "e5", "g4", "Qh4#"].map((san) => ({ san })));
	const st = analysisPanel(mate, () => {}).querySelector(".an-status");
	assert.strictEqual(st.textContent, "Black wins by checkmate");
	assert.ok(st.classList.contains("over"));
	done();
});

test("Home, End, Up, Down and F work from the keyboard", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5");
	const p = () => analysisPanel(s, () => {});
	keyOn(p(), "Home");
	assert.strictEqual(s.at, 0);
	keyOn(p(), "End");
	assert.strictEqual(s.at, 2);
	keyOn(p(), "ArrowUp"); // in the fork, no other line is on view
	assert.strictEqual(s.active, 1);
	keyOn(p(), "Home");
	keyOn(p(), "ArrowUp");
	assert.strictEqual(s.active, 0);
	keyOn(p(), "ArrowDown");
	assert.strictEqual(s.active, 1);
	keyOn(p(), "f");
	assert.strictEqual(s.flipped, true);
	keyOn(p(), "q"); // not a key it knows: nothing
	done();
});

test("a key with a modifier is left to the browser", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }]);
	const panel = analysisPanel(s, () => {});
	panel.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", ctrlKey: true, bubbles: true }));
	assert.strictEqual(s.at, 1);
	done();
});

test("the end button and Delete from here", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }, { san: "Nf3" }]);
	goTo(s, 0);
	click(analysisPanel(s, () => {}), ".an-end");
	assert.strictEqual(s.at, 3);
	assert.ok(analysisPanel(s, () => {}).querySelector(".an-cut").disabled, "nothing after the end to delete");
	goTo(s, 1);
	click(analysisPanel(s, () => {}), ".an-cut");
	assert.deepStrictEqual(activeLine(s).moves.map((m) => m.san), ["e4"]);
	// and it can be undone
	click(analysisPanel(s, () => {}), ".an-undo");
	assert.deepStrictEqual(activeLine(s).moves.map((m) => m.san), ["e4", "e5", "Nf3"]);
	assert.strictEqual(analysisPanel(s, () => {}).querySelector(".an-undo"), null, "one undo only");
	done();
});

test("lines can be reordered from the list, and shared opening moves are faint", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5");
	goTo(s, 1);
	const panel = analysisPanel(s, () => {});
	const second = panel.querySelectorAll(".an-line")[1];
	assert.ok(second.querySelector(".an-move.shared"), "1.e4 is written above");
	assert.ok(panel.querySelectorAll(".an-up")[0].disabled, "the first line cannot go up");
	panel.querySelectorAll(".an-up")[1].click();
	assert.deepStrictEqual(activeLine(s).moves.map((m) => m.san), ["e4", "c5"]);
	assert.strictEqual(s.active, 0);
	analysisPanel(s, () => {}).querySelectorAll(".an-down")[0].click();
	assert.strictEqual(s.active, 1);
	assert.strictEqual(analysisPanel(newScratch(), () => {}).querySelector(".an-up"), null, "no arrows for one line");
	done();
});

test("a line the notebook already has is badged", () => {
	const done = installDom();
	loadState("1. e4 e5 2. Nf3 Nc6 *");
	const s = newScratch(["e4", "e5", "Nf3", "Nc6"].map((san) => ({ san })));
	assert.ok(analysisPanel(s, () => {}).querySelector(".an-badge"));
	const other = newScratch([{ san: "d4" }]);
	assert.strictEqual(analysisPanel(other, () => {}).querySelector(".an-badge"), null);
	done();
});

test("Clear lines deletes the lines on view, keeps the position, and can be undone", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5");
	goTo(s, 1);
	click(analysisPanel(s, () => {}), ".an-clear");
	assert.strictEqual(s.lines.length, 1);
	assert.deepStrictEqual(activeLine(s).moves.map((m) => m.san), ["e4"], "a fresh line at the position");
	click(analysisPanel(s, () => {}), ".an-undo");
	assert.strictEqual(s.lines.length, 2);
	done();
});

test("Copy FEN and Copy PGN go to the clipboard, or onto the page without one", async () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }]);
	const copied = [];
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText: async (t) => copied.push(t) },
		configurable: true,
	});
	const panel = analysisPanel(s, () => {});
	click(panel, ".an-copy-fen");
	click(panel, ".an-copy-pgn");
	await new Promise((r) => setTimeout(r, 0));
	assert.match(copied[0], /^rnbqkbnr\/pppppppp\/8\/8\/4P3/);
	assert.match(copied[1], /1\. e4 \*/);
	assert.strictEqual(panel.querySelector(".an-msg").textContent, "PGN copied.");
	Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
	const bare = analysisPanel(s, () => {});
	click(bare, ".an-copy-fen");
	assert.match(bare.querySelector(".an-msg").textContent, /^rnbqkbnr/, "shown to copy by hand");
	done();
});

function fakeWorker() {
	const w = {
		sent: [],
		postMessage(cmd) {
			w.sent.push(cmd);
			if (cmd === "uci") w.onmessage({ data: "uciok" });
			if (cmd === "isready") w.onmessage({ data: "readyok" });
		},
		reply: (line) => w.onmessage({ data: line }),
		terminate() {},
	};
	return w;
}
const engineWith = () => {
	let w;
	const engine = createEngine(() => (w = fakeWorker()), { throttle: 0, multiPv: 2 });
	return { engine, w: () => w };
};

test("the engine box is off until switched on, and E switches it", () => {
	const done = installDom();
	const { engine } = engineWith();
	const s = newScratch();
	let panel = analysisPanel(s, () => {}, { engine });
	assert.strictEqual(panel.querySelector(".an-engine-toggle").textContent, "Engine off");
	assert.ok(panel.querySelector(".an-evalbar").hidden);
	assert.strictEqual(panel.querySelector(".an-engine-pv"), null, "no settings while off");
	keyOn(panel, "e");
	assert.strictEqual(engine.state.enabled, true);
	panel = analysisPanel(s, () => {}, { engine });
	assert.strictEqual(panel.querySelector(".an-engine-toggle").textContent, "Engine on");
	assert.match(panel.querySelector(".an-engine-info").textContent, /Thinking/);
	click(panel, ".an-engine-toggle");
	assert.strictEqual(engine.state.enabled, false);
	done();
});

test("the engine's lines, eval bar and arrows follow its output", () => {
	const done = installDom();
	const { engine, w } = engineWith();
	engine.enable();
	const s = newScratch([{ san: "e4" }]);
	let changed = 0;
	const panel = analysisPanel(s, () => changed++, { engine });
	w().reply("info depth 12 multipv 1 score cp -30 nps 900000 pv c7c5 g1f3 d7d6");
	w().reply("info depth 12 multipv 2 score cp -45 pv e7e5 g1f3");
	const rows = panel.querySelectorAll(".an-pv");
	assert.strictEqual(rows.length, 2);
	assert.strictEqual(rows[0].querySelector(".an-score").textContent, "+0.30");
	assert.deepStrictEqual(
		[...rows[0].querySelectorAll(".an-pvmove")].map((b) => b.textContent),
		["1...c5", "2.Nf3", "d6"],
	);
	assert.match(panel.querySelector(".an-engine-info").textContent, /depth 12 · 900k nodes\/s/);
	assert.ok(parseFloat(panel.querySelector(".an-evalfill").style.height) > 50);
	assert.strictEqual(panel.querySelectorAll(".an-arrow").length, 2);
	// playing a move from a line plays the line up to it
	rows[0].querySelectorAll(".an-pvmove")[1].click();
	assert.deepStrictEqual(activeLine(s).moves.map((m) => m.san), ["e4", "c5", "Nf3"]);
	assert.strictEqual(changed, 1);
	done();
});

test("Note eval writes the verdict into the move's note; Go deeper when done", () => {
	const done = installDom();
	const { engine, w } = engineWith();
	engine.enable();
	const s = newScratch([{ san: "e4" }]);
	const panel = analysisPanel(s, () => {}, { engine });
	w().reply("info depth 12 multipv 1 score cp -30 pv c7c5 g1f3");
	assert.strictEqual(panel.querySelector(".an-deeper").style.visibility, "hidden", "not while searching");
	w().reply("bestmove c7c5");
	assert.match(panel.querySelector(".an-engine-info").textContent, /depth 12 ✓/);
	click(panel, ".an-note-eval");
	assert.deepStrictEqual(activeLine(s).comments, [
		{ ply: 0, text: "Stockfish: +0.30 (depth 12), 1...c5 2.Nf3" },
	]);
	click(panel, ".an-deeper");
	assert.ok(w().sent.includes("go infinite"));
	done();
});

test("Space plays the engine's best move, but not while a button has focus", () => {
	const done = installDom();
	const { engine, w } = engineWith();
	engine.enable();
	const s = newScratch([{ san: "e4" }]);
	const panel = analysisPanel(s, () => {}, { engine });
	keyOn(panel, " "); // nothing found yet
	assert.strictEqual(activeLine(s).moves.length, 1);
	w().reply("info depth 12 multipv 1 score cp -30 pv c7c5 g1f3");
	keyOn(panel, " ", panel.querySelector(".an-flip"));
	assert.strictEqual(activeLine(s).moves.length, 1);
	keyOn(panel, " ");
	assert.deepStrictEqual(activeLine(s).moves.map((m) => m.san), ["e4", "c5"]);
	done();
});

test("the engine's settings change what it searches", () => {
	const done = installDom();
	const { engine, w } = engineWith();
	engine.enable();
	const panel = analysisPanel(newScratch(), () => {}, { engine });
	const pv = panel.querySelector(".an-engine-pv");
	pv.value = "3";
	pv.onchange();
	assert.strictEqual(engine.multiPv, 3);
	const depth = panel.querySelector(".an-engine-depth");
	assert.strictEqual(depth.type, "number");
	assert.strictEqual(depth.value, "22", "shows the depth in force");
	depth.value = "25";
	depth.onchange();
	assert.strictEqual(engine.depth, 25, "any depth, not just the old list");
	depth.value = "0";
	depth.onchange();
	assert.strictEqual(engine.depth, 0, "0 is no limit");
	assert.strictEqual(panel.querySelector(".an-depth-inf").textContent, "∞");
	for (const bad of ["", "-3", "2.5", "500"]) {
		depth.value = bad;
		depth.onchange();
		assert.strictEqual(engine.depth, 0, `"${bad}" is refused`);
		assert.strictEqual(depth.value, "0", "and the box is put back");
	}
	assert.ok(w().sent.includes("setoption name MultiPV value 3"));
	done();
});

test("the engine box says when it failed and when the game is over", () => {
	const done = installDom();
	const engine = createEngine(() => {
		throw new Error("no wasm here");
	}, { throttle: 0 });
	engine.enable();
	const panel = analysisPanel(newScratch(), () => {}, { engine });
	assert.match(panel.querySelector(".an-engine-info").textContent, /Engine failed: no wasm here/);
	const { engine: e2 } = engineWith();
	e2.enable();
	const mate = newScratch(["f3", "e5", "g4", "Qh4#"].map((san) => ({ san })));
	assert.match(analysisPanel(mate, () => {}, { engine: e2 }).querySelector(".an-engine-info").textContent, /Game over/);
	done();
});

test("the engine box keeps its rows between positions, so it does not jump", () => {
	const done = installDom();
	const { engine, w } = engineWith(); // two lines asked for
	engine.enable();
	const s = newScratch([{ san: "e4" }]);
	let panel = analysisPanel(s, () => {}, { engine });
	assert.strictEqual(panel.querySelectorAll(".an-pv").length, 2, "two rows before anything is found");
	assert.strictEqual(panel.querySelectorAll(".an-pv.empty").length, 2);
	assert.ok(panel.querySelector(".an-note-eval").disabled);
	w().reply("info depth 12 multipv 1 score cp -80 pv c7c5 g1f3");
	assert.strictEqual(panel.querySelectorAll(".an-pv").length, 2, "one found, one still held");
	assert.strictEqual(panel.querySelectorAll(".an-pv.empty").length, 1);
	const height = panel.querySelector(".an-evalfill").style.height;
	// a move: the new panel starts with its rows held and the bar where it was
	play(s, "c5");
	panel = analysisPanel(s, () => {}, { engine });
	assert.strictEqual(panel.querySelectorAll(".an-pv").length, 2);
	assert.strictEqual(panel.querySelector(".an-evalfill").style.height, height);
	done();
});

// ---- notes into the notebook, and the lines on view

import { openAt } from "../src/analysis.js";

test("the note tools save to the notebook and say so", () => {
	const done = installDom();
	loadState("1. e4 c5 2. Nf3 d6 *");
	const s = newScratch();
	openAt(s, [{ san: "e4" }, { san: "c5" }], getCurrent().lines);
	activeLine(s).comments.push({ ply: 1, text: "the Sicilian" });
	let panel = analysisPanel(s, () => {});
	assert.match(panel.querySelector(".an-note-nb").textContent, /In the notebook: no note/);
	click(panel, ".an-save-note");
	assert.deepStrictEqual(getCurrent().lines[0].comments, [{ ply: 1, text: "the Sicilian" }]);
	panel = analysisPanel(s, () => {});
	assert.strictEqual(panel.querySelector(".an-note-msg").textContent, "Note saved to the notebook.");
	assert.strictEqual(panel.querySelector(".an-note-nb"), null, "the two agree now");
	assert.strictEqual(analysisPanel(s, () => {}).querySelector(".an-note-msg"), null, "said once");
	// cleared on the board, cleared in the notebook
	activeLine(s).comments = [];
	click(analysisPanel(s, () => {}), ".an-save-note");
	assert.strictEqual(analysisPanel(s, () => {}).querySelector(".an-note-msg").textContent, "Note cleared in the notebook.");
	assert.deepStrictEqual(getCurrent().lines[0].comments, []);
	done();
});

test("off the notebook, Save note is disabled and Save all says what it could not keep", () => {
	const done = installDom();
	loadState("1. e4 c5 *");
	const s = newScratch([{ san: "d4" }]);
	activeLine(s).comments = [{ ply: 0, text: "queen's pawn" }];
	let panel = analysisPanel(s, () => {});
	assert.ok(panel.querySelector(".an-save-note").disabled);
	assert.match(panel.querySelector(".an-note-nb").textContent, /not in the notebook yet/);
	click(panel, ".an-save-notes");
	panel = analysisPanel(s, () => {});
	assert.match(panel.querySelector(".an-note-msg").textContent, /0 notes saved.*1 is on moves not in the notebook/);
	// at the start position, only Save all is offered
	goTo(s, 0);
	panel = analysisPanel(s, () => {});
	assert.strictEqual(panel.querySelector(".an-save-note"), null);
	assert.ok(panel.querySelector(".an-save-notes"));
	done();
});

test("the list follows the cursor, and show all toggles", () => {
	const done = installDom();
	loadState("1. e4 c5 2. Nf3 (2. Nc3) d6 *");
	const s = newScratch();
	openAt(s, [{ san: "d4" }], []);
	openAt(s, [{ san: "e4" }, { san: "c5" }], getCurrent().lines);
	let panel = analysisPanel(s, () => {});
	assert.match(panel.querySelector(".an-sec").textContent, /Lines through 1\.\.\.c5 \(2\)/);
	assert.strictEqual(panel.querySelectorAll(".an-line").length, 2);
	// into the 2.Nf3 branch: 2.Nc3 no longer leads here
	forward(s);
	panel = analysisPanel(s, () => {});
	assert.match(panel.querySelector(".an-sec").textContent, /Lines through 2\.Nf3 \(1\)/);
	assert.match(panel.querySelector(".an-showall").textContent, /show all 3 on the board/);
	panel.querySelector(".an-showall").click();
	panel = analysisPanel(s, () => {});
	assert.match(panel.querySelector(".an-sec").textContent, /^All lines on the board \(3\)/);
	assert.strictEqual(panel.querySelectorAll(".an-line").length, 3);
	assert.ok(panel.querySelector(".an-line.elsewhere"), "lines off the position are marked");
	// and back again: the toggle is the way to hide them
	panel.querySelector(".an-showall").click();
	assert.strictEqual(analysisPanel(s, () => {}).querySelectorAll(".an-line").length, 1);
	done();
});

test("a pinned line stays in view wherever the cursor goes, until the board closes", async () => {
	const done = installDom();
	const { closeBoard } = await import("../src/analysis.js");
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	goTo(s, 1);
	play(s, "c5"); // in the fork: 1...e5 is off view
	goTo(s, 1);
	let panel = analysisPanel(s, () => {});
	const pinBtn = panel.querySelectorAll(".an-pin")[0];
	assert.strictEqual(pinBtn.getAttribute("aria-pressed"), "false");
	pinBtn.click();
	forward(s);
	panel = analysisPanel(s, () => {});
	assert.strictEqual(panel.querySelectorAll(".an-line").length, 2, "the pinned 1...e5 stays");
	assert.ok(panel.querySelector(".an-line.elsewhere .an-pin.on"));
	closeBoard(s);
	assert.strictEqual(analysisPanel(s, () => {}).querySelectorAll(".an-line").length, 1, "closing unpins");
	done();
});

test("lines through the opened position pick up at its move", () => {
	const done = installDom();
	loadState("1. e4 c5 2. Nf3 d6 3. d4 (3. c3) *");
	const s = newScratch();
	openAt(s, ["e4", "c5", "Nf3", "d6"].map((san) => ({ san })), getCurrent().lines);
	const rows = analysisPanel(s, () => {}).querySelectorAll(".an-line");
	const texts = [...rows].map((r) => [...r.querySelectorAll(".an-elide, .an-move")].map((n) => n.textContent).join(" "));
	assert.deepStrictEqual(texts, ["… 2...d6 3.d4", "… 2...d6 3.c3"]);
	// the cursor's own move stays in view even when it is before the position
	goTo(s, 1);
	const back = analysisPanel(s, () => {}).querySelector(".an-line.active");
	assert.match(back.textContent, /^1\.e4c5/, "stepped back before it, the line shows whole");
	done();
});

test("each line on view has its own add buttons, which add that line", () => {
	const done = installDom();
	loadState("1. e4 e5 2. Nf3 Nc6 *");
	const s = newScratch([{ san: "d4" }, { san: "d5" }]);
	goTo(s, 1);
	play(s, "Nf6");
	goTo(s, 1); // both 1.d4 lines on view; the second is selected
	let added = 0;
	const panel = analysisPanel(s, () => {}, { onAdded: () => added++ });
	const rows = panel.querySelectorAll(".an-line");
	assert.strictEqual(rows.length, 2);
	rows[0].querySelector(".an-add-foot").click(); // the first, not the selected one
	const last = getCurrent().lines[getCurrent().lines.length - 1];
	assert.deepStrictEqual(last.moves.map((m) => m.san), ["d4", "d5"]);
	assert.strictEqual(last.tag, "foot");
	assert.strictEqual(added, 1);
	assert.strictEqual(s.active, 1, "adding did not change the selection");
	done();
});

test("an unselected row starts where it leaves the lines above it", () => {
	const done = installDom();
	loadState("1. e4 c5 2. Nf3 d6 3. d4 cxd4 (3... Nf6 4. Nc3) 4. Nxd4 *");
	const s = newScratch();
	openAt(s, [{ san: "e4" }, { san: "c5" }], getCurrent().lines);
	const rows = [...analysisPanel(s, () => {}).querySelectorAll(".an-line")].map((r) =>
		[...r.querySelectorAll(".an-elide, .an-move")].map((n) => n.textContent).join(" "),
	);
	// the selected (first) line from the position; the other from the move
	// before it parts company, so the two can be told apart at a glance
	assert.deepStrictEqual(rows, ["… 1...c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4", "… 3.d4 Nf6 4.Nc3"]);
	done();
});

test("a move in a capitalised heading keeps its case (Nbd7, not NBD7)", () => {
	const done = installDom();
	loadState("1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Nbd7 *");
	const s = newScratch();
	for (const san of ["e4", "d5", "exd5", "c6", "dxc6", "Nf6", "cxb7", "Nbd7"]) play(s, san);
	const panel = analysisPanel(s, () => {});
	const heads = [...panel.querySelectorAll(".an-sec")];
	// the heading is text-transform: uppercase; the move sits in its own span
	// that the stylesheet exempts
	const sans = heads.flatMap((h) => [...h.querySelectorAll(".an-san")].map((x) => x.textContent));
	assert.ok(sans.some((t) => t.includes("Nbd7")), "Lines through … names the move in a span");
	assert.ok(sans.some((t) => /Nbd7/.test(t) && heads.some((h) => /^Note on/.test(h.textContent))), "Note on … too");
	done();
});
