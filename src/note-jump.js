// From a note in the Notes panel to the move it belongs to: in the table, or
// in the line editor. The list says "16...Nb8" and the table has dozens of
// columns, so finding the move by eye meant reading down every one of them.
//
// Both jumps take a numbered entry from numberNotes() — its `ply` and `owner`
// are the move its [n] marker sits on, which for a footnote is the parent move
// it replaces — and change only session state (open groups, the trace, the
// editor selection) before re-rendering, like any other control.
import { buildTrie, divergence, isMainLine, mainOf } from "./tree.js";
import {
	getCurrent,
	getRenderHooks,
	getSharedInfo,
	openPaths,
	openTablePaths,
	setTraced,
} from "./state.js";
import { grid } from "./table.js";
import { tracedKey } from "./trace.js";
import { visibleLines } from "./visibility.js";

// Every trie key from the root down to the node whose leaf `match` accepts.
// Opening all of them is what un-folds a line: a key on a single-child chain
// that the view inlines is simply never asked for.
function pathTo(trie, match) {
	const walk = (node, keys) => {
		const here = node.key ? [...keys, node.key] : keys;
		if (node.leaf && match(node.leaf)) return here;
		for (const c of node.children.values()) {
			const found = walk(c, here);
			if (found) return found;
		}
		return null;
	};
	return walk(trie, []) || [];
}

// Show the note's move in the table: open the groups folded over its line,
// trace that line, and bring the cell carrying the [n] into view.
//
// The cell is found by its marker rather than by the owner's column. A move
// several lines share is spelled out once, in the first column that plays it
// (the mainline's, or an open group's), and the marker is drawn there — so
// the owner's own column can be an empty cell at that ply.
export function jumpToTable(entry) {
	const g = grid(getCurrent().lines);
	const ownVar = g.vars.find((v) => v.line === entry.owner);
	if (g.vars.length && ownVar && ownVar !== g.vars[0]) {
		const trie = buildTrie(g.vars.slice(1), g.vars[0]);
		pathTo(trie, (v) => v === ownVar).forEach((k) => openTablePaths.add(k));
	}
	if (ownVar) setTraced(tracedKey(ownVar));
	getRenderHooks().rerenderTable();
	const cell = markerCell(entry);
	if (cell) reveal(cell, "note-hit");
	return cell;
}

// The table cell on the entry's row whose superscript lists its number.
function markerCell(entry) {
	const row = document.querySelector(
		`.pv-table tr[data-ply="${entry.ply}"]`,
	);
	if (!row) return null;
	const want = String(entry.n);
	for (const td of row.querySelectorAll("td")) {
		const sup = td.querySelector("sup");
		if (sup && sup.textContent.split(",").includes(want)) return td;
	}
	return null;
}

// Select the note's move in the line editor, as tapping its chip there would,
// and scroll to it so the symbol and note panel that opens is in view.
//
// A line's chip strip starts where it leaves the mainline: a note on a move
// it shares with the mainline (a comment carried on the stem) has its chip on
// the mainline's row, so that row holds the selection.
export function jumpToEditor(entry) {
	const cur = getCurrent();
	const main = mainOf(cur.lines);
	const owner = entry.owner;
	const onStem =
		!isMainLine(owner) && !main.synthetic &&
		entry.ply < divergence(owner, main);
	const at = onStem ? main : owner;
	const gid = getSharedInfo().byLine?.get(at)?.get(entry.ply);
	const group = gid ? getSharedInfo().idLines.get(gid) : [at];
	cur.sel = { lines: group, ply: entry.ply, at };
	if (!isMainLine(at)) {
		const trie = buildTrie(visibleLines(cur.lines), main);
		pathTo(trie, (l) => l === at).forEach((k) => openPaths.add(k));
	}
	getRenderHooks().renderApp();
	const chip = document.querySelector(".markup .move-chip.on");
	if (chip) reveal(chip);
	return chip;
}

// Scroll to an element and give it the focus, so a keyboard user lands where
// the eye does. jsdom has no scrollIntoView, hence the guard.
function reveal(node, cls) {
	if (cls) node.classList.add(cls);
	node.scrollIntoView?.({ block: "center", inline: "center", behavior: "smooth" });
	node.focus?.({ preventScroll: true });
}
