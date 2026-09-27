// Deterministic synthetic repertoire for benchmarking: a mainline with
// nested variations, built from seeded-random legal moves.
import { Chess } from "chess.js";

function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

// `vars` variations in total, spread over `depth` levels; each line runs
// `len` plies past its branch point. Comments on some moves.
export function genPgn({ vars = 200, len = 30, depth = 3, seed = 1 } = {}) {
	const rand = rng(seed);
	let budget = vars;
	const pick = (chess) => {
		const ms = chess.moves();
		return ms.length ? ms[Math.floor(rand() * ms.length)] : null;
	};
	function seq(fen, ply, n, level) {
		const chess = new Chess(fen);
		const out = [];
		for (let i = 0; i < n; i++) {
			const before = chess.fen();
			const san = pick(chess);
			if (!san) break;
			chess.move(san);
			const num = Math.floor((ply + i) / 2) + 1;
			const white = (ply + i) % 2 === 0;
			if (white) out.push(num + ".");
			else if (i === 0) out.push(num + "...");
			out.push(san);
			if (rand() < 0.08) out.push("{ note " + (ply + i) + " }");
			const branches = level < depth && budget > 0 && rand() < 0.35 ? 1 + Math.floor(rand() * 2) : 0;
			for (let b = 0; b < branches && budget > 0; b++) {
				budget--;
				const sub = seq(before, ply + i, Math.max(4, len - i), level + 1);
				out.push("(" + sub + ")");
				if (!white) out.push(num + "...");
			}
		}
		return out.join(" ");
	}
	const body = seq(new Chess().fen(), 0, len * 2, 0);
	return '[Event "bench"]\n\n' + body + " *\n";
}
