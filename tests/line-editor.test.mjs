import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import {
	lineEditor,
	promoteMainline,
	moveStrip,
	movePanel,
	symbolRow,
	commentEditor,
	EVAL_SYMBOLS,
} from "../src/line-editor.js";
import { getCurrent } from "../src/state.js";
import { visibleLines } from "../src/visibility.js";

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
	assert.strictEqual(s.lines[0].marks[0], "$1", "stored as a NAG code");
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

test("lineEditor shows the move panel only on the line the selection is anchored to", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	s.sel = { lines: [s.lines[1]], ply: 1, at: s.lines[1] };
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
	getCurrent().sel = { ply: 2, lines: [main], at: main };
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
	getCurrent().sel = { ply: null, lines: [main], at: main };
	const box = lineEditor(main, 0, true);
	assert.strictEqual(box.querySelector(".mp-board"), null);
	assert.ok(box.querySelector(".ledge-board"), "end-position board kept");
	off();
});

test("a sibling sharing the selection keeps its own end-position board", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const [main, other] = s.lines;
	// the panel renders only on sel.at; the sibling shows no edit board,
	// so hiding its end-position board would leave it with none at all
	getCurrent().sel = { ply: 2, lines: [main, other], at: main };
	const box = lineEditor(other, 1, true);
	assert.strictEqual(box.querySelector(".mp-board"), null);
	assert.ok(box.querySelector(".ledge-board"), "sibling keeps its board");
	off();
});

test("a footnote line's move chip shows its sub-note letter", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const foot = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	const sups = [...moveStrip(foot).querySelectorAll("sup")].map(
		(x) => x.textContent,
	);
	assert.ok(
		sups.includes("a"),
		`the sub-note letter marks the chip (got ${JSON.stringify(sups)})`,
	);
	off();
});

test("movePanel shows every symbol on one row, each glyph once", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	s.sel = { lines: [s.lines[0]], ply: 0 };
	const rows = movePanel(s.lines[0]).querySelectorAll(".sympick");
	assert.strictEqual(rows.length, 1, "one row, no drawer");
	const shown = [...rows[0].children].map((b) => b.textContent);
	// the common ones a reader reaches for first
	assert.ok(shown.includes("!") && shown.includes("±"));
	// and what used to sit behind the fold
	assert.ok(shown.includes("⊙"), "zugzwang is on the row now");
	assert.ok(shown.includes("⇄") && shown.includes("↑"));
	assert.ok(shown.includes("TN") && shown.includes("✕"));
	// several NAGs share a glyph (White's and Black's halves of a pair); the
	// mark stored is the glyph, so a second button would be a duplicate that
	// looked like a different choice
	assert.strictEqual(
		new Set(shown).size,
		shown.length,
		"no glyph appears twice",
	);
	off();
});

test("a symbol that used to live in the drawer still applies its mark", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	s.sel = { lines: [s.lines[0]], ply: 0 };
	[...movePanel(s.lines[0]).querySelectorAll(".sympick button")]
		.find((b) => b.textContent === "↑")
		.onclick();
	// ply 0 is a White move, so the White half of the ↑ pair
	assert.strictEqual(s.lines[0].marks[0], "$36");
	off();
});

test("the mainline offers no Hide chip", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const row = lineEditor(s.lines[0], 0);
	assert.ok(!byText(row, "button", "Hide"), "no Hide chip on the mainline");
	assert.ok(!byText(row, "button", "Focus"), "no Focus chip on the mainline");
	off();
});

test("the Hide chip hides its line and then brings it back", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const side = s.lines[1];
	byText(lineEditor(side, 1), "button", "Hide").click();
	assert.strictEqual(side.hidden, true);
	// the chip on a hidden line reads "Hidden" and clears the flag outright
	byText(lineEditor(side, 1), "button", "Hidden").click();
	assert.strictEqual("hidden" in side, false);
	off();
});

test("Focus hides every other line but keeps the mainline", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5) (1... e6) 2. Nf3");
	const keep = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	byText(lineEditor(keep, 1), "button", "Focus").click();
	const shown = visibleLines(s.lines);
	assert.strictEqual(shown.length, 2, "mainline plus the focused line");
	assert.ok(shown.includes(keep));
	assert.ok(shown.some((l) => l.isMain));
	off();
});

