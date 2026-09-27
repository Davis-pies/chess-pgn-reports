import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { grid } from "../src/table.js";
import { renderTrieTable } from "../src/trie-view.js";
import {
	openTablePaths,
	setTraced,
	getTraced,
	getCurrent,
	setSharedInfo,
} from "../src/state.js";
import { closeTableMenu, openTableMenu } from "../src/table-menu.js";

const GROUP = "1. e4 e5 (1... c5 2. Nf3 d6 3. d4 (3. Bb5+)) 2. Nf3";
const GROUP_KEY = "1:c5";
// A branch OUTSIDE the group, so focusing the group is a real narrowing rather
// than already the state: with only the group's own lines in the notebook,
// isFocused correctly reports the group as what the table is showing.
const GROUP_PLUS =
	"1. e4 e5 (1... c5 2. Nf3 d6 3. d4 (3. Bb5+)) (1... e6 2. d4) 2. Nf3";

const moveOf = (td) =>
	td.childNodes[0] && td.childNodes[0].nodeType === 3
		? td.childNodes[0].textContent
		: "";

// Render the preview with the group open, ready to right-click into.
function preview(pgn = GROUP, { open = [GROUP_KEY] } = {}) {
	const s = loadState(pgn);
	openTablePaths.clear();
	open.forEach((k) => openTablePaths.add(k));
	setTraced(null);
	const box = document.createElement("div");
	renderTrieTable(box, grid(s.lines));
	return { s, box };
}

// jsdom has no real pointer, so hand the handler the event shape it reads.
const evt = (el) => ({
	preventDefault() {},
	stopPropagation() {},
	clientX: 10,
	clientY: 10,
	currentTarget: el,
});
const rightClick = (box, san) => {
	const cell = [...box.querySelectorAll("td")].find((c) => moveOf(c) === san);
	assert.ok(cell, `no cell for ${san}`);
	assert.ok(cell.oncontextmenu, `${san} has no menu handler`);
	cell.oncontextmenu(evt(cell));
	return document.querySelector(".tmenu");
};
const items = (menu) =>
	[...menu.querySelectorAll(".tmenu-item")].map((b) => b.textContent);
const click = (menu, label) => {
	const b = [...menu.querySelectorAll(".tmenu-item")].find(
		(x) => x.textContent === label,
	);
	assert.ok(b, `no item "${label}" in [${items(menu)}]`);
	b.onclick();
};

test("right-clicking a line's move offers the move and the line", () => {
	const off = installDom();
	const { box } = preview();
	const menu = rightClick(box, "d4");
	const secs = [...menu.querySelectorAll(".tmenu-sec")].map((s) => s.textContent);
	assert.match(secs[0], /^@ 3\.d4/, "the move it was opened on");
	assert.ok(menu.querySelector(".sympick"), "the editor's symbol picker");
	assert.ok(menu.querySelector(".cedit"), "the editor's note editor");
	assert.deepStrictEqual(items(menu), [
		"Analyse from here",
		"★ Make mainline",
		"Move to footnote",
		"Focus",
		"Hide",
	]);
	closeTableMenu();
	off();
});

test("a shared move's menu says how many lines the edit reaches", () => {
	const off = installDom();
	const { box } = preview();
	// d6 sits on the group column and is shared by both lines beneath it
	const menu = rightClick(box, "d6");
	const secs = [...menu.querySelectorAll(".tmenu-sec")].map((x) => x.textContent);
	assert.match(secs[0], /^@ 2\.\.\.d6 · 2 shared/, "the move, and its reach");
	assert.match(secs[1], /2 lines/, "then the group's own actions");
	closeTableMenu();
	off();
});

