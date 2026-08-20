// Browser glue: import PGN, tag each line, render the table, persist notebook.
import { parsePgn, fenMap } from "./pgn.js";
import { collectLines } from "./tree.js";
import { grid, divergence } from "./table.js";
import {
	renderCards,
	fullmoveLabel,
	fullMovesText,
	cardMovesText,
} from "./render.js";
import {
	saveNotebook,
	listNotebooks,
	loadNotebook,
	deleteNotebook,
	keyFor,
} from "./store.js";
import { el } from "./dom.js";
import {
	getCurrent,
	setCurrent,
	openPaths,
	openTablePaths,
	setSharedInfo,
	setRenderHooks,
} from "./state.js";
import { allNotes } from "./notes.js";
import { appendPrintTables } from "./print.js";
import {
	buildTrie,
	renderTrieTable,
	collectKeys,
	renderTrieNode,
} from "./trie-view.js";
import { lineEditor } from "./line-editor.js";

// Canonical reset for `current`. Every "start over" path (New/Import, Load &
// Tag, opening a saved notebook, a failed open) rebuilt this object from an
// ad-hoc literal, and the fields drifted apart between them — most notably
// sideWidth being dropped from the openNotebook success path, which silently
// reset the user's dragged panel width back to the 420px default. Building
// every reset from this shared base plus explicit overrides keeps every site
// carrying the same fields by construction.
function freshState(overrides = {}) {
	return {
		id: null,
		name: "",
		pgn: "",
		lines: [],
		orientation: "horizontal",
		showBoards: false,
		preview: "table",
		boardSize: 300,
		showFinalBoard: true,
		showFirstDivBoard: false,
		sideWidth: 420, // px; the drag-resized table panel width
		sel: null, // { l: line, ply } — the move the symbol row targets (null = line-end)
		...overrides,
	};
}

setCurrent(freshState());
// Reset the shared UI-open state too. In production this module body runs
// exactly once per page load, so these sets are already empty here and this
// is a no-op; it only matters for the test suite, which re-imports app.js
// (with a cache-busting query string) to get fresh state per test -- since
// openPaths/openTablePaths now live in the state.js singleton rather than as
// module-local `const`s of app.js, they'd otherwise carry leftover entries
// from a previous test's app.js instance into this one.
openPaths.clear();
openTablePaths.clear();
// Point the extracted view modules' callbacks at *this* app.js instance --
// see the comment on setRenderHooks() in state.js for why this indirection
// (rather than a static `import ... from "./app.js"`) is necessary.
setRenderHooks({ renderApp, rerenderTable, rerenderMarkup, lineEditor });
let sideDragging = false; // dragging the table-panel resize handle

// Rebuild-only-the-panel refs: expanding/collapsing a trie group must not
// re-render the whole app (that resets the side-panel scroll and other view
// state), so these two panels rebuild in place instead.
let tableBox = null; // the .pv-table container
let markupBox = null; // the .markup container
export function rerenderTable() {
	if (!tableBox) return;
	const g = grid(getCurrent().lines);
	tableBox.replaceChildren();
	tableBox.appendChild(el("h3", { textContent: "Table" }));
	renderTrieTable(tableBox, g, getCurrent().orientation);
}
export function rerenderMarkup() {
	if (!markupBox) return;
	const nb = markupPanel();
	markupBox.replaceChildren(...nb.children);
}

// identical-move tracking: a shared move (same position reached + same SAN)
// is annotated once and applied to every line carrying it
const fenCache = new WeakMap(); // line -> Map(ply -> fen)
function fenAtLine(l, ply) {
	let m = fenCache.get(l);
	if (!m) fenCache.set(l, (m = fenMap(l.moves)));
	return m.get(ply);
}
function computeShared() {
	const byLine = new Map();
	const idLines = new Map();
	const byFenSan = new Map();
	let next = 0;
	getCurrent().lines.forEach((l) => {
		const per = new Map();
		l.moves.forEach((m) => {
			const k = fenAtLine(l, m.ply) + "\u0000" + m.san;
			let id = byFenSan.get(k);
			if (!id) {
				id = "s" + ++next;
				byFenSan.set(k, id);
				idLines.set(id, []);
			}
			per.set(m.ply, id);
			const arr = idLines.get(id);
			if (!arr.includes(l)) arr.push(l);
		});
		byLine.set(l, per);
	});
	setSharedInfo({ byLine, idLines });
}

