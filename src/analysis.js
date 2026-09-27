// src/analysis.js
// The Analysis mode scratch: a parallel array of line objects in exactly the
// shape current.lines uses, so committing one is an array push rather than a
// translation. Nothing here touches the notebook.
//
// Plies are 0-based (see parseSeq), so within a line a move's ply IS its index.
// The cursor is called `at` -- the number of moves played, and the ply of the
// next one -- so it is never confused with a move's own ply field.
//
// The scratch holds the board's own analysis: the lines played on it. The
// workbook's lines are never copied in; the panel reads the ones through the
// position straight from the workbook. What the analysis list shows follows
// the cursor: the lines that pass through the position on the board, so
// stepping into a branch leaves the lines that do not lead there out of view,
// and stepping back brings them in again. Two things override it for as long
// as the board is open: a line can be pinned in view, and every analysis line
// can be shown at once (`showAll`). Both are cleared when the board closes.

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
		showAll: false,
	};
}

// The position on the board as the moves that reach it.
const here = (s) => activeLine(s).moves.slice(0, s.at);

// Whether a line passes through the position reached by `moves`.
export const through = (moves, line) =>
	line.moves.length >= moves.length && moves.every((m, i) => line.moves[i].san === m.san);

// The indices of the lines on view: those through the position on the board,
// the line being played, any line pinned in view, or every line while the
// board is showing all of them.
export function shown(s) {
	const pos = here(s);
	const out = [];
	s.lines.forEach((l, i) => {
		if (s.showAll || i === s.active || l.pinned || through(pos, l)) out.push(i);
	});
	return out;
}

// Keep a line in view wherever the cursor goes, or stop doing so.
export function pin(s, idx) {
	const l = s.lines[idx];
	if (l) l.pinned = !l.pinned;
	return s;
}

// Every line in the pool on view, or back to the lines through the position.
export function toggleShowAll(s) {
	s.showAll = !s.showAll;
	return s;
}

