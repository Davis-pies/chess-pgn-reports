// The on-screen Notes panel: the numbered reference list, folded into
// collapsible groups. It lives apart from export.js — which owns the Markdown
// and PGN paths — because only the screen list collapses: the print report,
// the cards and every export render their notes flat, and giving the shared
// footnote renderer a screen-only mode flag would be one branch that only one
// caller ever takes.
import { el, renderInline } from "./dom.js";
import { closedNotePaths, getCurrent, getRenderHooks } from "./state.js";
import { allNotes } from "./notes.js";
import {
	appendFootnote,
	appendFootNode,
	footStem,
	subNoteRow,
} from "./render.js";
import { moveRef } from "./export.js";

// The numbered Notes list, folded. Everything starts expanded; closedNotePaths
// carries what the reader shut, so a re-render (a re-tagged line, an edited
// note) puts the panel back the way they left it.
export function notesPanel() {
	const tree = noteTree(allNotes(), getCurrent().lines);
	const box = el("details", { className: "notes" });
	box.open = !closedNotePaths.has(tree.key);
	bindToggle(box, tree.key);
	const head = el("summary", { className: "ng-head notes-head" });
	head.appendChild(el("h3", { textContent: "Notes" }));
	head.append(
		bulkChip("Expand all", () => closedNotePaths.clear()),
		// the rows, not the tree: Collapse all folds what is IN the section, and
		// closing the section itself would hide the chip that undoes it
		bulkChip("Collapse all", () =>
			tree.rows.forEach((r) => collectNoteKeys(r, closedNotePaths)),
		),
	);
	box.appendChild(head);
	// The section's own rows sit in a plain wrapper: .ngroup-body draws the
	// indent guide, and the top level is not indented.
	const body = el("div", { className: "notes-body" });
	tree.rows.forEach((r) => appendRow(body, r));
	box.appendChild(body);
	return box;
}

// A bulk control living in the section's <summary>, where a plain click would
// also toggle the section — the same reason groupFootChip() in trie-view.js
// stops its event.
function bulkChip(text, act) {
	const chip = el("button", { className: "chip mini", textContent: text });
	chip.onclick = (e) => {
		e.preventDefault();
		e.stopPropagation();
		act();
		getRenderHooks().rerenderNotes();
	};
	return chip;
}

// A <details> records what the reader closed and stops there — unlike
// renderTrieNode()'s toggle in trie-view.js, which rebuilds because inline
// boards appear and disappear with expansion. A note's nested rows are already
// in the DOM and <details> hides them itself, so a rebuild would be work with
// nothing to show for it — and skipping it also sidesteps the toggle-loop guard
// that pattern needs, since jsdom fires `toggle` when a rebuilt element is
// handed open = true.
function bindToggle(det, key) {
	det.addEventListener("toggle", () => {
		if (det.open) closedNotePaths.delete(key);
		else closedNotePaths.add(key);
	});
}

// One row: a <details> when something is nested under it, otherwise exactly the
// flat DOM the panel rendered before any of this existed.
function appendRow(container, row) {
	if (!row.rows.length) return appendLeaf(container, row);
	const det = el("details", { className: rowClass(row) });
	det.open = !closedNotePaths.has(row.key);
	bindToggle(det, row.key);
	const head = el("summary", { className: "ng-head" });
	appendHead(head, row);
	head.appendChild(
		el("span", { className: "ngcount", textContent: " · " + countLabel(row) }),
	);
	det.appendChild(head);
	const body = el("div", { className: "ngroup-body" });
	row.rows.forEach((r) => appendRow(body, r));
	det.appendChild(body);
	container.appendChild(det);
}

function rowClass(row) {
	if (row.kind === "fnode") return "fnode d" + row.node.depth + " ngroup";
	return "nt ngroup"; // a footnote entry
}

function countLabel(row) {
	return row.hasBranch
		? plural(row.count, "item", "items")
		: plural(row.count, "note", "notes");
}

function plural(n, one, many) {
	return n + " " + (n === 1 ? one : many);
}