// For each line, the deepest prefix shared with any OTHER line — i.e. the
// index of this line's first move that no other line matches (its "latest
// divergence" / first moment of true uniqueness).
const uniqInfo = new Map(); // moves-array -> first-unique-move index
function computeUnique() {
	uniqInfo.clear();
	const lines = getCurrent().lines;
	for (const l of lines) {
		let best = 0;
		const a = l.moves;
		for (const y of lines) {
			if (y === l) continue;
			const b = y.moves;
			let i = 0;
			while (i < a.length && i < b.length && a[i].san === b[i].san) i++;
			if (i > best) best = i;
		}
		uniqInfo.set(a, best);
	}
}

const $ = (id) => document.getElementById(id);

// Full-viewport loading feedback. Painted via double-rAF before the slow
// synchronous parse+render runs, then removed. No fake progress: after the
// fenMap fix most loads flash it sub-frame.
const paintFrame = () =>
	new Promise((r) =>
		requestAnimationFrame(() => requestAnimationFrame(() => r())),
	);
async function withLoading(fn) {
	const ov = el("div", { id: "loading", className: "loading-overlay" });
	ov.appendChild(el("div", { className: "spinner" }));
	ov.appendChild(el("span", { textContent: "Loading…" }));
	document.body.appendChild(ov);
	await paintFrame();
	try {
		fn();
	} finally {
		ov.remove();
	}
}

const THEME_KEY = "ott-theme";
function currentTheme() {
	return (document.documentElement.dataset.theme || "light") === "dark"
		? "dark"
		: "light";
}
function applyTheme(t) {
	document.documentElement.dataset.theme = t;
	try {
		localStorage.setItem(THEME_KEY, t);
	} catch {}
}
function themeBtn() {
	const target = currentTheme() === "light" ? "dark" : "light";
	const b = el("button", {
		className: "chip",
		textContent: target === "dark" ? "Dark theme" : "Light theme",
	});
	b.onclick = () => {
		applyTheme(target);
		renderApp();
	};
	return b;
}

function renderApp() {
	const v = $("view");
	computeShared(); // which lines carry each move (identical position + SAN)
	computeUnique(); // each line's first move unique to it among all lines
	v.replaceChildren();
	v.appendChild(viewRoot());
}

