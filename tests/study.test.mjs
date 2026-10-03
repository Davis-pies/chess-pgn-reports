// tests/study.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { activeLine, goTo } from "../src/analysis.js";
import { backToBook, newStudy, studyMark, studyNotes, studyPlay, studyPlayAll } from "../src/study.js";
import { studyPanel, STUDY_KEYS } from "../src/study-view.js";
import { createEngine } from "../src/engine.js";
import { numberNotes } from "../src/notes.js";

const sans = (l) => l.moves.map((m) => m.san);
const NOTED = "1. e4 e5 2. Nf3 {Develops.} Nc6 (2... Nf6 3. d4 {The Petroff.}) 3. Bb5 a6";

const click = (root, sel) => {
	const n = root.querySelector(sel);
	assert.ok(n, `no ${sel}`);
	n.click();
	return n;
};
const keyOn = (panel, key, target = panel) =>
	target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

// ---- the model

test("a study copies the workbook's lines, mainline first, and opens at a move", () => {
	const s = loadState(NOTED);
	const st = newStudy([...s.lines].reverse());
	assert.strictEqual(st.lines[0].src, s.lines.find((l) => l.isMain), "the mainline leads");
	assert.strictEqual(st.at, 0);
	st.lines[0].moves[0].san = "MUTATED";
	assert.strictEqual(s.lines[0].moves[0].san, "e4", "the moves are copies");

	const at = newStudy(s.lines, sans(s.lines[1]).slice(0, 4).map((san) => ({ san })));
	assert.deepStrictEqual(sans(activeLine(at)), ["e4", "e5", "Nf3", "Nf6", "d4"]);
	assert.strictEqual(at.at, 4, "after the move it was opened on");
	assert.strictEqual(newStudy(s.lines, [{ san: "d4" }]).at, 0, "a position not in the book opens at the start");
});

test("an empty workbook still gives a board to play on", () => {
	const st = newStudy([]);
	assert.strictEqual(st.lines.length, 1);
	assert.ok(st.lines[0].off);
});

test("playing follows the book, then another book line, then leaves it", () => {
	const s = loadState(NOTED);
	const st = newStudy(s.lines);
	studyPlayAll(st, ["e4", "e5", "Nf3"]);
	assert.strictEqual(st.active, 0);
	studyPlay(st, "Nf6");
	assert.strictEqual(activeLine(st).src, s.lines[1], "onto the line that plays it");
	assert.strictEqual(st.lines.length, 2, "nothing new for a book move");

	studyPlay(st, "Nxe4");
	const own = activeLine(st);
	assert.ok(own.off);
	assert.strictEqual(own.offAt, 4);
	assert.strictEqual(own.src, s.lines[1], "it remembers the line it left");
	studyPlay(st, "Bd3");
	assert.strictEqual(st.lines.length, 3, "at its end, the reader's line grows");
	assert.deepStrictEqual(sans(own), ["e4", "e5", "Nf3", "Nf6", "Nxe4", "Bd3"]);
	assert.deepStrictEqual(sans(s.lines[1]), ["e4", "e5", "Nf3", "Nf6", "d4"], "the workbook is untouched");

	// a different move from inside the reader's own line starts another
	goTo(st, 5);
	studyPlay(st, "Qe2");
	assert.strictEqual(st.lines.length, 4);
	assert.strictEqual(activeLine(st).offAt, 4, "still off the book from where the first left it");

	backToBook(st);
	assert.strictEqual(st.lines.length, 2, "the reader's lines go");
	assert.strictEqual(activeLine(st).src, s.lines[1]);
	assert.strictEqual(st.at, 4, "back where the book was left");
	assert.strictEqual(backToBook(st), st, "on the book it does nothing");
});

