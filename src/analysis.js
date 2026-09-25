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
import { buildPgn } from "./pgn-out.js";

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

// What the board needs to say about the position at the cursor: whose move it
// is, the move that led here (for its highlight), the king in check, and
// whether the game is over. One replay serves all of it.
export function positionOf(s) {
	const chess = replay(playedMoves(s));
	const hist = chess.history({ verbose: true });
	const last = hist[hist.length - 1];
	const turn = chess.turn();
	let check = null;
	if (chess.inCheck()) {
		for (const row of chess.board())
			for (const p of row) if (p && p.type === "k" && p.color === turn) check = p.square;
	}
	let over = null;
	if (chess.isCheckmate()) over = (turn === "w" ? "Black" : "White") + " wins by checkmate";
	else if (chess.isStalemate()) over = "Draw by stalemate";
	else if (chess.isInsufficientMaterial()) over = "Draw by insufficient material";
	else if (chess.isThreefoldRepetition()) over = "Draw by threefold repetition";
	else if (chess.isDraw()) over = "Draw by the fifty-move rule";
	return {
		fen: chess.fen(),
		turn,
		lastMove: last ? { from: last.from, to: last.to } : null,
		check,
		over,
	};
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

// Play several moves in a row, e.g. an engine line. Stops at the first one
// that is not legal from where the cursor has got to, so a stale line can
// never put an illegal move into the scratch.
export function playAll(s, sans) {
	for (const san of sans) {
		const chess = replay(playedMoves(s));
		try {
			chess.move(san);
		} catch {
			break;
		}
		play(s, san);
	}
	return s;
}

// Cut the active line off after the cursor: the "delete from here" of a move
// list. The notes on the cut moves go with them. A line the cut leaves as a
// mere prefix of another line (an empty one included) says nothing that line
// does not, so it is dropped and the cursor moves across to that line at the
// same position.
export function truncate(s) {
	const line = activeLine(s);
	line.moves.length = s.at;
	if (line.comments) line.comments = line.comments.filter((c) => c.ply < s.at);
	const key = keyOf(line.moves);
	const twin = s.lines.findIndex(
		(l, i) => i !== s.active && keyOf(l.moves.slice(0, s.at)) === key,
	);
	if (twin !== -1) {
		const at = s.at;
		const drop = s.active;
		s.active = twin;
		s.lines.splice(drop, 1);
		if (drop < s.active) s.active--;
		s.at = at;
	}
	return s;
}

const keyOf = (moves) => moves.map((m) => m.san).join(" ");

// Move a line up or down the list, so the one that matters most can lead.
// The first line is the trunk of the scratch's PGN.
export function moveLine(s, idx, dir) {
	const to = idx + dir;
	if (!s.lines[idx] || !s.lines[to]) return s;
	const activeLineObj = activeLine(s);
	[s.lines[idx], s.lines[to]] = [s.lines[to], s.lines[idx]];
	s.active = s.lines.indexOf(activeLineObj);
	return s;
}

// The whole scratch as PGN, the first line as the trunk and every other line
// a variation off it -- written by the same code that writes the notebook's.
export function scratchPgn(s) {
	const lines = s.lines.filter((l) => l.moves.length).map((l, i) => toLine(l, i));
	return buildPgn({ lines });
}

export function select(s, idx) {
	if (!s.lines[idx]) return s;
	s.active = idx;
	s.at = s.lines[idx].moves.length;
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

// One level of undo for the moves that throw work away: deleting a line,
// cutting one short, starting over. A deep copy, so nothing done after it
// can reach back into it.
export function checkpoint(s) {
	s.undo = JSON.stringify({ lines: s.lines, active: s.active, at: s.at });
	return s;
}

export function undo(s) {
	if (!s.undo) return s;
	const { lines, active, at } = JSON.parse(s.undo);
	Object.assign(s, { lines, active, at, undo: null });
	return s;
}

// Step to the neighbouring line, keeping the cursor at the same move where
// that line is long enough -- so Up/Down compares two lines at one position.
export function stepLine(s, dir) {
	const idx = s.active + dir;
	if (!s.lines[idx]) return s;
	s.active = idx;
	s.at = Math.min(s.at, s.lines[idx].moves.length);
	return s;
}

// How many opening moves line `i` shares with the lines above it: the part
// the list can draw faintly, since it is written out already.
export function sharedPrefix(s, i) {
	let best = 0;
	for (let j = 0; j < i; j++) {
		const a = s.lines[i].moves;
		const b = s.lines[j].moves;
		let k = 0;
		while (k < a.length && k < b.length && a[k].san === b[k].san) k++;
		best = Math.max(best, k);
	}
	return best;
}

// Bring a notebook position into a scratch that already has work in it,
// rather than replacing that work. A line that already passes through the
// position is selected there; otherwise the moves come in as a new line (or
// fill the one empty line, if that is all there is).
export function seedLine(s, moves) {
	const key = keyOf(moves);
	const hit = s.lines.findIndex((l) => keyOf(l.moves.slice(0, moves.length)) === key);
	if (hit !== -1) {
		s.active = hit;
		s.at = moves.length;
		return s;
	}
	const [line] = newScratch(moves).lines;
	if (s.lines.length === 1 && !s.lines[0].moves.length) s.lines[0] = line;
	else s.lines.push(line);
	s.active = s.lines.indexOf(line);
	s.at = moves.length;
	return s;
}