function viewRoot() {
	const wrap = el("div", { className: "app" });
	if (!getCurrent().lines.length) {
		wrap.appendChild(importPanel());
		return wrap;
	}
	const top = el("div", { className: "toolbar" });
	top.appendChild(
		el("button", {
			onclick: () => {
				setCurrent(
					freshState({
						boardSize: getCurrent().boardSize,
						sideWidth: getCurrent().sideWidth,
					}),
				);
				renderApp();
			},
			textContent: "New / Import",
		}),
	);
	const name = el("input", {
		value: getCurrent().name,
		placeholder: "Notebook name",
		className: "name",
	});
	name.oninput = () => {
		getCurrent().name = name.value;
	};
	top.appendChild(name);
	const save = el("button", { className: "chip primary", textContent: "Save" });
	save.onclick = () => {
		if (!getCurrent().name) getCurrent().name = "Untitled";
		const ok = saveNotebook(
			getCurrent().id || (getCurrent().id = "n" + Date.now()),
			{
				name: getCurrent().name,
				pgn: getCurrent().pgn,
				lines: getCurrent().lines,
			},
		);
		if (ok) {
			save.textContent = "Saved ✓";
			setTimeout(() => (save.textContent = "Save"), 1200);
		} else {
			alert("Could not save: storage is full or unavailable.");
		}
	};
	top.appendChild(save);
	top.appendChild(themeBtn());
	wrap.appendChild(top);
	const layout = el("div", { className: "app-layout" });
	const side = el("aside", { className: "side-panel" });
	const main = el("div", { className: "main-panel" });
	const g = grid(getCurrent().lines);

	// side: the preview (table, or print lines) with its own scroll, resizable
	const t = el("div", { className: "pv-table" });
	tableBox = t;
	t.appendChild(el("h3", { textContent: "Table" }));
	renderTrieTable(t, g, getCurrent().orientation);
	side.appendChild(t);
	const c = el("div", { className: "pv-cards" });
	c.appendChild(
		el("h3", { textContent: "Print view — one line, one position" }),
	);
	renderCards(c, g, {
		notes: allNotes(),
		boardSize: getCurrent().boardSize,
		showFinalBoard: getCurrent().showFinalBoard,
		showFirstDivBoard: getCurrent().showFirstDivBoard,
		uniq: uniqInfo,
	});
	side.appendChild(c);
	appendPrintTables(side, g); // print-only horizontal slices (hidden on screen)
	const handle = el("div", {
		className: "side-resize",
		title: "Drag to resize",
	});
	handle.onmousedown = (e) => {
		e.preventDefault();
		sideDragging = true;
	};
	side.appendChild(handle);
	layout.appendChild(side);

	// main (right): controls + management + reference sections
	main.appendChild(orientationToggle());
	main.appendChild(notebookList());
	main.appendChild(helpPanel());
	const mb = markupPanel();
	markupBox = mb; // module ref for in-place re-renders
	const notesBox = notesFootnotesPanel();
	main.appendChild(mb);
	main.appendChild(notesBox);
	main.appendChild(exportBar());
	layout.appendChild(main);
	wrap.appendChild(layout);

	// `preview` flips the LEFT panel between the table and the print lines
	const useCards = getCurrent().preview === "cards";
	t.classList.toggle("hidden", useCards);
	c.classList.toggle("hidden", !useCards);
	// apply the (drag-resized) table panel width — one CSS var drives the side
	// width and the main/toolbar left margins so everything stays aligned
	document.documentElement.style.setProperty(
		"--side-w",
		(getCurrent().sideWidth || 420) + "px",
	);
	return wrap;
}

function notebookList() {
	const items = listNotebooks();
	const box = el("div", { className: "notebooks" });
	const shown = items.filter((n) => n.id !== getCurrent().id);
	if (!shown.length) return box;
	box.appendChild(
		el("div", {
			className: "nb-head",
			textContent: "My saved workbooks — click to open, ✕ to delete",
		}),
	);
	shown.forEach((n) => {
		const b = el("button", {
			className: "chip",
			textContent: `Open: ${n.name || n.id}`,
		});
		b.onclick = () => openNotebook(n.id);
		const del = el("button", { className: "chip danger", textContent: "✕" });
		const cell = el("span", {}, [b, del]);
		del.onclick = () => {
			if (confirm(`Delete "${n.name}"?`)) {
				deleteNotebook(n.id);
				cell.remove();
			}
		};
		box.appendChild(cell);
	});
	return box;
}

function openNotebook(id) {
	withLoading(() => {
		const nb = loadNotebook(id);
		if (!nb) {
			alert("That workbook could not be read.");
			return;
		}
		try {
			const { nodes } = parsePgn(nb.pgn);
			if (!nodes.length) {
				alert("That workbook has no moves.");
				return;
			}
			const lines = collectLines(nodes);
			// re-apply tags
			lines.forEach((l) => {
				const k = keyFor(l.moves);
				const t = (nb.tags || []).find((x) => x.key === k);
				if (t) {
					l.name = t.name;
					l.meta = t.meta || {};
					l.marks = t.marks || {};
					l.comments = t.comments || [];
					// legacy notebooks used 'main'/'minor'; mainline is now structural
					l.tag = l.isMain ? undefined : t.tag === "foot" ? "foot" : "sideline";
				}
			});
			// restore a user-promoted mainline, if any
			if (nb.main) {
				const target = lines.find((l) => keyFor(l.moves) === nb.main);
				if (target) {
					lines.forEach((x) => {
						x.isMain = x === target;
						if (x === target) x.tag = undefined;
					});
				}
			}
			setCurrent(
				freshState({
					id,
					name: nb.name,
					pgn: nb.pgn,
					lines,
					orientation: getCurrent().orientation,
					showBoards: getCurrent().showBoards,
					boardSize: getCurrent().boardSize,
					showFinalBoard: getCurrent().showFinalBoard !== false,
					showFirstDivBoard: !!getCurrent().showFirstDivBoard,
					sideWidth: getCurrent().sideWidth,
				}),
			);
		} catch (e) {
			setCurrent(
				freshState({
					boardSize: getCurrent().boardSize || 300,
					sideWidth: getCurrent().sideWidth,
				}),
			);
			alert("Could not open workbook: " + e.message);
		}
		openPaths.clear();
		renderApp();
	});
}