test("back to the book goes to the book line sharing the most moves", () => {
	const s = loadState(NOTED);
	const st = newStudy(s.lines);
	studyPlayAll(st, ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6"]);
	// it shares five moves with the mainline and three with the Petroff
	backToBook(st);
	assert.strictEqual(activeLine(st).src, s.lines[0]);
	assert.strictEqual(st.at, 5);
});

test("notes along a line are the table's numbered notes on the moves it plays", () => {
	const s = loadState(NOTED);
	const numbering = numberNotes(s.lines);
	const main = studyNotes(s.lines[0].moves, s.lines[0], numbering);
	assert.deepStrictEqual(main.notes.map((n) => [n.ply, n.label]), [[2, 1]]);
	assert.strictEqual(main.foot, null);
	const petroff = studyNotes(s.lines[1].moves, s.lines[1], numbering);
	assert.deepStrictEqual(
		petroff.notes.map((n) => [n.ply, n.label, n.entry.text]),
		[
			[2, 1, "Develops."],
			[4, 2, "The Petroff."],
		],
		"a note on a shared move is on both lines",
	);
	// the reader's own moves keep the notes on the moves they share
	const own = [...s.lines[1].moves.slice(0, 3), { san: "Bc5", ply: 3 }];
	assert.deepStrictEqual(studyNotes(own, s.lines[1], numbering).notes.map((n) => n.label), [1]);
	assert.deepStrictEqual(studyNotes(own, undefined, numbering).notes.map((n) => n.label), [1]);
});

test("a footnote sits on the move it replaces; its line has its lettered notes", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {Open Sicilian.}) 2. Nf3", { tags: { 1: "foot" } });
	const numbering = numberNotes(s.lines);
	const main = studyNotes(s.lines[0].moves, s.lines[0], numbering);
	assert.strictEqual(main.notes.length, 1);
	assert.ok(main.notes[0].entry.foot, "the footnote's [1] is on 1...e5");
	assert.strictEqual(main.notes[0].ply, 1);
	const foot = studyNotes(s.lines[1].moves, s.lines[1], numbering);
	assert.strictEqual(foot.foot.n, 1, "the line knows which footnote it is");
	assert.deepStrictEqual(foot.notes.map((n) => [n.ply, n.label, n.sub.text]), [[2, "a", "Open Sicilian."]]);
});

