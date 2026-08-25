// The on-screen Notes panel: the numbered reference list, folded into
// collapsible groups. It lives apart from export.js — which owns the Markdown
// and PGN paths — because only the screen list collapses: the print report,
// the cards and every export render their notes flat, and giving the shared
// footnote renderer a screen-only mode flag would be one branch that only one
// caller ever takes.
import { moveRef } from "./export.js";

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
