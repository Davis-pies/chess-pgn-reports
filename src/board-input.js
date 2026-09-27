// src/board-input.js
// Behaviour attached to the board render.js already draws. boardSvg keeps
// drawing; nothing here changes what a board looks like, which is why the
// printed report is unaffected by any of it.
//
// One pair of handlers serves both gestures. A drag is mousedown on the source
// and mouseup on the target; a click-click is mousedown+mouseup on the source
// (the release lands on the source, so it is ignored and the selection stands)
// then a mousedown on the target, which finds a selection already pending and
// completes it. Neither gesture needs to know the other exists.

import { Chess } from "chess.js";
import { boardSvg } from "./render.js";

// Queen first: it is the answer almost every time, so it is the shortest
// distance from the cursor, and the order never changes under the user.
const GLYPH_W = { q: "♕", r: "♖", b: "♗", n: "♘" };
const GLYPH_B = { q: "♛", r: "♜", b: "♝", n: "♞" };
const PROMO_PIECES = [
	["q", "Queen"],
	["r", "Rook"],
	["b", "Bishop"],
	["n", "Knight"],
];

const SVG_NS = "http://www.w3.org/2000/svg";
const FILES = "abcdefgh";

// The centre of a square in board units, for whichever way up it is drawn.
function centre(sq, size, flipped) {
	const s = size / 8;
	const f = FILES.indexOf(sq[0]);
	const r = 8 - Number(sq[1]);
	const col = flipped ? 7 - f : f;
	const row = flipped ? 7 - r : r;
	return [col * s + s / 2, row * s + s / 2];
}

// `lastMove` ({from, to}) and `check` (a square) are marked on the squares
// under the pieces; they are what a player looks for first on a board they
// did not just move on.
export function interactiveBoard(
	fen,
	onMove,
	{ size = 320, flipped = false, lastMove = null, check = null } = {},
) {
	const wrap = document.createElement("div");
	wrap.className = "an-board";
	const svg = boardSvg(fen, size, { flipped });
	wrap.appendChild(svg);
	wrap._geom = { size, flipped };

	const rectOf = (sq) => svg.querySelector(`rect[data-sq="${sq}"]`);
	if (lastMove) {
		rectOf(lastMove.from)?.classList.add("last");
		rectOf(lastMove.to)?.classList.add("last");
	}
	if (check) rectOf(check)?.classList.add("check");

	const chess = new Chess(fen);
	let from = null;
	let pending = null; // a promotion waiting on a choice: { from, to }

	const nodes = (sq) => svg.querySelectorAll(`[data-sq="${sq}"]`);
	const clear = () => {
		svg.querySelectorAll(".sel, .target").forEach((n) => {
			n.classList.remove("sel", "target");
		});
		svg.querySelectorAll(".an-hint").forEach((n) => n.remove());
		from = null;
	};
	const movesFrom = (sq) => chess.moves({ square: sq, verbose: true });

	// A dot on an empty target, a ring round a piece that can be taken -- the
	// convention every chess site uses, so it needs no legend.
	function hint(m) {
		const [cx, cy] = centre(m.to, size, flipped);
		const c = document.createElementNS(SVG_NS, "circle");
		const take = m.captured && !m.flags.includes("e");
		c.setAttribute("cx", cx);
		c.setAttribute("cy", cy);
		c.setAttribute("r", take ? size / 16 - size / 160 : size / 48);
		c.setAttribute("class", "an-hint" + (take ? " take" : ""));
		c.setAttribute("data-sq", m.to);
		svg.appendChild(c);
	}

	function pick(sq) {
		clear();
		const ms = movesFrom(sq);
		if (!ms.length) return; // an empty square, or a piece with nowhere to go
		from = sq;
		nodes(sq).forEach((n) => n.classList.add("sel"));
		ms.forEach((m) => {
			nodes(m.to).forEach((n) => n.classList.add("target"));
			hint(m);
		});
	}

	// Returns true if the square completed a pending move (or opened the
	// promotion picker, which is the same thing from the caller's side: the
	// gesture is over either way).
	function drop(sq) {
		if (!from) return false;
		const cand = movesFrom(from).filter((m) => m.to === sq);
		if (!cand.length) return false;
		// Every candidate for one from/to pair is the same move except for the
		// piece promoted to, so asking once covers all four.
		if (cand.some((m) => m.promotion)) {
			pending = { from, to: sq };
			askPromotion();
			return true;
		}
		const san = cand[0].san;
		clear();
		onMove(san);
		return true;
	}

	function askPromotion() {
		const box = document.createElement("div");
		box.className = "an-promo";
		PROMO_PIECES.forEach(([piece, label]) => {
			const b = document.createElement("button");
			b.className = "an-promo-pick";
			b.dataset.piece = piece;
			b.textContent = (chess.turn() === "w" ? GLYPH_W : GLYPH_B)[piece] + " " + label;
			b.title = label;
			b.onclick = () => {
				const { from: f, to } = pending;
				const m = chess
					.moves({ square: f, verbose: true })
					.find((x) => x.to === to && x.promotion === piece);
				pending = null;
				box.remove();
				clear();
				if (m) onMove(m.san);
			};
			box.appendChild(b);
		});
		const cancel = document.createElement("button");
		cancel.className = "an-promo-cancel";
		cancel.textContent = "Cancel";
		cancel.onclick = () => {
			pending = null;
			box.remove();
			clear();
		};
		box.appendChild(cancel);
		wrap.appendChild(box);
	}

	function squareOf(e) {
		const t = e.target;
		return t && t.getAttribute ? t.getAttribute("data-sq") : null;
	}

	function down(sq, x, y) {
		// A press on a legal target finishes a click-click; anything else
		// starts a new selection (including pressing another of your own pieces).
		if (drop(sq)) return false;
		pick(sq);
		return !!from && x != null && follow(x, y);
	}

	function up(sq) {
		// Releasing on the source is the first half of a click-click, so it must
		// leave the selection alone rather than treating it as a failed drag.
		if (!sq || sq === from) return;
		if (!drop(sq)) clear();
	}

	svg.addEventListener("mousedown", (e) => {
		if (pending || e.button > 0) return;
		const sq = squareOf(e);
		if (!sq) return;
		e.preventDefault();
		const drag = down(sq, e.clientX, e.clientY);
		if (!drag) return;
		const move = (ev) => drag.move(ev.clientX, ev.clientY);
		const end = () => {
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", end);
			drag.end();
		};
		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", end);
	});

	svg.addEventListener("mouseup", (e) => {
		if (pending) return;
		up(squareOf(e));
	});

	// Touch: the same two gestures with a finger. preventDefault stops the
	// page scrolling under the drag and stops the browser replaying the touch
	// as mouse events, which would run every handler twice. A touch's events
	// all go to the element it started on, so the square it ends over is
	// looked up from the point.
	svg.addEventListener(
		"touchstart",
		(e) => {
			if (pending || e.touches.length > 1) return;
			const sq = squareOf(e);
			if (!sq) return;
			e.preventDefault();
			const t = e.touches[0];
			const drag = down(sq, t.clientX, t.clientY);
			if (!drag) return;
			const move = (ev) => {
				ev.preventDefault();
				drag.move(ev.touches[0].clientX, ev.touches[0].clientY);
			};
			const end = (ev) => {
				svg.removeEventListener("touchmove", move);
				svg.removeEventListener("touchend", end);
				svg.removeEventListener("touchcancel", end);
				drag.end();
				const p = ev.changedTouches && ev.changedTouches[0];
				if (ev.type === "touchend" && p && document.elementFromPoint) {
					const under = document.elementFromPoint(p.clientX, p.clientY);
					up(under && under.getAttribute ? under.getAttribute("data-sq") : null);
				}
			};
			svg.addEventListener("touchmove", move, { passive: false });
			svg.addEventListener("touchend", end);
			svg.addEventListener("touchcancel", end);
		},
		{ passive: false },
	);

	// The picked piece rides under the pointer until it is let go. It stops
	// catching pointer events meanwhile, so the release lands on the square
	// beneath it and the drop resolves as before. A move that is played
	// re-renders the board anyway, and anything else snaps back.
	function follow(x0, y0) {
		const piece = svg.querySelector(`use[data-sq="${from}"]`);
		if (!piece) return null;
		svg.appendChild(piece); // drawn last, so it passes over the other pieces
		piece.classList.add("dragging");
		// the board can be drawn smaller than its viewBox; move in board units
		const w = svg.getBoundingClientRect().width;
		const scale = w ? size / w : 1;
		return {
			move(x, y) {
				piece.setAttribute("transform", `translate(${(x - x0) * scale} ${(y - y0) * scale})`);
			},
			end() {
				piece.removeAttribute("transform");
				piece.classList.remove("dragging");
			},
		};
	}

	return wrap;
}

