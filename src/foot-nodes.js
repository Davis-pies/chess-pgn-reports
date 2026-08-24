// The tree INSIDE one group footnote: turning the undecorated `tree` that
// foot-groups.js derives from the trie into the nested `children` nodes the
// renderers walk, merging each node's per-move symbols, and lettering the
// nodes once their notes are known.
//
// This is not in notes.js because none of it assigns a global number. That
// module has to number the table's superscripts and the notes list in ONE
// pass, or the two could drift; decoration is a separate job that only shapes
// what sits under a single already-numbered entry, and keeping it here keeps
// each piece testable on its own. notes.js still owns the entry itself: the
// anchor, the number, and which node a comment ends up on.

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

// Every member line below a node, in reading order — the lines whose symbols
// the node's own moves may carry.
export function linesUnder(node) {
	const out = node.line ? [node.line] : [];
	node.children.forEach((c) => out.push(...linesUnder(c)));
	return out;
}

// A node's per-move symbols are merged from the lines beneath it, at the plies
// that node actually renders (`plies`: node -> Set of plies): a symbol on a
// shared move belongs to the node that draws that move, not to whichever member
// happens to carry it. First line wins, so a disagreement between members is
// resolved in reading order rather than by whichever was visited last.
export function mergeMarks(node, plies) {
	const own = plies.get(node);
	linesUnder(node).forEach((l) =>
		own.forEach((ply) => {
			const m = l.marks && l.marks[ply];
			if (m !== undefined && node.marks[ply] === undefined) node.marks[ply] = m;
		}),
	);
	node.children.forEach((c) => mergeMarks(c, plies));
}

// Labels run in ONE sequence per level: a node's own notes take the first
// labels below it and its branches continue that same sequence, so a note and a
// branch can never collide on one label. That means labels can only be handed
// out after the comment pass has filled in subNotes.
export function labelNodes(node) {
	node.children.forEach((c, i) => {
		c.label = labelFor(node.depth + 1, node.subNotes.length + i);
		labelNodes(c);
	});
}

// The node a member's note belongs to: the DEEPEST one on its `chain` (group
// foot first, the member's own node last) whose own moves include the note's
// ply. A note at a stem or fork ply would otherwise print a label with no
// superscript to sit on, because the member's own node never renders that move.
// Two members carrying the same note at a shared ply land on the same host and
// so state it once.
function hostFor(chain, ply, plies) {
	for (let i = chain.length - 1; i >= 0; i--)
		if (plies.get(chain[i]).has(ply)) return chain[i];
	// No node draws this move at all — a ply before the group's divergence.
	// Lettering it under a member whose own moves don't contain it would print a
	// label pointing at nothing, so state it once at group level, exactly as a
	// lone footnote has always handled a pre-divergence note.
	return chain[0];
}

// The per-render index the decoration fills in and the comment pass reads back:
// which node speaks for a member line, and which node hosts a note at a ply.
export function hostIndex() {
	const nodeOfLine = new Map(); // member line -> its own decorated node
	const chainOfLine = new Map(); // member line -> [group foot, ...ancestors, own]
	const plies = new Map(); // node -> the set of plies that node renders
	return {
		nodeOfLine,
		chainOfLine,
		plies,
		hostFor: (line, ply) => hostFor(chainOfLine.get(line), ply, plies),
	};
}

function decorate(nodes, depth, chain, byLine, index) {
	return nodes.map((t) => {
		const node = {
			label: "", // assigned by labelNodes() once subNotes are known
			depth,
			moves: t.moves,
			d: 0, // `moves` is already only this node's tail
			marks: {},
			// A leaf aliases its line's map from birth: a member node is only ever
			// the host for its OWN moves, and those markers go into the line's map.
			// (A note at a ply the member doesn't draw is hosted by an ancestor
			// instead, and lives on that node.) `byLine` is pre-seeded by the caller,
			// so the map already exists; an internal fork owns no line and starts
			// empty.
			noteByPly: t.line ? byLine.get(t.line) : {},
			name: (t.line && t.line.name) || "",
			eval: (t.line && t.line.meta && t.line.meta.eval) || "",
			note: (t.line && t.line.meta && t.line.meta.note) || "",
			subNotes: [],
			line: t.line,
			children: [],
		};
		index.plies.set(node, new Set(t.moves.map((m) => m.ply)));
		const below = [...chain, node];
		node.children = decorate(t.children, depth + 1, below, byLine, index);
		if (t.line) {
			index.nodeOfLine.set(t.line, node);
			index.chainOfLine.set(t.line, below);
		}
		return node;
	});
}

// The decorated `foot` root for one group: the shared stem, then the group's
// branches as nested children, with symbols merged onto the node that draws
// each move. `d` is the index in the stem where the parent line diverges, so
// the renderer can slice off the prefix it shares with that parent. Labels are
// NOT assigned here — call labelNodes once the comment pass has filled in
// subNotes. `index` is filled in as a side effect for that pass.
export function groupFoot(group, d, byLine, index) {
	const foot = {
		moves: group.stemMoves,
		d,
		marks: {},
		noteByPly: {},
		depth: 0,
		subNotes: [],
		children: [],
	};
	// Only the moves the renderer actually draws: it slices at `d`, so the prefix
	// the group shares with its parent line is never shown.
	index.plies.set(foot, new Set(group.stemMoves.slice(d).map((m) => m.ply)));
	foot.children = decorate(group.tree, 1, [foot], byLine, index);
	mergeMarks(foot, index.plies);
	return foot;
}
