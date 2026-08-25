import { divergence } from "./tree.js";
import { nagFor } from "./nags.js";
import { numberNotes } from "./notes.js";

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
	// A placed line's own nodes, plus the move index its first node sits at.
	// The offset matters: a nested line's `nodes` covers only its tail, so a
	// child's divergence index (which counts from the START of the game) has to
	// be rebased before it can pick a host node out of it.
	const placed = new Map([[main, { nodes: trunk, start: 0 }]]);

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
		const { nodes: pn, start } = placed.get(parent);
		const host = pn[Math.min(pd - start, pn.length - 1)];
		host.variations.push(nodes);
		placed.set(l, { nodes, start: pd });
	}
	return trunk;
}

// The spec's export format wraps movetext at 80 columns, breaking only
// between tokens.
const WRAP = 80;

// A comment body cannot contain '}' (it would close the comment early) and
// cannot span lines in a way readers agree on, so newlines collapse to
// spaces. A '}' becomes ')' rather than being dropped, so the text still
// reads as the user wrote it.
function commentText(s) {
	return String(s).replace(/\}/g, ")").replace(/\s+/g, " ").trim();
}

function fullmove(ply) {
	return Math.floor(ply / 2) + 1;
}

// Emits one run of moves into `out`. `forceNumber` starts true so the first
// move of a run always carries its number — a variation opening on Black's
// move must read "1... c5", not a bare "c5".
function emitSeq(nodes, out) {
	let forceNumber = true;
	for (const n of nodes) {
		if (n.ply % 2 === 0) out.push(fullmove(n.ply) + ".");
		else if (forceNumber) out.push(fullmove(n.ply) + "...");
		out.push(n.san);
		forceNumber = false;
		// Everything below annotates the move just written, and each of them
		// separates White's move from Black's reply — so Black has to re-state
		// its move number afterwards, or a reader pairs it with the wrong move.
		for (const g of n.nags) {
			out.push("$" + g);
			forceNumber = true;
		}
		// One brace group, not one per comment: a move can carry a line label
		// and a note at once, and readers render two adjacent {} groups
		// inconsistently.
		if (n.comments.length) {
			out.push("{" + n.comments.map(commentText).join(" ") + "}");
			forceNumber = true;
		}
		for (const v of n.variations) {
			const inner = [];
			emitSeq(v, inner);
			out.push("(" + inner.join(" ") + ")");
			forceNumber = true;
		}
	}
}

// A node's comments are written AFTER its move: a PGN comment annotates the
// move it follows, which is also how annotate() anchors notes and marks.
export function writeMovetext(nodes, result) {
	const out = [];
	emitSeq(nodes, out);
	out.push(result);
	const lines = [];
	let line = "";
	for (const tok of out) {
		if (!line) line = tok;
		else if (line.length + 1 + tok.length <= WRAP) line += " " + tok;
		else {
			lines.push(line);
			line = tok;
		}
	}
	if (line) lines.push(line);
	return lines.join("\n");
}

// Index a tree by the line that owns each node, so an annotation belonging to
// a particular line reaches THAT line's node — a variation's first move shares
// a ply with the mainline move it replaces, so ply alone is ambiguous.
function indexByLine(trunk, lines) {
	const main = lines.find((l) => l.isMain) || lines[0];
	const idx = new Map(); // line -> Map(ply -> node)
	const walk = (nodes, owner) => {
		let per = idx.get(owner);
		if (!per) idx.set(owner, (per = new Map()));
		for (const n of nodes) {
			per.set(n.ply, n);
			for (const v of n.variations) {
				// the line whose own tail ends with this variation's moves
				const found = lines.find(
					(l) =>
						l !== owner &&
						v.every((vn, i) => {
							const m = l.moves[l.moves.length - v.length + i];
							return m && m.san === vn.san && m.ply === vn.ply;
						}),
				);
				walk(v, found || owner);
			}
		}
	};
	walk(trunk, main);
	return idx;
}

// The node carrying a line's move at `ply`: its own if it has one there,
// otherwise the trunk's (the move is in the shared prefix, which the trunk
// owns).
function nodeFor(idx, line, ply, main) {
	const own = idx.get(line);
	return (own && own.get(ply)) || (idx.get(main) && idx.get(main).get(ply));
}

export function annotate(trunk, lines, notes) {
	const main = lines.find((l) => l.isMain) || lines[0];
	const idx = indexByLine(trunk, lines);

	for (const l of lines) {
		// per-move symbols
		for (const [ply, sym] of Object.entries(l.marks || {})) {
			const n = nodeFor(idx, l, Number(ply), main);
			if (!n) continue;
			const code = nagFor(sym);
			if (code === undefined) {
				if (!n.comments.includes(sym)) n.comments.push(sym);
			} else if (!n.nags.includes(code)) n.nags.push(code);
		}
		// the line's own name and evaluation, on its first divergent move
		const label = [l.name, (l.meta || {}).eval].filter(Boolean).join(" ");
		if (label && !l.isMain) {
			const d = divergence(l, main);
			const m = l.moves[d] || l.moves[l.moves.length - 1];
			const n = m && nodeFor(idx, l, m.ply, main);
			if (n && !n.comments.includes(label)) n.comments.push(label);
		}
	}

	for (const note of notes) {
		const owner = note.owner || main;
		const n = nodeFor(idx, owner, note.ply, main);
		const text = note.foot ? note.text || "" : note.text;
		if (n && text && !n.comments.includes(text)) n.comments.push(text);
	}
	return trunk;
}

// A PGN tag value is a quoted string: '"' and '\' are the only characters that
// need escaping, and both escape with a backslash.
function tagValue(s) {
	return String(s || "?")
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"');
}

// The full Seven Tag Roster. It is not decoration: importers (lichess,
// chesstempo) reject or mangle a file that omits it, and the report has no
// player or event data to put there, so the spec's "?" / "????.??.??"
// placeholders stand in.
function tagPairs(state, result) {
	return [
		["Event", state.name || "?"],
		["Site", "?"],
		["Date", "????.??.??"],
		["Round", "?"],
		["White", "?"],
		["Black", "?"],
		["Result", result],
	]
		.map(([k, v]) => `[${k} "${tagValue(v)}"]`)
		.join("\n");
}

// The whole export: tag pairs, a blank line, movetext.
//
// `state` is passed in rather than read from state.js on purpose. The bug this
// module replaces was export.js shipping `getCurrent().pgn` — the text the user
// IMPORTED — so every edit was missing from the file. Taking the state as an
// argument keeps the serializer honest and directly testable.
export function buildPgn(state) {
	const lines = state.lines || [];
	const result = state.result || "*";
	const trunk = treeFromLines(lines);
	// numberNotes rather than allNotes: allNotes reads the current-state
	// singleton, and this module deliberately takes its state as an argument.
	annotate(trunk, lines, lines.length ? numberNotes(lines).entries : []);
	return tagPairs(state, result) + "\n\n" + writeMovetext(trunk, result) + "\n";
}
