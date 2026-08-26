import { buildTrie, leavesOf, countLeaves } from "./tree.js";
import { renderTable, fullmoveLabel } from "./render.js";
import { el } from "./dom.js";
import {
	getCurrent,
	openPaths,
	openTablePaths,
	getTraced,
	setTraced,
	getRenderHooks,
} from "./state.js";
import { subMaxPly } from "./print.js";
import { setHidden, solo, isFocused } from "./visibility.js";
import { grid } from "./table.js";
import { tracedKey, tracePath } from "./trace.js";
import { openTableMenu } from "./table-menu.js";

// Shared empty default for renderTrieNode's `forks`, so the common call does
// not allocate a Set per node.
const EMPTY = new Set();
// rerenderTable/rerenderMarkup (app.js shell glue, in-place panel rebuilds)
// and lineEditor (seam 3) are reached through the render-hooks registry
// rather than a static `import ... from "./app.js"` -- see the comment on
// setRenderHooks() in state.js for why.

// Left-panel preview: ONE table. The mainline column is always visible (left
// in horizontal, top row in vertical); each top-level trie branch contributes
// its columns. A collapsed branch is compressed to a single shared-continuation
// column (the moves all its lines have in common up to the fork); clicking that
// column's header expands it back into its individual line columns.
export function renderTrieTable(container, g, orientation) {
	const mainV = g.vars[0]; // mainline sorts first
	const others = g.vars.slice(1);
	const trie = buildTrie(others, mainV);
	const controls = el("div", { className: "orow tbl-controls" });
	controls.appendChild(el("span", { textContent: "Branches: " }));
	const ex = el("button", {
		className: "chip mini",
		textContent: "Expand all",
	});
	ex.onclick = () => {
		openTablePaths.clear();
		trie.children.forEach((c) => collectKeys(c, openTablePaths));
		getRenderHooks().rerenderTable();
	};
	const col = el("button", {
		className: "chip mini",
		textContent: "Collapse all",
	});
	col.onclick = () => {
		openTablePaths.clear();
		getRenderHooks().rerenderTable();
	};
	controls.append(ex, col);
	if (!mainV) {
		container.appendChild(controls);
		return;
	}
	// build the single table's var list: mainline + each branch, one level of
	// the trie at a time (see pushNode)
	const vars = pushVars(g);
	// The traced line, resolved against the columns actually on screen. A key
	// that no longer names a visible column resolves to null, so a trace a fold
	// has hidden simply stops showing rather than leaving stale state behind --
	// which is why folding, hiding and focusing need no hook into the trace.
	const litByVar = tracePath(vars, getTraced());
	// Offered only while a trace is actually showing: a control for something
	// that is not happening is noise, and clicking the traced column clears it
	// anyway.
	if (litByVar) {
		const clear = el("button", {
			className: "chip mini",
			textContent: "Clear trace",
		});
		clear.onclick = () => {
			setTraced(null);
			getRenderHooks().rerenderTable();
		};
		controls.append(" ", clear);
	}
	container.appendChild(controls);
	// rows span only the VISIBLE columns — collapsed branches don't stretch the
	// table down to the deepest hidden line
	renderTable(container, { ...g, vars, maxPly: subMaxPly(vars) }, orientation, {
		litByVar,
		// Right-click acts on the move; left-click still traces. A group column
		// stands in for several lines, so it gets the group actions and no
		// per-move section.
		onMenu: (v, ply, e) =>
			openTableMenu({
				x: e.clientX || 0,
				y: e.clientY || 0,
				from: e.currentTarget,
				target: v.groupLines
					? { lines: v.groupLines }
					: { line: v.line, ply },
			}),
		onTrace: (v) => {
			// Against the RESOLVED trace, not the stored key: clicking a line
			// whose trace is currently invisible sets it rather than clearing
			// it, so the click always does what it looks like it will do.
			setTraced(litByVar && litByVar.has(v) ? null : tracedKey(v));
			getRenderHooks().rerenderTable();
		},
	});
}

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
// The var list the screen preview renders: the mainline column, then each
// top-level branch by pushNode's rule. Exported so the trace rules can be
// tested against the same columns the view builds, without a DOM.
export function pushVars(g) {
	const mainV = g.vars[0];
	const trie = buildTrie(g.vars.slice(1), mainV);
	const vars = [mainV];
	trie.children.forEach((c) => pushNode(c, vars));
	return vars;
}

