import { divergence } from "./tree.js";
import { markNag, markSym } from "./nags.js";
import { numberNotes } from "./notes.js";
import { visibleLines } from "./visibility.js";

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

// The tree, plus a per-line map from ply to the node that draws that move,
// covering the line's WHOLE root-to-leaf path — its own tail and every move it
// inherits from its ancestors.
//
// Handing this back is what makes annotation exact. Recovering it afterwards by
// matching a variation's moves against the line list mis-assigns lines that
// share a suffix, and any ply a line inherits from an ancestor is missing
// altogether — which used to fall back to the MAINLINE's node at that ply, so
// notes from every deep variation piled onto one early mainline move.
export function buildTree(lines) {
	if (!lines.length)
		return { trunk: [], byLine: new Map(), ownFirst: new Map() };
	const main = lines.find((l) => l.isMain) || lines[0];
	const trunk = tailNodes(main, 0);
	const byLine = new Map([[main, new Map(trunk.map((n) => [n.ply, n]))]]);
	// The first node that exists BECAUSE of this line — the head of its own
	// tail. Anything describing the line as a whole belongs here. Its
	// divergence from the MAINLINE is the wrong anchor: a hundred branches off
	// one mainline move all share that node, so a hundred labels piled onto it.
	const ownFirst = new Map([[main, trunk[0]]]);
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
		if (!nodes.length) {
			// l duplicates its parent: no moves of its own, so it draws none —
			// but it still needs a map, and its parent's is exactly right.
			byLine.set(l, byLine.get(parent));
			// no moves of its own: the best it can point at is its parent's head
			ownFirst.set(l, ownFirst.get(parent));
			continue;
		}
		const { nodes: pn, start } = placed.get(parent);
		// l replaces its parent's move at index pd, so the variation hangs on
		// that move. A line running past its parent's end hangs on the last.
		const host = pn[Math.min(pd - start, pn.length - 1)];
		host.variations.push(nodes);
		placed.set(l, { nodes, start: pd });
		// inherited moves come from the parent's map; a variation's first move
		// shares a ply with the move it REPLACES, so the parent's entry at that
		// ply must not be inherited — hence the strict `<`.
		const map = new Map();
		for (const [ply, n] of byLine.get(parent))
			if (ply < nodes[0].ply) map.set(ply, n);
		for (const n of nodes) map.set(n.ply, n);
		byLine.set(l, map);
		ownFirst.set(l, nodes[0]);
	}
	return { trunk, byLine, ownFirst };
}

export function treeFromLines(lines) {
	return buildTree(lines).trunk;
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

// Takes the WHOLE result of buildTree, not just its trunk: the annotation has
// to land on the very node objects that tree holds, and `byLine` maps each line
// to the nodes drawing its moves. Passing them together makes it impossible to
// annotate one tree using another's index.
//
// A note whose ply its line never draws is dropped rather than guessed at —
// putting it on some other line's move is worse than leaving it out.
export function annotate({ trunk, byLine, ownFirst }, lines, notes, opts = {}) {
	const main = lines.find((l) => l.isMain) || lines[0];
	const idx = byLine;

	for (const l of lines) {
		// per-move symbols
		const per = idx.get(l);
		for (const [ply, mark] of Object.entries(l.marks || {})) {
			const n = per && per.get(Number(ply));
			if (!n) continue;
			const code = markNag(mark, Number(ply));
			if (code === undefined) {
				const sym = markSym(mark);
				if (sym && !n.comments.includes(sym)) n.comments.push(sym);
			} else if (!n.nags.includes(code)) n.nags.push(code);
		}
		// the line's own name and evaluation, on its first divergent move
		// A line's name is suppressed unless the notebook asks for it. In a PGN
		// the variation already sits under the move it branches from, so the
		// name mostly repeated what the surrounding moves said — and for a
		// footnote, which is a note ABOUT another variation, the bare name was
		// all the comment ended up carrying. The evaluation is not gated: it
		// says something the moves do not.
		const label = [opts.footNames ? l.name : "", (l.meta || {}).eval]
			.filter(Boolean)
			.join(" ");
		// The marker rides on the same move as the label but is independent of
		// it: the label is gated by the name setting and formatted for humans,
		// so it cannot carry the state our own importer needs back.
		if (label && !l.isMain) {
			const n = ownFirst.get(l);
			if (n && !n.comments.includes(label)) n.comments.push(label);
		}
	}

	const put = (line, ply, text) => {
		const per = idx.get(line || main);
		const n = per && per.get(ply);
		if (n && text && !n.comments.includes(text)) n.comments.push(text);
	};

	for (const note of notes) {
		// A footnote entry carries no `text`: its prose lives in the foot tree,
		// as the line's own `note` plus lettered sub-notes (and, for a group, the
		// same again on each branch). Reading `note.text` here dropped every
		// footnote's words and left only the line's name.
		if (note.foot) putFoot(note.foot, note.foot.line, put);
		else put(note.owner, note.ply, note.text);
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
	// Hidden lines are omitted. PGN is deliberately lossy (see the decision on
	// task a3f4f9db) and store.js is what archives the notebook, so a hidden
	// line does not come back on re-import -- that is accepted, not a bug.
	const lines = visibleLines(state.lines || []);
	const result = state.result || "*";
	const tree = buildTree(lines);
	// numberNotes rather than allNotes: allNotes reads the current-state
	// singleton, and this module deliberately takes its state as an argument.
	const opts = { footNames: state.showFootNames };
	annotate(
		tree,
		lines,
		lines.length ? numberNotes(lines, opts).entries : [],
		opts,
	);
	return (
		tagPairs(state, result) +
		"\n\n" +
		writeMovetext(tree.trunk, result) +
		"\n"
	);
}

// One footnote's prose, anchored move by move rather than dumped whole onto the
// anchor move: PGN comments are positional, so a sub-note about the third move
// belongs on the third move. The footnote's moves and symbols are NOT repeated
// here — they are already in the movetext as the variation itself, with its
// marks as NAGs.
//
// The lettered labels the report shows ("a.", "b.") are dropped for the same
// reason: they exist to tie a note back to a marker in a printed list, and a
// PGN reader shows each comment where it belongs.
function putFoot(foot, line, put) {
	const own = foot.line || line;
	// the node's own note describes the branch, so it goes on its first move
	const first = (foot.moves || []).slice(foot.d || 0)[0];
	if (foot.note && first) put(own, first.ply, foot.note);
	for (const s of foot.subNotes || []) put(own, s.ply, s.text);
	for (const c of foot.children || []) putFoot(c, own, put);
}