// What lasts only while the board is open: pins and show-all go when it closes.
export function closeBoard(s) {
	if (!s) return s;
	s.lines.forEach((l) => delete l.pinned);
	s.showAll = false;
	s.wbAll = false;
	return s;
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

// The next line on view from `idx` in direction `dir`, or -1.
function neighbour(s, idx, dir) {
	const on = shown(s);
	const at = on.indexOf(idx);
	const to = on[at + dir];
	return at === -1 || to === undefined ? -1 : to;
}

// Move a line up or down the list, so the one that matters most can lead.
// The first line is the trunk of the scratch's PGN. It swaps with its
// neighbour on view; lines off view keep their places.
export function moveLine(s, idx, dir) {
	const to = neighbour(s, idx, dir);
	if (!s.lines[idx] || to === -1) return s;
	const activeLineObj = activeLine(s);
	[s.lines[idx], s.lines[to]] = [s.lines[to], s.lines[idx]];
	s.active = s.lines.indexOf(activeLineObj);
	return s;
}

// The lines on view as PGN, the first as the trunk and every other a
// variation off it -- written by the same code that writes the notebook's.
export function scratchPgn(s) {
	const lines = shown(s)
		.map((i) => s.lines[i])
		.filter((l) => l.moves.length)
		.map((l, i) => toLine(l, i));
	return buildPgn({ lines });
}

// Make a line the one being played. The cursor stays at the move it was on
// when the line has it -- a line picked from the list passes through the
// position on view -- so picking one never sends the others out of view.
export function select(s, idx) {
	if (!s.lines[idx]) return s;
	const pos = here(s);
	s.active = idx;
	s.at = through(pos, s.lines[idx]) ? pos.length : s.lines[idx].moves.length;
	return s;
}

// Drop a line. The cursor moves with the active line if one before it went.
// If the active line itself went, the board stays at the same position, on
// another line through it if there is one -- the one on view before it, else
// after it -- and on a fresh line of just those moves if not, so there is
// always a board to play on.
export function removeLine(s, idx) {
	if (!s.lines[idx]) return s;
	if (idx !== s.active) {
		s.lines.splice(idx, 1);
		if (idx < s.active) s.active--;
		return s;
	}
	const pos = here(s);
	const on = shown(s).filter((i) => i !== idx && through(pos, s.lines[i]));
	const pick = on.filter((i) => i < idx).pop() ?? on[0];
	const keep = pick === undefined ? null : s.lines[pick];
	s.lines.splice(idx, 1);
	if (keep) {
		s.active = s.lines.indexOf(keep);
		s.at = pos.length;
		return s;
	}
	return lineAt(s, pos);
}

// A fresh line of `moves`, selected, the cursor at its end.
function lineAt(s, moves) {
	s.lines.push({ moves: moves.map((m, ply) => ({ san: m.san, ply })) });
	s.active = s.lines.length - 1;
	s.at = moves.length;
	return s;
}

// "Clear": the lines on view go; the rest of the pool stays, and the board
// stays at its position.
export function clearShown(s) {
	const pos = here(s);
	const on = new Set(shown(s));
	s.lines = s.lines.filter((_, i) => !on.has(i));
	return lineAt(s, pos);
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
	const idx = neighbour(s, s.active, dir);
	if (idx === -1) return s;
	s.active = idx;
	s.at = Math.min(s.at, s.lines[idx].moves.length);
	return s;
}

// How many opening moves line `i` shares with the lines on view above it: the
// part the list can draw faintly, since it is written out already.
export function sharedPrefix(s, i) {
	let best = 0;
	for (const j of shown(s)) {
		if (j >= i) break;
		const a = s.lines[i].moves;
		const b = s.lines[j].moves;
		let k = 0;
		while (k < a.length && k < b.length && a[k].san === b[k].san) k++;
		best = Math.max(best, k);
	}
	return best;
}

// Open the board at a position (`moves`, from move one): on an analysis line
// that already passes through it -- the one being played if it does -- or on
// a fresh line of just those moves. The workbook's own lines are not copied
// in: the panel shows the ones through the position straight from the
// workbook, beside the board's own analysis.
export function openAt(s, moves) {
	if (s.lines.length === 1 && !s.lines[0].moves.length) s.lines = [];
	const on = s.lines.map((l, i) => (through(moves, l) ? i : -1)).filter((i) => i !== -1);
	if (!on.length) return lineAt(s, moves);
	s.active = on.includes(s.active) ? s.active : on[0];
	s.at = moves.length;
	return s;
}

// ---- the board in a workbook
//
// A workbook carries the board as it was left, so analysis in progress is
// there when the workbook is opened again. Moves are stored as SAN only; the
// plies are their indices. Undo and one-off messages are not state worth
// keeping and stay behind.

export function packScratch(s) {
	if (!s || !s.lines.some((l) => l.moves.length)) return null;
	return {
		lines: s.lines.map((l) => ({
			moves: l.moves.map((m) => m.san),
			...(l.comments && l.comments.length
				? { comments: l.comments.map((c) => ({ ply: c.ply, text: c.text })) }
				: {}),
		})),
		active: s.active,
		at: s.at,
		flipped: !!s.flipped,
	};
}

// The inverse, trusting nothing: a file can be edited by hand. Each line is
// replayed and cut at its first move that is not legal; notes past the cut or
// not attached to a move go; the cursor is brought back within
// what survived. Null if nothing usable is left.
export function unpackScratch(d) {
	if (!d || !Array.isArray(d.lines)) return null;
	const lines = [];
	for (const raw of d.lines) {
		const sans = Array.isArray(raw && raw.moves) ? raw.moves : [];
		const chess = new Chess();
		const moves = [];
		for (const san of sans) {
			try {
				moves.push({ san: chess.move(String(san)).san, ply: moves.length });
			} catch {
				break;
			}
		}
		const comments = (Array.isArray(raw && raw.comments) ? raw.comments : [])
			.filter((c) => c && Number.isInteger(c.ply) && c.ply >= 0 && c.ply < moves.length && typeof c.text === "string")
			.map((c) => ({ ply: c.ply, text: c.text }));
		lines.push(comments.length ? { moves, comments } : { moves });
	}
	if (!lines.some((l) => l.moves.length)) return null;
	const s = newScratch();
	s.lines = lines;
	s.active = Number.isInteger(d.active) && lines[d.active] ? d.active : 0;
	const len = lines[s.active].moves.length;
	s.at = Number.isInteger(d.at) ? Math.max(0, Math.min(d.at, len)) : len;
	s.flipped = !!d.flipped;
	return s;
}

// A move typed rather than played on the board -- the way in for a keyboard or
// a screen reader. Takes SAN ("Nf3", "exd5", "O-O", "e8=Q"), with the check
// marks, zeros for castling and a lower-case piece letter forgiven, or a
// from-to pair ("g1f3", "e7e8q"). The SAN it comes to, or null if it is not a
// legal move in the position on the board.
export function typedMove(s, text) {
	const t = String(text || "").trim().replace(/[+#!?]+$/, "").replace(/0/g, "O");
	if (!t) return null;
	const chess = replay(playedMoves(s));
	const tries = [t];
	if (/^[nrqk]/.test(t)) tries.push(t[0].toUpperCase() + t.slice(1));
	if (/^o-o(-o)?$/i.test(t)) tries.push(t.toUpperCase());
	for (const x of tries) {
		try {
			return chess.move(x).san;
		} catch {
			// not this reading; try the next
		}
	}
	const m = /^([a-h][1-8])-?([a-h][1-8])=?([qrbn])?$/i.exec(t);
	return m ? sanFor(s, m[1].toLowerCase(), m[2].toLowerCase(), m[3] && m[3].toLowerCase()) : null;
}
