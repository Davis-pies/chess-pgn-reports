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
	return pending ? [pending] : [];
}

// Replay a line's moves up to and including the given ply and return the FEN
// of the resulting position (handles -- null moves). Used to show a static
// board for the move currently selected in the editor.
export function fenAt(moves, ply) {
	const chess = new Chess();
	for (const m of moves) {
		if (m.ply > ply) break;
		if (m.san === "--") chess.load(flipToMove(chess.fen()));
		else chess.move(m.san);
	}
	return chess.fen();
}

// Parses a run of moves starting at `state` ({fen, ply}: position BEFORE the
// first move). A '(' starts a variation that is an ALTERNATIVE to the preceding
// move, so it branches at the state before that move (same ply). ')' closes it.
// Returns the node list. `state` is never mutated across sub-variations because
// every step draws its position from the previous node's fen.
//
// Comment handling:
//  - Trunk comments are individual notes; a trunk comment that directly leads
//    into a variation (next token is '(' and it doesn't end in sentence
//    punctuation, e.g. "White threatened") is a lead-in: it is NOT emitted
//    standalone but merged into the variation's note.
//  - Within a variation, fragment comments separated only by moves merge into
//    ONE note with the moves inline, attached to the variation's first move
//    (so it lives on the variation, not on a ply-colliding mainline move).
function parseSeq(tokens, ctx, state, inVariation = false, intro = null) {
	const nodes = [];
	let last = null;
	let stateBeforeLast = state; // position before the most recent move
	let cur = state;
	let pendingComment = null; // trunk comment seen before any move yet
	let variationIntro = null; // trunk lead-in carried into the next variation
	let narrative = intro
		? { ply: state.ply, parts: [intro], firstNode: null }
		: null; // merged variation note: { ply, parts, firstNode }
	const flushNarrative = () => {
		if (narrative) {
			const text = narrative.parts.join(" ");
			const ply = narrative.firstNode ? narrative.firstNode.ply : narrative.ply;
			ctx.comments.push({ ply, text, inVar: inVariation });
			// the merged note lives on the variation's first move
			if (narrative.firstNode) narrative.firstNode.comments.push(text);
			narrative = null;
		}
	};
	const mvText = (m) => {
		const n = Math.floor(m.ply / 2) + 1;
		return (m.ply % 2 === 0 ? n + ". " : n + "... ") + m.san;
	};

	while (ctx.i < tokens.length) {
		const t = tokens[ctx.i];
		if (t.startsWith("{") || t.startsWith(";")) {
			let text = t.startsWith("{") ? t.slice(1, -1) : t.slice(1);
			text = text
				.trim()
				.replace(/\[%.*?\]/g, "")
				.trim(); // drop [%...] NAG markers
			if (!text) {
				ctx.i++;
				continue;
			}
			if (inVariation) {
				if (narrative) narrative.parts.push(text);
				else
					narrative = {
						ply: last ? last.ply : state.ply,
						parts: [text],
						firstNode: null,
					};
			} else if (tokens[ctx.i + 1] === "(" && !/[.!?、。！？]$/.test(text)) {
				// trunk lead-in straight into a variation -> merge, don't emit
				variationIntro = text;
			} else {
				ctx.comments.push({
					ply: last ? last.ply : state.ply,
					text,
					inVar: false,
				});
				if (last) last.comments.push(text);
				else
					pendingComment = pendingComment ? pendingComment + "\n" + text : text;
			}
			ctx.i++;
			continue;
		}
		if (t === "(") {
			flushNarrative();
			ctx.i++;
			const sub = parseSeq(tokens, ctx, stateBeforeLast, true, variationIntro);
			variationIntro = null;
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
			flushNarrative();
			return nodes;
		}
		if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) {
			ctx.result = t;
			ctx.i++;
			flushNarrative();
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
			if (narrative) {
				narrative.parts.push(mvText(node));
				if (!narrative.firstNode) narrative.firstNode = node;
			}
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
		if (narrative) {
			narrative.parts.push(mvText(node));
			if (!narrative.firstNode) narrative.firstNode = node;
		}
		nodes.push(node);
		stateBeforeLast = cur;
		cur = { fen: node.fen, ply: node.ply + 1 };
		last = node;
		ctx.i++;
	}
	flushNarrative();
	return nodes;
}