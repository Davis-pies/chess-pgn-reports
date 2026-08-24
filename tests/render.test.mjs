import { test } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { grid } from "../src/table.js";
import { allNotes } from "../src/notes.js";
import { installDom, loadState } from "./helpers.mjs";
import {
	renderTable,
	renderCards,
	boardSvg,
	fullMovesText,
	appendFootnote,
	footnoteText,
	appendSubNotes,
	subNoteLines,
} from "../src/render.js";

function dom() {
	return new JSDOM('<!DOCTYPE html><div id="view"></div>', {
		url: "http://localhost/",
	});
}

test("boardSvg draws all 64 squares with pieces and coordinates", () => {
	global.document = dom().window.document;
	const svg = boardSvg("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
	assert.strictEqual(svg.querySelectorAll("rect").length, 64);
	// the two kings are <use> sprite references
	assert.strictEqual(svg.querySelectorAll("use").length, 2);
	// a-file ranks + 1st-rank files are drawn as coordinate text
	assert.strictEqual(svg.querySelectorAll("text").length, 15);
	delete global.document;
});

test("boardSvg falls back to the start position instead of crashing on a malformed FEN", () => {
	global.document = dom().window.document;
	// a FEN board field with too few ranks (7, not 8)
	assert.doesNotThrow(() => boardSvg("8/8/8/8/8/8/8 w - - 0 1"));
	// not a FEN at all
	assert.doesNotThrow(() => boardSvg("not-a-fen-at-all"));
	const svg = boardSvg("not-a-fen-at-all");
	assert.strictEqual(svg.querySelectorAll("rect").length, 64);
	// falls back to the start position, so the opening piece count is intact
	assert.strictEqual(svg.querySelectorAll("use").length, 32);
	delete global.document;
});

test("boardSvg carries an accessible name", () => {
	global.document = dom().window.document;
	const svg = boardSvg("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
	assert.strictEqual(svg.getAttribute("role"), "img");
	const label = svg.getAttribute("aria-label");
	assert.ok(label, "expected an aria-label");
	assert.ok(/white/i.test(label), "label should describe the position");

	const blackToMove = boardSvg(
		"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1",
	);
	assert.ok(/black/i.test(blackToMove.getAttribute("aria-label")));
	delete global.document;
});

test("renders a vertical table with tagged variations into the DOM", () => {
	const { window } = dom();
	global.document = window.document;
	global.DOMParser = window.DOMParser;

	const lines = collectLines(
		parsePgn("1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6").nodes,
	);
	lines[1].tag = "sideline";

	const container = document.createElement("div");
	renderTable(container, grid(lines), "vertical");

	const table = container.querySelector("table.tbl");
	assert.ok(table, "expected a table");
	// one table; header + 2 variation rows
	assert.strictEqual(table.querySelectorAll("tr").length, 3);
	const rows = table.querySelectorAll("tr");
	const header = rows[0];
	// header labels include move numbers
	assert.ok(header.textContent.includes("1."));
	assert.ok(header.textContent.includes("2."));
	delete global.document;
	delete global.DOMParser;
});

test("renderCards produces one labeled card per line with moves", () => {
	global.document = dom().window.document;
	const lines = collectLines(
		parsePgn("1. e4 e5 (1... c5 2. Nf3) 2. Nf3").nodes,
	);
	const container = document.createElement("div");
	renderCards(container, grid(lines), { boardSize: 120 });
	const cards = container.querySelectorAll(".card");
	assert.strictEqual(cards.length, 2);
	assert.ok(cards[0].textContent.includes("e4"));
	assert.ok(cards[0].querySelector(".board-svg"));
	delete global.document;
});

test("fullMovesText pairs moves: number on white only, no '1...' for black", () => {
	const lines = collectLines(parsePgn("1. e4 e5 (1... c5) 2. Nf3").nodes);
	const main = lines[0];
	const txt = fullMovesText(main.moves);
	assert.strictEqual(txt, "1. e4 e5 2. Nf3");
	assert.ok(!txt.includes("..."), "no ellipsis move-number for black");
});

test("collapse/expand variation headers are keyboard accessible", () => {
	const { window } = dom();
	global.document = window.document;

	const lines = collectLines(
		parsePgn("1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6").nodes,
	);
	const g = grid(lines);
	let called = 0;
	g.vars[1].onclick = () => {
		called++;
	};

	const container = document.createElement("div");
	renderTable(container, g, "vertical");

	const cell = container.querySelector("td.var-head.clickable");
	assert.ok(cell, "expected a clickable variation head");
	assert.strictEqual(cell.tabIndex, 0);
	assert.strictEqual(cell.getAttribute("role"), "button");
	// not collapsed -> expanded
	assert.strictEqual(cell.getAttribute("aria-expanded"), "true");

	cell.dispatchEvent(
		new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	assert.strictEqual(called, 1, "Enter should activate the control");
	cell.dispatchEvent(
		new window.KeyboardEvent("keydown", { key: " ", bubbles: true }),
	);
	assert.strictEqual(called, 2, "Space should activate the control");

	delete global.document;
});

test("collapsed branch cells (horizontal + vertical) are keyboard accessible and marked not-expanded", () => {
	const { window } = dom();
	global.document = window.document;

	const lines = collectLines(
		parsePgn("1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6").nodes,
	);

	// vertical: a collapsed row's move cells are clickable to re-expand
	let vCalled = 0;
	const gv = grid(lines);
	gv.vars[1].onclick = () => {
		vCalled++;
	};
	gv.vars[1].collapsed = true;
	const vContainer = document.createElement("div");
	renderTable(vContainer, gv, "vertical");
	const vCell = vContainer.querySelector("td.clickable:not(.var-head)");
	assert.ok(vCell, "expected a clickable collapsed move cell (vertical)");
	assert.strictEqual(vCell.tabIndex, 0);
	assert.strictEqual(vCell.getAttribute("role"), "button");
	assert.strictEqual(vCell.getAttribute("aria-expanded"), "false");
	vCell.dispatchEvent(
		new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	assert.strictEqual(vCalled, 1);

	// horizontal: same, but the collapsed column's per-ply cells
	let hCalled = 0;
	const gh = grid(lines);
	gh.vars[1].onclick = () => {
		hCalled++;
	};
	gh.vars[1].collapsed = true;
	const hContainer = document.createElement("div");
	renderTable(hContainer, gh, "horizontal");
	const hCell = hContainer.querySelector("td.clickable");
	assert.ok(hCell, "expected a clickable collapsed move cell (horizontal)");
	assert.strictEqual(hCell.tabIndex, 0);
	assert.strictEqual(hCell.getAttribute("role"), "button");
	assert.strictEqual(hCell.getAttribute("aria-expanded"), "false");
	hCell.dispatchEvent(
		new window.KeyboardEvent("keydown", { key: " ", bubbles: true }),
	);
	assert.strictEqual(hCalled, 1);

	delete global.document;
});

test("horizontal layout transposes to one row per ply", () => {
	global.document = dom().window.document;
	const lines = collectLines(parsePgn("1. e4 c5 (1... e5) 2. Nf3").nodes);
	const container = document.createElement("div");
	renderTable(container, grid(lines), "horizontal", {});
	const table = container.querySelector("table.tbl");
	const rows = table.querySelectorAll("tr");
	// header + maxPly+1 rows (ply 0..2) = 4 rows (e4,c5,e5,Nf3 -> maxPly 2)
	assert.ok(rows.length >= 3, "horizontal has ply rows");
	delete global.document;
});

test("appendFootnote renders name, context, moves, eval and commentary", () => {
	const off = installDom();
	const span = document.createElement("span");
	appendFootnote(span, {
		name: "Sicilian",
		eval: "=",
		note: "sharp and **double-edged**",
		moves: [
			{ san: "e4", ply: 0 },
			{ san: "c5", ply: 1 },
			{ san: "Nf3", ply: 2 },
		],
		marks: { 2: "!" },
		noteByPly: { 2: [3] },
		d: 1,
	});
	const text = span.textContent;
	assert.match(text, /^Sicilian: /);
	assert.match(text, /1\.e4/, "context move precedes the divergent tail");
	assert.match(text, /1\.\.\.c5/);
	assert.match(text, /2\.Nf3 !/, "per-move marks are kept");
	assert.match(text, /—/);
	assert.strictEqual(
		span.querySelector("sup").textContent,
		"3",
		"the footnote's own notes render as inline superscripts",
	);
	assert.ok(
		span.querySelector("strong"),
		"commentary goes through renderInline",
	);
	off();
});

test("appendFootnote omits the parts a footnote does not have", () => {
	const off = installDom();
	const span = document.createElement("span");
	appendFootnote(span, {
		name: "",
		eval: "",
		note: "",
		moves: [
			{ san: "e4", ply: 0 },
			{ san: "c5", ply: 1 },
		],
		marks: {},
		noteByPly: {},
		d: 1,
	});
	assert.strictEqual(span.textContent.trim(), "⋯ 1.e4 1...c5");
	assert.strictEqual(span.querySelector("sup"), null);
	off();
});

test("appendFootnote with no divergent tail renders name and commentary alone", () => {
	const off = installDom();
	const span = document.createElement("span");
	appendFootnote(span, {
		name: "Transposes",
		eval: "",
		note: "same position",
		moves: [{ san: "e4", ply: 0 }],
		marks: {},
		noteByPly: {},
		d: 1,
	});
	// a footnote that shares everything it has with the mainline has no tail to
	// show, so it is just its name, the anchor move, and its commentary
	assert.strictEqual(span.textContent, "Transposes: ⋯ 1.e4 — same position");
	off();
});

test("footnoteText with no divergent tail renders name and commentary alone", () => {
	assert.strictEqual(
		footnoteText({
			name: "Transposes",
			eval: "",
			note: "same position",
			moves: [{ san: "e4", ply: 0 }],
			marks: {},
			noteByPly: {},
			d: 1,
		}),
		"Transposes: ⋯ 1.e4 — same position",
	);
});

test("footnoteText renders the same footnote as plain text", () => {
	assert.strictEqual(
		footnoteText({
			name: "Sicilian",
			eval: "=",
			note: "sharp",
			moves: [
				{ san: "e4", ply: 0 },
				{ san: "c5", ply: 1 },
			],
			marks: {},
			noteByPly: {},
			d: 1,
		}),
		"Sicilian: ⋯ 1.e4 1...c5 = — sharp",
	);
});

test("renderCards renders no card for a footnote line", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const g = grid(s.lines);
	const box = document.createElement("div");
	renderCards(box, g, { notes: allNotes() });
	const names = [...box.querySelectorAll(".card")].map(
		(c) => c.querySelector(".tag").textContent,
	);
	assert.ok(!names.includes("Footnote"), `no footnote cards (got ${names})`);
	off();
});

test("a card lists a footnote anchored on its own line", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", {
		tags: { 1: "foot" },
	});
	s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
	const g = grid(s.lines);
	const box = document.createElement("div");
	renderCards(box, g, { notes: allNotes() });
	const mainCard = box.querySelector(".card");
	assert.match(mainCard.querySelector(".card-notes").textContent, /Sicilian/);
	off();
});

