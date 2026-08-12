// Converts tagged lines into a cell grid shared by both (horizontal/vertical)
// table layouts. cell[variation][ply] is undefined where a variation has no
// move at that ply, or a display object {text, cls}. The mainline is the
// reference row (— usually structural, but a sideline can be promoted to it).
// Sidelines render as table rows; Footnote lines are pulled OUT of the table
// and returned as `footNotes` for the prose footnotes section. Comments render
// as per-line note markers (no row duplication).

export function divergence(line, main) {
	let i = 0;
	const a = line.moves;
	const b = main.moves;
	while (i < a.length && i < b.length && a[i].san === b[i].san) i++;
	return i;
}

const TAG_META = {
	mainline: { label: "Mainline" },
	sideline: { label: "Sideline" },
	foot: { label: "Footnote" },
};

export function grid(lines, comments = []) {
	const main = lines.find((l) => l.isMain) || lines[0];

	const vars = []; // mainline + sidelines (table rows)
	const footNotes = []; // footnote lines (prose section)
	lines.forEach((l) => {
		const isMain = !!l.isMain;
		const tag = isMain ? "mainline" : l.tag === "foot" ? "foot" : "sideline";
		const d = isMain ? 0 : divergence(l, main);
		const cells = {};
		const marks = l.marks || {};
		l.moves.forEach((m, i) => {
			let text, cls;
			if (i < d) {
				text = "\u2026";
				cls = "ellip";
			} else if (isMain) {
				text = m.san;
				cls = "main";
			} else {
				text = m.san;
				cls = tag;
			}
			cells[m.ply] = { text, cls, mark: marks[m.ply] || "" };
		});
		// note markers keyed by ply, only for plies this line owns (its tail; the
		// mainline owns every move). So a comment appears once, on the right line.
		const tail = isMain ? l.moves : l.moves.slice(d);
		const owned = new Set(tail.map((m) => m.ply));
		const noteByPly = {};
		comments.forEach((c, i) => {
			if (owned.has(c.ply))
				(noteByPly[c.ply] = noteByPly[c.ply] || []).push(i + 1);
		});
		const base = {
			tag,
			label: TAG_META[tag].label,
			name: l.name || "",
			eval: (l.meta && l.meta.eval) || "",
			note: (l.meta && l.meta.note) || "",
			fen: l.fen,
			moves: l.moves,
			marks,
			d,
		};
		if (tag === "foot") footNotes.push({ ...base, noteByPly });
		else vars.push({ ...base, cells, noteByPly });
	});
	// mainline is the top reference row
	vars.sort(
		(a, b) => (a.tag === "mainline" ? -1 : 1) - (b.tag === "mainline" ? -1 : 1),
	);

	// letter the footnote lines
	footNotes.forEach((f, i) => (f.letter = String.fromCharCode(97 + i)));

	const maxPly = vars.reduce(
		(m, v) => Math.max(m, ...Object.keys(v.cells).map(Number)),
		0,
	);
	return { vars, maxPly, mainMoves: main.moves, footNotes };
}
