// Converts tagged lines into a cell grid shared by both (horizontal/vertical)
// table layouts. cell[variation][ply] is undefined where a variation has no
// move at that ply (blank cell), or a display object {text, cls}.
// The mainline is structural (lines[0] with isMain) — never a user choice.
// Other lines are tagged 'sideline' or 'foot'. Shared-prefix plies render as
// ellipsis. Comments and footnote lines become cross-reference markers.

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
	const vars = lines.map((l) => {
		const isMain = !!l.isMain;
		const tag = isMain ? "mainline" : l.tag === "foot" ? "foot" : "sideline";
		const d = isMain ? 0 : divergence(l, main);
		const cells = {};
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
			cells[m.ply] = { text, cls };
		});
		return {
			tag,
			label: TAG_META[tag].label,
			name: l.name || "",
			eval: (l.meta && l.meta.eval) || "",
			fen: l.fen,
			moves: l.moves,
			cells,
		};
	});

	// number the PGN comments per ply
	const plyNotes = {};
	comments.forEach((c, i) => {
		(plyNotes[c.ply] = plyNotes[c.ply] || []).push(i + 1);
	});

	// letter the footnote lines in table order
	let li = 0;
	vars.forEach((v) => {
		if (v.tag === "foot") v.letter = String.fromCharCode(97 + li++);
	});

	const maxPly = vars.reduce(
		(m, v) => Math.max(m, ...Object.keys(v.cells).map(Number)),
		0,
	);
	return { vars, maxPly, mainMoves: main.moves, plyNotes };
}