function pushNode(node, vars, depth = 0, cut = -1, trail = []) {
	// one line under it: just that line's column, with nothing to fold
	if (countLeaves(node) === 1) {
		leavesOf(node).forEach((l) => vars.push(tag(elide(l, cut), depth, trail)));
		return;
	}
	const open = openTablePaths.has(node.key);
	const v = branchVar(node, open);
	// A group column is traceable in its own right (its stem), so it needs the
	// same trail its children get. It does not go through tag(), which is where
	// a line column picks one up -- without this a NESTED group's chain lost the
	// group above it and its trace died at the mainline prefix, while a
	// top-level group, whose trail is empty anyway, looked fine.
	v.trail = trail;
	// A shut branch belongs to whatever block encloses it; an open one opens a
	// block of its own and shares that block with its children.
	const d = open ? depth + 1 : depth;
	if (d) v.gdepth = d;
	if (open) v.gstart = true;
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
	if (fork.leaf) vars.push(tag(elide(fork.leaf, inner), d, below));
	fork.children.forEach((c) => pushNode(c, vars, d, inner, below));
}

function tag(v, depth, trail) {
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
function branchVar(node, open) {
	const shared = sharedMoves(node); // [{ ply, san }] down the single-child chain
	const cells = {};
	shared.forEach((m) => {
		cells[m.ply] = { text: m.san, cls: "collapsed" };
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
	// Named `moves` because that is what tracePath reads. It cannot reach the
	// cards or the printed report: those build from grid() directly, and this
	// var only ever enters the preview's list.
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
		name: `${count} lines`,
		eval: "",
		cells,
		noteByPly: sharedNotes(node, shared),
		collapsed: !open,
		onclick: () => {
			if (open) openTablePaths.delete(node.key);
			else openTablePaths.add(node.key);
			getRenderHooks().rerenderTable();
		},
	};
}

// The group-level Footnote chip. Its state is read back off the lines rather
// than stored: all tagged reads "on", some reads "partial" (dimmed), none reads
// off. Clicking sets every line unless they are all already set, in which case
// it clears them — so one click always changes something.
function groupFootChip(node) {
	const leaves = leavesOf(node);
	const all = leaves.every((l) => l.tag === "foot");
	const some = !all && leaves.some((l) => l.tag === "foot");
	const chip = el("button", {
		className:
			"chip tag foot groupfoot" + (all ? " on" : some ? " partial" : ""),
		textContent: "Footnote",
	});
	chip.onclick = (e) => {
		// the chip lives in the <summary>, where a click would otherwise toggle
		// the <details> open/closed as well
		e.preventDefault();
		e.stopPropagation();
		leaves.forEach((l) => (l.tag = all ? null : "foot"));
		getRenderHooks().renderApp();
	};
	return chip;
}

// The group-level Hide chip, read back off the leaves rather than stored.
//
// Unlike groupFootChip there is no "partial" state to show: a group's leaves
// are always uniformly visible or uniformly hidden, because the editor builds
// its trie over the VISIBLE lines and the drawer builds its own over the
// hidden ones. So the chip hides a whole group in the editor, and brings a
// whole group back in the drawer.
function groupHideChip(node) {
	const leaves = leavesOf(node);
	const allHidden = leaves.every((l) => l.hidden);
	const chip = el("button", {
		className: "chip hide grouphide" + (allHidden ? " on" : ""),
		textContent: allHidden ? "Hidden" : "Hide",
	});
	chip.onclick = (e) => {
		// the chip lives in the <summary>, where a click would otherwise toggle
		// the <details> open/closed as well
		e.preventDefault();
		e.stopPropagation();
		setHidden(leaves, !allHidden);
		getRenderHooks().renderApp();
	};
	return chip;
}

// "Hide everything outside this group."
function groupSoloChip(node) {
	const leaves = leavesOf(node);
	const on = isFocused(getCurrent().lines, leaves);
	const chip = el("button", {
		className: "chip solo groupsolo" + (on ? " on" : ""),
		textContent: "Focus",
		title: on
			? "this group is what the notebook is showing"
			: "hide every line outside this group",
	});
	chip.onclick = (e) => {
		e.preventDefault();
		e.stopPropagation();
		focusLines(leaves);
	};
	return chip;
}

// Focus, from either chip. Beyond narrowing the lines, it opens every table
// branch left standing: the table compresses a multi-line branch into a single
// "N lines" stub by default, and focusing a group only to be shown a stub of it
// is the opposite of what the click asked for.
export function focusLines(keep) {
	solo(getCurrent().lines, keep);
	openTablePaths.clear();
	const g = grid(getCurrent().lines);
	if (g.vars.length)
		buildTrie(g.vars.slice(1), g.vars[0]).children.forEach((c) =>
			collectKeys(c, openTablePaths),
		);
	getRenderHooks().renderApp();
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

function branchLabel(move) {
	return fullmoveLabel(move.ply) + move.san;
}

// Shared move path of a branch, accumulated through its single-child chain
// (e.g. "1... c5 2. Nf3") for the group header.
// Collect a node's key and every descendant's key (for "Expand all").
export function collectKeys(node, into) {
	if (node.key) into.add(node.key);
	node.children.forEach((c) => collectKeys(c, into));
}

export function renderTrieNode(
	container,
	node,
	nameCounter,
	path,
	allOpen,
	// which open-state Set to record this trie's <details> in: the editor's
	// openPaths by default, openHiddenPaths for the hidden drawer's own trie
	paths = openPaths,
	// keys of the nodes that fork in the UNFILTERED tree (see forkKeys) — a
	// node listed here keeps its own level even when the trie being rendered
	// has left it with a single child. Empty means "inline every chain", which
	// is what the trie's own shape says when nothing is filtered out.
	forks = EMPTY,
) {
	const nextPath = path
		? path + "  " + branchLabel(node.move)
		: branchLabel(node.move);
	const boards = getCurrent().showBoards; // inline-boards master toggle
	// single-child chain: inline it, accumulating the path so a long shared
	// continuation shows as one compressed header, not nested single groups.
	// A real fork left with one visible child is NOT such a chain: Focus and
	// Hide are meant to narrow what is under a group, not to dissolve the group
	// into what survived, so a forking node keeps its own level.
	if (!node.leaf && node.children.size === 1 && !forks.has(node.key)) {
		node.children.forEach((c) =>
			renderTrieNode(container, c, nameCounter, nextPath, allOpen, paths, forks),
		);
		return;
	}
	// every node — fork OR lone line — is a collapsible group, closed by
	// default; header shows the full shared path up to this node
	const det = el("details", { className: "lgroup" });
	det.open = paths.has(node.key);
	det.addEventListener("toggle", () => {
		// only rebuild when the open-state actually changed; jsdom fires a
		// toggle when a rebuilt element gets open=true, and without this guard
		// that rebuild re-schedules another toggle forever
		const had = paths.has(node.key);
		if (det.open && !had) paths.add(node.key);
		else if (!det.open && had) paths.delete(node.key);
		else return;
		getRenderHooks().rerenderMarkup(); // boards appear/disappear with expansion (in-place, so the table scroll keeps its position)
		// ponytail: whole-app re-render; if toggling feels slow on huge files,
		// scope the rebuild to the markup panel only
	});
	const count = countLeaves(node);
	const summary = el("summary", {
		className: "lg-head",
		textContent: `${nextPath} · ${count} line${count === 1 ? "" : "s"}`,
	});
	// Marking a group as a footnote is marking all its lines: the group IS one
	// footnote precisely when every line under it is tagged (see foot-groups.js).
	//
	// A group of ONE gets the chips too. Its line editor carries the same three,
	// but only once the group is expanded -- and a collapsed lone line is the
	// common case, so hiding or tagging it would otherwise cost an expand first.
	// leavesOf() returns the single line, so each chip acts on exactly it.
	summary.append(
		groupFootChip(node),
		groupHideChip(node),
		groupSoloChip(node),
	);
	det.appendChild(summary);
	const body = el("div", { className: "lgroup-body" });
	const open = det.open;
	if (node.leaf)
		body.appendChild(
			getRenderHooks().lineEditor(
				node.leaf,
				nameCounter.n++,
				allOpen && open && boards,
			),
		);
	node.children.forEach((c) =>
		renderTrieNode(body, c, nameCounter, "", allOpen && open, paths, forks),
	);
	det.appendChild(body);
	container.appendChild(det);
}
