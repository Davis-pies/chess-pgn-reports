// The on-screen Notes panel: the numbered reference list, folded into
// collapsible groups. It lives apart from export.js — which owns the Markdown
// and PGN paths — because only the screen list collapses: the print report,
// the cards and every export render their notes flat, and giving the shared
// footnote renderer a screen-only mode flag would be one branch that only one
// caller ever takes.
import { el, renderInline } from "./dom.js";
import { closedNotePaths, getCurrent } from "./state.js";
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
	box.appendChild(head);
	// The section's own rows sit in a plain wrapper: .ngroup-body draws the
	// indent guide, and the top level is not indented.
	const body = el("div", { className: "notes-body" });
	tree.rows.forEach((r) => appendRow(body, r));
	box.appendChild(body);
	return box;
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
	if (row.kind === "cluster") return "ntcluster ngroup";
	if (row.kind === "fnode") return "fnode d" + row.node.depth + " ngroup";
	return "nt ngroup"; // a footnote entry
}

// A collapsed row has to say what it is hiding, in the words of the thing it
// hides: a group's members are branches, a footnote's own notes are notes.
function countLabel(row) {
	const { branches, notes } = row;
	if (branches && notes) return plural(branches + notes, "item", "items");
	if (branches) return plural(branches, "branch", "branches");
	return plural(notes, "note", "notes");
}

function plural(n, one, many) {
	return n + " " + (n === 1 ? one : many);
}

function appendHead(head, row) {
	if (row.kind === "cluster") {
		head.appendChild(el("span", { textContent: row.ref }));
		return;
	}
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
		// Inside a cluster the move reference is already in the header, so the
		// row states its text alone rather than repeating "7.Nbd2 — " down the
		// group.
		if (!row.inCluster)
			span.appendChild(
				document.createTextNode(
					moveRef(row.entry.ply, row.entry.owner) + " — ",
				),
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
// Three rules, applied together: several entries on one move cluster under that
// move's reference; a footnote with branches or notes of its own is a node; and
// a branch inside a group that has branches or notes of its own is a node too,
// recursively. Anything with nothing under it stays a leaf and gets no key.
export function noteTree(entries, lines) {
	const rows = [];
	// Cluster members by owning line + ply. Entries arrive in reading order, so
	// recording each key's first appearance keeps a cluster where its first
	// member stood; the same ply on two different lines is two clusters, since
	// a variation's first move shares its ply with the move it replaces.
	const at = new Map();
	entries.forEach((e) => {
		const k = lines.indexOf(e.owner) + ":" + e.ply;
		const arr = at.get(k);
		if (arr) arr.push(e);
		else at.set(k, [e]);
	});
	const done = new Set();
	entries.forEach((e) => {
		const k = lines.indexOf(e.owner) + ":" + e.ply;
		if (done.has(k)) return;
		done.add(k);
		const members = at.get(k);
		if (members.length < 2) {
			rows.push(entryRow(e, "notes", false));
			return;
		}
		const key = "notes/m" + k;
		rows.push({
			kind: "cluster",
			key,
			entry: e,
			ref: moveRef(e.ply, e.owner),
			rows: members.map((m) => entryRow(m, key, true)),
			branches: 0,
			notes: members.length,
		});
	});
	return {
		kind: "root",
		key: "notes",
		rows,
		branches: 0,
		notes: entries.length,
	};
}

// One numbered entry. A plain note has nothing under it; a footnote may carry
// its own notes, its group's branches, or both.
function entryRow(entry, parentKey, inCluster) {
	if (!entry.foot)
		return { kind: "note", entry, inCluster, rows: [], branches: 0, notes: 0 };
	const foot = entry.foot;
	const key = parentKey + "/e" + entry.ply + ":" + firstSan(foot);
	return {
		kind: "foot",
		key,
		entry,
		rows: footRows(foot, key),
		branches: (foot.children || []).length,
		notes: (foot.subNotes || []).length,
	};
}

// A footnote's contents in the order appendFootnote() renders them: its own
// notes first, then its branches.
function footRows(foot, key) {
	const rows = (foot.subNotes || []).map((sub) => ({
		kind: "subnote",
		sub,
		rows: [],
		branches: 0,
		notes: 0,
	}));
	(foot.children || []).forEach((node, i) => {
		const k = key + "/" + i;
		rows.push({
			kind: "fnode",
			key: k,
			node,
			rows: footRows(node, k),
			branches: (node.children || []).length,
			notes: (node.subNotes || []).length,
		});
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
