// src/analysis-commit.js
// The only thing in Analysis mode that writes to the notebook.
//
// Two writes, not one. A workbook is not a dump of current.lines: toNotebook
// saves the PGN plus tags keyed by move, and applyNotebook re-parses that PGN
// on load. A line pushed onto current.lines but missing from current.pgn is
// therefore gone at the next reload -- so the PGN is regenerated here, the
// same way app.js does it in the Update PGN flow.
//
// Nothing here edits an existing line. Appending is safe where mutation is
// not: pgn-out.js recovers a line's parent by longest shared prefix, so an
// appended line is parented by exactly the rule an imported sibling gets,
// while changing a move under an existing line could silently re-parent its
// siblings and strand marks keyed by a ply that moved.

import { getCurrent, openTablePaths } from "./state.js";
import { defaultLineName, divergence, mainOf } from "./tree.js";
import { buildPgn } from "./pgn-out.js";
import { shown, toLine } from "./analysis.js";

const keyOf = (moves) => moves.map((m) => m.san).join(" ");

// Whether the notebook already holds exactly these moves -- what Add would
// refuse, shown on the line before anyone presses it.
export function inNotebook(moves) {
	const cur = getCurrent();
	if (!cur || !moves.length) return false;
	const key = keyOf(moves);
	return cur.lines.some((l) => keyOf(l.moves) === key);
}

// `tag` is what the line is filed as: a sideline unless asked for a footnote.
export function commitLine(scratchLine, { tag = "sideline" } = {}) {
	const moves = scratchLine.moves || [];
	if (!moves.length) return { ok: false, reason: "That line has no moves yet." };
	const cur = getCurrent();
	const key = keyOf(moves);
	if (cur.lines.some((l) => keyOf(l.moves) === key))
		return { ok: false, reason: "The notebook already has that line." };
	// Named for the index it is about to occupy, which is what the editor's
	// placeholder names do for every other unnamed line.
	const line = toLine(scratchLine, cur.lines.length);
	line.tag = tag;
	// The first line into an empty notebook -- a repertoire begun on the
	// board rather than from a PGN -- is its mainline, as the first line of
	// an imported PGN is. A mainline has no tag of its own.
	if (!cur.lines.length) {
		line.isMain = true;
		line.name = defaultLineName(true, 0);
		delete line.tag;
	}
	cur.lines.push(line);
	cur.pgn = buildPgn(cur);
	revealInTable(line, cur.lines);
	return { ok: true, line };
}

// The lines on the board: the ones on view, not the whole session's pool.
export function commitAll(scratch) {
	let added = 0;
	let skipped = 0;
	for (const line of shown(scratch).map((i) => scratch.lines[i])) {
		if (commitLine(line).ok) added++;
		else skipped++;
	}
	return { added, skipped };
}

// The table folds a branch holding several lines into one "N lines" column, so
// a line added into an existing branch would land out of sight. Open every
// group on its path: the keys are buildTrie's, "ply:san" joined from where the
// line leaves the mainline. Keys that name no group are simply never asked for.
function revealInTable(line, lines) {
	const main = mainOf(lines);
	let key = "";
	for (const m of line.moves.slice(divergence(line, main))) {
		key = (key ? key + "/" : "") + m.ply + ":" + m.san;
		openTablePaths.add(key);
	}
}

// ---- notes, without adding a line
//
// A note typed on the board belongs to a position, and if the notebook already
// has that position it can go straight in: onto every notebook line through
// it, which is what annotating a shared move does everywhere else. Notes
// travel in the workbook's per-line tags, not the PGN, so nothing else needs
// rewriting.

// The notebook lines that play these moves up to and including `ply`.
function linesThrough(moves, ply) {
	const cur = getCurrent();
	if (!cur || moves.length <= ply) return [];
	const key = keyOf(moves.slice(0, ply + 1));
	return cur.lines.filter(
		(l) => l.moves.length > ply && keyOf(l.moves.slice(0, ply + 1)) === key,
	);
}

const notesAt = (line, ply) =>
	(line.comments || []).filter((c) => c.ply === ply).map((c) => c.text);

// The notebook's notes on this move, or null if the notebook has not got the
// move at all.
export function notebookNotes(moves, ply) {
	const hits = linesThrough(moves, ply);
	return hits.length ? notesAt(hits[0], ply) : null;
}

// Make the notebook's notes on this move exactly the board's -- including
// none, which clears them. Refused for a move the notebook has not got.
export function saveNote(scratchLine, ply) {
	const hits = linesThrough(scratchLine.moves, ply);
	if (!hits.length)
		return {
			ok: false,
			reason: "That move is not in the notebook yet: add its line, and its notes go in with it.",
		};
	const texts = notesAt(scratchLine, ply);
	for (const l of hits) {
		l.comments = (l.comments || []).filter((c) => c.ply !== ply);
		texts.forEach((text) => l.comments.push({ ply, text }));
	}
	return { ok: true, notes: texts.length };
}

// Every note on the lines on view that is on a move the notebook has. Adds and
// replaces, never clears: a move with no note on the board may simply never
// have been annotated here, and that is no reason to wipe the notebook's.
export function saveAllNotes(scratch) {
	let saved = 0;
	let missing = 0;
	const seen = new Set();
	for (const line of shown(scratch).map((i) => scratch.lines[i]))
		for (const c of line.comments || []) {
			const key = keyOf(line.moves.slice(0, c.ply + 1));
			if (seen.has(key)) continue;
			seen.add(key);
			if (saveNote(line, c.ply).ok) saved++;
			else missing++;
		}
	return { saved, missing };
}
