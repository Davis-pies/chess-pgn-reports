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

export function interactiveBoard(fen, onMove, { size = 320, flipped = false } = {}) {
	const wrap = document.createElement("div");
	wrap.className = "an-board";
	const svg = boardSvg(fen, size);
	// Flip is a CSS rotation of the drawing, so the squares keep their real
	// names and every hit test stays honest -- a flipped board is the same
	// board seen from the other side, not a different coordinate system.
	if (flipped) svg.classList.add("flipped");
	wrap.appendChild(svg);

	const chess = new Chess(fen);
	let from = null;

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

	// Returns true if the square completed a pending move.
	function drop(sq) {
		if (!from) return false;
		const cand = movesFrom(from).filter((m) => m.to === sq);
		if (!cand.length) return false;
		const san = cand[0].san;
		clear();
		onMove(san);
		return true;
	}

	function squareOf(e) {
		const t = e.target;
		return t && t.getAttribute ? t.getAttribute("data-sq") : null;
	}

	svg.addEventListener("mousedown", (e) => {
		const sq = squareOf(e);
		if (!sq) return;
		e.preventDefault();
		// A mousedown on a legal target finishes a click-click; anything else
		// starts a new selection (including clicking another of your own pieces).
		if (drop(sq)) return;
		pick(sq);
	});

	svg.addEventListener("mouseup", (e) => {
		const sq = squareOf(e);
		// Releasing on the source is the first half of a click-click, so it must
		// leave the selection alone rather than treating it as a failed drag.
		if (!sq || sq === from) return;
		if (!drop(sq)) clear();
	});

	return wrap;
}
