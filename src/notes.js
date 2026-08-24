import { getCurrent } from "./state.js";
import { divergence } from "./tree.js";
import { footGroups } from "./foot-groups.js";

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
	// Depth 0 is the note's own global [n], handed out by the reading-order
	// renumbering pass at the end of numberNotes — never a local sibling index.
	// Answering for it here would hand back a plausible-looking "1" that is not
	// the note's number, so refuse instead of lying.
	if (depth < 1) throw new Error("labelFor: depth 0 is the global note number");
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
	const nodeOfLine = new Map(); // member line -> its own decorated node
	const chainOfLine = new Map(); // member line -> [group foot, ...ancestors, own]
	const pliesOf = new Map(); // node -> the set of plies that node renders
	// The stem as a pseudo-line, so parentOf/divergence — which compare whole
	// move arrays from move 0 — can be run on the group as a unit.
	const stemLine = (g) => {
		const k = divergence(g.members[0], main) + g.stem.length;
		return { moves: g.members[0].moves.slice(0, k) };
	};
	// Every member line below a node, in reading order — the lines whose symbols
	// the node's own moves may carry.
	const linesUnder = (node) => {
		const out = node.line ? [node.line] : [];
		node.children.forEach((c) => out.push(...linesUnder(c)));
		return out;
	};
	// A node's per-move symbols are merged from the lines beneath it, at the
	// plies that node actually renders: a symbol on a shared move belongs to the
	// node that draws that move, not to whichever member happens to carry it.
	// First line wins, so a disagreement between members is resolved in reading
	// order rather than by whichever was visited last.
	const mergeMarks = (node) => {
		const plies = pliesOf.get(node);
		linesUnder(node).forEach((l) =>
			plies.forEach((ply) => {
				const m = l.marks && l.marks[ply];
				if (m !== undefined && node.marks[ply] === undefined)
					node.marks[ply] = m;
			}),
		);
		node.children.forEach(mergeMarks);
	};
	// Labels run in ONE sequence per level: a node's own notes take the first
	// labels below it and its branches continue that same sequence, so a note and
	// a branch can never collide on one label. That means labels can only be
	// handed out after the comment pass has filled in subNotes.
	const label = (node) => {
		node.children.forEach((c, i) => {
			c.label = labelFor(node.depth + 1, node.subNotes.length + i);
			label(c);
		});
	};
	const decorate = (nodes, depth, chain) =>
		nodes.map((t) => {
			const node = {
				label: "", // assigned by label() once subNotes are known
				depth,
				moves: t.moves,
				d: 0, // `moves` is already only this node's tail
				marks: {},
				noteByPly: {},
				name: (t.line && t.line.name) || "",
				eval: (t.line && t.line.meta && t.line.meta.eval) || "",
				note: (t.line && t.line.meta && t.line.meta.note) || "",
				subNotes: [],
				line: t.line,
				children: [],
			};
			pliesOf.set(node, new Set(t.moves.map((m) => m.ply)));
			const below = [...chain, node];
			node.children = decorate(t.children, depth + 1, below);
			if (t.line) {
				nodeOfLine.set(t.line, node);
				chainOfLine.set(t.line, below);
			}
			return node;
		});
	const roots = [];
	groups.forEach((g) => {
		const pseudo = stemLine(g);
		const parent = parentOf(pseudo);
		const d = divergence(pseudo, parent);
		const ply = anchorPly(parent, d);
		const n = entries.length + 1;
		const foot = {
			moves: pseudo.moves,
			d,
			marks: {},
			noteByPly: {},
			depth: 0,
			subNotes: [],
			children: [],
		};
		pliesOf.set(foot, new Set(pseudo.moves.map((m) => m.ply)));
		foot.children = decorate(g.tree, 1, [foot]);
		mergeMarks(foot);
		roots.push(foot);
		entries.push({ ply, owner: parent, n, foot });
		const parentMap = byLine.get(parent);
		(parentMap[ply] = parentMap[ply] || []).push(n);
	});
	// The node a member's note belongs to: the DEEPEST one on its path whose own
	// moves include the note's ply. A note at a stem or fork ply would otherwise
	// print a label with no superscript to sit on, because the member's own node
	// never renders that move. Two members carrying the same note at a shared ply
	// land on the same host and so state it once.
	const hostFor = (l, ply) => {
		const chain = chainOfLine.get(l);
		for (let i = chain.length - 1; i >= 0; i--)
			if (pliesOf.get(chain[i]).has(ply)) return chain[i];
		return chain[chain.length - 1];
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
				// A grouped member's notes hang off the node that renders the move
				// they annotate, one level below it; a lone footnote's hang off its
				// own entry at depth 1. A note hosted by an ancestor writes its
				// marker onto that node; a note on the member's own move keeps going
				// through the line's map, which the node aliases below.
				const own = nodeOfLine.get(l);
				const host = own ? hostFor(l, c.ply) : entry.foot;
				const depth = (host.depth || 0) + 1; // a lone footnote's entry has none
				const sub = host.subNotes;
				let at = sub.find((x) => x.ply === c.ply && x.text === c.text);
				if (!at) {
					at = { label: labelFor(depth, sub.length), ply: c.ply, text: c.text };
					sub.push(at);
				}
				const into = host === own || !own ? map : host.noteByPly;
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
			const at = (map[c.ply] = map[c.ply] || []);
			if (!at.includes(n)) at.push(n);
		});
	});
	footEntries.forEach(([e, l]) => (e.foot.noteByPly = byLine.get(l)));
	// A member node's own markers were written into its line's map, so alias it
	// in wholesale — but keep anything already hosted on the node itself (a note
	// a DEEPER node could not host lands here).
	nodeOfLine.forEach(
		(node, l) => (node.noteByPly = Object.assign(byLine.get(l), node.noteByPly)),
	);
	roots.forEach(label);
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
