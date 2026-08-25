// Hidden lines: a presentation-only flag, orthogonal to a line's tag (a
// footnote can also be hidden, so hidden is never a tag value). A hidden line
// leaves the table, the print view, the Markdown export and the PGN, and moves
// into the editor's hidden drawer.
//
// The mainline is never hidden. grid() uses it as the table's reference row and
// every sideline's cells are computed as a divergence FROM it, so hiding it
// would redefine the table rather than remove a row from it. setHidden() and
// solo() are the only writers and both refuse l.isMain, so no caller can route
// around that rule.

export function visibleLines(lines) {
	return lines.filter((l) => !l.hidden);
}

export function hiddenLines(lines) {
	return lines.filter((l) => l.hidden);
}

// Clearing DELETES the property rather than writing hidden:false -- the same
// rule line-editor.js applies to a cleared mark, so a saved notebook never
// carries a falsy value that means nothing.
export function setHidden(targets, on) {
	targets.forEach((l) => {
		if (l.isMain) return;
		if (on) l.hidden = true;
		else delete l.hidden;
	});
}

export function hideAll(lines) {
	setHidden(lines, true);
}

export function showAll(lines) {
	setHidden(lines, false);
}

// A line whose moves are a proper prefix of another's: it stops where the
// longer line is still going, so it is one of the lines that line branched out
// of.
function isPrefixOf(a, b) {
	return (
		a.moves.length < b.moves.length &&
		a.moves.every((m, i) => m.san === b.moves[i].san)
	);
}

// What Focus leaves visible: the lines asked for, plus the parent lines they
// hang off — a line that stops somewhere on the way to one of them. Focus
// narrows the notebook to a branch, and dropping the lines that branch grew out
// of would take its context away with it. The mainline never appears here
// because it is never hidden in the first place.
export function focusSet(all, keep) {
	const set = new Set(keep.filter((l) => !l.isMain));
	all.forEach((l) => {
		if (l.isMain || set.has(l)) return;
		if (keep.some((k) => isPrefixOf(l, k))) set.add(l);
	});
	return [...set];
}

// "Show only this line/group, and the lines it hangs off."
export function focus(all, keep) {
	solo(all, focusSet(all, keep));
}

// Is this line/group exactly what is on screen right now? Read back off the
// lines rather than stored, the way the Footnote and Hide chips read theirs: a
// focus is a pattern of hidden flags, not a mode, so deriving it keeps the chip
// honest after a reload, a manual hide, or a Show all.
export function isFocused(all, keep) {
	const want = new Set(focusSet(all, keep));
	if (!want.size) return false;
	const shown = all.filter((l) => !l.hidden && !l.isMain);
	return shown.length === want.size && shown.every((l) => want.has(l));
}

// "Hide everything except this line/group". The kept lines are unhidden:
// hiding all but one implies that one is visible, even if it was hidden itself.
export function solo(all, keep) {
	const spare = new Set(keep);
	setHidden(
		all.filter((l) => !spare.has(l)),
		true,
	);
	setHidden(keep, false);
}
