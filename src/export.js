import { grid, divergence } from "./table.js";
import { fullmoveLabel, fullMovesText, cardMovesText } from "./render.js";
import { el } from "./dom.js";
import { getCurrent, getRenderHooks } from "./state.js";
import { allNotes } from "./notes.js";

// Explicit move reference for a note, e.g. "7.Nbd2" / "7...Nbd7" (number + SAN).
// A variation-owned note (inVar) is looked up among non-main lines, since a
// variation's first move shares a ply with the mainline move it replaces (e.g.
// the variation's cxd6 and the mainline Kf6 both at ply 71).
export function moveRef(ply, owner) {
	// use the owning line's move if given (a variation note at a colliding ply
	// should reference the variation's move, not the mainline's)
	const pool = owner ? [owner] : getCurrent().lines.filter((l) => l.isMain);
	for (const l of pool) {
		const m = l.moves.find((x) => x.ply === ply);
		if (m) return fullmoveLabel(m.ply) + m.san;
	}
	return fullmoveLabel(ply);
}

// "→ <directly preceding move>" so a branched line's divergence point is clear.
export function branchContext(l) {
	if (l.isMain) return "";
	const mainL = getCurrent().lines.find((x) => x.isMain) || getCurrent().lines[0];
	let d = 0;
	const mv = l.moves;
	while (
		d < mv.length &&
		d < mainL.moves.length &&
		mv[d].san === mainL.moves[d].san
	)
		d++;
	if (!d) return "";
	const m = mv[d - 1];
	return (
		"→ " +
		(m.ply % 2 === 0 ? Math.floor(m.ply / 2) + 1 + ". " : "") +
		m.san
	);
}

// Safely render a small markdown subset (bold/italic/code + newlines) into DOM
// nodes (no innerHTML, so note text can't inject markup).
export function renderInline(container, text) {
	const lines = text.split("\n");
	lines.forEach((line, li) => {
		if (li) container.appendChild(document.createElement("br"));
		const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
		let last = 0;
		let m;
		while ((m = re.exec(line))) {
			if (m.index > last)
				container.appendChild(
					document.createTextNode(line.slice(last, m.index)),
				);
			const tok = m[0];
			const bold = tok.startsWith("**");
			const code = tok.startsWith("`");
			const node = document.createElement(
				bold ? "strong" : code ? "code" : "em",
			);
			node.textContent = tok.slice(bold ? 2 : 1, tok.length - (bold ? 2 : 1));
			container.appendChild(node);
			last = m.index + tok.length;
		}
		if (last < line.length)
			container.appendChild(document.createTextNode(line.slice(last)));
	});
}

// Notes are numbered (PGN {comments}); tagged-Footnote lines are lettered.
export function notesFootnotesPanel() {
	const box = el("div", { className: "notes" });
	const notes = allNotes();
	box.appendChild(el("h3", { textContent: "Notes" }));
	if (notes.length) {
		notes.forEach((note) => {
			const row = el("div", { className: "nt" });
			row.appendChild(el("sup", { textContent: "[" + note.n + "]" }));
			const span = document.createElement("span");
			span.appendChild(
				document.createTextNode(moveRef(note.ply, note.owner) + " — "),
			);
			renderInline(span, note.text);
			row.appendChild(span);
			box.appendChild(row);
		});
	}
	// Notes are edited per-move from the line editors above; this section is the
	// read-only reference (and what prints/exports).
	const footLines = getCurrent().lines.filter((l) => l.tag === "foot");
	const mainL = getCurrent().lines.find((l) => l.isMain) || getCurrent().lines[0];
	if (footLines.length) {
		box.appendChild(el("h3", { textContent: "Footnotes" }));
		footLines.forEach((l, i) => {
			const row = el("div", { className: "nt" });
			row.appendChild(el("sup", { textContent: String.fromCharCode(97 + i) }));
			const note = (l.meta && l.meta.note) || "";
			const d = divergence(l, mainL);
			const ctx = branchContext(l);
			const span = document.createElement("span");
			span.appendChild(
				document.createTextNode(
					(l.name ? l.name + ": " : "") +
						(ctx ? ctx + " " : "") +
						fullMovesText(l.moves.slice(d), l.marks),
				),
			);
			if (note) {
				span.appendChild(document.createTextNode(" — "));
				renderInline(span, note);
			}
			row.appendChild(span);
			box.appendChild(row);
		});
	}
	return box;
}

