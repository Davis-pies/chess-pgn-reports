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

// One branch below the stem: its own move run, the line that ends on it (leaf
// only), and its children. Undecorated — labels, depths and note maps are
// notes.js's job.
function subtree(node) {
	const { moves, end } = run(node);
	const t = { moves, line: end.leaf || null, children: [] };
	end.children.forEach((c) => t.children.push(subtree(c)));
	return t;
}

function group(node) {
	const { moves, end } = run(node);
	const tree = [];
	// A line whose moves are a prefix of its siblings' ends ON the stem. It has
	// no tail of its own, so it becomes a moveless first child rather than a
	// special case every renderer would have to know about.
	if (end.leaf) tree.push({ moves: [], line: end.leaf, children: [] });
	end.children.forEach((c) => tree.push(subtree(c)));
	return { members: leavesOf(node), stem: moves, tree };
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
		const g = group(child);
		groups.push(g);
		g.members.forEach((l) => grouped.add(l));
	});
	return { groups, grouped };
}
