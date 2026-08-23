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
