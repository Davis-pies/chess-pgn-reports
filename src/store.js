// localStorage persistence of named notebooks. Each notebook stores the raw
// PGN plus per-line annotations keyed by the line's move string, so a notebook
// can be reopened and re-parsed/re-tagged.

const PREFIX = "ott:";

export function keyFor(moves) {
	return moves.map((m) => m.san).join(" ");
}

export function saveNotebook(id, { name, pgn, lines, comments = [] }) {
	localStorage.setItem(
		PREFIX + id,
		JSON.stringify({
			name,
			pgn,
			comments,
			tags: lines.map((l) => ({
				key: keyFor(l.moves),
				tag: l.tag || "minor",
				name: l.name || "",
				meta: l.meta || {},
			})),
		}),
	);
}

export function listNotebooks() {
	return Object.keys(localStorage)
		.filter((k) => k.startsWith(PREFIX))
		.map((k) => {
			let d = null;
			try {
				d = JSON.parse(localStorage.getItem(k));
			} catch {
				d = null;
			}
			return { id: k.slice(PREFIX.length), name: d ? d.name : "" };
		});
}

export function loadNotebook(id) {
	try {
		return JSON.parse(localStorage.getItem(PREFIX + id));
	} catch {
		return null;
	}
}

export function deleteNotebook(id) {
	localStorage.removeItem(PREFIX + id);
}
