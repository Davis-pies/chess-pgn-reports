// Re-homing a workbook's annotations onto a freshly parsed PGN.
//
// store.js re-applies tags by EXACT line key, which is right when the PGN is
// the one the workbook was built from. It is wrong when the PGN has moved on:
// a line whose analysis grew four moves deeper has a different key and would
// come back bare. This module matches the old lines to the new ones instead,
// so annotating work survives a repertoire update.
//
// Two scopes, because the app itself has two:
//
//   * marks and comments are MOVE-scoped. symbolRow() and commentEditor() in
//     line-editor.js both write onto every line reaching a position, so "a
//     note on a shared move lives on every line through it" is an invariant
//     the editor maintains everywhere. Re-homing them by move path upholds it,
//     which matters because three consumers read a line's own copy: table.js
//     builds each line's cells from `l.marks`, allNotes() filters to the
//     VISIBLE lines (so a note carried by one line vanishes when that line is
//     hidden), and pgn-out.js writes comments per line.
//
//   * name, tag, meta and hidden are LINE-scoped -- they describe a whole
//     continuation, so they go to a single line even when one old line now
//     prefixes several new ones.

import { isDefaultLineName } from "./tree.js";

const sanKey = (line) => line.moves.map((m) => m.san).join(" ");

// How many leading moves two lines agree on.
function commonPrefix(a, b) {
	let d = 0;
	while (d < a.moves.length && d < b.moves.length && a.moves[d].san === b.moves[d].san)
		d++;
	return d;
}

// The move paths a line spells out, one per move: ["e4", "e4 e5", ...].
// Index i is the path ending at moves[i], which is what a mark or comment at
// that move is really attached to.
function pathsOf(line) {
	const out = [];
	const acc = [];
	line.moves.forEach((m) => {
		acc.push(m.san);
		out.push(acc.join(" "));
	});
	return out;
}

// Every move-scoped annotation in the old workbook, keyed by the move path it
// sits on. A mark is single-valued (the first line carrying it wins, exactly
// as sharedMarks() in group-cols.js already resolves a group's column); notes
// are a set, since several distinct notes can share a move.
function moveAnnotations(oldLines) {
	const out = new Map();
	const at = (path, moves) => {
		let e = out.get(path);
		if (!e) out.set(path, (e = { mark: undefined, comments: [], moves }));
		return e;
	};
	oldLines.forEach((l) => {
		const paths = pathsOf(l);
		const indexOfPly = new Map(l.moves.map((m, i) => [m.ply, i]));
		Object.entries(l.marks || {}).forEach(([ply, mark]) => {
			const i = indexOfPly.get(Number(ply));
			if (i === undefined) return;
			const e = at(paths[i], l.moves.slice(0, i + 1));
			if (e.mark === undefined) e.mark = mark;
		});
		(l.comments || []).forEach((c) => {
			const i = indexOfPly.get(c.ply);
			if (i === undefined) return;
			const e = at(paths[i], l.moves.slice(0, i + 1));
			if (!e.comments.includes(c.text)) e.comments.push(c.text);
		});
	});
	return out;
}

// Which new line inherits each old line's line-scoped attributes.
//
// A new line is a candidate only when one line's moves are a prefix of the
// other's -- that is what "the same line, continued (or cut short)" means.
// Longest shared prefix wins, ties broken by the new PGN's own order. Old
// lines are matched longest-first and each new line is claimed once, so two
// old lines that both prefix the same new line cannot both take it: the more
// specific one does, and the other is reported as dropped.
function matchLines(oldLines, newLines) {
	const claimed = new Set();
	const matched = new Map();
	const byLength = oldLines
		.map((l, i) => ({ l, i }))
		.sort((a, b) => b.l.moves.length - a.l.moves.length || a.i - b.i);
	byLength.forEach(({ l: old }) => {
		let best = null;
		let bestD = -1;
		newLines.forEach((n) => {
			if (claimed.has(n)) return;
			const d = commonPrefix(old, n);
			if (d !== Math.min(old.moves.length, n.moves.length)) return;
			if (d > bestD) {
				best = n;
				bestD = d;
			}
		});
		if (best) {
			claimed.add(best);
			matched.set(old, best);
		}
	});
	return matched;
}

// Line-scoped work the old line put on the record. A line carrying none of
// this loses nothing by disappearing, so it is not worth reporting.
function lineWork(l) {
	const meta = l.meta || {};
	// A placeholder name is not work: the editor writes one onto every line it
	// renders, so counting it would report every removed line as annotated.
	return !!(
		!isDefaultLineName(l.name) ||
		l.tag === "foot" ||
		meta.eval ||
		meta.note ||
		l.hidden
	);
}

