import { getCurrent } from "./state.js";
import { divergence } from "./tree.js";

// The parent-line move a footnote replaces: the one at the divergence index. A
// footnote that runs past its parent's end has no such move, so it anchors on
// the parent's last move instead.
function anchorPly(parent, d) {
	const m = parent.moves[d] || parent.moves[parent.moves.length - 1];
	// Unreachable: collectLines() never builds a mainline with zero moves (it
	// returns [] for empty movetext instead), and callers only reach here after
	// confirming `main` exists. A missing move here means an invariant broke
	// upstream, so fail loudly rather than anchoring at a fake ply 0.
	if (!m) throw new Error("anchorPly: parent line has no moves");
	return m.ply;
}

// Bijective base-26: a, b, ... z, aa, ab, ... so a 27th sibling doesn't run
// past 'z' into punctuation.
function letters(i) {
	let n = i + 1;
	let s = "";
	while (n > 0) {
		n--;
		s = String.fromCharCode(97 + (n % 26)) + s;
		n = Math.floor(n / 26);
	}
	return s;
}

// Labels alternate by nesting depth: depth 0 is the note's own global [n],
// odd depths are letters, even depths below that are numbers — [3] a) 1. a) 1.
// and so on for as deep as a group nests. Only depth 0 takes part in global
// numbering, so a label anywhere below it can never renumber a table marker.
export function labelFor(depth, i) {
	return depth % 2 === 1 ? letters(i) : String(i + 1);
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
	// Fallback parent, and the tie-break winner in parentOf below.
	const main = lines.find((l) => l.isMain) || lines[0];
	const footEntries = []; // [entry, line] — noteByPly filled in after the loop
	// A note the editor shared onto a non-footnote line stays a global numbered
	// note; only notes living exclusively on footnote lines become a footnote's
	// own lettered sub-notes. Computed up front because a footnote line can be
	// visited before the sideline that shares its note.
	const isFoot = (l) => !l.isMain && l.tag === "foot";
	const globalKeys = new Set();
	lines.forEach((l) => {
		if (isFoot(l)) return;
		(l.comments || []).forEach((c) => globalKeys.add(c.ply + "|" + c.text));
	});
	// The line a footnote hangs off: the one it shares the most moves with.
	// A footnote branching off a sideline belongs on THAT line's row and card —
	// anchoring every footnote on the mainline filed its note under a line it
	// never touches. Foot lines are excluded as candidates because grid() pulls
	// them out of the table, so a note anchored on one would have no row or card
	// to render on. The mainline wins ties, leaving a footnote off the trunk
	// exactly where it was.
	//
	// Group-footnote seam: a group marks a SET of sibling lines as one footnote,
	// which needs the parent to be the trie node they share rather than a single
	// line. This lookup is where that generalization goes.
	const parentOf = (l) => {
		let best = null;
		let bestD = -1;
		lines.forEach((c) => {
			if (c === l || isFoot(c)) return;
			const d = divergence(l, c);
			if (d > bestD || (d === bestD && c.isMain)) {
				best = c;
				bestD = d;
			}
		});
		return best || main;
	};
	lines.forEach((l) => {
		const map = byLine.get(l);
		let entry = null;
		// A footnote line is pulled out of the table and rendered as a note
		// anchored on the mainline move it replaces. Derived here rather than
		// written into l.comments so renaming or re-tagging the line can never
		// leave a stale note behind. Its own noteByPly isn't filled in until this
		// line's comments are processed below, so the entry gets it after the loop
		// instead of aliasing the still-empty map in.
		if (!l.isMain && l.tag === "foot" && main) {
			const parent = parentOf(l);
			const d = divergence(l, parent);
			const ply = anchorPly(parent, d);
			const n = entries.length + 1;
			entry = {
				ply,
				owner: parent,
				n,
				foot: {
					name: l.name || "",
					eval: (l.meta && l.meta.eval) || "",
					note: (l.meta && l.meta.note) || "",
					moves: l.moves,
					marks: l.marks || {},
					subNotes: [],
					d,
				},
			};
			entries.push(entry);
			footEntries.push([entry, l]);
			const parentMap = byLine.get(parent);
			(parentMap[ply] = parentMap[ply] || []).push(n);
		}
		(l.comments || []).forEach((c) => {
			const k = c.ply + "|" + c.text;
			// exclusive to footnote lines: it belongs under this footnote, lettered
			if (isFoot(l) && !globalKeys.has(k)) {
				const sub = entry.foot.subNotes;
				let at = sub.find((x) => x.ply === c.ply && x.text === c.text);
				if (!at) {
					at = { label: labelFor(1, sub.length), ply: c.ply, text: c.text };
					sub.push(at);
				}
				const marks = (map[c.ply] = map[c.ply] || []);
				if (!marks.includes(at.label)) marks.push(at.label);
				return;
			}
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
	// Reading order. Numbers are handed out above in lines order — a whole line
	// at a time — which is not the order a reader meets the markers in: a
	// footnote anchored on an early mainline move is created only when its own
	// line comes around, so it used to outnumber a comment on a later move and
	// the table's markers read out of sequence. Renumber by anchor ply, keeping
	// first-seen order within one ply, then rewrite the markers to match.
	const ordered = entries
		.map((e, i) => [e, i])
		.sort((a, b) => a[0].ply - b[0].ply || a[1] - b[1])
		.map(([e]) => e);
	const remap = new Map();
	ordered.forEach((e, i) => {
		remap.set(e.n, i + 1);
		e.n = i + 1;
	});
	// In place, because a footnote's noteByPly aliases its line's map above and
	// both have to see the new numbers. Letters are a footnote's own sub-notes
	// and are never remapped. Relative order within a ply is preserved by the
	// stable tie-break, so each marker array stays ascending.
	byLine.forEach((map) =>
		Object.values(map).forEach((marks) =>
			marks.forEach((m, i) => {
				if (typeof m === "number") marks[i] = remap.get(m);
			}),
		),
	);
	return { entries: ordered, byLine };
}

// The numbered Notes list for the open notebook.
export function allNotes() {
	return numberNotes(getCurrent().lines).entries;
}