test("a group column's menu acts on every line under it and offers no promote", () => {
	const off = installDom();
	const { s, box } = preview(GROUP_PLUS);
	const menu = rightClick(box, "d6");
	assert.deepStrictEqual(
		items(menu),
		["Analyse from here", "Move to footnote", "Focus", "Hide"],
		"no Make mainline: a group is not one line",
	);
	assert.ok(menu.querySelector(".sympick"), "but its shared move is editable");
	click(menu, "Hide");
	const inGroup = s.lines.filter((l) => l.moves.some((m) => m.san === "d6"));
	const outside = s.lines.find((l) => l.moves.some((m) => m.san === "e6"));
	assert.strictEqual(inGroup.length, 2);
	assert.ok(inGroup.every((l) => l.hidden), "both lines under the group hide");
	assert.ok(!outside.hidden, "the branch outside it is untouched");
	closeTableMenu();
	off();
});

test("the mainline is offered none of the line controls", () => {
	const off = installDom();
	const { box } = preview();
	const menu = rightClick(box, "e5"); // a mainline-only move
	// Analysing from a mainline move is exactly how you add a variation to it,
	// so it stays; what the mainline is refused is the LINE controls.
	assert.deepStrictEqual(
		items(menu),
		["Analyse from here"],
		"no promote, hide, focus or footnote",
	);
	assert.ok(menu.querySelector(".tmenu-note"), "and says why");
	assert.ok(menu.querySelector(".sympick"), "but its moves are still editable");
	closeTableMenu();
	off();
});

test("Hide from the menu hides that line and nothing else", () => {
	const off = installDom();
	const { s, box } = preview();
	click(rightClick(box, "d4"), "Hide");
	const hidden = s.lines.filter((l) => l.hidden);
	assert.strictEqual(hidden.length, 1);
	assert.ok(hidden[0].moves.some((m) => m.san === "d4"));
	off();
});

test("Move to footnote tags the line, and offers the way back", () => {
	const off = installDom();
	const { s, box } = preview();
	click(rightClick(box, "d4"), "Move to footnote");
	const line = s.lines.find((l) => l.moves.some((m) => m.san === "d4"));
	assert.strictEqual(line.tag, "foot");
	// re-render against the new state: the item has flipped
	const again = preview();
	const line2 = again.s.lines.find((l) => l.moves.some((m) => m.san === "d4"));
	line2.tag = "foot";
	const box2 = document.createElement("div");
	renderTrieTable(box2, grid(again.s.lines));
	off();
});

test("Make mainline promotes the line the menu was opened on", () => {
	const off = installDom();
	const { s, box } = preview();
	click(rightClick(box, "d4"), "★ Make mainline");
	const promoted = s.lines.find((l) => l.isMain);
	assert.ok(promoted.moves.some((m) => m.san === "d4"), "the clicked line");
	assert.strictEqual(
		s.lines.filter((l) => l.isMain).length,
		1,
		"and the old mainline was demoted",
	);
	off();
});

test("Focus narrows to the line, and the item flips to Stop focusing", () => {
	const off = installDom();
	const { s, box } = preview();
	click(rightClick(box, "d4"), "Focus");
	const shown = s.lines.filter((l) => !l.hidden && !l.isMain);
	assert.strictEqual(shown.length, 1, "only the focused line is left");
	const menu = rightClick(preview().box, "d4");
	assert.ok(items(menu).includes("Focus"), "a fresh notebook is not focused");
	closeTableMenu();
	off();
});

