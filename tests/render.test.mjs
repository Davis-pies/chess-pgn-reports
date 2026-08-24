import { test } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { grid } from "../src/table.js";
import { allNotes, numberNotes } from "../src/notes.js";
import { installDom, loadState } from "./helpers.mjs";
import {
	renderTable,
	renderCards,
	boardSvg,
	fullMovesText,
	appendFootnote,
	footnoteText,
	cardMovesText,
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

test("appendFootnote renders name, moves, eval and commentary", () => {
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
	assert.doesNotMatch(
		text,
		/1\.e4/,
		"the shared move before the branch is not shown",
	);
	assert.match(text, /^Sicilian: 1\.\.\.c5/, "it opens at the divergence");
	assert.match(text, /2\.Nf3!/, "per-move marks are kept (gap is CSS)");
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
	assert.strictEqual(span.textContent.trim(), "1...c5");
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
	// a footnote that shares everything it has with its parent has no tail to
	// show, so it is just its name and its commentary — and with no moves to
	// separate, the em dash would dangle, so it is dropped too
	assert.strictEqual(span.textContent, "Transposes: same position");
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
		"Transposes: same position",
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
		"Sicilian: 1...c5 = — sharp",
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

test("a card lists its notes in ascending number order", () => {
	const off = installDom();
	const s = loadState("1. e4 c5 (1... e6 2. d4) 2. Nf3 d6 3. d4 {late}", {
		tags: { 1: "foot" },
	});
	s.lines.find((l) => l.moves.some((m) => m.san === "e6")).name = "French";
	const box = document.createElement("div");
	renderCards(box, grid(s.lines), { notes: allNotes() });
	const nums = [...box.querySelectorAll(".card-notes .nt")]
		.map((r) => r.textContent.match(/^\[(\d+)\]/))
		.filter(Boolean)
		.map((m) => Number(m[1]));
	assert.deepStrictEqual(
		nums,
		[...nums].sort((a, b) => a - b),
		`card notes read in order (got ${JSON.stringify(nums)})`,
	);
	off();
});

test("a card's sub-notes render as their own indented rows", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
	const box = document.createElement("div");
	renderCards(box, grid(s.lines), { notes: allNotes() });
	const notesBox = box.querySelector(".card .card-notes");
	const foot = [...notesBox.querySelectorAll(".nt")].find((r) =>
		/Sicilian/.test(r.textContent),
	);
	assert.ok(foot, "the footnote row is there");
	assert.ok(
		!/knight move/.test(foot.textContent),
		"its sub-note is NOT inline in the footnote row",
	);
	const subs = [...notesBox.querySelectorAll(".subnote")];
	assert.strictEqual(subs.length, 1, "it is its own row");
	assert.strictEqual(subs[0].textContent, "[a] knight move");
	assert.strictEqual(
		subs[0].previousSibling,
		foot,
		"placed directly below its footnote",
	);
	off();
});

test("a card's sub-note row is actually indented by the stylesheet", () => {
	// Guards the cascade, not the markup: `.card-notes .nt` sets the margin
	// shorthand at the same specificity as `.subnote`, so the plain `.subnote`
	// indent loses and the row renders flush left — gray, but not indented.
	const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
	const w = new JSDOM(
		`<!DOCTYPE html><style>${css}</style><div class="card-notes">` +
			`<div class="nt" id="plain">plain</div>` +
			`<div class="nt subnote" id="sub">[a] sub</div></div>`,
	).window;
	const px = (id) =>
		parseFloat(w.getComputedStyle(w.document.getElementById(id)).marginLeft) || 0;
	assert.strictEqual(px("plain"), 0, "an ordinary card note is flush left");
	assert.ok(px("sub") > 0, `a sub-note is indented (got ${px("sub")}px)`);
});

test("a card's footnote row carries no anchor-move prefix", () => {
	// Spec §6: a footnote note reads "Name: moves — commentary". The anchor
	// move is not part of it — the panel, print block and Markdown all omit it,
	// and with commentary present a prefix would put two em dashes in one row.
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", { tags: { 1: "foot" } });
	const foot = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	foot.name = "Sicilian";
	foot.meta = { note: "commentary" };
	const box = document.createElement("div");
	renderCards(box, grid(s.lines), { notes: allNotes() });
	const row = [...box.querySelectorAll(".card-notes .nt")].find((r) =>
		/Sicilian/.test(r.textContent),
	);
	assert.ok(row, "the footnote row is on the parent's card");
	assert.match(row.textContent, /^\[\d+\] Sicilian: /, row.textContent);
	assert.strictEqual(
		(row.textContent.match(/—/g) || []).length,
		1,
		"only the commentary dash, not an anchor-ref dash",
	);
	off();
});

test("a card's ordinary note keeps its move reference", () => {
	const off = installDom();
	const s = loadState("1. e4 {opening} e5 2. Nf3");
	const box = document.createElement("div");
	renderCards(box, grid(s.lines), { notes: allNotes() });
	const row = box.querySelector(".card-notes .nt");
	assert.match(row.textContent, /^\[1\] 1\.e4 — opening$/, row.textContent);
	off();
});

test("a move run starting on Black carries its move number", () => {
	// A bare "Nc6" gives the reader no move to hang the line on. Standard
	// notation writes the first half-move in full, "2...Nc6", and only then
	// falls back to numbering White alone.
	assert.strictEqual(
		fullMovesText(
			[
				{ san: "Nc6", ply: 3 },
				{ san: "Bb5", ply: 4 },
			],
			{},
		),
		"2... Nc6 3. Bb5",
	);
	// a run starting on White is unchanged
	assert.strictEqual(
		fullMovesText(
			[
				{ san: "e4", ply: 0 },
				{ san: "c5", ply: 1 },
			],
			{},
		),
		"1. e4 c5",
	);
});

test("a card's ellipsis context move carries its number on Black", () => {
	const off = installDom();
	// diverges on White's 2nd, so the shared move before it is Black's 1...e5 —
	// which used to render as a bare "⋯ e5"
	const s = loadState("1. e4 e5 2. Bc4 (2. Nf3 Nc6) Nf6");
	const box = document.createElement("div");
	renderCards(box, grid(s.lines), { notes: allNotes() });
	const text = [...box.querySelectorAll(".card-moves")]
		.map((m) => m.textContent)
		.find((t) => /Nc6/.test(t));
	assert.match(text, /⋯ 1\.\.\. e5/, `context move numbered (got ${text})`);
	off();
});

test("a footnote's moves pair after the first", () => {
	// the first half-move is written in full; Black's later moves do not repeat
	// the number, matching the card move text
	assert.strictEqual(
		footnoteText({
			name: "Line 264",
			eval: "",
			note: "",
			moves: [
				{ san: "f6", ply: 26 },
				{ san: "gxf6", ply: 27 },
				{ san: "gxf6", ply: 28 },
				{ san: "Nxf6", ply: 29 },
			],
			marks: {},
			noteByPly: {},
			d: 0,
		}),
		"Line 264: 14.f6 gxf6 15.gxf6 Nxf6",
	);
});

test("a per-move symbol is attached to its move, not spaced like a separator", () => {
	// .card-moves is monospace, where a literal space is a full character cell
	// — the same width as the gap between whole moves, so the symbol read as a
	// floating token. The gap is CSS margin now, not a space character.
	const off = installDom();
	const s = loadState("1. e4 e5 2. Nf3 Nc6");
	s.lines[0].marks = { 3: "∞" };
	const box = document.createElement("div");
	renderCards(box, grid(s.lines), { notes: allNotes() });
	const moves = box.querySelector(".card-moves");
	const mark = moves.querySelector(".mv-mark");
	assert.ok(mark, "the symbol is its own element");
	assert.strictEqual(mark.textContent, "∞");
	assert.ok(
		!/ ∞/.test(moves.textContent),
		`no literal space before it (got ${JSON.stringify(moves.textContent)})`,
	);
	off();
});

test("a table cell's symbol is attached the same way", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 2. Nf3 Nc6");
	s.lines[0].marks = { 3: "∞" };
	const t = document.createElement("div");
	renderTable(t, grid(s.lines), "vertical");
	const cell = [...t.querySelectorAll("td")].find((x) => /∞/.test(x.textContent));
	assert.ok(cell.querySelector(".mv-mark"), "symbol is its own element");
	assert.ok(!/ ∞/.test(cell.textContent), cell.textContent);
	off();
});

test("plain-text exports keep a real space before the symbol", () => {
	// no CSS there to make the gap, so the character has to
	const s = loadState("1. e4 e5 2. Nf3 Nc6");
	s.lines[0].marks = { 3: "∞" };
	assert.match(cardMovesText(grid(s.lines).vars[0]), /Nc6 ∞/);
});

test("appendFootnote renders a group's members as nested labelled rows", () => {
	const off = installDom();
	// 2.Nf3 is shared by two members, so it becomes an inner fork below the
	// stem; 2.Nc3 is a leaf beside it.
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "foot" } },
	);
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	const box = document.createElement("div");
	appendFootnote(box, e.foot);
	assert.match(box.textContent, /1\.\.\.c5/, "stem rendered inline");
	const top = [...box.children].filter((c) => c.className.includes("fnode"));
	assert.deepStrictEqual(
		top.map((r) => r.querySelector("sup").textContent),
		["[a]", "[b]"],
		"the 2.Nf3 fork and the 2.Nc3 leaf",
	);
	assert.match(top[1].textContent, /2\.Nc3/);
	const inner = [...top[0].children].filter((c) =>
		c.className.includes("fnode"),
	);
	assert.deepStrictEqual(
		inner.map((r) => r.querySelector("sup").textContent),
		["[1]", "[2]"],
		"depth 2 is numbered",
	);
	assert.match(inner[0].textContent, /d6/);
	assert.match(inner[1].textContent, /Nc6/);
	off();
});

