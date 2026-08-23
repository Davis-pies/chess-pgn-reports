import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import {
	lineEditor,
	promoteMainline,
	moveStrip,
	movePanel,
	commentEditor,
	EVAL_SYMBOLS,
} from "../src/line-editor.js";
import { getCurrent } from "../src/state.js";

const TWO_LINES = "1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6";
const chips = (node) => [...node.querySelectorAll("button.move-chip")];
const byText = (node, sel, txt) =>
	[...node.querySelectorAll(sel)].find((b) => b.textContent === txt);

test("lineEditor labels the mainline and offers tag buttons only on other lines", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const main = lineEditor(s.lines[0], 0);
	assert.ok(main.querySelector(".maintag"), "mainline shows a static label");
	assert.strictEqual(byText(main, "button", "Sideline"), undefined);

	const other = lineEditor(s.lines[1], 1);
	assert.ok(byText(other, "button", "Sideline"), "sideline button offered");
	assert.ok(byText(other, "button", "Footnote"), "footnote button offered");
	assert.ok(byText(other, "button", "★ Make mainline"), "promote offered");
	off();
});

test("lineEditor pre-populates a default name and writes edits back to the line", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	lineEditor(s.lines[0], 0);
	assert.strictEqual(s.lines[0].name, "Mainline");

	let renders = 0;
	const s2 = loadState(TWO_LINES, { renderHooks: { renderApp: () => renders++ } });
	const row = lineEditor(s2.lines[1], 3);
	assert.strictEqual(s2.lines[1].name, "Line 3");
	const name = row.querySelector("input.ln");
	name.value = "Sicilian";
	name.oninput();
	assert.strictEqual(s2.lines[1].name, "Sicilian");
	assert.strictEqual(renders, 0, "typing does not re-render");
	name.onchange();
	assert.strictEqual(renders, 1, "blur re-renders");
	off();
});

test("lineEditor's tag buttons toggle the tag on and back off", () => {
	const off = installDom();
	let renders = 0;
	const s = loadState(TWO_LINES, { renderHooks: { renderApp: () => renders++ } });
	const row = lineEditor(s.lines[1], 1);
	byText(row, "button", "Sideline").onclick();
	assert.strictEqual(s.lines[1].tag, "sideline");
	byText(row, "button", "Sideline").onclick();
	assert.strictEqual(s.lines[1].tag, null, "clicking the active tag clears it");
	assert.strictEqual(renders, 2);
	off();
});

test("lineEditor's note field writes to meta.note", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const row = lineEditor(s.lines[1], 1);
	const note = row.querySelector("input.lno");
	note.value = "sharp";
	note.oninput();
	assert.strictEqual(s.lines[1].meta.note, "sharp");
	off();
});

test("lineEditor renders an end-position board only when boards are enabled", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	assert.strictEqual(lineEditor(s.lines[0], 0).querySelector(".ledge-board"), null);
	assert.ok(lineEditor(s.lines[0], 0, true).querySelector(".ledge-board"));
	off();
});

test("promoteMainline swaps which line is the mainline and demotes the old one", () => {
	const off = installDom();
	let renders = 0;
	const s = loadState(TWO_LINES, { renderHooks: { renderApp: () => renders++ } });
	assert.strictEqual(s.lines[0].isMain, true);
	promoteMainline(s.lines[1]);
	assert.strictEqual(s.lines[1].isMain, true);
	assert.strictEqual(s.lines[1].tag, undefined);
	assert.strictEqual(s.lines[0].isMain, false);
	assert.strictEqual(s.lines[0].tag, "sideline", "old mainline becomes a sideline");
	assert.strictEqual(renders, 1);
	off();
});

test("promoteMainline keeps an existing tag on the demoted line", () => {
	const off = installDom();
	const s = loadState(TWO_LINES, { tags: { 0: "foot" } });
	promoteMainline(s.lines[1]);
	assert.strictEqual(s.lines[0].tag, "foot");
	off();
});

test("moveStrip shows every mainline move, and only the divergent tail elsewhere", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	assert.deepStrictEqual(
		chips(moveStrip(s.lines[0])).map((b) => b.textContent),
		["1. e4", "e5", "2. Nf3", "Nc6"],
	);
	// the variation shares 1. e4, so its strip starts at c5
	const strip = moveStrip(s.lines[1]);
	assert.deepStrictEqual(
		chips(strip).map((b) => b.textContent),
		["c5", "2. Nf3", "Nc6"],
	);
	// and it is prefixed with the divergence context
	assert.strictEqual(strip.querySelector(".ctxchip").textContent, "→ 1. e4");
	off();
});

