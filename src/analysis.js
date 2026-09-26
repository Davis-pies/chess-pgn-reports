// src/analysis.js
// The Analysis mode scratch: a parallel array of line objects in exactly the
// shape current.lines uses, so committing one is an array push rather than a
// translation. Nothing here touches the notebook.
//
// Plies are 0-based (see parseSeq), so within a line a move's ply IS its index.
// The cursor is called `at` -- the number of moves played, and the ply of the
// next one -- so it is never confused with a move's own ply field.
//
// The scratch is a pool: every line explored in the session stays in it. What
// the board shows is the part of the pool that passes through `root`, the
// position it was opened at (a list of SANs; empty is the start, where every
// line passes). Opening another position changes the root, not the pool, so
// lines explored from one position come back whenever it, or anything before
// it, is opened again -- the same rule the notebook's own lines are brought
// onto the board by.

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
		root: [],
	};
}

const passes = (root, line) =>
	line.moves.length >= root.length && root.every((san, i) => line.moves[i].san === san);

// The indices of the lines the board shows: those through the root, and the
// line being played, which is always on view.
export function shown(s) {
	const root = s.root || [];
	const out = [];
	s.lines.forEach((l, i) => {
		if (i === s.active || passes(root, l)) out.push(i);
	});
	return out;
}

// Stepping back before the root and playing something else leaves the root
// behind; the view widens to the position the two share, so the line being
// played never drops out of the list it is in.
function widen(s) {
	const root = s.root || [];
	const moves = activeLine(s).moves;
	if (passes(root, activeLine(s))) return;
	let k = 0;
	while (k < root.length && k < moves.length && moves[k].san === root[k]) k++;
	s.root = root.slice(0, k);
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
		widen(s);
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
	widen(s);
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
	widen(s);
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

export function select(s, idx) {
	if (!s.lines[idx]) return s;
	s.active = idx;
	s.at = s.lines[idx].moves.length;
	return s;
}

// Drop a line. The cursor moves with the active line if one before it went;
// if the active line itself went, it lands on the line on view before it (or
// after, at the top). A board always has a line to play on: if none is left
// on view, an empty one starts from the root.
export function removeLine(s, idx) {
	if (!s.lines[idx]) return s;
	const wasActive = idx === s.active;
	const before = neighbour(s, idx, -1);
	const after = neighbour(s, idx, 1);
	s.lines.splice(idx, 1);
	if (!wasActive) {
		if (idx < s.active) s.active--;
		return s;
	}
	const next = before !== -1 ? before : after !== -1 ? after - 1 : -1;
	if (next !== -1) return select(s, next);
	return rootLine(s);
}

// A fresh line at the root, selected: somewhere to play when nothing is on view.
function rootLine(s) {
	const root = s.root || [];
	s.lines.push({ moves: root.map((san, ply) => ({ san, ply })) });
	s.active = s.lines.length - 1;
	s.at = root.length;
	return s;
}

// "Clear": the lines on view go; the rest of the pool stays.
export function clearShown(s) {
	const on = new Set(shown(s));
	s.lines = s.lines.filter((_, i) => !on.has(i));
	return rootLine(s);
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
	s.undo = JSON.stringify({ lines: s.lines, active: s.active, at: s.at, root: s.root || [] });
	return s;
}

export function undo(s) {
	if (!s.undo) return s;
	const { lines, active, at, root } = JSON.parse(s.undo);
	Object.assign(s, { lines, active, at, root, undo: null });
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

// Open the board at a position (`moves`, from move one). The view becomes the
// lines through it: every notebook line through it comes into the pool, whole
// and with its notes, beside the lines already explored from there, so the
// lines written and the lines tried are both there to extend, compare and
// annotate. Nothing is doubled, and a lone empty line is dropped. The cursor
// sits at the position on `prefer` (the notebook line the move was picked
// from) if it is on view, else the first line on view; a position nothing
// passes through gets a line of its own.
export function openAt(s, moves, notebookLines = [], prefer = null) {
	s.root = moves.map((m) => m.san);
	if (s.lines.length === 1 && !s.lines[0].moves.length) s.lines = [];
	for (const l of notebookLines) {
		if (!passes(s.root, l)) continue;
		const lk = keyOf(l.moves);
		if (s.lines.some((x) => keyOf(x.moves) === lk)) continue;
		s.lines.push({
			moves: l.moves.map((m, i) => ({ san: m.san, ply: i })),
			comments: (l.comments || []).map((c) => ({ ply: c.ply, text: c.text })),
		});
	}
	const on = s.lines.map((l, i) => (passes(s.root, l) ? i : -1)).filter((i) => i !== -1);
	if (!on.length) return rootLine(s);
	const want = prefer && keyOf(prefer.moves);
	const hit = on.find((i) => keyOf(s.lines[i].moves) === want);
	s.active = hit !== undefined ? hit : on[0];
	s.at = moves.length;
	return s;
}

// Every line in the pool back on view: the root goes back to the start.
export function showAll(s) {
	s.root = [];
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
		root: (s.root || []).slice(),
		flipped: !!s.flipped,
	};
}

// The inverse, trusting nothing: a file can be edited by hand. Each line is
// replayed and cut at its first move that is not legal; notes past the cut or
// not attached to a move go; the cursor and root are brought back within
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
	s.root = Array.isArray(d.root) ? d.root.map(String) : [];
	// a root no line reaches would leave nothing on view: widen it to the
	// part the active line shares
	widen(s);
	s.flipped = !!d.flipped;
	return s;
}