test("appendSubNotes renders one labelled row per sub-note", () => {
	const off = installDom();
	const box = document.createElement("div");
	appendSubNotes(box, {
		subNotes: [
			{ label: "a", ply: 2, text: "knight move" },
			{ label: "b", ply: 3, text: "**sharp**" },
		],
	});
	const rows = [...box.querySelectorAll(".subnote")];
	assert.strictEqual(rows.length, 2);
	assert.strictEqual(rows[0].querySelector("sup").textContent, "[a]");
	assert.match(rows[0].textContent, /knight move/);
	assert.ok(rows[1].querySelector("strong"), "text goes through renderInline");
	off();
});

test("appendSubNotes renders nothing when a footnote has none", () => {
	const off = installDom();
	const box = document.createElement("div");
	appendSubNotes(box, { subNotes: [] });
	assert.strictEqual(box.childNodes.length, 0);
	off();
});

test("subNoteLines renders the same sub-notes as indented text", () => {
	assert.deepStrictEqual(
		subNoteLines({
			subNotes: [
				{ label: "a", ply: 2, text: "knight move" },
				{ label: "b", ply: 3, text: "sharp" },
			],
		}),
		["   a. knight move", "   b. sharp"],
	);
	assert.deepStrictEqual(subNoteLines({ subNotes: [] }), []);
});

test("a card's footnote note carries its sub-notes", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
	const g = grid(s.lines);
	const box = document.createElement("div");
	renderCards(box, g, { notes: allNotes() });
	const text = box.querySelector(".card .card-notes").textContent;
	assert.match(text, /Sicilian/);
	assert.match(text, /\[a\] knight move/, "the sub-note travels with it");
	off();
});
