import { Chess } from "chess.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function tokenize(mt) {
	// A '{' with no matching '}' can't form a valid \{[^}]*\} token, so it's
	// silently dropped by the main regex below and its body gets retokenized
	// as if it were SAN -- producing a confusing "illegal move" error that
	// names a comment word instead of the real problem. Catch it explicitly.
	if (mt.replace(/\{[^}]*\}/g, "").includes("{")) {
		throw new Error("Unterminated comment: missing closing '}'");
	}
	const re =
		/(\(|\)|\{[^}]*\}|;[^\r\n]*|\d+\.\.\.|\d+\.|1-0|0-1|1\/2-1\/2|\*|\$\d+|[^\s(){};]+)/g;
	return mt.match(re) || [];
}

export function parsePgn(mt) {
	// Tag pairs are read off, then stripped. Anchored per line and matched
	// against the real tag-pair shape on purpose: a looser pattern removes ANY
	// bracketed text anywhere, which also eats "[%...]" markers inside comments
	// (an imported file's [%eval] or [%clk] annotations, say).
	const TAG_LINE = /^[ \t]*\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\][ \t]*$/gm;
	const tags = {};
	for (const m of mt.matchAll(TAG_LINE))
		tags[m[1]] = m[2].replace(/\\(["\\])/g, "$1");
	const cleaned = mt.replace(TAG_LINE, " ");
	const tokens = tokenize(cleaned);
	const ctx = { i: 0, result: "*", comments: [] };
	const nodes = parseSeq(tokens, ctx, { fen: START_FEN, ply: 0 });
	return { nodes, result: ctx.result, comments: ctx.comments, tags };
}

function stepFrom(w, state, san) {
	let m;
	try {
		m = w.play(san, true);
	} catch {
		throw new Error("Illegal or ambiguous move in PGN: " + san);
	}
	return {
		san: m.san,
		fen: m.fen,
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

// Every position reached by a move, keyed by the position before it and the
// move as written: "fen\nsan" -> { san (canonical), fen (after) }. Playing a
// move through chess.js is the expensive part of loading (move generation,
// SAN, FEN), and the same moves are played over and over: each line replays
// the opening it shares with its siblings, and every render replays every line
// (see fenMap). A cached step is a string key and a Map lookup instead.
//
// Only a move chess.js accepts in strict mode is kept, so a lookup never lets
// the parser accept a loose SAN ("Ng1f3") it would otherwise have refused.
// Bounded: it starts over once full rather than growing without limit.
const steps = new Map();
const STEPS_MAX = 200000;

function remember(key, step) {
	if (steps.size >= STEPS_MAX) steps.clear();
	steps.set(key, step);
}

function slowStep(chess, san, strict) {
	const m = chess.move(san, strict ? { strict: true } : undefined);
	return { san: m.san, fen: m.after };
}

// chess.move() builds a full Move object for its return value: every legal
// move again, the SAN, and the FEN before and after, by making and unmaking
// the move. Parsing needs none of that beyond the SAN and the FEN after, so
// this plays the move through chess.js's own internals instead, at about a
// third of the cost. Those internals are not public API, which is why the
// version is pinned (tests/deps.test.mjs) and why any surprise -- a method
// gone, a SAN it will not match -- returns null for the public path to
// handle, errors and all.
const STRIP = (san) => san.replace(/=/, "").replace(/[+#]?[?!]*$/, "");
function fastStrict(chess, san) {
	if (typeof chess._moveFromSan !== "function" || typeof chess._makeMove !== "function") return null;
	let mv;
	try {
		mv = chess._moveFromSan(san, true);
	} catch {
		return null;
	}
	if (!mv) return null;
	// strict matching means the SAN as written, less the decorations chess.js
	// strips, IS the canonical one; put back what the strip took
	let base = STRIP(san);
	if (mv.promotion) base = base.slice(0, -1) + "=" + base.slice(-1).toUpperCase();
	chess._makeMove(mv);
	const suffix = chess.inCheck() ? (chess.isCheckmate() ? "#" : "+") : "";
	return { san: base + suffix, fen: chess.fen() };
}

// A walker over one line: `play` advances it a move, reading the cache when it
// can and replaying on a chess.js board only when it cannot. The board is
// created on the first miss and re-seated only when a hit moved on without it.
function walker(fen = START_FEN) {
	let chess = null;
	let boardAt = null; // the FEN the board is at, when it is in step
	const seat = () => {
		if (!chess) chess = new Chess();
		if (boardAt !== fen) chess.load(fen);
	};
	return {
		get fen() {
			return fen;
		},
		// `strict`: SAN exactly as the standard writes it, as the parser needs.
		// Throws what chess.js throws on an illegal move.
		play(san, strict = false) {
			if (san === "--") {
				// null move: the other side to move, board unchanged. The board
				// is re-seated from it only if a real move follows.
				fen = flipToMove(fen);
				return { san, fen };
			}
			const key = fen + "\n" + san;
			const hit = steps.get(key);
			if (hit) {
				fen = hit.fen;
				return hit;
			}
			seat();
			// Strict parsing accepts less than loose parsing and means the same
			// move by what it accepts, so the fast strict path serves both.
			const fast = fastStrict(chess, san);
			const step = fast || slowStep(chess, san, strict);
			// a loose SAN that only non-strict parsing took is not cached
			if (fast || strict || step.san === san) remember(key, step);
			fen = boardAt = step.fen;
			return step;
		},
	};
}

// Replay a line's moves up to and including the given ply and return the FEN
// of the resulting position (handles -- null moves). Used to show a static
// board for the move currently selected in the editor.
export function fenAt(moves, ply) {
	const w = walker();
	for (const m of moves) {
		if (m.ply > ply) break;
		w.play(m.san);
	}
	return w.fen;
}

// One-pass variant of fenAt: replay a line's moves once and record the FEN
// after each ply. Turns per-(line,ply) replays (O(n²) Chess steps) into O(n).
export function fenMap(moves) {
	const w = walker();
	const map = new Map();
	for (const m of moves) map.set(m.ply, w.play(m.san).fen);
	return map;
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
	// this run's own walker: a variation gets its own, from where it branches
	const w = walker(state.fen);
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
			// the merged note lives on the variation's first move; when the
			// comment trails the variation (no move follows it), it attaches to
			// the move it follows — like trunk comments
			if (narrative.firstNode) narrative.firstNode.comments.push(text);
			else if (last) last.comments.push(text);
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
				.trim(); // drop [%...] markers
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
			if (inVariation) {
				// A result token can only legitimately appear once all
				// variations have closed; hitting one while still inside a
				// variation means the ')' that should have closed it is
				// missing (e.g. a truncated PGN) -- don't silently swallow
				// the result into the variation.
				throw new Error("Unclosed variation: missing closing ')'");
			}
			ctx.result = t;
			ctx.i++;
			flushNarrative();
			return nodes;
		}
		if (/^\d+\.\.?/.test(t) || t === "...") {
			// move-number token (and a standalone spaced ellipsis, e.g.
			// "3. ... a6"), redundant with ply; skip
			ctx.i++;
			continue;
		}
		if (/^\$\d+$/.test(t)) {
			// NAG (Numeric Annotation Glyph), e.g. $1 for "!"; record on the
			// preceding move, not surfaced in the UI.
			if (last) {
				const code = Number(t.slice(1));
				if (!last.nags) last.nags = [];
				last.nags.push(code);
			}
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
			w.play("--");
			last = node;
			ctx.i++;
			continue;
		}
		const node = stepFrom(w, cur, t);
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
	if (inVariation) {
		// Ran out of tokens without hitting the ')' that should have closed
		// this variation -- e.g. the PGN was truncated. Left unchecked, this
		// silently folds the rest of the game (including the result) into
		// the unclosed variation with no warning, producing a plausible but
		// wrong table.
		throw new Error("Unclosed variation: missing closing ')'");
	}
	flushNarrative();
	return nodes;
}
