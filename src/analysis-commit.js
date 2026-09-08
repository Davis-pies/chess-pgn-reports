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

import { getCurrent } from "./state.js";
import { buildPgn } from "./pgn-out.js";
import { toLine } from "./analysis.js";

const keyOf = (moves) => moves.map((m) => m.san).join(" ");

export function commitLine(scratchLine) {
	const moves = scratchLine.moves || [];
	if (!moves.length) return { ok: false, reason: "That line has no moves yet." };
	const cur = getCurrent();
	const key = keyOf(moves);
	if (cur.lines.some((l) => keyOf(l.moves) === key))
		return { ok: false, reason: "The notebook already has that line." };
	// Named for the index it is about to occupy, which is what the editor's
	// placeholder names do for every other unnamed line.
	const line = toLine(scratchLine, cur.lines.length);
	cur.lines.push(line);
	cur.pgn = buildPgn(cur);
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