// --- the panel follows the line you clicked, not the group's first line -----
// A shared move belongs to every line reaching the same position, and
// annotating it annotates them all. That group is built in notebook order and
// has no memory of the click, so anchoring the panel to it put the board and
// notes on a line the user had not touched -- and, once that line was hidden,
// inside the collapsed hidden drawer where nothing was visible at all.
//
// Two sidelines that share 1...c5 2. Nf3 d6 and split on move 3. Both diverge
// from the mainline at c5, so both STRIPS render the shared d6 chip -- unlike
// TWO_LINES, where the sideline's shared prefix is elided.
const SHARED_SIBLINGS = "1. e4 e5 (1... c5 2. Nf3 d6 3. d4 (3. Bb5+)) 2. Nf3";
// notebook order puts the Bb5+ line first, so it is the shared group's [0]
const siblings = (s) => [
	s.lines.find((l) => l.moves.some((m) => m.san === "Bb5+")),
	s.lines.find((l) => l.moves.some((m) => m.san === "d4")),
];
// the shared d6 chip: index 2 of the strip (c5, Nf3, d6, ...)
const sharedChip = (l) => chips(moveStrip(l))[2];

test("the move panel opens on the clicked line, not the group's first line", () => {
	const off = installDom();
	const s = loadState(SHARED_SIBLINGS);
	const [first, second] = siblings(s);
	sharedChip(second).onclick();
	assert.strictEqual(getCurrent().sel.ply, 3, "d6 selected");
	assert.strictEqual(getCurrent().sel.at, second, "the clicked line is the anchor");
	assert.strictEqual(getCurrent().sel.lines.length, 2, "both lines still targeted");
	assert.ok(
		lineEditor(second, 2).querySelector(".movepanel"),
		"panel on the clicked line",
	);
	assert.strictEqual(
		lineEditor(first, 1).querySelector(".movepanel"),
		null,
		"no panel on the sibling",
	);
	off();
});

test("a hidden sibling does not swallow the panel for a shared move", () => {
	const off = installDom();
	const s = loadState(SHARED_SIBLINGS);
	const [first, second] = siblings(s);
	// the group's first line is hidden, so a panel anchored to it would render
	// only inside the collapsed hidden drawer
	first.hidden = true;
	sharedChip(second).onclick();
	assert.strictEqual(getCurrent().sel.at, second);
	assert.ok(
		lineEditor(second, 1).querySelector(".movepanel .mp-board svg"),
		"the visible line shows the board",
	);
	off();
});

test("a note on a shared move is reachable from a visible sibling", () => {
	const off = installDom();
	const s = loadState(SHARED_SIBLINGS);
	const [first, second] = siblings(s);
	// the note was written on the group, then the line it was written on hid
	[first, second].forEach((l) => (l.comments = [{ ply: 3, text: "Hmmmmm" }]));
	first.hidden = true;
	sharedChip(second).onclick();
	const notes = [...lineEditor(second, 1).querySelectorAll(".movepanel .nt input")];
	assert.deepStrictEqual(
		notes.map((i) => i.value),
		["Hmmmmm"],
		"the shared note is editable on the visible line",
	);
	off();
});

test("clicking a shared move on a sibling moves the panel rather than clearing it", () => {
	const off = installDom();
	const s = loadState(SHARED_SIBLINGS);
	const [first, second] = siblings(s);
	sharedChip(first).onclick();
	assert.strictEqual(getCurrent().sel.at, first);
	// the same shared move on the other line: re-anchor, do not toggle off
	sharedChip(second).onclick();
	assert.ok(getCurrent().sel, "selection survives");
	assert.strictEqual(getCurrent().sel.at, second, "anchor moved to the sibling");
	// clicking it again on the line it is anchored to does clear it
	sharedChip(second).onclick();
	assert.strictEqual(getCurrent().sel, null);
	off();
});

