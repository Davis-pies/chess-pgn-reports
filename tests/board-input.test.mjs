// tests/board-input.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { installDom } from "./helpers.mjs";
import { interactiveBoard } from "../src/board-input.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Fire a real event so the handler sees the same shape the browser sends.
function on(board, sq, type) {
	const node = board.querySelector(`rect[data-sq="${sq}"]`);
	assert.ok(node, `no square ${sq}`);
	node.dispatchEvent(
		new window.MouseEvent(type, { bubbles: true, cancelable: true }),
	);
}
const marked = (board, cls) =>
	[...board.querySelectorAll(`rect.${cls}`)].map((n) => n.getAttribute("data-sq")).sort();

test("picking a piece marks it and its legal targets", () => {
	const done = installDom();
	const board = interactiveBoard(START, () => {});
	on(board, "e2", "mousedown");
	assert.deepStrictEqual(marked(board, "sel"), ["e2"]);
	assert.deepStrictEqual(marked(board, "target"), ["e3", "e4"]);
	done();
});

test("picking an empty square selects nothing", () => {
	const done = installDom();
	const board = interactiveBoard(START, () => {});
	on(board, "e5", "mousedown");
	assert.deepStrictEqual(marked(board, "sel"), []);
	assert.deepStrictEqual(marked(board, "target"), []);
	done();
});

test("a drag from source to target emits the move as SAN", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(START, (san) => seen.push(san));
	on(board, "e2", "mousedown");
	on(board, "e4", "mouseup");
	assert.deepStrictEqual(seen, ["e4"]);
	assert.deepStrictEqual(marked(board, "sel"), [], "selection clears after a move");
	done();
});

test("click-click emits the same move as a drag", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(START, (san) => seen.push(san));
	on(board, "g1", "mousedown");
	on(board, "g1", "mouseup"); // released on the source: still selected
	assert.deepStrictEqual(marked(board, "sel"), ["g1"]);
	on(board, "f3", "mousedown");
	assert.deepStrictEqual(seen, ["Nf3"]);
	done();
});

test("releasing on an illegal square emits nothing and clears the selection", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(START, (san) => seen.push(san));
	on(board, "e2", "mousedown");
	on(board, "e5", "mouseup");
	assert.deepStrictEqual(seen, []);
	assert.deepStrictEqual(marked(board, "sel"), []);
	done();
});

test("picking another of your own pieces switches the selection", () => {
	const done = installDom();
	const board = interactiveBoard(START, () => {});
	on(board, "e2", "mousedown");
	on(board, "d2", "mousedown");
	assert.deepStrictEqual(marked(board, "sel"), ["d2"]);
	done();
});

test("a click on a coordinate label resolves to its square", () => {
	const done = installDom();
	const board = interactiveBoard(START, () => {});
	const label = board.querySelector('text[data-sq="a2"]');
	assert.ok(label, "the a-file coordinate is drawn on a2");
	label.dispatchEvent(
		new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }),
	);
	assert.deepStrictEqual(marked(board, "sel"), ["a2"]);
	done();
});

test("flipping is view-only and does not renumber the squares", () => {
	const done = installDom();
	const board = interactiveBoard(START, () => {}, { flipped: true });
	assert.ok(board.querySelector("svg").classList.contains("flipped"));
	on(board, "e2", "mousedown");
	assert.deepStrictEqual(marked(board, "sel"), ["e2"]);
	done();
});
