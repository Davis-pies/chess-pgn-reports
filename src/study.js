// src/study.js
// The study view's state: the workbook's lines to step through, read-only.
// It has the shape of the analysis scratch (analysis.js) -- lines, active, at,
// flipped -- so every stepping primitive there (back, forward, goTo, stepLine,
// stepBranch, select) works on it unchanged, and the board, nav row and engine
// box are the analysis board's own.
//
// Each study line is a copy of a workbook line's moves with `src` pointing at
// the line itself, so names, symbols and notes are read from the workbook as
// it stands and nothing here can write to it. A move off the book starts a
// line of the reader's own (`off`), which lasts until "Back to the book" or
// the view closes; it is never saved.

import { activeLine, through } from "./analysis.js";
import { divergence, mainOf } from "./tree.js";
import { numberNotes } from "./notes.js";

const copyMoves = (moves) => moves.map((m) => ({ san: m.san, ply: m.ply }));

// A study of `lines` (the workbook's visible lines), the mainline first. With
// `moves` it opens on the first line through that position, after its last
// move; otherwise at the start of the mainline.
//
// The notes are numbered once, here, as the table numbers them (`notesOpts`
// are numberNotes' options). The workbook cannot change while the study is
// open, and numbering walks every line against every other, which is too slow
// to repeat on every step through a big workbook.
export function newStudy(lines, moves = [], notesOpts = {}) {
	const main = mainOf(lines);
	const ordered = [...lines.filter((l) => l === main), ...lines.filter((l) => l !== main)];
	const s = {
		lines: ordered.map((l) => ({ moves: copyMoves(l.moves), src: l })),
		active: 0,
		at: 0,
		flipped: false,
		showAll: false,
		numbering: lines.length ? numberNotes(lines, notesOpts) : { entries: [], byLine: new Map() },
	};
	if (!s.lines.length) s.lines.push({ moves: [], off: true, offAt: 0 });
	const i = moves.length ? s.lines.findIndex((l) => through(moves, l)) : -1;
	if (i !== -1) {
		s.active = i;
		s.at = moves.length;
	}
	return s;
}

// Play a move. Along the line being read if it is that line's next move, onto
// another line that plays it from here if one does (a book line before one of
// the reader's own), or else off the book: the reader's line is extended if
// the cursor is at its end, and a new one started from here if not.
export function studyPlay(s, san) {
	const line = activeLine(s);
	if (line.moves[s.at] && line.moves[s.at].san === san) {
		s.at++;
		return s;
	}
	const pos = line.moves.slice(0, s.at);
	const twin = s.lines.findIndex((l) => l.moves[s.at] && l.moves[s.at].san === san && through(pos, l));
	if (twin !== -1) {
		s.active = twin;
		s.at++;
		return s;
	}
	if (line.off && s.at === line.moves.length) {
		line.moves.push({ san, ply: s.at });
		s.at++;
		return s;
	}
	// `src` and `offAt` remember the book line it left, for its symbols on the
	// moves before and for the way back.
	const book = line.off ? line : { src: line.src, offAt: s.at };
	s.lines.push({ moves: [...copyMoves(pos), { san, ply: s.at }], off: true, src: book.src, offAt: Math.min(book.offAt, s.at) });
	s.active = s.lines.length - 1;
	s.at++;
	return s;
}

// Play several moves, as from an engine line. The engine only offers legal
// moves from the position it was given, and the box drops a line from an
// older position, so these are not re-checked here.
export function studyPlayAll(s, sans) {
	sans.forEach((san) => studyPlay(s, san));
	return s;
}

// Drop the reader's own lines and go back to where the line being read left
// the book: on the book line it came from, at the move it left it.
export function backToBook(s) {
	const line = activeLine(s);
	const book = s.lines.filter((l) => !l.off);
	if (!line.off || !book.length) return s;
	let to = book.find((l) => l.src === line.src) || book[0];
	let at = Math.min(line.offAt, divergence(line, to));
	// a line that shares more of the reader's moves is the better way back
	book.forEach((l) => {
		const d = divergence(line, l);
		if (d > at) {
			to = l;
			at = d;
		}
	});
	s.lines = book;
	s.active = s.lines.indexOf(to);
	s.at = at;
	return s;
}

// The symbol (!, ?!, +=) on a move of a study line, from the workbook line it
// is or left, for the moves the two still share.
export function studyMark(line, ply) {
	const src = line.src;
	return src && src.marks && sameThrough(line.moves, src.moves, ply) ? src.marks[ply] : undefined;
}

// Whether a line plays the same moves as `moves` up to and including `ply`.
const sameThrough = (a, b, ply) =>
	a.length > ply && b.length > ply && a.slice(0, ply + 1).every((m, k) => m.san === b[k].san);

// The group-footnote node that is `line`, and the nodes above it: the path
// down one entry's foot tree. Empty when the line is not in that tree.
function pathTo(node, line) {
	if (node.line === line) return [node];
	for (const c of node.children || []) {
		const p = pathTo(c, line);
		if (p.length) return [node, ...p];
	}
	return [];
}

// The notes a reader meets along a line (`moves`, with `src` the workbook line
// it is, if it is one), from the numbering the table and the Notes list use
// (`numbering`, numberNotes()'s result) so the numbers are the printed ones.
//
// A numbered note is about a move, not about the line that happens to carry
// it, so it is on every line that plays the same moves up to it. A footnote's
// [n] sits on the move it is an alternative to, as it does in the table. A
// footnote line's own lettered notes come from its place in its footnote,
// and that footnote is `foot`: what the line is, for its heading.
//
// `notes` are { ply, label, entry } for a numbered note or { ply, label, sub }
// for a lettered one, in order along the line: by ply, numbers before letters
// on one move (the order the table writes them in).
export function studyNotes(moves, src, numbering) {
	const notes = [];
	let foot = null;
	for (const e of numbering.entries) {
		if (e.foot) {
			const path = src ? pathTo(e.foot, src) : [];
			if (path.length) {
				foot = e;
				path.forEach((node) =>
					(node.subNotes || []).forEach((sub) => {
						if (sameThrough(moves, src.moves, sub.ply)) notes.push({ ply: sub.ply, label: sub.label, sub });
					}),
				);
			}
		}
		// a note several lines carry is numbered once, against the first of them
		const carried =
			!e.foot &&
			src &&
			sameThrough(moves, src.moves, e.ply) &&
			(src.comments || []).some((c) => c.ply === e.ply && c.text === e.text);
		if (carried || sameThrough(moves, e.owner.moves, e.ply)) notes.push({ ply: e.ply, label: e.n, entry: e });
	}
	const rank = (n) => (typeof n.label === "number" ? 0 : 1);
	notes.sort((a, b) => a.ply - b.ply || rank(a) - rank(b) || (rank(a) ? 0 : a.label - b.label));
	return { notes, foot };
}