test("a grouped footnote's line finds its notes down the group's tree", () => {
	const s = loadState("1. e4 e5 (1... c5 {Sharp.} 2. Nf3) (1... c5 2. Nc3 {Closed.}) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const numbering = numberNotes(s.lines);
	const closed = studyNotes(s.lines[2].moves, s.lines[2], numbering);
	assert.strictEqual(closed.foot.n, 1);
	assert.ok(closed.notes.some((n) => n.sub && n.sub.text === "Closed."));
	assert.ok(!closed.notes.some((n) => n.sub && n.sub.text === "Open."));
});

test("a move's symbol comes from its workbook line while the moves agree", () => {
	const s = loadState("1. e4 e5 2. Nf3! Nc6");
	const line = { moves: s.lines[0].moves.slice(0, 2), src: s.lines[0] };
	assert.strictEqual(studyMark({ moves: s.lines[0].moves, src: s.lines[0] }, 2), "$1");
	assert.strictEqual(studyMark(line, 2), undefined, "a move the line does not play");
	assert.strictEqual(studyMark({ moves: [] }, 0), undefined, "no workbook line");
});

// ---- the panel

test("the panel draws the board, the line and its notes", () => {
	const done = installDom();
	const s = loadState(NOTED);
	const st = newStudy(s.lines);
	let panel = studyPanel(st, () => {});
	assert.ok(panel.querySelector(".an-board svg"));
	assert.strictEqual(panel.querySelector(".st-name").textContent, "Mainline");
	assert.strictEqual(panel.querySelector(".st-count").textContent, "1 of 2");
	assert.strictEqual(panel.querySelector(".st-here").textContent, "The start position.");
	assert.strictEqual(panel.querySelectorAll(".st-note").length, 1);
	assert.ok(panel.querySelector(".st-note").classList.contains("ahead"));
	// nothing that edits the workbook
	for (const sel of [".an-add", ".an-del", ".an-rename", ".cedit", ".an-cut", ".an-undo", ".an-note-eval"])
		assert.strictEqual(panel.querySelector(sel), null, sel);

	goTo(st, 3);
	panel = studyPanel(st, () => {});
	assert.match(panel.querySelector(".st-moves .an-move.at").textContent, /^2\.Nf3\[1\]$/);
	assert.match(panel.querySelector(".st-here").textContent, /\[1\]Develops\./);
	assert.ok(panel.querySelector(".st-note").classList.contains("here"));
	goTo(st, 4);
	panel = studyPanel(st, () => {});
	assert.strictEqual(panel.querySelector(".st-here").textContent, "No note on this move.");
	done();
});

test("clicks go to a move and to a note's move", () => {
	const done = installDom();
	const s = loadState(NOTED);
	const st = newStudy(s.lines);
	let changed = 0;
	const panel = studyPanel(st, () => changed++);
	panel.querySelectorAll(".st-moves .an-move")[1].click();
	assert.strictEqual(st.at, 2);
	click(panel, ".st-note-go");
	assert.strictEqual(st.at, 3);
	assert.strictEqual(changed, 2);
	done();
});

const OPENINGS = "1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nc3) (1... e6) 2. Nf3 Nc6 3. Bb5 (3. Bc4 Bc5) a6 *";
const named = () => {
	const s = loadState(OPENINGS);
	s.lines.forEach((l, i) => i && (l.name = ["", "Open", "Closed", "French", "Italian"][i]));
	return s;
};

test("◀ ▶ step through every line in order, and the picker goes to any", () => {
	const done = installDom();
	const s = named();
	const st = newStudy(s.lines);
	goTo(st, 4); // 3.Bb5 on the mainline
	let changed = 0;
	let panel = studyPanel(st, () => changed++);
	const options = [...panel.querySelectorAll(".st-pick option")].map((o) => o.textContent);
	assert.deepStrictEqual(options, ["1. Mainline", "2. Open · 2.Nf3", "3. Closed · 2.Nc3", "4. French · 1...e6", "5. Italian · 3.Bc4"]);
	assert.strictEqual(panel.querySelector(".st-pick").value, "0");

	click(panel, ".st-next");
	assert.strictEqual(activeLine(st).src.name, "Open");
	assert.strictEqual(st.at, 3, "on the line's own first move, 2.Nf3");
	click(studyPanel(st, () => changed++), ".st-next");
	assert.strictEqual(activeLine(st).src.name, "Closed");
	assert.strictEqual(st.at, 3, "2.Nc3, where it leaves the Open");
	click(studyPanel(st, () => changed++), ".st-prev");
	assert.strictEqual(activeLine(st).src.name, "Open");
	// a line through the position keeps the board where it is
	goTo(st, 2);
	click(studyPanel(st, () => changed++), ".st-next");
	assert.strictEqual(st.at, 2);
	// to the mainline: where the line being read left it
	panel = studyPanel(st, () => changed++);
	const pick = panel.querySelector(".st-pick");
	goTo(st, 3);
	pick.value = "0";
	pick.dispatchEvent(new window.Event("change"));
	assert.strictEqual(activeLine(st).src.isMain, true);
	assert.strictEqual(st.at, 2, "1...e5, where the Closed left it");
	// round the end
	click(studyPanel(st, () => changed++), ".st-prev");
	assert.strictEqual(activeLine(st).src.name, "Italian");
	click(studyPanel(st, () => changed++), ".st-next");
	assert.ok(activeLine(st).src.isMain);
	assert.strictEqual(changed, 7);
	done();
});

test("from your own moves the switcher counts from the line you left", () => {
	const done = installDom();
	const s = named();
	const st = newStudy(s.lines);
	studyPlayAll(st, ["e4", "e5", "Nf3", "Nc6", "d4"]);
	const panel = studyPanel(st, () => {});
	assert.strictEqual(panel.querySelector(".st-pick option").textContent, "Your moves");
	assert.strictEqual(panel.querySelector(".st-count").textContent, "5 lines");
	click(panel, ".st-next");
	assert.strictEqual(activeLine(st).src.name, "Open");
	assert.strictEqual(st.lines.length, 6, "your moves are kept until you go back to the book");
	done();
});

test("a lone line has nothing to switch to", () => {
	const done = installDom();
	const s = loadState("1. e4 e5 *");
	const panel = studyPanel(newStudy(s.lines), () => {});
	assert.ok(panel.querySelector(".st-prev").disabled);
	assert.ok(panel.querySelector(".st-next").disabled);
	assert.strictEqual(panel.querySelector(".st-name").textContent, "Mainline");
	done();
});

test("a footnote in the notes offers its line, and its line says what it is", () => {
	const done = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {Open Sicilian.}) 2. Nf3", { tags: { 1: "foot" } });
	s.lines[0].meta = { eval: "=", note: "The *main* line." };
	const st = newStudy(s.lines);
	let panel = studyPanel(st, () => {});
	assert.strictEqual(panel.querySelector(".st-eval").textContent, "=");
	assert.strictEqual(panel.querySelector(".st-linenote em").textContent, "main");
	click(panel, ".st-read-foot");
	assert.strictEqual(activeLine(st).src, s.lines[1]);
	assert.strictEqual(st.at, 2, "on the footnote's own first move");
	panel = studyPanel(st, () => {});
	assert.strictEqual(panel.querySelector(".st-tag").textContent, "footnote [1]");
	assert.strictEqual(panel.querySelector(".st-read-foot"), null, "not offered on the footnote itself");
	assert.match(panel.querySelector(".st-notes").textContent, /\[a\] 2\.Nf3Open Sicilian\./);
	done();
});