function orientationToggle() {
	const bar = el("div", { className: "orow" });
	bar.appendChild(el("span", { textContent: "Layout: " }));
	const h = el("button", {
		className:
			"chip" + (getCurrent().orientation === "horizontal" ? " on" : ""),
		textContent: "Horizontal",
	});
	h.onclick = () => {
		getCurrent().orientation = "horizontal";
		renderApp();
	};
	const v = el("button", {
		className: "chip" + (getCurrent().orientation === "vertical" ? " on" : ""),
		textContent: "Vertical",
	});
	v.onclick = () => {
		getCurrent().orientation = "vertical";
		renderApp();
	};
	bar.append(h, v);
	bar.appendChild(el("span", { textContent: "  View: " }));
	const tb = el("button", {
		className: "chip" + (getCurrent().preview === "table" ? " on" : ""),
		textContent: "Table",
	});
	tb.onclick = () => {
		getCurrent().preview = "table";
		renderApp();
	};
	const cb = el("button", {
		className: "chip" + (getCurrent().preview === "cards" ? " on" : ""),
		textContent: "Lines (print)",
	});
	cb.onclick = () => {
		getCurrent().preview = "cards";
		renderApp();
	};
	bar.append(tb, cb);
	bar.appendChild(el("span", { textContent: " Board: " }));
	[220, 300, 400].forEach((s) => {
		const sb = el("button", {
			className: "chip" + (getCurrent().boardSize === s ? " on" : ""),
			textContent: String(s),
		});
		sb.onclick = () => {
			getCurrent().boardSize = s;
			renderApp();
		};
		bar.appendChild(sb);
	});
	const b = el("label", {}, [
		"Board diagrams ",
		el("input", { type: "checkbox", checked: getCurrent().showBoards }),
	]);
	b.querySelector("input").onchange = (e) => {
		getCurrent().showBoards = e.target.checked;
		renderApp();
	};
	bar.appendChild(b);
	return bar;
}


function markupPanel() {
	const box = el("div", { className: "markup" });
	// view toggle: grouped (divergence trie) vs flat list
	const main = getCurrent().lines.find((l) => l.isMain) || getCurrent().lines[0];
	const row = el("div", { className: "orow" });
	const grouped = el("button", {
		className: "chip" + (getCurrent().groupView !== "flat" ? " on" : ""),
		textContent: "Grouped",
		onclick: () => {
			getCurrent().groupView = "trie";
			rerenderMarkup();
		},
	});
	const flat = el("button", {
		className: "chip" + (getCurrent().groupView === "flat" ? " on" : ""),
		textContent: "Flat",
		onclick: () => {
			getCurrent().groupView = "flat";
			rerenderMarkup();
		},
	});
	row.append("View: ", grouped, flat);
	if (getCurrent().groupView !== "flat") {
		const all = el("button", {
			className: "chip mini",
			textContent: "Expand all",
			onclick: () => {
				const trie = buildTrie(getCurrent().lines, main);
				openPaths.clear();
				trie.children.forEach((c) => collectKeys(c, openPaths));
				renderApp();
			},
		});
		const none = el("button", {
			className: "chip mini",
			textContent: "Collapse all",
			onclick: () => {
				openPaths.clear();
				renderApp();
			},
		});
		row.append(all, none);
	}
	box.appendChild(row);
	box.appendChild(
		el("h3", {
			textContent:
				"The mainline is the reference row. Promote a sideline to make it the mainline; tag the rest Sideline or Footnote.",
		}),
	);
	// mainline first, then the side lines grouped as a trie of shared divergence
	box.appendChild(lineEditor(main, 0, getCurrent().showBoards));
	const counter = { n: 1 };
	const trie = buildTrie(getCurrent().lines, main);
	// flat view renders every non-main line in order; grouped uses the trie
	if (getCurrent().groupView === "flat") {
		getCurrent().lines.forEach((l) => {
			if (!l.isMain)
				box.appendChild(lineEditor(l, counter.n++, getCurrent().showBoards));
		});
	} else {
		trie.children.forEach((c) => renderTrieNode(box, c, counter, "", true));
	}
	box.appendChild(
		el("button", {
			className: "chip",
			textContent: "Tag remaining as sideline",
			onclick: () => {
				getCurrent().lines.forEach((l) => {
					if (!l.tag && !l.isMain) l.tag = "sideline";
				});
				renderApp();
			},
		}),
	);
	return box;
}

