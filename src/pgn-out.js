import { divergence } from "./tree.js";

// Serializes the live editor state back to PGN.
//
// The editor works on a FLAT list of root-to-leaf lines (see collectLines in
// tree.js); PGN needs the tree those lines were flattened from. treeFromLines
// rebuilds it.
//
// Which line a sideline branches off is not recorded anywhere, because
// flattening dropped it — it is recovered the same way notes.js recovers a
// note's parent: the candidate line sharing the longest prefix with it wins,
// with the mainline breaking ties. Sorting candidates by depth before
// attaching means a sideline is always attached to an already-placed parent,
// so a sideline of a sideline nests rather than landing on the trunk.

function node(m) {
	return { san: m.san, ply: m.ply, nags: [], comments: [], variations: [] };
}

// The nodes of `line` from index `d` onward — the part that is this line's own,
// not shared with its parent.
function tailNodes(line, d) {
	return line.moves.slice(d).map(node);
}

export function treeFromLines(lines) {
	if (!lines.length) return [];
	const main = lines.find((l) => l.isMain) || lines[0];
	const trunk = tailNodes(main, 0);
	// nodes[i] of a placed line, so a child can attach into its parent's nodes
	const placed = new Map([[main, trunk]]);

	// Shallowest first: a line's parent must already be placed when we get to
	// it. Depth is how far the line diverges from the mainline — a sideline of
	// a sideline necessarily diverges later than the sideline it branches off.
	const rest = lines
		.filter((l) => l !== main)
		.map((l) => ({ l, d: divergence(l, main) }))
		.sort((a, b) => a.d - b.d);

	for (const { l } of rest) {
		// the placed line sharing the most moves with l; ties go to the
		// mainline, which is first in insertion order
		let parent = main;
		let best = -1;
		for (const cand of placed.keys()) {
			const d = divergence(l, cand);
			if (d > best) {
				best = d;
				parent = cand;
			}
		}
		const pd = divergence(l, parent);
		const nodes = tailNodes(l, pd);
		if (!nodes.length) continue; // l duplicates its parent; nothing to add
		// l replaces its parent's move at index pd, so the variation hangs on
		// that move. A line running past its parent's end hangs on the last.
		const pn = placed.get(parent);
		const host = pn[Math.min(pd, pn.length - 1)];
		host.variations.push(nodes);
		placed.set(l, nodes);
	}
	return trunk;
}