test("a move of your own is said so, and B or the button goes back", () => {
	const done = installDom();
	const s = loadState(NOTED);
	const st = newStudy(s.lines);
	studyPlayAll(st, ["e4", "c5"]);
	let panel = studyPanel(st, () => {});
	assert.strictEqual(panel.querySelector(".st-name").textContent, "Your moves");
	assert.match(panel.querySelector(".st-off").textContent, /Off the book after 1\.e4/);
	assert.ok(panel.querySelector(".st-moves .st-own"));
	keyOn(panel, "b");
	assert.ok(!activeLine(st).off);
	assert.strictEqual(st.at, 1);

	studyPlay(st, "d5");
	panel = studyPanel(st, () => {});
	click(panel, ".st-head .st-book");
	assert.ok(!activeLine(st).off);


	const fresh = newStudy(s.lines);
	studyPlay(fresh, "d4");
	assert.match(studyPanel(fresh, () => {}).querySelector(".st-off").textContent, /from the start/);
	done();
});

test("the keys step, switch lines, flip, and open the help", () => {
	const done = installDom();
	const s = loadState(NOTED);
	const st = newStudy(s.lines);
	let changed = 0;
	const panel = studyPanel(st, () => changed++);
	keyOn(panel, "End");
	assert.strictEqual(st.at, 6);
	keyOn(panel, "Home");
	keyOn(panel, "ArrowRight");
	keyOn(panel, "ArrowRight");
	keyOn(panel, "ArrowRight");
	keyOn(panel, "ArrowLeft");
	assert.strictEqual(st.at, 2);
	keyOn(panel, "]");
	assert.strictEqual(st.at, 3, "where the Petroff leaves");
	keyOn(panel, "[");
	keyOn(panel, "ArrowDown");
	assert.strictEqual(activeLine(st).src, s.lines[1]);
	keyOn(panel, "ArrowUp");
	assert.strictEqual(activeLine(st).src, s.lines[0]);
	keyOn(panel, "F");
	assert.ok(st.flipped);
	keyOn(panel, "?");
	assert.ok(st.help);
	keyOn(panel, "x");
	keyOn(panel, "z", panel); // not a study key
	keyOn(panel, "ArrowLeft", panel.querySelector(".an-type")); // typing in the box
	panel.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", ctrlKey: true, bubbles: true }));
	assert.strictEqual(st.at, 3);
	const helped = studyPanel(st, () => changed++);
	assert.ok(helped.querySelector(".an-help"));
	assert.strictEqual(helped.querySelectorAll(".an-help-keys tr").length, STUDY_KEYS.length - 2, "no engine keys without an engine");
	keyOn(helped, "Escape");
	assert.ok(!st.help);
	done();
});

test("M focuses the move box, and a typed move plays", () => {
	const done = installDom();
	const s = loadState(NOTED);
	const st = newStudy(s.lines);
	const panel = studyPanel(st, () => {});
	document.body.appendChild(panel);
	keyOn(panel, "m");
	const input = panel.querySelector(".an-type");
	assert.strictEqual(document.activeElement, input);
	input.value = "e4";
	input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	assert.strictEqual(st.at, 1);
	assert.ok(!activeLine(st).off);
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

test("the engine runs in the study, its lines play off the book, and no eval is noted", () => {
	const done = installDom();
	let w;
	const engine = createEngine(() => (w = fakeWorker()), { throttle: 0, multiPv: 2 });
	const s = loadState(NOTED);
	const st = newStudy(s.lines);
	studyPlay(st, "e4");
	let panel = studyPanel(st, () => {}, { engine });
	assert.strictEqual(panel.querySelector(".an-engine-toggle").textContent, "Engine off");
	keyOn(panel, "e");
	assert.ok(engine.state.enabled);
	panel = studyPanel(st, () => {}, { engine });
	w.reply("info depth 12 multipv 1 score cp -30 pv c7c5 g1f3");
	w.reply("bestmove c7c5");
	assert.strictEqual(panel.querySelector(".an-note-eval"), null, "the study writes no notes");
	panel.querySelectorAll(".an-pvmove")[1].click();
	assert.deepStrictEqual(sans(activeLine(st)), ["e4", "c5", "Nf3"]);
	assert.ok(activeLine(st).off);
	backToBook(st);
	studyPlay(st, "e5");
	panel = studyPanel(st, () => {}, { engine });
	w.reply("info depth 12 multipv 1 score cp 30 pv g1f3 b8c6");
	keyOn(panel, " ");
	assert.deepStrictEqual(sans(activeLine(st)).slice(0, 3), ["e4", "e5", "Nf3"]);
	assert.ok(!activeLine(st).off, "the engine's choice was the book's");
	assert.strictEqual(studyPanel(st, () => {}, { engine }).querySelectorAll(".an-help-open").length, 1);
	done();
});
