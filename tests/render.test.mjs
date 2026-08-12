import { test } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { grid } from "../src/table.js";
import {
	renderTable,
	renderCards,
	boardSvg,
	fullMovesText,
} from "../src/render.js";

function dom() {
	return new JSDOM('<!DOCTYPE html><div id="view"></div>', {
		url: "http://localhost/",
	});
}

test("boardSvg draws all 64 squares, including empty ones", () => {
	global.document = dom().window.document;
	const svg = boardSvg("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
	assert.strictEqual(svg.querySelectorAll("rect").length, 64);
	// the two kings still render as pieces
	assert.strictEqual(svg.querySelectorAll("text").length, 2);
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
	renderTable(container, grid(lines), "vertical", { showBoards: true });

	const table = container.querySelector("table.tbl");
	assert.ok(table, "expected a table");
	// one table; header + 2 variation rows
	assert.strictEqual(table.querySelectorAll("tr").length, 3);
	const rows = table.querySelectorAll("tr");
	const header = rows[0];
	// header labels include move numbers
	assert.ok(header.textContent.includes("1."));
	assert.ok(header.textContent.includes("2."));
	// each variation gets a board diagram
	const boards = container.querySelectorAll("figure.board svg.board-svg");
	assert.strictEqual(boards.length, 2);

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

test("fullMovesText renders move numbers with the moves", () => {
	const lines = collectLines(parsePgn("1. e4 e5 (1... c5) 2. Nf3").nodes);
	const main = lines[0];
	const txt = fullMovesText(main.moves);
	assert.ok(txt.includes("1. e4"));
	assert.ok(txt.includes("2. Nf3"));
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
