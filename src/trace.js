// Tracing a line through the grouped table preview.
//
// After elide() (see the recursive-table-collapse design) a line's own column
// carries only its tail: the moves before it live in the Mainline column and in
// each enclosing open group's column. Reading one line therefore means
// stitching three places together by eye. This module works out which cells
// make up a given line so the view can light exactly those.
//
// Pure and DOM-free on purpose — the path rule is the part worth testing on its
// own, and render.js only stamps classes from what comes out of here.

// A line's identity across renders. grid() rebuilds every var on every render,
// so a stored var reference would be stale before the next click; the SAN path
// survives. Group columns stand in for several lines and have no `moves` of
// their own, so they have no key and can never be traced.
export function tracedKey(v) {
	return v && v.moves ? v.moves.map((m) => m.san).join(" ") : null;
}

// Which cells make up the line `key` names: Map(var -> Set(ply)).
//
// The line's CHAIN — the mainline column, the open group columns enclosing the
// line, then the line's own column — is ordered, and each link spells a
// contiguous run of the line's moves. So the walk hands the plies out in order:
// each column claims from where the one above it left off, for as long as it
// keeps spelling the line's moves.
//
// A per-ply SAN match is NOT enough, which is the whole reason for the running
// index. The mainline of 1. e4 e5 2. Nf3 and the sideline 1. e4 c5 2. Nf3 both
// play Nf3 at ply 2 from different positions; matching ply by ply would light
// the mainline column again after the line had already left it. Claiming a run
// stops the mainline column at the divergence without any index being stored:
// the moves simply stop matching.
//
// The `next - 1` look-back is for a line ending exactly at its group's fork,
// which keeps its last move rather than being elided to nothing (elide's rule).
// That move is then spelled twice, on the group column and on the line's own,
// and both light — they are the same move, and a lone unlit cell in a traced
// line's own column would read as a bug.
//
// Returns null when the key names no column on screen — the group folded over
// it, or the line was hidden. Nothing to dim, and no stale state to clear,
// which is why the fold, hide and focus handlers need no hook into this.
export function tracePath(vars, key) {
	if (!key) return null;
	const line = vars.find((v) => tracedKey(v) === key);
	if (!line) return null;
	const san = new Map(line.moves.map((m) => [m.ply, m.san]));
	// deduped: tracing the mainline makes it both the head of the chain and the
	// traced line itself
	const chain = [...new Set([vars[0], ...(line.trail || []), line])];
	const spells = (v, ply) => {
		const c = (v.cells || {})[ply];
		return !!c && c.cls !== "ellip" && c.text === san.get(ply);
	};
	const lit = new Map();
	let next = 0;
	for (const v of chain) {
		const plies = new Set();
		if (next > 0 && spells(v, next - 1)) plies.add(next - 1);
		while (spells(v, next)) plies.add(next++);
		if (plies.size) lit.set(v, plies);
	}
	return lit;
}