test("a sibling's shared chip is marked shared, not selected", () => {
	const off = installDom();
	const s = loadState(SHARED_SIBLINGS);
	const [first, second] = siblings(s);
	sharedChip(second).onclick();
	const picked = sharedChip(second);
	const sibling = sharedChip(first);
	assert.ok(picked.classList.contains("on"), "the clicked chip is selected");
	assert.ok(!picked.classList.contains("on-shared"));
	assert.ok(!sibling.classList.contains("on"), "the sibling is not selected");
	assert.ok(sibling.classList.contains("on-shared"), "the sibling is marked shared");
	// an unshared move on the same strip stays plain
	const solo = chips(moveStrip(first))[3];
	assert.ok(!solo.classList.contains("on") && !solo.classList.contains("on-shared"));
	off();
});

test("Enter in the add-note field saves the note", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const main = s.lines[0];
	const box = commentEditor(0, [main]);
	document.body.appendChild(box);
	const add = [...box.querySelectorAll("input")].at(-1);
	add.value = "typed and entered";
	add.onkeydown({ key: "Enter", preventDefault() {} });
	assert.deepStrictEqual(
		(main.comments || []).map((c) => c.text),
		["typed and entered"],
	);
	assert.strictEqual(add.value, "", "and the field is cleared for the next one");
	off();
});

test("Enter with an empty add-note field adds nothing", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const main = s.lines[0];
	const box = commentEditor(0, [main]);
	document.body.appendChild(box);
	const add = [...box.querySelectorAll("input")].at(-1);
	add.value = "   ";
	add.onkeydown({ key: "Enter", preventDefault() {} });
	assert.deepStrictEqual(main.comments || [], []);
	off();
});


// --- the eight glyphs a White/Black pair shares ------------------------------
// ⊙ ○ ⟳ ↑ → ⯹ ⇄ ⊕ carry no side in the glyph, so the palette shows one button
// and the side comes from the move the mark is set on.

test("a paired glyph takes its side from the move it is set on", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const main = s.lines[0];
	const pick = (ply, sym) => {
		main.marks = {};
		const row = symbolRow(ply, [main], "");
		[...row.querySelectorAll("button")].find((b) => b.textContent === sym).onclick();
		return main.marks[ply];
	};
	assert.strictEqual(pick(0, "↑"), "$36", "ply 0 is White's move");
	assert.strictEqual(pick(1, "↑"), "$37", "ply 1 is Black's");
	assert.strictEqual(pick(3, "⊙"), "$23", "and zugzwang likewise");
	// an unpaired glyph is the same code either way
	assert.strictEqual(pick(0, "±"), "$16");
	assert.strictEqual(pick(1, "±"), "$16");
	off();
});

test("the palette shows one button per glyph, with no side in its label", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const buttons = [...symbolRow(0, [s.lines[0]], "").querySelectorAll("button")];
	const arrows = buttons.filter((b) => b.textContent === "↑");
	assert.strictEqual(arrows.length, 1, "one ↑ button, not a White and a Black");
	assert.strictEqual(arrows[0].title, "the initiative", "and no side claimed");
	assert.strictEqual(
		buttons.find((b) => b.textContent === "⊙").title,
		"zugzwang",
	);
	// an unpaired glyph keeps its side-specific label, which is true of it
	assert.strictEqual(
		buttons.find((b) => b.textContent === "±").title,
		"White clearly better",
	);
	off();
});

test("a coded mark lights its own button and toggles off", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const main = s.lines[0];
	main.marks = { 1: "$37" }; // Black has the initiative
	const row = symbolRow(1, [main], "$37");
	const up = [...row.querySelectorAll("button")].find((b) => b.textContent === "↑");
	assert.match(up.className, /\bon\b/, "the ↑ button is lit by $37");
	up.onclick();
	assert.strictEqual(main.marks, undefined, "clicking it again clears the mark");
	off();
});

test("geometric-shape glyphs are flagged for their own optical size", () => {
	const off = installDom();
	const s = loadState(TWO_LINES);
	const buttons = [...symbolRow(0, [s.lines[0]], "").querySelectorAll("button")];
	const geo = buttons.filter((b) => b.className.includes("geo")).map((b) => b.textContent);
	// U+25A1 □, U+25CB ○, U+25B3 △ — shapes, not letters, and drawn smaller
	assert.deepStrictEqual(geo.sort(), ["△", "○", "□"].sort());
	off();
});
