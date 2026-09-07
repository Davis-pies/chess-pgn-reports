// The column list a grouped theory table renders: the mainline column, then
// each trie branch by pushNode’s rule — an open group’s shared moves in a
// column of its own, with the lines beneath it eliding what that column
// already spells out.
//
// Lives here rather than in trie-view.js because print.js needs the same
// columns and cannot import the view layer: trie-view.js already imports
// subMaxPly from print.js, so the reverse import would close a cycle. Same
// reasoning as buildTrie living in tree.js.
import { buildTrie, leavesOf, countLeaves } from "./tree.js";
import { markSym } from "./nags.js";

// A trie node's contribution to the column list, one level at a time.
//
// An open group keeps a column of its own: the moves its lines share, and the
// only control in the group. That column is not decoration — without it a group
// whose children are ALL branches would be unfoldable, since every column under
// it would be a shut stub whose click opens rather than closes, leaving
// Collapse all as the only way back out.
//
// It carries no line count while open (the lines are right there) and no fold
// lives on the line columns, so one click closes exactly one level instead of
// however many the reader had opened.
//
// `depth` tints the block: an open group and everything beneath it carry the
// same depth, so the shading marks exactly what that group's ▾ will fold, and a
// group nested inside another shades one step further.
// The grouped column list for `lines` measured against `mainV`: the mainline
// column first, then each top-level branch by pushNode's rule.
//
// `isOpen(key)` decides which groups are expanded — the screen preview reads
// the reader's open paths, the printed report opens everything, since there is
// nothing to click on paper.
//
// `onToggle(key, open)` is the fold handler for a group's header. WITHOUT it
// the columns come out inert: no handler, and no shading depth or trace trail
// either. Those are affordances of a table you can fold and click, and the
// printed report is neither — so the flag that drops one drops all three
// rather than leaving print to strip the leftovers off afterwards.
export function groupedVars(mainV, lines, { isOpen, onToggle } = {}) {
	const opts = { isOpen: isOpen || (() => false), onToggle: onToggle || null };
	const trie = buildTrie(lines, mainV);
	const vars = [mainV];
	trie.children.forEach((c) => pushNode(opts, c, vars));
	return vars;
}

function pushNode(opts, node, vars, depth = 0, cut = -1, trail = []) {
	// one line under it: just that line's column, with nothing to fold
	if (countLeaves(node) === 1) {
		leavesOf(node).forEach((l) =>
			vars.push(tag(opts, elide(l, cut), depth, trail)),
		);
		return;
	}
	const open = opts.isOpen(node.key);
	const v = branchVar(opts, node, open);
	// A group column is traceable in its own right (its stem), so it needs the
	// same trail its children get. It does not go through tag(), which is where
	// a line column picks one up -- without this a NESTED group's chain lost the
	// group above it and its trace died at the mainline prefix, while a
	// top-level group, whose trail is empty anyway, looked fine.
	if (opts.onToggle) v.trail = trail;
	// A shut branch belongs to whatever block encloses it; an open one opens a
	// block of its own and shares that block with its children.
	const d = open ? depth + 1 : depth;
	if (d && opts.onToggle) v.gdepth = d;
	if (open && opts.onToggle) v.gstart = true;
	vars.push(v);
	if (!open) return;
	// Down to the first real fork before recursing: sharedMoves already put the
	// single-child chain in the column above, so opening one level per shared
	// move would reveal nothing new. It also means an open group never has a
	// single child — the fork has at least two things under it.
	const fork = forkOf(node);
	// ...and the group column is now carrying those shared moves on screen, so
	// everything under it starts where the group left off.
	const inner = fork.move.ply;
	// An open group's column is where its shared moves are spelled out, so it
	// joins the trail of everything beneath it: a line traced from here has to
	// light cells in this column, not just in its own.
	const below = [...trail, v];
	// a line ending exactly at the fork is a column beside its continuations
	if (fork.leaf) vars.push(tag(opts, elide(fork.leaf, inner), d, below));
	fork.children.forEach((c) => pushNode(opts, c, vars, d, inner, below));
}

function tag(opts, v, depth, trail) {
	if (!opts.onToggle) return { ...v };
	return { ...v, ...(depth ? { gdepth: depth } : {}), trail };
}

