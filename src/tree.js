// Turns a parsed variation-tree (from pgn.js) into the flat list of "lines"
// the editor works on. A line is one root-to-leaf path: mainline is index 0,
// every (variation) contributes its own leaf line.

function chainToMoves(chain) {
	return chain
		.filter((x) => x && x.san)
		.map((x) => ({ san: x.san, ply: x.ply }));
}

export function collectLines(nodes) {
	const lines = [];
	function walk(seq, prefix, isTop) {
		const path = prefix.slice();
		seq.forEach((n) => {
			path.push(n);
			n.variations.forEach((v) => walk(v, path, false));
		});
		if (!isTop) {
			const last = path[path.length - 1];
			lines.push({
				moves: chainToMoves(path),
				fen: last.fen,
				ply: last.ply,
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
	};
	return [main, ...lines];
}
