import { buildTrie, leavesOf, countLeaves } from "./tree.js";

// Marking a whole trie node as one footnote is derived from the hierarchy, not
// stored: a node is a group when every line under it is tagged "foot". Building
// the trie over the foot lines ALONE gives that for free — each top-level child
// of the resulting root is the maximal node whose lines are all footnotes, and
// an untagged sibling passing through the same move simply isn't in the trie.

const isFoot = (l) => !l.isMain && l.tag === "foot";

// The move run from `node` down its single-child chain to the first fork (or to
// the end of a line), plus the node it stops on.
function run(node) {
	const moves = [{ ply: node.move.ply, san: node.move.san }];
	let n = node;
	while (!n.leaf && n.children.size === 1) {
		n = [...n.children.values()][0];
		moves.push({ ply: n.move.ply, san: n.move.san });
	}
	return { moves, end: n };
}

// One branch of a group: its own move run, its children, and — when a line
// ends exactly HERE while others continue past it — that line demoted to a
// moveless first child. A node is therefore strictly one of two things: a leaf
// carrying a line, or a fork carrying children. notes.js and the renderers
// branch on that dichotomy, and a node that was both would silently lose either
// its line's name and commentary or its children.
function subtree(node) {
	const { moves, end } = run(node);
	const children = [];
	if (end.leaf && end.children.size)
		children.push({ moves: [], line: end.leaf, children: [] });
	end.children.forEach((c) => children.push(subtree(c)));
	return { moves, line: children.length ? null : end.leaf, children };
}

function buildGroup(node) {
	// The stem has no line field of its own — the group's entry owns it — so a
	// member ending on the stem surfaces as a child exactly like the fork case.
	const t = subtree(node);
	const tree = t.line
		? [{ moves: [], line: t.line, children: [] }, ...t.children]
		: t.children;
	return { members: leavesOf(node), stem: t.moves, tree };
}

// Groups of foot-tagged lines, plus the set of lines they account for. A lone
// foot line is never a group: it stays the single footnote it already is.
export function footGroups(lines, main) {
	const groups = [];
	const grouped = new Set();
	const foots = lines.filter(isFoot);
	if (!main || foots.length < 2) return { groups, grouped };
	const root = buildTrie(foots, main);
	root.children.forEach((child) => {
		if (countLeaves(child) < 2) return;
		const g = buildGroup(child);
		groups.push(g);
		g.members.forEach((l) => grouped.add(l));
	});
	return { groups, grouped };
}
