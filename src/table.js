// Converts tagged lines into a cell grid shared by both (horizontal/vertical)
// table layouts. cell[variation][ply] is undefined where a variation has no
// move at that ply, or a display object {text, cls}. The mainline is the
// reference row (— usually structural, but a sideline can be promoted to it).
// Sidelines render as table rows; Footnote lines are pulled OUT of the table
// and returned as `footNotes` for the prose footnotes section. Comments render
// as per-line note markers (no row duplication).

import { divergence } from "./tree.js";
import { numberNotes } from "./notes.js";
import { visibleLines } from "./visibility.js";

const TAG_META = {
	mainline: { label: "Mainline" },
	sideline: { label: "Sideline" },
	foot: { label: "Footnote" },
};

export function grid(all) {
	// Hidden lines leave the table, the print view and the Markdown export.
	// Filtering HERE -- ahead of the isMain lookup and numberNotes -- also means
	// a hidden line consumes no [n] note number and no footnote letter.
	const lines = visibleLines(all);
	const main = lines.find((l) => l.isMain) || lines[0];
	// Numbering lives in notes.js so the table's [n] superscripts and the Notes
	// list cannot drift apart. byLine gives each line its own ply -> [numbers].
	const { byLine } = numberNotes(lines);
	const vars = []; // mainline + sidelines (table rows)
	// footnote lines, pulled out of the table. Nothing in src/ reads this today —
	// every renderer gets footnote content from allNotes() instead — but it's kept
	// as the structural output of the foot/sideline split for the group-footnote
	// follow-up, which will need exactly this: the set of lines pulled out of the table.
	const footNotes = [];
	lines.forEach((l) => {
		const isMain = !!l.isMain;
		const tag = isMain ? "mainline" : l.tag === "foot" ? "foot" : "sideline";
		const d = isMain ? 0 : divergence(l, main);
		const cells = {};
		const marks = l.marks || {};
		l.moves.forEach((m, i) => {
			let text, cls;
			if (i < d) {
				text = "\u2026";
				cls = "ellip";
			} else if (isMain) {
				text = m.san;
				cls = "main";
			} else {
				text = m.san;
				cls = tag;
			}
			cells[m.ply] = { text, cls, mark: marks[m.ply] || "" };
		});
		const noteByPly = byLine.get(l);
		const base = {
			// Back-reference to the line this var was built from. The table's
			// context menu mutates lines, and a var is a copy: {tag, name,
			// moves, marks, ...}. Nothing else reads it -- store.js saves lines
			// and never vars, and the card and print renderers read named
			// fields -- so it stays a one-way pointer for the menu's benefit.
			line: l,
			tag,
			label: TAG_META[tag].label,
			name: l.name || "",
			eval: (l.meta && l.meta.eval) || "",
			note: (l.meta && l.meta.note) || "",
			fen: l.fen,
			moves: l.moves,
			marks,
			d,
		};
		if (tag === "foot") footNotes.push({ ...base, noteByPly });
		else vars.push({ ...base, cells, noteByPly });
	});
	// mainline is the top reference row
	vars.sort(
		(a, b) => (a.tag === "mainline" ? -1 : 1) - (b.tag === "mainline" ? -1 : 1),
	);


	const maxPly = vars.reduce(
		(m, v) => Math.max(m, ...Object.keys(v.cells).map(Number)),
		0,
	);
	return { vars, maxPly, mainMoves: main.moves, footNotes };
}