// Arrows over a board drawn by interactiveBoard: the engine's best move, and
// its other candidates fainter. Redrawn in place, so an engine update never
// rebuilds the board (and never drops a piece the user is holding).
export function drawArrows(wrap, arrows) {
	const svg = wrap.querySelector("svg");
	const { size, flipped } = wrap._geom;
	svg.querySelector(".an-arrows")?.remove();
	if (!arrows.length) return;
	const g = document.createElementNS(SVG_NS, "g");
	g.setAttribute("class", "an-arrows");
	const s = size / 8;
	arrows.forEach(({ from, to, weight = 1 }) => {
		const [x1, y1] = centre(from, size, flipped);
		const [x2, y2] = centre(to, size, flipped);
		const len = Math.hypot(x2 - x1, y2 - y1);
		const ux = (x2 - x1) / len;
		const uy = (y2 - y1) / len;
		const head = s * 0.42;
		const w = s * 0.17;
		const bx = x2 - ux * head;
		const by = y2 - uy * head;
		const line = document.createElementNS(SVG_NS, "line");
		line.setAttribute("x1", x1 + ux * s * 0.2);
		line.setAttribute("y1", y1 + uy * s * 0.2);
		line.setAttribute("x2", bx);
		line.setAttribute("y2", by);
		line.setAttribute("stroke-width", w);
		const tip = document.createElementNS(SVG_NS, "polygon");
		const px = -uy * head * 0.6;
		const py = ux * head * 0.6;
		tip.setAttribute("points", `${x2},${y2} ${bx + px},${by + py} ${bx - px},${by - py}`);
		const arrow = document.createElementNS(SVG_NS, "g");
		arrow.setAttribute("class", "an-arrow");
		arrow.setAttribute("opacity", weight);
		arrow.append(line, tip);
		g.appendChild(arrow);
	});
	svg.appendChild(g);
}
