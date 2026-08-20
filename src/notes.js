import { getCurrent } from "./state.js";

// Flatten every line's own comments into the numbered Notes list (mainline
// first, then each variation). Each entry remembers its owning line, so notes
// are attached to a specific line rather than to a (colliding) ply.
//
// Not one of the four named refactor seams, but pulled out alongside them
// (verbatim, only `current` -> `getCurrent()`) because print.js,
// line-editor.js, and export.js all need it and it only depends on
// `current.lines` — keeping it in app.js would have forced each of those
// modules to import it back from app.js for no reason.
export function allNotes() {
	const out = [];
	const seen = new Set();
	getCurrent().lines.forEach((l) => {
		(l.comments || []).forEach((c) => {
			// identical (ply,text) notes carried by several shared lines are one note
			const k = c.ply + "|" + c.text;
			if (seen.has(k)) return;
			seen.add(k);
			out.push({ ply: c.ply, text: c.text, owner: l, n: out.length + 1 });
		});
	});
	return out;
}
