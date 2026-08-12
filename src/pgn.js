import { Chess } from "chess.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function tokenize(mt) {
	const re =
		/(\(|\)|\{[^}]*\}|;[^\r\n]*|\d+\.\.\.|\d+\.|1-0|0-1|1\/2-1\/2|\*|[^\s(){};]+)/g;
	return mt.match(re) || [];
}

export function parsePgn(mt) {
	const cleaned = mt.replace(/\[[^\]\n]*\]\s*/g, " "); // strip PGN tag/header lines
	const tokens = tokenize(cleaned);
	const ctx = { i: 0, result: "*", comments: [] };
	const nodes = parseSeq(tokens, ctx, { fen: START_FEN, ply: 0 });
	return { nodes, result: ctx.result, comments: ctx.comments };
}

function stepFrom(state, san) {
	const chess = new Chess();
	chess.load(state.fen);
	let m;
	try {
		m = chess.move(san, { strict: true });
	} catch {
		throw new Error("Illegal or ambiguous move in PGN: " + san);
	}
	return {
		san: m.san,
		fen: chess.fen(),
		ply: state.ply,
		variations: [],
		comments: [],
	};
}

// PGN null move: swap the side to move in a FEN string (no board change).
function flipToMove(fen) {
	const p = fen.split(" ");
	p[1] = p[1] === "w" ? "b" : "w";
	return p.join(" ");
}

function attachPending(pending) {
	return pending ? [{ text: pending }] : [];
}

// Parses a run of moves starting at `state` ({fen, ply}: position BEFORE the
// first move). A '(' starts a variation that is an ALTERNATIVE to the preceding
// move, so it branches at the state before that move (same ply). ')' closes it.
// Returns the node list. `state` is never mutated across sub-variations because
// every step draws its position from the previous node's fen.
function parseSeq(tokens, ctx, state) {
	const nodes = [];
	let last = null;
	let stateBeforeLast = state; // position before the most recent move
	let cur = state;
	let pendingComment = null; // comment seen before any move yet
	while (ctx.i < tokens.length) {
		const t = tokens[ctx.i];
		if (t.startsWith("{") || t.startsWith(";")) {
			let text = t.startsWith("{") ? t.slice(1, -1) : t.slice(1);
			text = text
				.trim()
				.replace(/\[%.*?\]/g, "")
				.trim(); // drop [%...] NAG markers
			if (!text || text.length < 5) {
				// drop empty or trivially short fragments (e.g. a lone "If"/"then")
				// that are PGN sentence-splitter noise rather than real notes
				ctx.i++;
				continue;
			}
			ctx.comments.push({ ply: last ? last.ply : 0, text });
			if (last) last.comments.push(text);
			else
				pendingComment = pendingComment ? pendingComment + "\n" + text : text;
			ctx.i++;
			continue;
		}
		if (t === "(") {
			ctx.i++;
			const sub = parseSeq(tokens, ctx, stateBeforeLast);
			if (last) last.variations.push(sub);
			else
				nodes.push({
					san: null,
					fen: state.fen,
					ply: state.ply - 1,
					variations: [sub],
				});
			continue;
		}
		if (t === ")") {
			ctx.i++;
			return nodes;
		}
		if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) {
			ctx.result = t;
			ctx.i++;
			return nodes;
		}
		if (/^\d+\.\.?/.test(t)) {
			// move-number token, redundant with ply; skip
			ctx.i++;
			continue;
		}
		if (t === "--") {
			// null move: opponent passes, swapping the side to move. Flip the FEN's
			// active color so the following move validates for the right side, and
			// keep '--' as a visible node.
			const node = {
				san: "--",
				fen: flipToMove(cur.fen),
				ply: cur.ply,
				variations: [],
				comments: attachPending(pendingComment),
			};
			pendingComment = null;
			nodes.push(node);
			stateBeforeLast = cur;
			cur = { fen: node.fen, ply: node.ply + 1 };
			last = node;
			ctx.i++;
			continue;
		}
		const node = stepFrom(cur, t);
		node.comments = attachPending(pendingComment);
		pendingComment = null;
		nodes.push(node);
		stateBeforeLast = cur;
		cur = { fen: node.fen, ply: node.ply + 1 };
		last = node;
		ctx.i++;
	}
	return nodes;
}
