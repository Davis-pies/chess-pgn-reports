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
const PROMO_PIECES = [
	["q", "Queen"],
	["r", "Rook"],
	["b", "Bishop"],
	["n", "Knight"],
];

export function interactiveBoard(fen, onMove, { size = 320, flipped = false } = {}) {
	const wrap = document.createElement("div");
	wrap.className = "an-board";
	const svg = boardSvg(fen, size, { flipped });
	wrap.appendChild(svg);

	const chess = new Chess(fen);
	let from = null;
	let pending = null; // a promotion waiting on a choice: { from, to }

	const nodes = (sq) => svg.querySelectorAll(`[data-sq="${sq}"]`);
	const clear = () => {
		svg.querySelectorAll(".sel, .target").forEach((n) => {
			n.classList.remove("sel", "target");
		});
		from = null;
	};
	const movesFrom = (sq) => chess.moves({ square: sq, verbose: true });

	function pick(sq) {
		clear();
		const ms = movesFrom(sq);
		if (!ms.length) return; // an empty square, or a piece with nowhere to go
		from = sq;
		nodes(sq).forEach((n) => n.classList.add("sel"));
		ms.forEach((m) => nodes(m.to).forEach((n) => n.classList.add("target")));
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
			b.textContent = label;
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
		wrap.appendChild(box);
	}

	function squareOf(e) {
		const t = e.target;
		return t && t.getAttribute ? t.getAttribute("data-sq") : null;
	}

	svg.addEventListener("mousedown", (e) => {
		if (pending) return;
		const sq = squareOf(e);
		if (!sq) return;
		e.preventDefault();
		// A mousedown on a legal target finishes a click-click; anything else
		// starts a new selection (including clicking another of your own pieces).
		if (drop(sq)) return;
		pick(sq);
		if (from) follow(e);
	});

	// The picked piece rides under the cursor until the button comes up. It
	// stops catching pointer events meanwhile, so the mouseup lands on the
	// square beneath it and the drop above resolves as before. The listeners
	// are on window so a release off the board still ends the drag; a move
	// that is played re-renders the board anyway, and anything else snaps back.
	function follow(down) {
		const piece = svg.querySelector(`use[data-sq="${from}"]`);
		if (!piece) return;
		svg.appendChild(piece); // drawn last, so it passes over the other pieces
		piece.classList.add("dragging");
		// the board can be drawn smaller than its viewBox; move in board units
		const w = svg.getBoundingClientRect().width;
		const scale = w ? size / w : 1;
		const move = (e) => {
			const dx = (e.clientX - down.clientX) * scale;
			const dy = (e.clientY - down.clientY) * scale;
			piece.setAttribute("transform", `translate(${dx} ${dy})`);
		};
		const up = () => {
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", up);
			piece.removeAttribute("transform");
			piece.classList.remove("dragging");
		};
		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", up);
	}

	svg.addEventListener("mouseup", (e) => {
		if (pending) return;
		const sq = squareOf(e);
		// Releasing on the source is the first half of a click-click, so it must
		// leave the selection alone rather than treating it as a failed drag.
		if (!sq || sq === from) return;
		if (!drop(sq)) clear();
	});

	return wrap;
}
