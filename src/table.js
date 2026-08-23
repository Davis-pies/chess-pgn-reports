// Converts tagged lines into a cell grid shared by both (horizontal/vertical)
// table layouts. cell[variation][ply] is undefined where a variation has no
// move at that ply, or a display object {text, cls}. The mainline is the
// reference row (— usually structural, but a sideline can be promoted to it).
// Sidelines render as table rows; Footnote lines are pulled OUT of the table
// and returned as `footNotes` for the prose footnotes section. Comments render
// as per-line note markers (no row duplication).

import { divergence } from "./tree.js";
import { numberNotes } from "./notes.js";

// Footnote letter for index i (0-based): a..z, then aa, ab, ... az, ba, ...
function footLetter(i) {
	let n = i + 1;
	let s = "";
	while (n > 0) {
		n--;
		s = String.fromCharCode(97 + (n % 26)) + s;
		n = Math.floor(n / 26);
	}
	return s;
}

const TAG_META = {
	mainline: { label: "Mainline" },
	sideline: { label: "Sideline" },
	foot: { label: "Footnote" },
};

export function grid(lines) {
	const main = lines.find((l) => l.isMain) || lines[0];
	// Numbering lives in notes.js so the table's [n] superscripts and the Notes
	// list cannot drift apart. byLine gives each line its own ply -> [numbers].
	const { byLine } = numberNotes(lines);
	const vars = []; // mainline + sidelines (table rows)
	const footNotes = []; // footnote lines (prose section)
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
		const noteByPly = byLine.get(l) || {};
		const base = {
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

	// letter the footnote lines: a, b, ..., z, aa, ab, ... (spreadsheet-column
	// style bijective base-26) so a 27th+ footnote doesn't overflow into
	// punctuation/non-printable code points past 'z'.
	footNotes.forEach((f, i) => (f.letter = footLetter(i)));

	const maxPly = vars.reduce(
		(m, v) => Math.max(m, ...Object.keys(v.cells).map(Number)),
		0,
	);
	return { vars, maxPly, mainMoves: main.moves, footNotes };
}
