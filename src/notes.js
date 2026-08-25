import { getCurrent } from "./state.js";
import { divergence } from "./tree.js";
import { footGroups } from "./foot-groups.js";
// The tree INSIDE a group footnote — decoration, symbol merging and lettering —
// lives in foot-nodes.js, which assigns no global numbers; this module keeps the
// one-pass numbering. labelFor lives there too, with the rest of the labelling.
import { groupFoot, hostIndex, labelNodes, labelFor } from "./foot-nodes.js";

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
	// replaced when it does. A group member's node aliases its line's map from
	// birth (see foot-nodes.js), which also needs every map to exist by then.
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
	// A group reaches this lookup through `stemLine`, which presents the group's
	// shared moves as a pseudo-line so the whole group is parented as a unit.
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
	// Group footnotes. A whole all-foot trie node is ONE entry: its members are
	// nested children of that entry instead of separate notes, and the parent
	// line gets a single [n]. Built before the per-line pass so that pass can
	// route a member's comments into its node rather than into the global list.
	const { groups, grouped } = footGroups(lines, main);
	// Filled in by groupFoot below, read back by the comment pass: which node
	// speaks for a member line, and which node hosts a note at a given ply.
	const index = hostIndex();
	const { nodeOfLine } = index;
	// The stem as a pseudo-line, so parentOf/divergence — which compare whole
	// move arrays from move 0 — can be run on the group as a unit. footGroups
	// states the stem absolutely for exactly this.
	const stemLine = (g) => ({ moves: g.stemMoves });
	const roots = [];
	groups.forEach((g) => {
		const pseudo = stemLine(g);
		const parent = parentOf(pseudo);
		const d = divergence(pseudo, parent);
		const ply = anchorPly(parent, d);
		const n = entries.length + 1;
		const foot = groupFoot(g, d, byLine, index);
		roots.push(foot);
		entries.push({ ply, owner: parent, n, foot });
		const parentMap = byLine.get(parent);
		(parentMap[ply] = parentMap[ply] || []).push(n);
	});
	lines.forEach((l) => {
		const map = byLine.get(l);
		let entry = null;
		// A footnote line is pulled out of the table and rendered as a note
		// anchored on the mainline move it replaces. Derived here rather than
		// written into l.comments so renaming or re-tagging the line can never
		// leave a stale note behind. Its own noteByPly isn't filled in until this
		// line's comments are processed below, so the entry gets it after the loop
		// instead of aliasing the still-empty map in.
		// A group member is already a child of the group's entry, so it must not
		// also build a footnote of its own.
		if (!l.isMain && l.tag === "foot" && main && !grouped.has(l)) {
			const parent = parentOf(l);
			const d = divergence(l, parent);
			const ply = anchorPly(parent, d);
			const n = entries.length + 1;
			entry = {
				ply,
				owner: parent,
				n,
				// A lone footnote: no `children`, which is exactly what distinguishes
				// it from a group's entry — `children` present ⇔ group, and every
				// renderer branches on that.
				foot: {
					depth: 0,
					name: l.name || "",
					eval: (l.meta && l.meta.eval) || "",
					note: (l.meta && l.meta.note) || "",
					moves: l.moves,
					marks: l.marks || {},
					subNotes: [],
					// The line this footnote is: a group's child nodes each carry
					// theirs, and a consumer that walks the foot tree (the PGN
					// exporter) needs the root's too, to anchor its sub-notes on the
					// right line when a ply collides with the mainline's.
					line: l,
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
				// A grouped member's notes hang off the node that renders the move
				// they annotate, one level below it; a lone footnote's hang off its
				// own entry at depth 1. A note hosted by an ancestor writes its
				// marker onto that node; a note on the member's own move keeps going
				// through the line's map, which the node aliases.
				// Every grouped line has a node: a member whose moves are a prefix of
				// its siblings' is demoted to a moveless child, which still carries
				// `line`. So no node here means this is a lone footnote, not a group
				// member footGroups forgot.
				const own = nodeOfLine.get(l);
				const host = own ? index.hostFor(l, c.ply) : entry.foot;
				const depth = host.depth + 1;
				const sub = host.subNotes;
				let at = sub.find((x) => x.ply === c.ply && x.text === c.text);
				if (!at) {
					at = { label: labelFor(depth, sub.length), ply: c.ply, text: c.text };
					sub.push(at);
				}
				const into = own && host !== own ? host.noteByPly : map;
				const marks = (into[c.ply] = into[c.ply] || []);
				if (!marks.includes(at.label)) marks.push(at.label);
				return;
			}
			let n = seen.get(k);
			if (n === undefined) {
				n = entries.length + 1;
				seen.set(k, n);
				entries.push({ ply: c.ply, text: c.text, owner: l, n });
			}
			// A global note is hosted like any other: at a shared ply its number
			// belongs on the node that draws that move, or the group's rendering
			// would drop the cross-reference. A note on the member's own move stays
			// in the line's map, which the member's node aliases.
			const own = nodeOfLine.get(l);
			const host = own && index.hostFor(l, c.ply);
			const into = host && host !== own ? host.noteByPly : map;
			const at = (into[c.ply] = into[c.ply] || []);
			if (!at.includes(n)) at.push(n);
		});
	});
	footEntries.forEach(([e, l]) => (e.foot.noteByPly = byLine.get(l)));
	roots.forEach(labelNodes);
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
	// Every marker map, once each: the per-line maps plus the group nodes that
	// host a marker of their own. A member node aliases its line's map, so the
	// seen-set keeps it from being remapped twice.
	const maps = new Set(byLine.values());
	const collect = (node) => {
		maps.add(node.noteByPly);
		node.children.forEach(collect);
	};
	roots.forEach(collect);
	maps.forEach((map) =>
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