export function exportBar() {
	const bar = el("div", { className: "export" });
	const printBtn = el("button", {
		className: "chip",
		textContent: "Print / Save as PDF",
	});
	printBtn.onclick = () => window.print();
	const pgn = el("button", { className: "chip", textContent: "Export PGN" });
	pgn.onclick = () =>
		download(slug() + ".pgn", getCurrent().pgn, "application/x-chess-pgn");
	const md = el("button", {
		className: "chip",
		textContent: "Export Markdown",
	});
	md.onclick = () => download(slug() + ".md", buildMarkdown(), "text/markdown");
	const copy = el("button", { className: "chip", textContent: "Copy report" });
	copy.onclick = async () => {
		const text = buildMarkdown();
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const ta = document.createElement("textarea");
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand("copy");
			ta.remove();
		}
		copy.textContent = "Copied ✓";
		setTimeout(() => (copy.textContent = "Copy report"), 1500);
	};
	bar.append(printBtn, pgn, md, copy);
	// print/PDF options: which diagrams appear in the Lines (print) cards, and
	// whether the table splits by trie. Each option is checkbox-first; they're
	// grouped by target with a clear gap between groups.
	const pOpts = el("div", { className: "printopts" });
	const group = (title, checks) => {
		const g = el("div", { className: "optgroup" });
		g.appendChild(el("span", { className: "optgroup-h", textContent: title }));
		checks.forEach(([label, key, def]) => {
			const lab = el("label", { className: "opt" }, [
				el("input", {
					type: "checkbox",
					checked: getCurrent()[key] == null ? def : getCurrent()[key],
				}),
				" " + label,
			]);
			lab.querySelector("input").onchange = (e) => {
				getCurrent()[key] = e.target.checked;
				getRenderHooks().renderApp();
			};
			g.appendChild(lab);
		});
		return g;
	};
	pOpts.append(
		group("Cards", [
			["final-position image", "showFinalBoard", true],
			["latest-divergence image", "showFirstDivBoard", false],
		]),
		group("Table", [["split table by trie", "showSplitTrie", false]]),
	);
	bar.appendChild(pOpts);
	return bar;
}

function slug() {
	return (getCurrent().name || "opening-table")
		.replace(/[^a-z0-9_-]+/gi, "-")
		.replace(/^-+|-+$/g, "");
}

function download(filename, text, mime) {
	const blob = new Blob([text], { type: mime });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(a.href);
}

// Editable, portable Markdown of the finished table — paste into Docs/Word.
function buildMarkdown() {
	const g = grid(getCurrent().lines);
	const L = [];
	if (getCurrent().name) L.push("# " + getCurrent().name, "");
	L.push("## Lines", "");
	for (const v of g.vars) {
		const lead =
			v.tag === "mainline" ? "**Mainline**" : "- " + v.label.toUpperCase();
		const moves = cardMovesText(v);
		L.push(
			`${lead}${v.name ? " (" + v.name + ")" : ""}${v.eval ? " " + v.eval : ""}: ${moves}`,
		);
	}
	if (g.footNotes.length) {
		L.push("", "## Footnotes", "");
		g.footNotes.forEach((f) => {
			const prec =
				f.d > 0
					? "→ " +
						(f.moves[f.d - 1].ply % 2 === 0
							? Math.floor(f.moves[f.d - 1].ply / 2) + 1 + ". "
							: "") +
						f.moves[f.d - 1].san +
						" "
					: "";
			L.push(
				`- ${f.letter}${f.name ? " " + f.name : ""}${f.eval ? " " + f.eval : ""}: ${prec}${fullMovesText(f.moves.slice(f.d), f.marks)}${f.note ? " — " + f.note : ""}`,
			);
		});
	}
	const notes = allNotes();
	if (notes.length) {
		L.push("", "## Notes", "");
		notes.forEach((note) =>
			L.push(`${note.n}. ${moveRef(note.ply, note.owner)} — ${note.text}`),
		);
	}
	return L.join("\n") + "\n";
}