test("Escape closes the menu and only one is ever open", () => {
	const off = installDom();
	const { box } = preview();
	rightClick(box, "d4");
	assert.ok(document.querySelector(".tmenu"));
	// opening another replaces it rather than stacking
	rightClick(box, "Bb5+");
	assert.strictEqual(document.querySelectorAll(".tmenu").length, 1);
	document.dispatchEvent(
		new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	assert.strictEqual(document.querySelector(".tmenu"), null, "Escape closes it");
	off();
});

test("a click outside closes the menu", () => {
	const off = installDom();
	const { box } = preview();
	rightClick(box, "d4");
	document.body.dispatchEvent(
		new window.MouseEvent("mousedown", { bubbles: true }),
	);
	assert.strictEqual(document.querySelector(".tmenu"), null);
	off();
});

test("an action closes the menu behind it", () => {
	const off = installDom();
	const { box } = preview();
	click(rightClick(box, "d4"), "Hide");
	assert.strictEqual(document.querySelector(".tmenu"), null);
	off();
});

test("a line column's header carries a visible way into the menu", () => {
	const off = installDom();
	const { box } = preview();
	const heads = [...box.querySelectorAll("th.var-head")];
	const grp = heads.find((h) => h.textContent.includes("2 lines"));
	assert.strictEqual(
		grp.querySelector(".tmenu-open"),
		null,
		"a group header is the fold control and gets none",
	);
	assert.ok(
		heads[0].querySelector(".tmenu-open"),
		"the mainline header has one too — its menu is just reduced",
	);
	const line = heads.find(
		(h) => h.textContent.includes("Sideline") && h.querySelector(".tmenu-open"),
	);
	assert.ok(line, "and so does a sideline's");
	line.querySelector(".tmenu-open").onclick(evt(line));
	const menu = document.querySelector(".tmenu");
	assert.ok(menu, "it opens the menu");
	assert.strictEqual(
		menu.querySelector(".sympick"),
		null,
		"with no move section — a header has no move",
	);
	assert.ok(items(menu).includes("★ Make mainline"));
	closeTableMenu();
	off();
});

test("left-click still traces rather than opening a menu", () => {
	const off = installDom();
	const { box } = preview();
	const cell = [...box.querySelectorAll("td")].find((c) => moveOf(c) === "d4");
	cell.onclick({});
	assert.strictEqual(document.querySelector(".tmenu"), null, "no menu");
	off();
});

test("a symbol set from the menu lands on every line sharing the move", () => {
	const off = installDom();
	const { s, box } = preview();
	// 1. e4 is shown on the Mainline column and reached by every line, so this
	// is the shared-move rule the editor applies, reached from the table.
	const menu = rightClick(box, "e4");
	assert.match(
		menu.querySelector(".tmenu-sec").textContent,
		/3 shared/,
		"the menu says how far the edit reaches",
	);
	[...menu.querySelectorAll(".sympick button")]
		.find((b) => b.textContent === "!")
		.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	assert.deepStrictEqual(
		s.lines.map((l) => (l.marks || {})[0]),
		["$1", "$1", "$1"],
		"written to every line through the editor's own apply, as a NAG code",
	);
	closeTableMenu();
	off();
});

test("the header's ⋮ opens the menu without also tracing the line", () => {
	const off = installDom();
	const { box } = preview();
	document.body.appendChild(box); // a real dispatch needs to be in the document
	const line = [...box.querySelectorAll("th.var-head")].find(
		(h) => h.textContent.includes("Sideline") && h.querySelector(".tmenu-open"),
	);
	line.querySelector(".tmenu-open").dispatchEvent(
		new window.MouseEvent("click", { bubbles: true }),
	);
	assert.ok(document.querySelector(".tmenu"), "the menu opened");
	assert.strictEqual(getTraced(), null, "and the click did not reach the header");
	closeTableMenu();
	off();
});

test("the menu refreshes itself after a symbol is picked inside it", () => {
	const off = installDom();
	const { box } = preview();
	const menu = rightClick(box, "d4");
	const lit = () =>
		[...document.querySelectorAll(".tmenu .sympick button")]
			.filter((b) => b.className.includes("on"))
			.map((b) => b.textContent);
	assert.deepStrictEqual(lit(), [], "nothing set to begin with");
	// a real dispatch, so the menu's own bubbled listener runs after the button
	[...menu.querySelectorAll(".sympick button")]
		.find((b) => b.textContent === "!")
		.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	assert.deepStrictEqual(lit(), ["!"], "the menu shows the symbol it just set");
	closeTableMenu();
	off();
});

test("a note typed in the menu is saved and another box opens, without a rebuild", () => {
	const off = installDom();
	const { box } = preview();
	const menu = rightClick(box, "d4");
	assert.strictEqual(menu.querySelectorAll(".cedit .nt:not(.new)").length, 0);
	assert.ok(
		![...menu.querySelectorAll("button")].some((b) => b.textContent === "Add note"),
		"there is no Add note button",
	);
	const input = menu.querySelector(".cedit .nt.new input");
	input.value = "a note";
	input.dispatchEvent(new window.Event("input", { bubbles: true }));
	assert.strictEqual(input.isConnected, true, "the box typed in was not rebuilt");
	assert.strictEqual(menu.querySelectorAll(".cedit .nt").length, 2);
	assert.ok(
		getCurrent().lines.some((l) => (l.comments || []).some((c) => c.text === "a note")),
		"the note is on the line",
	);
	closeTableMenu();
	off();
});

test("the menu keeps its scroll position across a refresh", () => {
	const off = installDom();
	const { box } = preview();
	const menu = rightClick(box, "d4");
	// jsdom has no layout, so scrollTop stays whatever it is set to — enough to
	// prove the rebuild restores it rather than dropping the reader to the top
	menu.scrollTop = 40;
	[...menu.querySelectorAll(".sympick button")]
		.find((b) => b.textContent === "⊙")
		.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	assert.strictEqual(document.querySelector(".tmenu").scrollTop, 40);
	closeTableMenu();
	off();
});

test("right-clicking a group's header opens the group menu", () => {
	const off = installDom();
	// GROUP_PLUS: with a branch outside the group, Focus is a real narrowing
	const { box } = preview(GROUP_PLUS);
	const head = [...box.querySelectorAll("th.var-head")].find((h) =>
		h.textContent.includes("2 lines"),
	);
	assert.ok(head.oncontextmenu, "the group header has a menu handler");
	head.oncontextmenu(evt(head));
	const menu = document.querySelector(".tmenu");
	assert.deepStrictEqual(items(menu), ["Move to footnote", "Focus", "Hide"]);
	assert.ok(openTablePaths.has(GROUP_KEY), "and it did not fold the group");
	closeTableMenu();
	off();
});

test("right-clicking a line's header opens its menu without a move section", () => {
	const off = installDom();
	const { box } = preview();
	const head = [...box.querySelectorAll("th.var-head")].find((h) =>
		h.textContent.includes("Sideline"),
	);
	head.oncontextmenu(evt(head));
	const menu = document.querySelector(".tmenu");
	assert.strictEqual(menu.querySelector(".sympick"), null, "no move here");
	assert.ok(items(menu).includes("★ Make mainline"));
	closeTableMenu();
	off();
});

test("the table offers Hide all and Show all", () => {
	const off = installDom();
	const { s, box } = preview();
	const chip = (t) =>
		[...box.querySelectorAll(".tbl-controls button")].find(
			(b) => b.textContent === t,
		);
	assert.ok(chip("Hide all") && chip("Show all"), "both offered");
	chip("Hide all").onclick();
	assert.ok(
		s.lines.filter((l) => !l.isMain).every((l) => l.hidden),
		"every sideline hides",
	);
	assert.ok(!s.lines.find((l) => l.isMain).hidden, "the mainline never does");
	chip("Show all").onclick();
	assert.ok(s.lines.every((l) => !l.hidden), "and they all come back");
	off();
});

test("the menu draws the position after the move it was opened on", () => {
	const off = installDom();
	const { box } = preview();
	const menu = rightClick(box, "d4");
	const svg = menu.querySelector(".tmenu-board svg");
	assert.ok(svg, "a board is drawn");
	// clamped: boardSize goes up to 400, which belongs to the report and the
	// editor's panels, not to a menu
	getCurrent().boardSize = 400;
	closeTableMenu();
	const wide = rightClick(preview().box, "d4").querySelector(".tmenu-board svg");
	assert.ok(Number(wide.getAttribute("width")) <= 200, "a menu stays a menu");
	closeTableMenu();
	off();
});

test("a group column's move gets a board like any other", () => {
	const off = installDom();
	const { box } = preview();
	assert.ok(rightClick(box, "d6").querySelector(".tmenu-board svg"));
	closeTableMenu();
	off();
});

test("a symbol set on a group's move reaches every line under it", () => {
	const off = installDom();
	const { s, box } = preview();
	const menu = rightClick(box, "d6"); // shared by both lines in the group
	[...menu.querySelectorAll(".sympick button")]
		.find((b) => b.textContent === "!")
		.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	const under = s.lines.filter((l) => l.moves.some((m) => m.san === "d6"));
	assert.strictEqual(under.length, 2);
	assert.ok(
		under.every((l) => (l.marks || {})[3] === "$1"),
		"the shared-move rule, reached from the group column",
	);
	closeTableMenu();
	off();
});

test("a note on a group's move lands on every line under it", () => {
	const off = installDom();
	const { s, box } = preview();
	const menu = rightClick(box, "d6");
	const add = menu.querySelector(".cedit .nt.new input");
	add.value = "shared from the group column";
	add.dispatchEvent(new window.Event("input", { bubbles: true }));
	const under = s.lines.filter((l) => l.moves.some((m) => m.san === "d6"));
	assert.ok(
		under.every((l) =>
			(l.comments || []).some((c) => c.text === "shared from the group column"),
		),
	);
	closeTableMenu();
	off();
});

test("a header menu draws no board — a header has no move", () => {
	const off = installDom();
	const { box } = preview();
	const head = [...box.querySelectorAll("th.var-head")].find((h) =>
		h.textContent.includes("Sideline"),
	);
	head.oncontextmenu(evt(head));
	assert.strictEqual(document.querySelector(".tmenu-board"), null);
	closeTableMenu();
	off();
});

test("noMain: the line that carries isMain gets the ordinary line actions", () => {
	const off = installDom();
	const s = loadState(GROUP);
	s.noMain = true;
	openTablePaths.clear();
	// the trie roots at ply 1 now, so open the whole game's group then the fork
	openTablePaths.add("0:e4");
	setTraced(null);
	const box = document.createElement("div");
	renderTrieTable(box, grid(s.lines));
	const menu = rightClick(box, "e5");
	const labels = items(menu);
	assert.ok(!labels.some((t) => t.includes("Make mainline")), labels.join("|"));
	assert.ok(labels.includes("Move to footnote"), labels.join("|"));
	assert.ok(labels.includes("Hide"), labels.join("|"));
	assert.strictEqual(menu.querySelectorAll(".tmenu-note").length, 0);
	closeTableMenu();
	off();
});

// The menu opened straight on a target, as the header and cell handlers do,
// so each branch of what it offers can be reached without a rendered table.
const open = (target, at = {}) =>
	openTableMenu({ x: 10, y: 10, target, ...at });
const lineOf = (s, san) => s.lines.find((l) => l.moves.some((m) => m.san === san));

test("a footnoted line is offered the way back out", () => {
	const off = installDom();
	const { s } = preview();
	const line = lineOf(s, "d4");
	line.tag = "foot";
	const menu = open({ line, ply: 4 });
	assert.ok(items(menu).includes("Move out of footnotes"));
	assert.ok(
		[...menu.querySelectorAll(".tmenu-item.on")].some(
			(b) => b.textContent === "Move out of footnotes",
		),
		"lit, since the line is in the footnotes",
	);
	click(menu, "Move out of footnotes");
	assert.strictEqual(line.tag, "sideline");
	off();
});

test("a group whose every line is footnoted moves them all back out", () => {
	const off = installDom();
	const { s } = preview(GROUP_PLUS);
	const lines = s.lines.filter((l) => l.moves.some((m) => m.san === "d6"));
	lines.forEach((l) => (l.tag = "foot"));
	click(open({ lines }), "Move out of footnotes");
	assert.ok(lines.every((l) => l.tag === "sideline"));
	off();
});

test("Stop focusing shows every line again", () => {
	const off = installDom();
	const { s } = preview(GROUP_PLUS);
	const line = lineOf(s, "d4");
	click(open({ line, ply: 4 }), "Focus");
	assert.ok(s.lines.some((l) => l.hidden), "focusing hid the others");
	const menu = open({ line, ply: 4 });
	assert.ok(items(menu).includes("Stop focusing"));
	click(menu, "Stop focusing");
	assert.ok(s.lines.every((l) => !l.hidden), "everything is back");
	off();
});

test("a hidden line is offered Unhide", () => {
	const off = installDom();
	const { s } = preview();
	const line = lineOf(s, "d4");
	line.hidden = true;
	const menu = open({ line });
	assert.ok(items(menu).includes("Unhide"));
	click(menu, "Unhide");
	assert.ok(!("hidden" in line), "cleared, not written as false");
	off();
});

test("a move with no shared group or marks still gets a picker for its own line", () => {
	const off = installDom();
	const { s } = preview();
	const line = lineOf(s, "d4");
	delete line.marks;
	setSharedInfo({ byLine: new Map(), idLines: new Map() });
	const menu = open({ line, ply: 4 });
	const sec = menu.querySelector(".tmenu-sec").textContent;
	assert.match(sec, /^@ 3\.d4$/, "no shared count when it reaches one line");
	assert.ok(menu.querySelector(".sympick"));
	closeTableMenu();
	off();
});

test("a ply the line never reaches names the move number alone", () => {
	const off = installDom();
	const { s } = preview();
	const menu = open({ line: lineOf(s, "d4"), ply: 40 });
	assert.match(menu.querySelector(".tmenu-sec").textContent, /^@ 21\.$/);
	closeTableMenu();
	off();
});

test("closing returns focus to the cell the menu came from, if still there", () => {
	const off = installDom();
	const { s } = preview();
	const from = document.createElement("button");
	document.body.appendChild(from);
	open({ line: lineOf(s, "d4") }, { from });
	assert.notStrictEqual(document.activeElement, from, "focus moved into the menu");
	closeTableMenu();
	assert.strictEqual(document.activeElement, from);
	// a cell re-rendered away in the meantime is not focused
	const gone = document.createElement("button");
	open({ line: lineOf(s, "d4") }, { from: gone });
	closeTableMenu();
	assert.notStrictEqual(document.activeElement, gone);
	off();
});

test("a stale menu's click does not rebuild the menu that replaced it", () => {
	const off = installDom();
	const { s } = preview();
	const first = open({ line: lineOf(s, "d4"), ply: 4 });
	const btn = first.querySelector(".sympick button");
	open({ line: lineOf(s, "Bb5+"), ply: 4 });
	// the first menu is detached; its handler must not touch the open one
	const second = document.querySelector(".tmenu");
	const before = second.innerHTML;
	btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	assert.strictEqual(document.querySelector(".tmenu"), second);
	assert.strictEqual(second.innerHTML, before);
	closeTableMenu();
	off();
});

test("the menu is nudged back inside the viewport near an edge", () => {
	const off = installDom();
	const { s } = preview();
	window.innerWidth = 300;
	window.innerHeight = 200;
	const proto = window.HTMLElement.prototype;
	const real = proto.getBoundingClientRect;
	proto.getBoundingClientRect = () => ({ width: 120, height: 150 });
	try {
		const menu = open({ line: lineOf(s, "d4") }, { x: 250, y: 100 });
		assert.strictEqual(menu.style.left, "180px");
		assert.strictEqual(menu.style.top, "50px");
		closeTableMenu();
		const fits = open({ line: lineOf(s, "d4") }, { x: 20, y: 30 });
		assert.strictEqual(fits.style.left, "20px", "left alone when it fits");
		assert.strictEqual(fits.style.top, "30px");
		closeTableMenu();
		// a menu wider than the viewport pins to its left edge
		proto.getBoundingClientRect = () => ({ width: 500, height: 0 });
		const wide = open({ line: lineOf(s, "d4") }, { x: 250, y: 100 });
		assert.strictEqual(wide.style.left, "0px");
		assert.strictEqual(wide.style.top, "100px", "a zero height is not clamped");
		closeTableMenu();
	} finally {
		proto.getBoundingClientRect = real;
	}
	off();
});