test("a group member shows its name, eval and note", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	const m1 = s.lines.filter((l) => !l.isMain)[0];
	m1.name = "Open";
	m1.meta = { eval: "±", note: "critical" };
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	const box = document.createElement("div");
	appendFootnote(box, e.foot);
	const row = box.querySelector(".fnode");
	assert.match(row.textContent, /Open: /);
	assert.match(row.textContent, /±/);
	assert.match(row.textContent, /— critical/);
	off();
});

test("a group's own note renders above its branches with a marker on the stem", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
		tags: { 1: "foot", 2: "foot" },
	});
	s.lines.filter((l) => !l.isMain)[0].comments = [
		{ ply: 1, text: "sharp gambit line" },
	];
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	const box = document.createElement("div");
	appendFootnote(box, e.foot);
	// the stem move carries the sub-note's label as a superscript
	assert.match(box.textContent, /1\.\.\.c5a/, "marker on the stem move");
	const sub = box.querySelector(".subnote");
	assert.ok(sub, "the group's own note is rendered");
	assert.match(sub.textContent, /sharp gambit line/);
	assert.deepStrictEqual(
		[...box.querySelectorAll(":scope > .fnode > sup")].map((x) => x.textContent),
		["[b]", "[c]"],
		"branches continue the label sequence",
	);
	off();
});

