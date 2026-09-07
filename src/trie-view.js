import { buildTrie, leavesOf, countLeaves } from "./tree.js";

import { renderTable, movesText } from "./render.js";
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
import { groupedVars } from "./group-cols.js";
import { setHidden, solo, isFocused, hideAll, showAll } from "./visibility.js";
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
	// No "Branches:" label: Expand all / Collapse all sit directly under a table
	// of branches and say what they do. "Lines:" stays on the pair below, where
	// "Hide all" on its own would not say what it hides.
	const controls = el("div", { className: "orow tbl-controls" });
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
	// Bulk hide/show, mirroring the editor's pair. The table is where a reader
	// decides a line is in the way, so the control belongs here too; both call
	// the same primitives, which refuse the mainline at the source.
	const hideEvery = el("button", {
		className: "chip mini",
		textContent: "Hide all",
		onclick: () => {
			hideAll(getCurrent().lines);
			getRenderHooks().renderApp();
		},
	});
	const showEvery = el("button", {
		className: "chip mini",
		textContent: "Show all",
		onclick: () => {
			showAll(getCurrent().lines);
			getRenderHooks().renderApp();
		},
	});
	controls.append(" Lines: ", hideEvery, showEvery);
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
		// gets the group's line actions and the move section both -- its moves
		// are shared by every line under it, so annotating one there is the same
		// edit the shared-move rule already makes from a line column.
		onMenu: (v, ply, e) =>
			openTableMenu({
				x: e.clientX || 0,
				y: e.clientY || 0,
				from: e.currentTarget,
				target: v.groupLines
					? { lines: v.groupLines, ply }
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
// The var list the screen preview renders. Exported so the trace rules can be
// tested against the same columns the view builds, without a DOM.
//
// The columns themselves come from group-cols.js, which print.js builds from
// too; what belongs to the screen is the pair of hooks passed in — which groups
// the reader has open, and what a click on a group's header does.
export function pushVars(g) {
	return groupedVars(g.vars[0], g.vars.slice(1), {
		isOpen: (key) => openTablePaths.has(key),
		onToggle: (key, open) => {
			if (open) openTablePaths.delete(key);
			else openTablePaths.add(key);
			getRenderHooks().rerenderTable();
		},
	});
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

// The shared path a group header states is written by movesText (render.js),
// so it numbers each fullmove once instead of every ply: "2.Nf3 d6  3.d4 cxd4",
// not "2.Nf3  2...d6  3.d4  3...cxd4", which doubled every header's length and
// read as a list of plies rather than as a line of chess. `path` is carried
// down as the moves themselves for exactly that reason -- a pre-joined string
// has lost the plies the pairing needs.

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
	const nextPath = [...(path || []), node.move];
	const boards = getCurrent().showBoards; // inline-boards master toggle
	// Single-child chain: inline it, accumulating the path so a long shared
	// continuation shows as one compressed header, not nested single groups.
	//
	// A real fork left with one visible child is NOT such a chain: Focus and
	// Hide are meant to narrow what is under a group, not to dissolve the group
	// into what survived, so a forking node keeps its own level -- but only
	// while it still has something to separate. A group level says "several
	// things share this prefix"; with ONE visible line under it there is
	// nothing left to say, and the header is pure indirection. That rule had no
	// floor, so Focus -- which hides everything but one line -- turned every
	// fork along that line's path into a single-child wrapper, seven of them
	// nested around one row in a real notebook.
	//
	// countLeaves runs on the VISIBLE trie, so this counts what is on screen.
	if (
		!node.leaf &&
		node.children.size === 1 &&
		(!forks.has(node.key) || countLeaves(node) < 2)
	) {
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
		textContent: `${movesText(nextPath)} · ${count} line${count === 1 ? "" : "s"}`,
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
