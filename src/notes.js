import { getCurrent } from "./state.js";
import { divergence } from "./tree.js";

// The mainline move a footnote replaces: the one at the divergence index. A
// footnote that runs past the mainline's end has no such move, so it anchors
// on the mainline's last move instead.
function anchorPly(main, d) {
	const m = main.moves[d] || main.moves[main.moves.length - 1];
	// Unreachable: collectLines() never builds a mainline with zero moves (it
	// returns [] for empty movetext instead), and callers only reach here after
	// confirming `main` exists. A missing move here means an invariant broke
	// upstream, so fail loudly rather than anchoring at a fake ply 0.
	if (!m) throw new Error("anchorPly: mainline has no moves");
	return m.ply;
}

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
//
// This lives in its own module rather than app.js because print.js,
// line-editor.js, export.js, and app.js all need the notes list and it only
// depends on the lines — putting it in app.js would force those other
// modules to import it back from app.js.
//
// Each returned `byLine` is keyed by line object identity and is only valid
// for the exact `lines` array it was computed from — recompute per render
// rather than caching it across mutations (a promoted or re-tagged line is a
// different key set).
export function numberNotes(lines) {
	const entries = [];
	// Pre-seeded so every line's map is created exactly once, up front: a
	// footnote can write into the mainline's map before the mainline's own
	// turn in the loop below comes around, and that map must not then be
	// replaced when it does.
	const byLine = new Map(lines.map((l) => [l, {}]));
	const seen = new Map(); // "ply|text" -> the number first assigned to it
	const main = lines.find((l) => l.isMain) || lines[0];
	const footEntries = []; // [entry, line] — noteByPly filled in after the loop
	lines.forEach((l) => {
		const map = byLine.get(l);
		// A footnote line is pulled out of the table and rendered as a note
		// anchored on the mainline move it replaces. Derived here rather than
		// written into l.comments so renaming or re-tagging the line can never
		// leave a stale note behind. Its own noteByPly isn't filled in until this
		// line's comments are processed below, so the entry gets it after the loop
		// instead of aliasing the still-empty map in.
		if (!l.isMain && l.tag === "foot" && main) {
			const d = divergence(l, main);
			const ply = anchorPly(main, d);
			const n = entries.length + 1;
			const entry = {
				ply,
				owner: main,
				n,
				foot: {
					name: l.name || "",
					eval: (l.meta && l.meta.eval) || "",
					note: (l.meta && l.meta.note) || "",
					moves: l.moves,
					marks: l.marks || {},
					d,
				},
			};
			entries.push(entry);
			footEntries.push([entry, l]);
			const mainMap = byLine.get(main);
			(mainMap[ply] = mainMap[ply] || []).push(n);
		}
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
	footEntries.forEach(([e, l]) => (e.foot.noteByPly = byLine.get(l)));
	return { entries, byLine };
}

// The numbered Notes list for the open notebook.
export function allNotes() {
	return numberNotes(getCurrent().lines).entries;
}