// Elide the moves an open ancestor group's column is already showing.
//
// A line column only has to say how it differs from the column above it; while
// the group is shut there is no such column, so the line spells its whole
// divergence out, but once the group is open repeating its shared moves in
// every child just pushes each line's own continuation off to the right.
// Elided moves become the same "…" the mainline prefix already uses, so the
// column still starts at ply 0 and the rows stay aligned.
//
// A line that ends AT the fork would be left with nothing, so its last move
// stays put: an empty column reads as a bug rather than as "this line stops
// here" — and its marker stays with it.
//
// A note marker goes wherever its move went. An elided cell no longer spells
// out the move it annotates, so a [n] left behind on the "…" pointed at
// nothing, and repeated itself once per line in the group besides. The group
// column shows those moves now and carries their markers (see branchVar).
function elide(v, cut) {
	if (cut < 0) return v;
	const own = Object.keys(v.cells)
		.map(Number)
		.filter((p) => v.cells[p].cls !== "ellip");
	if (!own.length) return v;
	const last = Math.max(...own);
	const upto = last <= cut ? last - 1 : cut;
	const cells = {};
	for (const [k, c] of Object.entries(v.cells))
		cells[k] = Number(k) <= upto ? { text: "\u2026", cls: "ellip" } : c;
	const noteByPly = {};
	for (const [k, refs] of Object.entries(v.noteByPly || {}))
		if (Number(k) > upto) noteByPly[k] = refs;
	return { ...v, cells, noteByPly };
}

// Note markers for the moves a group's column shows, gathered off the lines
// underneath it.
//
// The column is the only place those moves appear — open, its children elide
// them; shut, its children are not on screen at all — so without this a note on
// a shared move was numbered in the Notes list and referenced from nowhere in
// the table.
//
// Only the plies the column actually spells out: a note deeper in a shut
// group's lines has no cell here to sit on, and hanging it off a shared move
// would file it under a move it does not annotate. It stays in the Notes list,
// and reappears in the table when the group is opened far enough to show its
// move.
//
// Numbers are deduped and sorted: a note shared across the group is one number
// (numberNotes already collapses identical text at one ply), and two lines each
// carrying a different note at the same move list both.
function sharedNotes(node, shared) {
	const plies = new Set(shared.map((m) => m.ply));
	const out = {};
	leavesOf(node).forEach((v) => {
		for (const [k, refs] of Object.entries(v.noteByPly || {})) {
			if (!plies.has(Number(k))) continue;
			const into = (out[k] = out[k] || []);
			refs.forEach((n) => into.includes(n) || into.push(n));
		}
	});
	for (const k of Object.keys(out)) out[k].sort((a, b) => a - b);
	return out;
}

// Per-move symbols for the moves a group's column shows, merged off the lines
// underneath it — the same job sharedNotes does for [n] markers, and the same
// job foot-nodes.js's mergeMarks does inside a group footnote.
//
// The column is the only place those moves appear — open, its children elide
// them; shut, its children are not on screen at all — so without this a ⩲ set
// on a shared move was saved in the notebook, exported to the PGN as its NAG,
// and shown nowhere in the table.
//
// Only the plies the column actually spells out, for the same reason: a symbol
// deeper in a shut group's lines has no cell here to sit on, and hanging it off
// a shared move would file it under a move it does not annotate.
//
// First line wins, so members disagreeing about a shared move are resolved in
// reading order rather than by whichever leaf was visited last — matching
// mergeMarks, so a group reads the same in the table and in its footnote.
function sharedMarks(node, shared) {
	const plies = new Set(shared.map((m) => m.ply));
	const out = {};
	leavesOf(node).forEach((v) => {
		for (const [k, mark] of Object.entries(v.marks || {}))
			if (plies.has(Number(k)) && out[k] === undefined) out[k] = mark;
	});
	return out;
}

// The end of a node's single-child chain — the node sharedMoves() stops at.
function forkOf(node) {
	let n = node;
	while (!n.leaf && n.children.size === 1) n = [...n.children.values()][0];
	return n;
}

