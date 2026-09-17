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
	// drawn from Black's side: h1 is the top-left square, and a8 the bottom-right
	const rects = [...board.querySelectorAll("rect")];
	assert.strictEqual(rects[0].getAttribute("data-sq"), "h1");
	assert.strictEqual(rects[63].getAttribute("data-sq"), "a8");
	on(board, "e2", "mousedown");
	assert.deepStrictEqual(marked(board, "sel"), ["e2"]);
	done();
});

// append to tests/board-input.test.mjs

// White pawn on b7, black rook on a8: both a push and a capture promote.
const PROMO_FEN = "r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1";

test("a promoting move asks which piece before it is played", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(PROMO_FEN, (san) => seen.push(san));
	on(board, "b7", "mousedown");
	on(board, "b8", "mouseup");
	assert.deepStrictEqual(seen, [], "nothing is played until a piece is chosen");
	const picker = board.querySelector(".an-promo");
	assert.ok(picker, "the picker opened");
	assert.deepStrictEqual(
		[...picker.querySelectorAll("button")].map((b) => b.dataset.piece),
		["q", "r", "b", "n"],
	);
	done();
});

test("choosing a piece plays that promotion and closes the picker", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(PROMO_FEN, (san) => seen.push(san));
	on(board, "b7", "mousedown");
	on(board, "b8", "mouseup");
	board.querySelector('.an-promo button[data-piece="n"]').click();
	assert.deepStrictEqual(seen, ["b8=N"]);
	assert.strictEqual(board.querySelector(".an-promo"), null);
	assert.deepStrictEqual(marked(board, "sel"), []);
	done();
});

test("a promoting capture keeps the capture in the SAN", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(PROMO_FEN, (san) => seen.push(san));
	on(board, "b7", "mousedown");
	on(board, "a8", "mouseup");
	board.querySelector('.an-promo button[data-piece="q"]').click();
	// the new queen checks the king on e8, so chess.js spells it with the +
	assert.deepStrictEqual(seen, ["bxa8=Q+"]);
	done();
});

test("the board ignores clicks while the picker is open", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(PROMO_FEN, (san) => seen.push(san));
	on(board, "b7", "mousedown");
	on(board, "b8", "mouseup");
	on(board, "e1", "mousedown");
	// the promoting pawn stays lit while the picker asks, so you can see what
	// is being promoted -- what must NOT happen is the king becoming selected
	assert.deepStrictEqual(marked(board, "sel"), ["b7"]);
	assert.ok(board.querySelector(".an-promo"), "the picker is still open");
	done();
});

test("a non-promoting move never opens the picker", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(PROMO_FEN, (san) => seen.push(san));
	on(board, "e1", "mousedown");
	on(board, "e2", "mouseup");
	assert.deepStrictEqual(seen, ["Ke2"]);
	assert.strictEqual(board.querySelector(".an-promo"), null);
	done();
});

test("a dragged piece follows the mouse and snaps back if dropped off the board", () => {
	const done = installDom();
	const seen = [];
	const board = interactiveBoard(START, (san) => seen.push(san));
	document.body.appendChild(board);
	const piece = () => board.querySelector('use[data-sq="e2"]');
	board
		.querySelector('rect[data-sq="e2"]')
		.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
	window.dispatchEvent(new window.MouseEvent("mousemove", { clientX: 30, clientY: -30 }));
	assert.strictEqual(piece().getAttribute("transform"), "translate(20 -40)");
	assert.ok(piece().classList.contains("dragging"), "it lets the square under it take the drop");

	window.dispatchEvent(new window.MouseEvent("mouseup", {}));
	assert.strictEqual(piece().getAttribute("transform"), null, "back on its square");
	assert.ok(!piece().classList.contains("dragging"));
	window.dispatchEvent(new window.MouseEvent("mousemove", { clientX: 90, clientY: 90 }));
	assert.strictEqual(piece().getAttribute("transform"), null, "and no longer following");
	assert.deepStrictEqual(seen, []);
	board.remove();
	done();
});