/**
 * Carry `oldLines`' annotations onto `newLines`, which are mutated in place
 * the way store.js's tag re-application already mutates freshly parsed lines.
 *
 * With `keepDropped`, a line the new PGN no longer plays is carried over
 * whole instead of being lost -- additive mode. The workbook's stored PGN then
 * no longer describes its own lines, so the caller must rebuild it from them
 * (app.js does, via buildPgn).
 *
 * Returns a report for the preview: how many lines matched unchanged, were
 * extended or shortened, arrived new or were kept, plus the two kinds of
 * annotation that could not be re-homed -- `droppedLines` (a line's own
 * name/tag/eval, when the line itself is gone) and `droppedNotes` (a note or
 * mark whose move path the new PGN no longer contains). Both are empty in
 * additive mode, where by construction nothing is dropped.
 */
export function mergeAnnotations(oldLines, newLines, { keepDropped = false } = {}) {
	// Move-scoped pass, first: every new line through a remembered move path
	// picks the annotation up, however the lines were re-cut around it.
	const anno = moveAnnotations(oldLines);
	newLines.forEach((l) => {
		const paths = pathsOf(l);
		l.moves.forEach((m, i) => {
			const e = anno.get(paths[i]);
			if (!e) return;
			if (e.mark !== undefined) {
				l.marks = l.marks || {};
				l.marks[m.ply] = e.mark;
			}
			if (!e.comments.length) return;
			l.comments = l.comments || [];
			e.comments.forEach((text) => {
				// The new PGN may already carry this note as a {comment}; keep one.
				if (!l.comments.some((c) => c.ply === m.ply && c.text === text))
					l.comments.push({ ply: m.ply, text });
			});
		});
	});

	// Line-scoped pass.
	const matched = matchLines(oldLines, newLines);
	matched.forEach((n, old) => {
		n.name = old.name || "";
		n.meta = { ...(old.meta || {}) };
		n.tag = old.tag;
		n.hidden = !!old.hidden;
	});

	// Additive mode: carry over every old line the new PGN has no home for.
	// The line object itself is reused, so its marks, notes, name and tag come
	// with it untouched. A key the new set already has is skipped -- an old line
	// can go unmatched because a more specific sibling claimed its successor
	// first, and re-adding it would put the same line in twice.
	let kept = 0;
	if (keepDropped) {
		const have = new Set(newLines.map(sanKey));
		oldLines.forEach((l) => {
			if (matched.has(l) || have.has(sanKey(l))) return;
			have.add(sanKey(l));
			// the new PGN's own mainline stays the mainline; a kept line joins as
			// an ordinary line and is normalised below
			l.isMain = false;
			newLines.push(l);
			kept++;
		});
	}

	// A user-promoted mainline is re-promoted onto whatever it became. Done
	// after the attribute copy so the normalisation below has the final answer.
	const oldMain = oldLines.find((l) => l.isMain);
	const newMain = oldMain && matched.get(oldMain);
	if (newMain) newLines.forEach((x) => (x.isMain = x === newMain));

	// Same normalisation store.js applies on load: the mainline is structural,
	// so it carries no tag and is never hidden.
	newLines.forEach((l) => {
		l.tag = l.isMain ? undefined : l.tag === "foot" ? "foot" : "sideline";
		l.hidden = !l.isMain && !!l.hidden;
	});

	let exact = 0;
	let extended = 0;
	let shortened = 0;
	matched.forEach((n, old) => {
		if (n.moves.length === old.moves.length) exact++;
		else if (n.moves.length > old.moves.length) extended++;
		else shortened++;
	});
	// Which remembered move paths the final line set still plays. Computed here
	// rather than during the copy pass above, so a line kept by additive mode
	// counts as the home for its own annotations.
	const present = new Set();
	newLines.forEach((l) =>
		pathsOf(l).forEach((p) => {
			if (anno.has(p)) present.add(p);
		}),
	);
	const droppedLines = oldLines
		.filter((l) => !matched.has(l) && !newLines.includes(l) && lineWork(l))
		.map((l) => ({
			key: sanKey(l),
			// the moves themselves, so the report can number them properly
			moves: l.moves.map((m) => ({ san: m.san, ply: m.ply })),
			name: isDefaultLineName(l.name) ? "" : l.name,
			tag: l.tag === "foot" ? "foot" : "sideline",
			eval: (l.meta || {}).eval || "",
			note: (l.meta || {}).note || "",
		}));
	const droppedNotes = [...anno.entries()]
		.filter(([path]) => !present.has(path))
		.map(([path, e]) => ({
			path,
			moves: e.moves.map((m) => ({ san: m.san, ply: m.ply })),
			comments: e.comments,
			mark: e.mark,
		}));

	return {
		exact,
		extended,
		shortened,
		kept,
		removed: oldLines.filter((l) => !matched.has(l) && !newLines.includes(l))
			.length,
		added: newLines.filter((n) => ![...matched.values()].includes(n)).length,
		droppedLines,
		droppedNotes,
	};
}