// A trie branch as a single column/row of its shared continuation: the moves
// common to all its lines up to the first fork, with divergent cells empty.
// Shut, it stands in for the lines underneath and says how many there are;
// open, it is the group's header and shows the shared moves alone.
function branchVar(opts, node, open) {
	const shared = sharedMoves(node); // [{ ply, san }] down the single-child chain
	const marks = sharedMarks(node, shared);
	const cells = {};
	shared.forEach((m) => {
		// resolved to a glyph here, exactly as grid() does for a line's own cells
		cells[m.ply] = { text: m.san, cls: "collapsed", mark: markSym(marks[m.ply]) };
	});
	// ellipsis prefix before the branch's first shared move, like a sideline
	const d = shared.length ? shared[0].ply : 0;
	for (let ply = 0; ply < d; ply++)
		cells[ply] = { text: "…", cls: "ellip" };
	const count = countLeaves(node);
	// The path this column shows, as a line: every move from ply 0 down to the
	// last one it spells out. Tracing a group column highlights how the reader
	// GETS here -- the mainline prefix, any enclosing groups, and this column's
	// own shared moves -- which is the only well-defined answer for a column
	// that stands in for several lines.
	//
	// Named `moves` because that is what tracePath reads. The printed report
	// builds these columns too, but never passes renderTable a trace object, so
	// nothing there reads this; the cards build from grid() directly and never
	// see a group column at all.
	const lastShared = shared.length ? shared[shared.length - 1].ply : -1;
	const leaves = leavesOf(node);
	const anyLeaf = leaves[0];
	const stem = anyLeaf ? anyLeaf.moves.filter((m) => m.ply <= lastShared) : [];
	// The lines under this column, for the context menu's group actions. Vars
	// are copies; grid() carries the line each was built from (see table.js).
	const groupLines = leaves.map((x) => x.line).filter(Boolean);
	return {
		tag: "collapse",
		label: "",
		moves: stem,
		groupLines,
		// Its own identity, not the stem's SAN path: a group whose stem is
		// exactly some line's moves (a line ending at the fork) would otherwise
		// share that line's key and the two would trace each other.
		traceKey: "@" + node.key,
		// The same header either way, so opening a group turns its arrow and
		// nothing else — a header that rewrote itself on click read as the
		// column having been replaced. The shared moves are in the cells; this
		// says how many lines are under them, open or shut, exactly as the
		// editor's group summary does.
		//
		// It is a fold affordance, though: it tells the reader how much a stub
		// is standing in for. The printed report has no stubs and nothing to
		// unfold, so it goes the way of the ▸/▾ cue and the shading, leaving
		// the column to do its one job of stating the shared moves.
		name: opts.onToggle ? `${count} lines` : "",
		eval: "",
		cells,
		noteByPly: sharedNotes(node, shared),
		collapsed: !open,
		// No handler in the printed report: renderTable hangs the ▸/▾ cue and the
		// clickable class off this property, so leaving it undefined is what
		// keeps a fold control off paper.
		...(opts.onToggle
			? { onclick: () => opts.onToggle(node.key, open) }
			: {}),
	};
}


// The moves a branch's lines share, from the branch's root child down its
// single-child chain to the first fork (or the leaf).
function sharedMoves(node) {
	const out = [];
	let n = node;
	while (true) {
		out.push({ ply: n.move.ply, san: n.move.san });
		if (n.leaf || n.children.size !== 1) break;
		n = [...n.children.values()][0];
	}
	return out;
}

// The PRINTED report's columns: the same grouping, without a column of its own
// for each group.
//
// On screen a group's shared moves need their own column, because that column
// is the fold control -- see pushNode. On paper nothing folds, and the column
// bought nothing but a place to put moves that one of the lines beneath it was
// going to spell out anyway. Worse, it made a line's ancestry unreadable: every
// cell above a line's first move is a bare ellipsis, so a line starting at ply
// 13 gave the reader no way to tell whether it followed the mainline's move at
// ply 12 or the group's.
//
// So the group's FIRST line carries the shared run itself and continues into
// its own tail, and its siblings still start at the move after the run. What
// says they belong to it is `spans`: one horizontal rule per group, drawn on
// the row of the last shared move, reaching from just right of that move
// across every column that continues from it. Groups nested inside a group
// produce their own, shorter rules, on their own rows.
export function flatGroupedVars(mainV, lines) {
	const trie = buildTrie(lines, mainV);
	const vars = [mainV];
	const spans = [];
	trie.children.forEach((c) => pushFlat(c, vars, spans, -1));
	return { vars, spans };
}

function pushFlat(node, vars, spans, cut) {
	if (countLeaves(node) === 1) {
		leavesOf(node).forEach((l) => vars.push(elide(l, cut)));
		return;
	}
	const fork = forkOf(node);
	const inner = fork.move.ply;
	// a line ending exactly at the fork sits beside its continuations, as on screen
	const kids = fork.leaf ? [{ leaf: fork.leaf }] : [];
	fork.children.forEach((c) => kids.push({ node: c }));
	const start = vars.length;
	// where each child's own block of columns begins -- one tick per child,
	// however many columns that child's own descendants go on to take
	const tees = [];
	kids.forEach((k, i) => {
		if (i) tees.push(vars.length);
		// The first child is not cut at the fork: its column spells the shared
		// run out and then runs on into its own moves. Every other child starts
		// after the run, as it did when the group had a column.
		const c = i === 0 ? cut : inner;
		if (k.leaf) vars.push(elide(k.leaf, c));
		else pushFlat(k.node, vars, spans, c);
	});
	// `start` holds the shared run's last move, so the run begins after it and
	// stops at the LAST CHILD's first column -- not at the last column of the
	// group, which belongs to that child's own descendants. `tree` gives a
	// directory one connector whatever is nested inside it; the columns the run
	// crosses on the way are the earlier children's descendants, and they are
	// spoken for by their own parent's connector.
	if (tees.length)
		spans.push({
			ply: inner,
			from: start + 1,
			to: tees[tees.length - 1],
			tees,
		});
}