function appendHead(head, row) {
	if (row.kind === "fnode") {
		head.appendChild(el("sup", { textContent: "[" + row.node.label + "]" }));
		footStem(head, row.node);
		return;
	}
	head.appendChild(el("sup", { textContent: "[" + row.entry.n + "]" }));
	footStem(head, row.entry.foot);
}

function appendLeaf(container, row) {
	if (row.kind === "subnote") {
		container.appendChild(subNoteRow(row.sub));
		return;
	}
	if (row.kind === "fnode") {
		appendFootNode(container, row.node);
		return;
	}
	const div = el("div", { className: "nt" });
	div.appendChild(el("sup", { textContent: "[" + row.entry.n + "]" }));
	if (row.kind === "foot") {
		// A footnote owns the whole row: its stem goes in a span of its own, and
		// its sub-notes and a group's branches are block rows beside that span.
		appendFootnote(div, row.entry.foot);
	} else {
		const span = document.createElement("span");
		span.appendChild(
			document.createTextNode(moveRef(row.entry.ply, row.entry.owner) + " — "),
		);
		renderInline(span, row.entry.text);
		div.appendChild(span);
	}
	container.appendChild(div);
}

// The flat entry list from numberNotes(), grouped into a tree of collapsible
// rows. Pure: `lines` is passed rather than read off the state so the grouping
// can be tested without a notebook loaded.
//
// Two rules: a footnote with branches or notes of its own is a node, and a
// branch inside a group that has branches or notes of its own is a node too,
// recursively. Anything with nothing under it stays a leaf and gets no key.
// Entries themselves are never grouped with each other — several notes on one
// move stay separate numbered rows, each stating its own move.
export function noteTree(entries, lines) {
	const rows = entries.map((e) => entryRow(e, lines));
	return { kind: "root", key: "notes", rows, ...tally(rows) };
}

// One numbered entry. A plain note has nothing under it; a footnote may carry
// its own notes, its group's branches, or both.
function entryRow(entry, lines) {
	if (!entry.foot) return { kind: "note", entry, rows: [], ...tally([]) };
	const foot = entry.foot;
	// The owning line as well as the ply: two footnotes anchored at the same ply
	// on different lines can open with the same move.
	const key =
		"notes/e" + lines.indexOf(entry.owner) + ":" + entry.ply + ":" +
		firstSan(foot);
	const rows = footRows(foot, key);
	return { kind: "foot", key, entry, rows, ...tally(rows) };
}

// What a collapsed row is hiding: every row beneath it at any depth, not just
// its direct children — a group whose branches carry the commentary would
// otherwise announce "2 branches" and say nothing about the notes inside them.
// `hasBranch` only picks the word: a subtree that is all commentary reads
// "notes", and anything with a branch in it reads "items".
function tally(rows) {
	let count = 0;
	let hasBranch = false;
	rows.forEach((r) => {
		count += 1 + r.count;
		if (r.kind === "fnode" || r.hasBranch) hasBranch = true;
	});
	return { count, hasBranch };
}

// A footnote's contents in the order appendFootnote() renders them: its own
// notes first, then its branches.
function footRows(foot, key) {
	const rows = (foot.subNotes || []).map((sub) => ({
		kind: "subnote",
		sub,
		rows: [],
		...tally([]),
	}));
	(foot.children || []).forEach((node, i) => {
		const k = key + "/" + i;
		const kids = footRows(node, k);
		rows.push({ kind: "fnode", key: k, node, rows: kids, ...tally(kids) });
	});
	return rows;
}

// The first move a footnote shows — its own tail, starting where it diverges.
// Part of the key, so two footnotes anchored on one move stay distinguishable.
function firstSan(foot) {
	const m = (foot.moves || [])[foot.d];
	return m ? m.san : "";
}

// Every collapse key in the tree, for Collapse all.
export function collectNoteKeys(node, into) {
	if (node.key) into.add(node.key);
	node.rows.forEach((r) => collectNoteKeys(r, into));
	return into;
}
