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

// Is this line/group exactly what is on screen right now? Read back off the
// lines rather than stored, the way the Footnote and Hide chips read theirs: a
// focus is a pattern of hidden flags, not a mode, so deriving it keeps the chip
// honest after a reload, a manual hide, or a Show all. The mainline is excluded
// from both sides because it is never hidden in the first place.
export function isFocused(all, keep) {
	const want = new Set(keep.filter((l) => !l.isMain));
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
