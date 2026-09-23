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
import { divergence, mainOf } from "./tree.js";
import { buildPgn } from "./pgn-out.js";
import { toLine } from "./analysis.js";

const keyOf = (moves) => moves.map((m) => m.san).join(" ");

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
	cur.lines.push(line);
	cur.pgn = buildPgn(cur);
	revealInTable(line, cur.lines);
	return { ok: true, line };
}

export function commitAll(scratch) {
	let added = 0;
	let skipped = 0;
	for (const line of scratch.lines) {
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
