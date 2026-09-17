// src/analysis.js
// The Analysis mode scratch: a parallel array of line objects in exactly the
// shape current.lines uses, so committing one is an array push rather than a
// translation. Nothing here touches the notebook.
//
// Plies are 0-based (see parseSeq), so within a line a move's ply IS its index.
// The cursor is called `at` -- the number of moves played, and the ply of the
// next one -- so it is never confused with a move's own ply field.

import { Chess } from "chess.js";
import { defaultLineName } from "./tree.js";

export function newScratch(moves = []) {
	// Renumber from 0: a scratch line seeded from the middle of a notebook line
	// is still a root-to-leaf path in its own right, and its plies have to be
	// its own indices for toLine's output to match collectLines'.
	return {
		lines: [{ moves: moves.map((m, i) => ({ san: m.san, ply: i })) }],
		active: 0,
		at: moves.length,
		flipped: false,
	};
}

export function activeLine(s) {
	return s.lines[s.active];
}

export function playedMoves(s) {
	return activeLine(s).moves.slice(0, s.at);
}

function replay(moves) {
	const chess = new Chess();
	for (const m of moves) chess.move(m.san);
	return chess;
}

export function fenOf(s) {
	return replay(playedMoves(s)).fen();
}

// A from/to pair (plus a promotion piece) as SAN, or null if that is not a
// legal move here. chess.js throws on an illegal move rather than returning
// null, and a board click on an empty square is an ordinary thing to do -- so
// the throw is caught rather than propagated.
export function sanFor(s, from, to, promotion) {
	const chess = replay(playedMoves(s));
	try {
		const mv = chess.move(promotion ? { from, to, promotion } : { from, to });
		return mv ? mv.san : null;
	} catch {
		return null;
	}
}

// The one rule the whole tree comes from.
export function play(s, san) {
	const line = activeLine(s);
	const next = line.moves[s.at];
	// walking forward through a line already held
	if (next && next.san === san) {
		s.at++;
		return s;
	}
	// at the end: extend it
	if (s.at === line.moves.length) {
		line.moves.push({ san, ply: s.at });
		s.at++;
		return s;
	}
	// diverging mid-line: fork a sibling rather than discarding the tail, which
	// is what makes several lines at once possible without a tree structure.
	// The prefix is COPIED move by move -- sharing the objects would make an
	// annotation on one branch appear on the other.
	const moves = line.moves
		.slice(0, s.at)
		.map((m) => ({ san: m.san, ply: m.ply }));
	moves.push({ san, ply: s.at });
	// The notes on the shared moves come along too, copied for the same reason.
	const comments = (line.comments || [])
		.filter((c) => c.ply < s.at)
		.map((c) => ({ ply: c.ply, text: c.text }));
	s.lines.push({ moves, comments });
	s.active = s.lines.length - 1;
	s.at = moves.length;
	return s;
}

export function back(s) {
	if (s.at > 0) s.at--;
	return s;
}

export function forward(s) {
	if (s.at < activeLine(s).moves.length) s.at++;
	return s;
}

export function goTo(s, at) {
	s.at = Math.max(0, Math.min(at, activeLine(s).moves.length));
	return s;
}

export function select(s, idx) {
	if (!s.lines[idx]) return s;
	s.active = idx;
	s.at = s.lines[idx].moves.length;
	return s;
}

// A note on the move just played -- the one before the cursor -- in the same
// { ply, text } shape a notebook line keeps, one per move as the line editor
// has it. A blank note clears it; at the start there is no move to hold one.
export function noteAt(s) {
	const c = (activeLine(s).comments || []).find((n) => n.ply === s.at - 1);
	return c ? c.text : "";
}

export function setNote(s, text) {
	if (s.at === 0) return s;
	const line = activeLine(s);
	const ply = s.at - 1;
	line.comments = (line.comments || []).filter((c) => c.ply !== ply);
	if (text.trim()) line.comments.push({ ply, text: text.trim() });
	return s;
}

// Drop a line. The cursor moves with the active line if one before it went;
// if the active line itself went, it lands on the neighbour before it. A
// scratch always keeps one line, empty if need be, so there is a board to play.
export function removeLine(s, idx) {
	if (!s.lines[idx]) return s;
	s.lines.splice(idx, 1);
	if (!s.lines.length) {
		s.lines.push({ moves: [] });
		s.active = 0;
		s.at = 0;
	} else if (idx < s.active) s.active--;
	else if (idx === s.active) select(s, Math.max(0, idx - 1));
	return s;
}

// A scratch line as a notebook line. `idx` is the index it will occupy in
// current.lines after the push, which is what names an unnamed line.
export function toLine(scratchLine, idx) {
	const moves = scratchLine.moves.map((m) => ({ san: m.san, ply: m.ply }));
	const last = moves[moves.length - 1];
	return {
		moves,
		marks: {},
		comments: (scratchLine.comments || []).map((c) => ({ ply: c.ply, text: c.text })),
		meta: {},
		fen: replay(moves).fen(),
		ply: last ? last.ply : 0,
		tag: "sideline",
		name: defaultLineName(false, idx),
	};
}
