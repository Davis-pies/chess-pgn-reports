// Turns a parsed variation-tree (from pgn.js) into the flat list of "lines"
// the editor works on. A line is one root-to-leaf path: mainline first,
// every (variation) contributes its own leaf line. Each line carries the
// comments owned by it (mainline owns trunk comments; a variation owns only
// its own nodes' comments), so note markers render without row duplication.

function chainToMoves(chain) {
	return chain
		.filter((x) => x && x.san)
		.map((x) => ({ san: x.san, ply: x.ply }));
}

function nodeComments(seq) {
	const out = [];
	seq.forEach((n) =>
		(n.comments || []).forEach((c) => out.push({ text: c, ply: n.ply })),
	);
	return out;
}

export function collectLines(nodes) {
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
		fen: last.fen,
		ply: last.ply,
		isMain: true,
		comments: nodeComments(chain),
	};
	return [main, ...lines];
}