test("footnoteText and subNoteLines flatten a group for text exports", () => {
	const off = installDom();
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 {sharp}) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	assert.strictEqual(footnoteText(e.foot), "1...c5", "stem only");
	assert.deepStrictEqual(subNoteLines(e.foot), [
		"   a. 2.Nf3",
		"      1. sharp",
		"   b. 2.Nc3",
	]);
	off();
});

test("a lone footnote still renders exactly as before", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {sharp}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	const box = document.createElement("div");
	appendFootnote(box, e.foot);
	assert.strictEqual(box.querySelectorAll(".fnode").length, 0, "no group rows");
	assert.match(box.textContent, /1\.\.\.c5 2\.Nf3/);
	assert.deepStrictEqual(subNoteLines(e.foot), ["   a. sharp"]);
	off();
});

test("nested group rows carry their depth so each level can indent", () => {
	const off = installDom();
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "foot" } },
	);
	const [e] = numberNotes(s.lines).entries.filter((x) => x.foot);
	const box = document.createElement("div");
	appendFootnote(box, e.foot);
	const top = box.querySelector(".fnode");
	assert.ok(top.className.includes("d1"), "a top-level branch is depth 1");
	const inner = top.querySelector(".fnode");
	assert.ok(inner.className.includes("d2"), "its child is depth 2");
	off();
});

test("a card's group rows keep one indent step per depth", () => {
	const off = installDom();
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot", 3: "foot" } },
	);
	const box = document.createElement("div");
	renderCards(box, grid(s.lines), { notes: allNotes() });
	const rows = [...box.querySelectorAll(".card-notes .subnote")];
	const byLabel = new Map(rows.map((r) => [r.textContent.trim(), r]));
	const b = byLabel.get("[a] 2.Nf3");
	const inner = byLabel.get("[1] 2...d6");
	assert.ok(b, "the depth-1 branch row is present");
	assert.ok(b.className.includes("d1"));
	assert.ok(inner, "a depth-2 row is present");
	assert.ok(inner.className.includes("d2"));
	off();
});