test("moveStrip shows a move's mark on its chip", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	s.lines[0].marks[0] = "!";
	assert.strictEqual(chips(moveStrip(s.lines[0]))[0].textContent, "1. e4 · !");
	off();
});

test("moveStrip flags moves carrying a note and shows the note number", () => {
	const off = installDom();
	const s = loadState("1. e4 {solid} e5 2. Nf3");
	const [first, second] = chips(moveStrip(s.lines[0]));
	assert.match(first.className, /has-note/);
	assert.strictEqual(first.querySelector("sup").textContent, "1");
	assert.ok(!/has-note/.test(second.className));
	assert.strictEqual(second.querySelector("sup"), null);
	off();
});

test("clicking a move selects it, and clicking it again clears the selection", () => {
	const off = installDom();
	let renders = 0;
	const s = loadState(TWO_LINES, { renderHooks: { renderApp: () => renders++ } });
	chips(moveStrip(s.lines[0]))[1].onclick();
	assert.strictEqual(getCurrent().sel.ply, 1);
	assert.ok(getCurrent().sel.lines.includes(s.lines[0]));
	// re-render the strip against the new selection: the chip is marked active
	assert.match(chips(moveStrip(s.lines[0]))[1].className, /\bon\b/);
	chips(moveStrip(s.lines[0]))[1].onclick();
	assert.strictEqual(getCurrent().sel, null);
	assert.strictEqual(renders, 2);
	off();
});

test("selecting a shared move targets every line that reaches the same position", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	// 1. e4 is the shared first move of both lines
	chips(moveStrip(s.lines[0]))[0].onclick();
	assert.strictEqual(getCurrent().sel.ply, 0);
	assert.strictEqual(getCurrent().sel.lines.length, 2, "both lines targeted");
	off();
});

test("movePanel applies a symbol to the selected move and toggles it off again", () => {
	const off = installDom();
	let renders = 0;
	const s = loadState(TWO_LINES, { renderHooks: { renderApp: () => renders++ } });
	s.sel = { lines: [s.lines[0]], ply: 0 };
	byText(movePanel(s.lines[0]), "button.chip.mini", "!").onclick();
	assert.strictEqual(s.lines[0].marks[0], "!");
	// rebuilt against the new state, the same button now clears the mark
	const again = movePanel(s.lines[0]);
	assert.match(byText(again, "button.chip.mini", "!").className, /\bon\b/);
	byText(again, "button.chip.mini", "!").onclick();
	assert.strictEqual(s.lines[0].marks, undefined, "last mark removed clears marks");
	assert.strictEqual(renders, 2);
	off();
});

test("movePanel's clear button removes the selected move's mark", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	s.lines[0].marks[0] = "!";
	s.sel = { lines: [s.lines[0]], ply: 0 };
	movePanel(s.lines[0]).querySelector("button.danger").onclick();
	assert.strictEqual(s.lines[0].marks, undefined);
	off();
});

test("movePanel edits the line-end evaluation when no move is selected", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	s.sel = { lines: [s.lines[0]], ply: null };
	const panel = movePanel(s.lines[0]);
	assert.match(panel.querySelector(".symlabel").textContent, /@ line-end/);
	// no board and no comment editor at line-end
	assert.strictEqual(panel.querySelector(".mp-board"), null);
	assert.strictEqual(panel.querySelector(".cedit"), null);
	byText(panel, "button.chip.mini", "=").onclick();
	assert.strictEqual(s.lines[0].meta.eval, "=");
	off();
});

test("movePanel shows a board and note count for a selected move", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	s.sel = { lines: [s.lines[0], s.lines[1]], ply: 0 };
	const panel = movePanel(s.lines[0]);
	assert.ok(panel.querySelector(".mp-board svg"), "position board rendered");
	assert.ok(panel.querySelector(".cedit"), "comment editor rendered");
	assert.match(panel.querySelector(".symlabel").textContent, /@ 1\.e4 · 2 shared:/);
	off();
});

test("movePanel offers every evaluation symbol plus a clear button", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	s.sel = { lines: [s.lines[0]], ply: 0 };
	const picks = movePanel(s.lines[0]).querySelectorAll(".sympick button");
	// EVAL_SYMBOLS leads with "" (the no-symbol default), which is not a button
	assert.strictEqual(picks.length, EVAL_SYMBOLS.length - 1 + 1);
	off();
});

test("movePanel's done button clears the selection", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	s.sel = { lines: [s.lines[0]], ply: 0 };
	byText(movePanel(s.lines[0]), "button", "done").onclick();
	assert.strictEqual(s.sel, null);
	off();
});