// A form to append a note to a specific mainline move.
function helpPanel() {
	const d = document.createElement("details");
	d.className = "help";
	d.appendChild(el("summary", { textContent: "How to use" }));
	const ol = el("ol", {});
	[
		"Paste a PGN or upload a .pgn file, then click Load & Tag. Every variation in parentheses becomes its own line.",
		"The mainline is the reference row. For each other line choose Sideline or Footnote, add a name, or use ★ Make mainline to promote it.",
		"Tap any move chip (or the end chip) on a line — a panel opens to add symbols and notes to that specific move; press done to close.",
		"Switch layout between Horizontal and Vertical, or the Lines (print) view; toggle board diagrams; use the toolbar to flip the dark theme.",
		"Click Save to keep this workbook in your browser (localStorage). Reopen it anytime from My saved workbooks.",
		"Export PGN (editable chess notation for any chess software), Export Markdown (paste into Google Docs/Word), or Print → Save as PDF.",
	].forEach((s) => ol.appendChild(el("li", { textContent: s })));
	d.appendChild(ol);
	return d;
}

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
function notesFootnotesPanel() {
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

function exportBar() {
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
				renderApp();
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

function importPanel() {
	const box = el("div", { className: "panel" });
	box.appendChild(
		el("h2", { textContent: "Chess Opening Theory Table Builder" }),
	);
	box.appendChild(themeBtn());
	box.append(helpPanel(), notebookList());
	const ta = el("textarea", {
		className: "pgnin",
		rows: 10,
		placeholder: "1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4) 3. Bb5",
	});
	const file = el("input", { type: "file", accept: ".pgn,text/plain" });
	file.onchange = () => {
		const f = file.files[0];
		if (f)
			f.text().then((t) => {
				ta.value = t;
			});
	};
	const go = el("button", { textContent: "Load & Tag" });
	go.onclick = () => {
		withLoading(() => {
			try {
				const { nodes } = parsePgn(ta.value);
				if (!nodes.length) {
					alert("No moves found in PGN");
					return;
				}
				openPaths.clear();
				setCurrent(
					freshState({
						id: getCurrent().id,
						pgn: ta.value,
						lines: collectLines(nodes),
						boardSize: getCurrent().boardSize,
						sideWidth: getCurrent().sideWidth,
					}),
				);
				renderApp();
			} catch (e) {
				alert("Could not read PGN: " + e.message);
			}
		});
	};
	box.append(ta, el("div", {}, [file, go]));
	return box;
}

document.addEventListener("DOMContentLoaded", () => {
	if (!document.getElementById("view")) return;
	let saved = null;
	try {
		saved = localStorage.getItem(THEME_KEY);
	} catch {}
	if (saved) document.documentElement.dataset.theme = saved;
	renderApp();
	// drag-resize for the table panel (updates main margin to match)
	document.addEventListener("mousemove", (e) => {
		if (!sideDragging) return;
		const w = Math.max(280, Math.min(window.innerWidth * 0.7, e.clientX));
		getCurrent().sideWidth = w;
		document.documentElement.style.setProperty("--side-w", w + "px");
	});
	document.addEventListener("mouseup", () => {
		sideDragging = false;
	});
	// inject the cburnett piece sprite so board <use href="#wK"> works & prints,
	// then re-render once it's in the DOM
	fetch("assets/pieces.svg")
		.then(async (r) => {
			if (!r.ok) return;
			const doc = new DOMParser().parseFromString(
				await r.text(),
				"image/svg+xml",
			);
			document.body.appendChild(doc.documentElement);
			renderApp();
		})
		.catch(() => {});
});
