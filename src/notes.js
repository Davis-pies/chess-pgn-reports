import { getCurrent } from "./state.js";

// The single owner of note numbering. One pass over the lines produces both
// the numbered entries (the Notes list) and, per line, a map of
// `ply -> [numbers]` for the markers that render on that line's moves.
//
// It has to be one pass: grid() renders the [n] superscripts in the table and
// the notes panel renders the list, and if those two numbered the notes
// separately they could drift apart without anything failing.
//
// Dedupe rules: identical (ply, text) notes carried by several lines are one
// note with one number, and a line that repeats a note at one ply lists that
// number once.
export function numberNotes(lines) {
	const entries = [];
	const byLine = new Map();
	const seen = new Map(); // "ply|text" -> the number first assigned to it
	lines.forEach((l) => {
		const map = {};
		byLine.set(l, map);
		(l.comments || []).forEach((c) => {
			const k = c.ply + "|" + c.text;
			let n = seen.get(k);
			if (n === undefined) {
				n = entries.length + 1;
				seen.set(k, n);
				entries.push({ ply: c.ply, text: c.text, owner: l, n });
			}
			const at = (map[c.ply] = map[c.ply] || []);
			if (!at.includes(n)) at.push(n);
		});
	});
	return { entries, byLine };
}

// The numbered Notes list for the open notebook.
export function allNotes() {
	return numberNotes(getCurrent().lines).entries;
}