test("commentEditor adds a note to every line in the shared group", () => {
	const off = installDom();
	let renders = 0;
	const s = loadState(TWO_LINES, { renderHooks: { renderApp: () => renders++ } });
	const group = [s.lines[0], s.lines[1]];
	const ed = commentEditor(0, group);
	assert.strictEqual(
		ed.querySelector("input.lno").placeholder,
		"note at this move…",
	);
	ed.querySelector("input.lno").value = "  the King's pawn  ";
	byText(ed, "button", "Add note").onclick();
	for (const l of group)
		assert.deepStrictEqual(l.comments, [{ ply: 0, text: "the King's pawn" }]);
	assert.strictEqual(ed.querySelector("input.lno").value, "", "input cleared");
	assert.strictEqual(renders, 1);
	off();
});

test("commentEditor ignores an empty or whitespace-only note", () => {
	const off = installDom();
	let renders = 0;
	const s = loadState(TWO_LINES, { renderHooks: { renderApp: () => renders++ } });
	const ed = commentEditor(0, [s.lines[0]]);
	ed.querySelector("input.lno").value = "   ";
	byText(ed, "button", "Add note").onclick();
	assert.deepStrictEqual(s.lines[0].comments, []);
	assert.strictEqual(renders, 0);
	off();
});

test("commentEditor lists existing notes and edits them in place", () => {
	const off = installDom();
	const s = loadState("1. e4 {solid} e5 2. Nf3");
	const ed = commentEditor(0, [s.lines[0]]);
	const rows = [...ed.querySelectorAll(".nt")];
	assert.strictEqual(rows.length, 1);
	assert.strictEqual(rows[0].querySelector("input").value, "solid");
	// the trailing input is the "add another" field once a note exists
	assert.strictEqual(
		ed.querySelector(":scope > input.lno").placeholder,
		"add another note…",
	);
	const inp = rows[0].querySelector("input");
	inp.value = "very solid";
	inp.oninput();
	assert.deepStrictEqual(s.lines[0].comments, [{ ply: 0, text: "very solid" }]);
	off();
});

test("commentEditor deletes a note from every line in the group", () => {
	const off = installDom();
	let renders = 0;
	const s = loadState("1. e4 {solid} e5 2. Nf3", {
		renderHooks: { renderApp: () => renders++ },
	});
	const ed = commentEditor(0, [s.lines[0]]);
	ed.querySelector(".nt button.danger").onclick();
	assert.deepStrictEqual(s.lines[0].comments, []);
	assert.strictEqual(renders, 1);
	off();
});

test("commentEditor deduplicates a note shared across the group", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const group = [s.lines[0], s.lines[1]];
	group.forEach((l) => (l.comments = [{ ply: 0, text: "same" }]));
	// one row, not one per line
	assert.strictEqual(commentEditor(0, group).querySelectorAll(".nt").length, 1);
	off();
});

test("lineEditor shows the move panel only on the first line of the selected group", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	s.sel = { lines: [s.lines[1]], ply: 1 };
	assert.strictEqual(lineEditor(s.lines[0], 0).querySelector(".movepanel"), null);
	assert.ok(lineEditor(s.lines[1], 1).querySelector(".movepanel"));
	off();
});

test("selecting a move swaps the line's end-position board for the edit board", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const main = s.lines[0];
	// nothing selected: the inline end-position board is the only board
	const idle = lineEditor(main, 0, true);
	assert.ok(idle.querySelector(".ledge-board"), "end-position board shown");
	assert.strictEqual(idle.querySelector(".mp-board"), null);
	// a move selected on this line: the edit board REPLACES it rather than
	// rendering a second board beside it
	getCurrent().sel = { ply: 2, lines: [main] };
	const editing = lineEditor(main, 0, true);
	assert.ok(editing.querySelector(".mp-board svg"), "edit board shown");
	assert.strictEqual(
		editing.querySelector(".ledge-board"),
		null,
		"the end-position board is hidden while editing a move",
	);
	off();
});

test("a line-end selection keeps the end-position board", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const main = s.lines[0];
	// ply null is the line-end selection: movePanel draws no board, so the
	// line's own end-position board has nothing to give way to
	getCurrent().sel = { ply: null, lines: [main] };
	const box = lineEditor(main, 0, true);
	assert.strictEqual(box.querySelector(".mp-board"), null);
	assert.ok(box.querySelector(".ledge-board"), "end-position board kept");
	off();
});

test("a sibling sharing the selection keeps its own end-position board", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const [main, other] = s.lines;
	// the panel renders only on sel.lines[0]; the sibling shows no edit board,
	// so hiding its end-position board would leave it with none at all
	getCurrent().sel = { ply: 2, lines: [main, other] };
	const box = lineEditor(other, 1, true);
	assert.strictEqual(box.querySelector(".mp-board"), null);
	assert.ok(box.querySelector(".ledge-board"), "sibling keeps its board");
	off();
});
