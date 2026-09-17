// tests/analysis-view.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { getCurrent } from "../src/state.js";
import { analysisPanel, numberedMoves } from "../src/analysis-view.js";
import { newScratch, activeLine, play, goTo } from "../src/analysis.js";

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
	const panel = analysisPanel(s, () => {});
	click(panel, ".an-back");
	assert.strictEqual(s.at, 1);
	click(panel, ".an-fwd");
	assert.strictEqual(s.at, 2);
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
	const panel = analysisPanel(s, () => {});
	const rows = panel.querySelectorAll(".an-line");
	assert.strictEqual(rows.length, 2);
	assert.ok(rows[1].classList.contains("active"), "the fork is the active line");
	rows[0].click();
	assert.strictEqual(s.active, 0);
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
	let changed = 0;
	const panel = analysisPanel(s, () => changed++);
	panel.querySelectorAll(".an-del")[0].click();
	assert.strictEqual(s.lines.length, 1);
	assert.deepStrictEqual(activeLine(s).moves.map((m) => m.san), ["e4", "c5"]);
	assert.strictEqual(changed, 1);
	done();
});

test("the note box saves as you type, without redrawing the panel", () => {
	const done = installDom();
	const s = newScratch([{ san: "e4" }, { san: "e5" }]);
	let changed = 0;
	const panel = analysisPanel(s, () => changed++);
	const box = panel.querySelector(".an-note");
	assert.strictEqual(box.disabled, false);
	box.value = "symmetrical";
	box.dispatchEvent(new window.Event("input", { bubbles: true }));
	assert.deepStrictEqual(activeLine(s).comments, [{ ply: 1, text: "symmetrical" }]);
	// A redraw here would replace the button a click is on its way to, which
	// is how a first click on Add used to be swallowed.
	assert.strictEqual(changed, 0);
	assert.ok(panel.querySelector(".an-move.at.has-note"), "the move shows its note at once");
	box.dispatchEvent(new window.Event("change", { bubbles: true }));
	assert.strictEqual(changed, 0, "leaving the box does not redraw either");

	const again = analysisPanel(s, () => {});
	assert.strictEqual(again.querySelector(".an-note").value, "symmetrical");
	done();
});

test("Add takes a note that was typed but never left", () => {
	const done = installDom();
	loadState("1. e4 e5 2. Nf3 Nc6 *");
	const s = newScratch([{ san: "e4" }, { san: "c5" }]);
	const panel = analysisPanel(s, () => {});
	const box = panel.querySelector(".an-note");
	box.value = "the Sicilian";
	box.dispatchEvent(new window.Event("input", { bubbles: true }));
	click(panel, ".an-add");
	const added = getCurrent().lines[getCurrent().lines.length - 1];
	assert.deepStrictEqual(added.moves.map((m) => m.san), ["e4", "c5"]);
	assert.deepStrictEqual(added.comments, [{ ply: 1, text: "the Sicilian" }]);
	done();
});

test("there is no note to write before the first move", () => {
	const done = installDom();
	const panel = analysisPanel(newScratch(), () => {});
	assert.strictEqual(panel.querySelector(".an-note").disabled, true);
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
