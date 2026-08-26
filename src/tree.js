// Turns a parsed variation-tree (from pgn.js) into the flat list of "lines"
// the editor works on. A line is one root-to-leaf path: mainline first,
// every (variation) contributes its own leaf line. Each line carries the
// comments owned by it (mainline owns trunk comments; a variation owns only
// its own nodes' comments), so note markers render without row duplication.

import { symFor, markOf } from "./nags.js";

function chainToMoves(chain) {
	return chain
		.filter((x) => x && x.san)
		.map((x) => ({ san: x.san, ply: x.ply }));
}

// A line's per-move symbols, recovered from the NAG codes the PGN carried.
// pgn.js records them on the node; without this they would be parsed and then
// silently dropped, so an imported annotation could never be re-exported.
// A code outside our table has no glyph to show, so it is skipped.
function chainToMarks(chain) {
	const marks = {};
	chain.forEach((x) => {
		if (!x || !x.san || !x.nags) return;
		for (const code of x.nags) {
			// The CODE, not the glyph. Eight glyphs are shared by a White/Black
			// pair, so collapsing to one here threw the side away before the
			// exporter could read it back -- an imported $23 left as $22.
			if (symFor(code)) {
				marks[x.ply] = markOf(code);
				break;
			}
		}
	});
	return marks;
}

function nodeComments(seq) {
	const out = [];
	seq.forEach((n) =>
		(n.comments || []).forEach((c) => out.push({ text: c, ply: n.ply })),
	);
	return out;
}

export function collectLines(nodes) {
	// Result-only or empty movetext (e.g. "*", or no moves at all): there is no
	// mainline to build (no moves were ever played), so there are no lines.
	// Callers (see app.js) already treat an empty `nodes` as "no moves found"
	// before ever reaching collectLines/grid, so an empty array here matches
	// the "no game" state they already handle rather than fabricating a
	// synthetic empty mainline (which would need an invented starting FEN).
	if (!nodes.length) return [];

	const lines = [];
	function walk(seq, prefix, isTop) {
		const path = prefix.slice();
		const own = []; // nodes in THIS line's tail (not the shared prefix)
		seq.forEach((n) => {
			// a variation's first move REPLACES n's move at the same ply, so the
			// variation branches BEFORE n (n is not part of the variation's prefix)
			n.variations.forEach((v) => walk(v, path, false));
			path.push(n);
			own.push(n);
		});
		if (!isTop) {
			const last = path[path.length - 1];
			lines.push({
				moves: chainToMoves(path),
				marks: chainToMarks(path),
				fen: last.fen,
				ply: last.ply,
				comments: nodeComments(own),
			});
		}
	}
	walk(nodes, [], true);

	const chain = [];
	(function main(ns) {
		ns.forEach((n) => chain.push(n));
	})(nodes);
	const last = chain[chain.length - 1];
	const main = {
		moves: chainToMoves(chain),
		marks: chainToMarks(chain),
		fen: last.fen,
		ply: last.ply,
		isMain: true,
		comments: nodeComments(chain),
	};
	return [main, ...lines];
}

// How many leading moves a line shares with the mainline. The line's own tail
// starts at this index; everything before it is the shared prefix. Lives here
// rather than in table.js so notes.js can use it without the two modules
// importing each other.
export function divergence(line, main) {
	let i = 0;
	const a = line.moves;
	const b = main.moves;
	while (i < a.length && i < b.length && a[i].san === b[i].san) i++;
	return i;
}

// Trie of the side lines' divergent tails, so lines that share pieces of their
// divergence from the mainline are grouped together (nested collapsible groups).
// Lives here rather than in trie-view.js so notes.js and foot-groups.js can use
// it without importing the view layer.
export function buildTrie(lines, main) {
	const root = { children: new Map(), leaf: null };
	for (const l of lines) {
		if (l.isMain) continue;
		const d = divergence(l, main);
		let node = root;
		for (const m of l.moves.slice(d)) {
			const k = m.ply + ":" + m.san;
			let child = node.children.get(k);
			if (!child) {
				child = {
					children: new Map(),
					leaf: null,
					move: m,
					// root-relative path key: stable across renders, used to
					// remember which <details> groups are open
					key: (node.key ? node.key + "/" : "") + k,
				};
				node.children.set(k, child);
			}
			node = child;
		}
		node.leaf = l;
	}
	return root;
}

// Keys of the trie nodes that genuinely fork — more than one child. Built from
// the WHOLE line set so a view rendering a filtered trie can tell a group that
// really is a single shared continuation from one that merely has a single
// VISIBLE child right now. Without it, hiding a node's siblings would dissolve
// that node into its child's header and the reader would lose the level they
// were working in.
export function forkKeys(lines, main) {
	const out = new Set();
	const walk = (n) => {
		if (n.key && n.children.size > 1) out.add(n.key);
		n.children.forEach(walk);
	};
	walk(buildTrie(lines, main));
	return out;
}

export function countLeaves(node) {
	let n = node.leaf ? 1 : 0;
	node.children.forEach((c) => (n += countLeaves(c)));
	return n;
}

// All descendant lines of a trie node, depth-first (the flat row/column set
// a table branch contributes to the preview).
export function leavesOf(node) {
	const out = [];
	if (node.leaf) out.push(node.leaf);
	node.children.forEach((c) => out.push(...leavesOf(c)));
	return out;
}
