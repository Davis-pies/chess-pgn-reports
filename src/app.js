// Browser glue: import PGN, tag each line, render the table, persist notebook.
import { parsePgn, fenAt, fenMap } from "./pgn.js";
import { collectLines } from "./tree.js";
import { grid, divergence } from "./table.js";
import {
	renderTable,
	renderCards,
	appendBoard,
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

let current = {
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
};
let sideDragging = false; // dragging the table-panel resize handle

// trie groups the user expanded — details open state survives re-renders
const openPaths = new Set();

// trie groups the user expanded in the TABLE preview — separate from the
// editor's openPaths: expanding a table branch does not expand the editor
const openTablePaths = new Set();

// Rebuild-only-the-panel refs: expanding/collapsing a trie group must not
// re-render the whole app (that resets the side-panel scroll and other view
// state), so these two panels rebuild in place instead.
let tableBox = null; // the .pv-table container
let markupBox = null; // the .markup container
function rerenderTable() {
	if (!tableBox) return;
	const g = grid(current.lines);
	tableBox.replaceChildren();
	tableBox.appendChild(el("h3", { textContent: "Table" }));
	renderTrieTable(tableBox, g, current.orientation);
}
function rerenderMarkup() {
	if (!markupBox) return;
	const nb = markupPanel();
	markupBox.replaceChildren(...nb.children);
}

// identical-move tracking: a shared move (same position reached + same SAN)
// is annotated once and applied to every line carrying it
const fenCache = new WeakMap(); // line -> Map(ply -> fen)
let sharedInfo = {}; // { byLine: line -> Map(ply -> id), idLines: id -> [lines] }
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
	current.lines.forEach((l) => {
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
	sharedInfo = { byLine, idLines };
}

// For each line, the deepest prefix shared with any OTHER line — i.e. the
// index of this line's first move that no other line matches (its "latest
// divergence" / first moment of true uniqueness).
const uniqInfo = new Map(); // moves-array -> first-unique-move index
function computeUnique() {
	uniqInfo.clear();
	const lines = current.lines;
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

// Flatten every line's own comments into the numbered Notes list (mainline
// first, then each variation). Each entry remembers its owning line, so notes
// are attached to a specific line rather than to a (colliding) ply.
function allNotes() {
	const out = [];
	const seen = new Set();
	current.lines.forEach((l) => {
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
	ov.appendChild(el("span", { textContent: "Loading\u2026" }));
	document.body.appendChild(ov);
	await paintFrame();
	try {
		fn();
	} finally {
		ov.remove();
	}
}

function el(tag, props, children = []) {
	const e = document.createElement(tag);
	Object.assign(e, props);
	(Array.isArray(children) ? children : [children]).forEach((c) =>
		typeof c === "string"
			? e.appendChild(document.createTextNode(c))
			: e.appendChild(c),
	);
	return e;
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
	if (!current.lines.length) {
		wrap.appendChild(importPanel());
		return wrap;
	}
	const top = el("div", { className: "toolbar" });
	top.appendChild(
		el("button", {
			onclick: () => {
				current = {
					id: null,
					name: "",
					pgn: "",
					lines: [],
					orientation: "horizontal",
					showBoards: false,
					boardSize: current.boardSize,
					showFinalBoard: true,
					showFirstDivBoard: false,
					sideWidth: current.sideWidth,
					sel: null,
				};
				renderApp();
			},
			textContent: "New / Import",
		}),
	);
	const name = el("input", {
		value: current.name,
		placeholder: "Notebook name",
		className: "name",
	});
	name.oninput = () => {
		current.name = name.value;
	};
	top.appendChild(name);
	const save = el("button", { className: "chip primary", textContent: "Save" });
	save.onclick = () => {
		if (!current.name) current.name = "Untitled";
		saveNotebook(current.id || (current.id = "n" + Date.now()), {
			name: current.name,
			pgn: current.pgn,
			lines: current.lines,
		});
		save.textContent = "Saved ✓";
		setTimeout(() => (save.textContent = "Save"), 1200);
	};
	top.appendChild(save);
	top.appendChild(themeBtn());
	wrap.appendChild(top);
	const layout = el("div", { className: "app-layout" });
	const side = el("aside", { className: "side-panel" });
	const main = el("div", { className: "main-panel" });
	const g = grid(current.lines);

	// side: the preview (table, or print lines) with its own scroll, resizable
	const t = el("div", { className: "pv-table" });
	tableBox = t;
	t.appendChild(el("h3", { textContent: "Table" }));
	renderTrieTable(t, g, current.orientation);
	side.appendChild(t);
	const c = el("div", { className: "pv-cards" });
	c.appendChild(
		el("h3", { textContent: "Print view — one line, one position" }),
	);
	renderCards(c, g, {
		notes: allNotes(),
		boardSize: current.boardSize,
		showFinalBoard: current.showFinalBoard,
		showFirstDivBoard: current.showFirstDivBoard,
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
	const useCards = current.preview === "cards";
	t.classList.toggle("hidden", useCards);
	c.classList.toggle("hidden", !useCards);
	// apply the (drag-resized) table panel width — one CSS var drives the side
	// width and the main/toolbar left margins so everything stays aligned
	document.documentElement.style.setProperty(
		"--side-w",
		(current.sideWidth || 420) + "px",
	);
	return wrap;
}

// Print/PDF horizontal table. The mainline is always shown as the reference
// column; the side lines are split into vertical slices of ~16 columns so the
// table wraps across pages instead of being cut off or scaled.

// Highest ply present in a subset of table vars — so a per-branch print table
// doesn't render empty rows down to the notebook's global max.
function subMaxPly(vars) {
	let m = 0;
	for (const v of vars)
		for (const p of Object.keys(v.cells)) {
			const n = Number(p);
			if (n > m) m = n;
		}
	return m;
}

function appendPrintTables(box, g) {
	const wrap = el("div", { className: "pv-htable" });
	wrap.appendChild(el("h3", { textContent: "Table" }));
	const mainV = g.vars[0]; // mainline sorts first
	const others = g.vars.slice(1);
	const size = 15; // mainline + 15 = 16 columns per slice
	if (!mainV) {
		box.appendChild(wrap);
		return;
	}
	const trie = buildTrie(others, mainV);
	const split = current.showSplitTrie === true;
	if (!split && others.length <= size) {
		renderTable(wrap, g, "horizontal");
	} else {
		trie.children.forEach((c) => printBranch(wrap, c, g, mainV, size));
	}
	box.appendChild(wrap);
}

function printBranch(wrap, node, g, mainV, size) {
	const lines = leavesOf(node);
	const count = lines.length;
	wrap.appendChild(
		el("h4", {
			className: "print-group",
			textContent: `${count} lines \u00b7 ${tblPath(node)}`,
		}),
	);
	if (count <= size) {
		renderTable(
			wrap,
			{
				...g,
				vars: [mainV, ...lines],
				maxPly: subMaxPly([mainV, ...lines]),
			},
			"horizontal",
		);
	} else if (node.children.size) {
		// too wide: cut at the branch's real forks, not arbitrary rows
		node.children.forEach((c) => printBranch(wrap, c, g, mainV, size));
	} else {
		// a leaf-heavy branch with no sub-fork: row-chunk as a last resort
		for (let i = 0; i < lines.length; i += size) {
			const vars = [mainV, ...lines.slice(i, i + size)];
			renderTable(wrap, { ...g, vars, maxPly: subMaxPly(vars) }, "horizontal");
		}
	}
}

function notebookList() {
	const items = listNotebooks();
	const box = el("div", { className: "notebooks" });
	const shown = items.filter((n) => n.id !== current.id);
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
		del.onclick = () => {
			if (confirm(`Delete "${n.name}"?`)) {
				deleteNotebook(n.id);
				box.remove();
			}
		};
		const cell = el("span", {}, [b, del]);
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
			current = {
				id,
				name: nb.name,
				pgn: nb.pgn,
				lines,
				orientation: current.orientation,
				showBoards: current.showBoards,
				boardSize: current.boardSize,
				showFinalBoard: current.showFinalBoard !== false,
				showFirstDivBoard: !!current.showFirstDivBoard,
				sel: null,
			};
		} catch (e) {
			current = {
				id: null,
				name: "",
				pgn: "",
				lines: [],
				orientation: "horizontal",
				showBoards: false,
				boardSize: current.boardSize || 300,
				sel: null,
			};
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
		className: "chip" + (current.orientation === "horizontal" ? " on" : ""),
		textContent: "Horizontal",
	});
	h.onclick = () => {
		current.orientation = "horizontal";
		renderApp();
	};
	const v = el("button", {
		className: "chip" + (current.orientation === "vertical" ? " on" : ""),
		textContent: "Vertical",
	});
	v.onclick = () => {
		current.orientation = "vertical";
		renderApp();
	};
	bar.append(h, v);
	bar.appendChild(el("span", { textContent: "\u00a0 View: " }));
	const tb = el("button", {
		className: "chip" + (current.preview === "table" ? " on" : ""),
		textContent: "Table",
	});
	tb.onclick = () => {
		current.preview = "table";
		renderApp();
	};
	const cb = el("button", {
		className: "chip" + (current.preview === "cards" ? " on" : ""),
		textContent: "Lines (print)",
	});
	cb.onclick = () => {
		current.preview = "cards";
		renderApp();
	};
	bar.append(tb, cb);
	bar.appendChild(el("span", { textContent: " Board: " }));
	[220, 300, 400].forEach((s) => {
		const sb = el("button", {
			className: "chip" + (current.boardSize === s ? " on" : ""),
			textContent: String(s),
		});
		sb.onclick = () => {
			current.boardSize = s;
			renderApp();
		};
		bar.appendChild(sb);
	});
	const b = el("label", {}, [
		"Board diagrams ",
		el("input", { type: "checkbox", checked: current.showBoards }),
	]);
	b.querySelector("input").onchange = (e) => {
		current.showBoards = e.target.checked;
		renderApp();
	};
	bar.appendChild(b);
	return bar;
}

// Trie of the side lines' divergent tails, so lines that share pieces of their
// divergence from the mainline are grouped together (nested collapsible groups).
function buildTrie(lines, main) {
	const root = { children: new Map(), leaf: null };
	for (const l of lines) {
		if (l.isMain) continue;
		const d = divergence(l, main);
		let node = root;
		for (const m of l.moves.slice(d)) {
			const k = m.ply + ":" + m.san;
			let child = node.children.get(k);
			if (!child) {
				child = {
					children: new Map(),
					leaf: null,
					move: m,
					// root-relative path key: stable across renders, used to
					// remember which <details> groups are open
					key: (node.key ? node.key + "/" : "") + k,
				};
				node.children.set(k, child);
			}
			node = child;
		}
		node.leaf = l;
	}
	return root;
}

// Left-panel preview: ONE table. The mainline column is always visible (left
// in horizontal, top row in vertical); each top-level trie branch contributes
// its columns. A collapsed branch is compressed to a single shared-continuation
// column (the moves all its lines have in common up to the fork); clicking that
// column's header expands it back into its individual line columns.
function renderTrieTable(container, g, orientation) {
	const mainV = g.vars[0]; // mainline sorts first
	const others = g.vars.slice(1);
	const trie = buildTrie(others, mainV);
	const controls = el("div", { className: "orow tbl-controls" });
	controls.appendChild(el("span", { textContent: "Branches: " }));
	const ex = el("button", {
		className: "chip mini",
		textContent: "Expand all",
	});
	ex.onclick = () => {
		openTablePaths.clear();
		trie.children.forEach((c) => collectKeys(c, openTablePaths));
		rerenderTable();
	};
	const col = el("button", {
		className: "chip mini",
		textContent: "Collapse all",
	});
	col.onclick = () => {
		openTablePaths.clear();
		rerenderTable();
	};
	controls.append(ex, col);
	container.appendChild(controls);
	if (!mainV) return;
	// build the single table's var list: mainline + each branch. Expanded
	// branches contribute their real lines (each header clickable to collapse
	// the whole branch); collapsed ones a single shared-continuation column.
	const vars = [mainV];
	trie.children.forEach((c) => {
		if (openTablePaths.has(c.key)) {
			const collapse = () => {
				openTablePaths.delete(c.key);
				rerenderTable();
			};
			leavesOf(c).forEach((l) => vars.push({ ...l, onclick: collapse }));
		} else {
			vars.push(collapsedVar(c));
		}
	});
	// rows span only the VISIBLE columns — collapsed branches don't stretch the
	// table down to the deepest hidden line
	renderTable(container, { ...g, vars, maxPly: subMaxPly(vars) }, orientation);
}

// A collapsed trie branch as a single column/row of its shared continuation:
// the moves common to all its lines up to the first fork, with divergent cells
// empty. Its header is clickable to expand.
function collapsedVar(node) {
	const shared = sharedMoves(node); // [{ ply, san }] down the single-child chain
	const cells = {};
	shared.forEach((m) => {
		cells[m.ply] = { text: m.san, cls: "collapsed" };
	});
	// ellipsis prefix before the branch's first shared move, like a sideline
	const d = shared.length ? shared[0].ply : 0;
	for (let ply = 0; ply < d; ply++)
		cells[ply] = { text: "\u2026", cls: "ellip" };
	const count = countLeaves(node);
	return {
		tag: "collapse",
		label: "",
		name: `${tblPath(node)}` + (count > 1 ? ` \u00b7 ${count} lines` : ""),
		eval: "",
		cells,
		noteByPly: {},
		collapsed: true,
		onclick: () => {
			openTablePaths.add(node.key);
			rerenderTable();
		},
	};
}

// The moves a branch's lines share, from the branch's root child down its
// single-child chain to the first fork (or the leaf).
function sharedMoves(node) {
	const out = [];
	let n = node;
	while (true) {
		out.push({ ply: n.move.ply, san: n.move.san });
		if (n.leaf || n.children.size !== 1) break;
		n = [...n.children.values()][0];
	}
	return out;
}

function countLeaves(node) {
	let n = node.leaf ? 1 : 0;
	node.children.forEach((c) => (n += countLeaves(c)));
	return n;
}

function branchLabel(move) {
	return fullmoveLabel(move.ply) + move.san;
}

// All descendant lines of a trie node, depth-first (the flat row/column set
// a table branch contributes to the preview).
function leavesOf(node) {
	const out = [];
	if (node.leaf) out.push(node.leaf);
	node.children.forEach((c) => out.push(...leavesOf(c)));
	return out;
}

// Shared move path of a branch, accumulated through its single-child chain
// (e.g. "1... c5 2. Nf3") for the group header.
function tblPath(node) {
	let p = branchLabel(node.move);
	let n = node;
	while (!n.leaf && n.children.size === 1) {
		n = [...n.children.values()][0];
		p += "  " + branchLabel(n.move);
	}
	return p;
}

// Collect a node's key and every descendant's key (for "Expand all").
function collectKeys(node, into) {
	if (node.key) into.add(node.key);
	node.children.forEach((c) => collectKeys(c, into));
}

function renderTrieNode(container, node, nameCounter, path, allOpen) {
	const nextPath = path
		? path + "  " + branchLabel(node.move)
		: branchLabel(node.move);
	const boards = current.showBoards; // inline-boards master toggle
	// single-child chain: inline it, accumulating the path so a long shared
	// continuation shows as one compressed header, not nested single groups
	if (!node.leaf && node.children.size === 1) {
		node.children.forEach((c) =>
			renderTrieNode(container, c, nameCounter, nextPath, allOpen),
		);
		return;
	}
	// every node — fork OR lone line — is a collapsible group, closed by
	// default; header shows the full shared path up to this node
	const det = el("details", { className: "lgroup" });
	det.open = openPaths.has(node.key);
	det.addEventListener("toggle", () => {
		// only rebuild when the open-state actually changed; jsdom fires a
		// toggle when a rebuilt element gets open=true, and without this guard
		// that rebuild re-schedules another toggle forever
		const had = openPaths.has(node.key);
		if (det.open && !had) openPaths.add(node.key);
		else if (!det.open && had) openPaths.delete(node.key);
		else return;
		rerenderMarkup(); // boards appear/disappear with expansion (in-place, so the table scroll keeps its position)
		// ponytail: whole-app re-render; if toggling feels slow on huge files,
		// scope the rebuild to the markup panel only
	});
	const count = countLeaves(node);
	det.appendChild(
		el("summary", {
			className: "lg-head",
			textContent: `${nextPath} \u00b7 ${count} line${count === 1 ? "" : "s"}`,
		}),
	);
	const body = el("div", { className: "lgroup-body" });
	const open = det.open;
	if (node.leaf)
		body.appendChild(
			lineEditor(node.leaf, nameCounter.n++, allOpen && open && boards),
		);
	node.children.forEach((c) =>
		renderTrieNode(body, c, nameCounter, "", allOpen && open),
	);
	det.appendChild(body);
	container.appendChild(det);
}

function markupPanel() {
	const box = el("div", { className: "markup" });
	// view toggle: grouped (divergence trie) vs flat list
	const main = current.lines.find((l) => l.isMain) || current.lines[0];
	const row = el("div", { className: "orow" });
	const grouped = el("button", {
		className: "chip" + (current.groupView !== "flat" ? " on" : ""),
		textContent: "Grouped",
		onclick: () => {
			current.groupView = "trie";
			rerenderMarkup();
		},
	});
	const flat = el("button", {
		className: "chip" + (current.groupView === "flat" ? " on" : ""),
		textContent: "Flat",
		onclick: () => {
			current.groupView = "flat";
			rerenderMarkup();
		},
	});
	row.append("View: ", grouped, flat);
	if (current.groupView !== "flat") {
		const all = el("button", {
			className: "chip mini",
			textContent: "Expand all",
			onclick: () => {
				const trie = buildTrie(current.lines, main);
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
	box.appendChild(lineEditor(main, 0, current.showBoards));
	const counter = { n: 1 };
	const trie = buildTrie(current.lines, main);
	// flat view renders every non-main line in order; grouped uses the trie
	if (current.groupView === "flat") {
		current.lines.forEach((l) => {
			if (!l.isMain)
				box.appendChild(lineEditor(l, counter.n++, current.showBoards));
		});
	} else {
		trie.children.forEach((c) => renderTrieNode(box, c, counter, "", true));
	}
	box.appendChild(
		el("button", {
			className: "chip",
			textContent: "Tag remaining as sideline",
			onclick: () => {
				current.lines.forEach((l) => {
					if (!l.tag && !l.isMain) l.tag = "sideline";
				});
				renderApp();
			},
		}),
	);
	return box;
}

function lineEditor(l, idx, showBoard = false) {
	const row = el("div", { className: "ledge" });
	const tag = l.tag || "";
	const btn = (t, txt) => {
		const b = el("button", {
			className: "chip tag " + t + (tag === t ? " on" : ""),
			textContent: txt,
		});
		b.onclick = () => {
			l.tag = l.tag === t ? null : t;
			renderApp();
		};
		return b;
	};
	const isMain = !!l.isMain;
	// name comes first, pre-populated
	if (!l.name) l.name = isMain ? "Mainline" : "Line " + idx;
	const name = el("input", { className: "ln", value: l.name });
	name.oninput = () => {
		l.name = name.value;
	};
	// reflect the (renamed) line in the table/cards once the field is blurred
	name.onchange = () => renderApp();
	const tags = el("div", { className: "tags" });
	if (isMain) {
		tags.appendChild(
			el("span", { className: "maintag", textContent: "Mainline" }),
		);
	} else {
		tags.append(btn("sideline", "Sideline"), btn("foot", "Footnote"));
		const promote = el("button", {
			className: "chip",
			textContent: "\u2605 Make mainline",
		});
		promote.onclick = () => {
			promoteMainline(l);
		};
		tags.appendChild(promote);
	}
	const head = el("div", { className: "ledge-head" });
	head.append(name, tags);
	row.appendChild(head);
	row.appendChild(moveStrip(l));
	// the symbol/comment panel appears once, on the first line of the group
	if (current.sel && current.sel.lines && current.sel.lines[0] === l)
		row.appendChild(movePanel(l));
	const note = el("input", {
		className: "lno",
		placeholder: "note",
		value: (l.meta && l.meta.note) || "",
	});
	note.oninput = () => {
		l.meta = { ...(l.meta || {}), note: note.value };
	};
	note.onchange = () => renderApp();
	row.appendChild(note);
	// the line's end-position board, next to its line (inline boards toggle)
	if (showBoard) {
		const bw = el("div", { className: "ledge-board" });
		appendBoard(bw, l.fen, current.boardSize || 220);
		row.appendChild(bw);
	}
	return row;
}

// Promote a sideline/footnote line to be the mainline; demote the old one.
function promoteMainline(l) {
	current.lines.forEach((x) => {
		if (x === l) {
			x.isMain = true;
			x.tag = undefined;
		} else if (x.isMain) {
			x.isMain = false;
			if (!x.tag) x.tag = "sideline";
		}
	});
	renderApp();
}

// Advantage/quality symbols offered in the line editor's evaluation picker.
const EVAL_SYMBOLS = [
	"",
	"=",
	"\u00b1",
	"\u2213",
	"+=",
	"=+",
	"\u221e",
	"+\u2212",
	"\u2212+",
	"!",
	"?",
	"!?",
	"?!",
	"!!",
	"??",
	"\u25a1", // □ only move
	"\u2299", // ⊙ zugzwang
	"\u2191", // ↑ initiative
	"\u2192", // → with attack / idea
	"\u21c4", // ⇄ counterplay
	"\u25b3", // △ with the threat
	"\u2295", // ⊕ time trouble
	"N", // novelty
	"TN", // theoretical novelty
];

// A per-line row of tappable symbol buttons; clicking one sets (or clears)
// that line's evaluation, which then shows in the table and lines/card views.
// A tappable strip of a line's moves. Clicking a move selects it as the target
// for the symbol row; the current mark, if any, is shown on the chip.
function moveStrip(l) {
	const mainL = current.lines.find((x) => x.isMain) || current.lines[0];
	const wrap = el("span", { className: "moves" });
	wrap.appendChild(
		el("span", {
			className: "symlabel",
			textContent: "Tap a move\u00a0\u2192",
		}),
	);
	let d = 0;
	const mv = l.moves;
	if (!l.isMain)
		while (
			d < mv.length &&
			d < mainL.moves.length &&
			mv[d].san === mainL.moves[d].san
		)
			d++;
	// indicate the directly preceding move (where this line diverges)
	if (!l.isMain) {
		const ctx = branchContext(l);
		if (ctx)
			wrap.appendChild(el("span", { className: "ctxchip", textContent: ctx }));
	}
	const owned = l.isMain ? mv : mv.slice(d);
	owned.forEach((m) => {
		const num = m.ply % 2 === 0 ? Math.floor(m.ply / 2) + 1 + ". " : "";
		const mark = (l.marks || {})[m.ply];
		// this move's shared group: every line reaching the identical position
		const gid = sharedInfo.byLine.get(l)?.get(m.ply);
		const group = gid ? sharedInfo.idLines.get(gid) : [l];
		// a note lives on whichever lines carry it; shared notes sit on all of them
		const hasNote = group.some((x) =>
			(x.comments || []).some((c) => c.ply === m.ply),
		);
		// numbered note references for this move's chip (superscript numbers, no brackets)
		const noteNums = allNotes()
			.filter(
				(n) =>
					n.ply === m.ply &&
					(l.comments || []).some((c) => c.ply === n.ply && c.text === n.text),
			)
			.map((n) => n.n);
		const sel =
			current.sel &&
			current.sel.ply === m.ply &&
			current.sel.lines &&
			current.sel.lines.includes(l);
		const b = el("button", {
			type: "button",
			className:
				"move-chip" + (sel ? " on" : "") + (hasNote ? " has-note" : ""),
			textContent: num + m.san + (mark ? " \u00b7 " + mark : ""),
		});
		noteNums.forEach((n) => {
			const sup = document.createElement("sup");
			sup.textContent = String(n);
			b.appendChild(sup);
		});
		b.onclick = () => {
			// annotating a shared move targets the whole identical group
			current.sel =
				current.sel &&
				current.sel.ply === m.ply &&
				current.sel.lines &&
				current.sel.lines.includes(l)
					? null
					: { lines: group, ply: m.ply };
			renderApp();
		};
		wrap.appendChild(b);
	});
	return wrap;
}

// Symbol row. Applies to the selected move (a per-move mark) or, when no move
// is selected, to the line-end evaluation.
// Revealed when a move (or line-end) is selected on a line: symbol buttons and
// a per-move comment editor. Collapses via the done button.
function movePanel(l) {
	const box = el("div", { className: "movepanel" });
	const selPly = current.sel.ply;
	const atEnd = selPly == null;
	const lines = current.sel.lines || [l];
	const cur = atEnd
		? (l.meta && l.meta.eval) || ""
		: (l.marks || {})[selPly] || "";
	const mm = atEnd ? null : l.moves.find((x) => x.ply === selPly);
	const label = atEnd ? "line-end" : fullmoveLabel(selPly) + (mm ? mm.san : "");
	box.appendChild(
		el("div", {
			className: "symlabel",
			textContent:
				"@ " +
				label +
				(lines.length > 1 ? " \u00b7 " + lines.length + " shared" : "") +
				":",
		}),
	);
	// a static board of the selected move's position
	if (!atEnd) {
		const board = el("div", { className: "mp-board" });
		appendBoard(board, fenAt(l.moves, selPly), 260);
		box.appendChild(board);
	}
	const apply = (sym) => {
		if (atEnd) {
			lines.forEach((x) => {
				x.meta = { ...(x.meta || {}), eval: cur === sym ? "" : sym };
			});
		} else {
			lines.forEach((x) => {
				x.marks = x.marks || {};
				if (cur === sym) delete x.marks[selPly];
				else x.marks[selPly] = sym;
				if (!Object.keys(x.marks).length) x.marks = undefined;
			});
		}
	};
	const srow = el("span", { className: "sympick" });
	EVAL_SYMBOLS.forEach((sym) => {
		if (!sym) return;
		const b = el("button", {
			type: "button",
			className: "chip mini" + (cur === sym ? " on" : ""),
			textContent: sym,
		});
		b.onclick = () => {
			apply(sym);
			renderApp();
		};
		srow.appendChild(b);
	});
	const clear = el("button", {
		type: "button",
		className: "chip mini danger",
		textContent: "\u2715",
		title: "clear",
	});
	clear.onclick = () => {
		apply("");
		renderApp();
	};
	srow.appendChild(clear);
	box.appendChild(srow);
	if (!atEnd) box.appendChild(commentEditor(selPly, lines));
	const done = el("button", {
		type: "button",
		className: "chip mini",
		textContent: "done",
	});
	done.onclick = () => {
		current.sel = null;
		renderApp();
	};
	box.appendChild(done);
	return box;
}

// Edit/add notes attached to an (identical) move; `lines` is the shared
// group, so every line carrying the position gets the same note.
function commentEditor(ply, lines) {
	const wrap = el("div", { className: "cedit" });
	// the distinct notes at this ply across the group (deduped by text)
	const snapshot = () => {
		const out = [];
		const seen = new Set();
		lines.forEach((l) =>
			(l.comments || []).forEach((c) => {
				if (c.ply !== ply || seen.has(c.text)) return;
				seen.add(c.text);
				out.push(c.text);
			}),
		);
		return out;
	};
	// write the same set of notes onto every line in the group
	const writeAll = (texts) => {
		lines.forEach((l) => {
			l.comments = (l.comments || []).filter((c) => c.ply !== ply);
		});
		texts.forEach((t) => {
			if (!t.trim()) return;
			lines.forEach((l) => {
				l.comments = l.comments || [];
				l.comments.push({ ply, text: t.trim() });
			});
		});
	};
	const texts = snapshot(); // live row order; edits update this array
	texts.forEach((_, i) => {
		const row = el("div", { className: "nt" });
		const inp = el("input", { className: "lno", value: texts[i] });
		inp.oninput = () => {
			texts[i] = inp.value;
			writeAll(texts);
		};
		const del = el("button", {
			type: "button",
			className: "chip mini danger",
			textContent: "\u2715",
		});
		del.onclick = () => {
			texts.splice(i, 1);
			writeAll(texts);
			renderApp();
		};
		row.append(inp, del);
		wrap.appendChild(row);
	});
	const addInp = el("input", {
		className: "lno",
		placeholder: texts.length ? "add another note…" : "note at this move…",
	});
	const add = el("button", {
		type: "button",
		className: "chip",
		textContent: "Add note",
	});
	add.onclick = () => {
		if (addInp.value.trim()) {
			texts.push(addInp.value.trim());
			writeAll(texts);
			addInp.value = "";
			renderApp();
		}
	};
	wrap.append(addInp, add);
	return wrap;
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
function moveRef(ply, owner) {
	// use the owning line's move if given (a variation note at a colliding ply
	// should reference the variation's move, not the mainline's)
	const pool = owner ? [owner] : current.lines.filter((l) => l.isMain);
	for (const l of pool) {
		const m = l.moves.find((x) => x.ply === ply);
		if (m) return fullmoveLabel(m.ply) + m.san;
	}
	return fullmoveLabel(ply);
}

// "→ <directly preceding move>" so a branched line's divergence point is clear.
function branchContext(l) {
	if (l.isMain) return "";
	const mainL = current.lines.find((x) => x.isMain) || current.lines[0];
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
		"\u2192 " +
		(m.ply % 2 === 0 ? Math.floor(m.ply / 2) + 1 + ". " : "") +
		m.san
	);
}

// Safely render a small markdown subset (bold/italic/code + newlines) into DOM
// nodes (no innerHTML, so note text can't inject markup).
function renderInline(container, text) {
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
				document.createTextNode(moveRef(note.ply, note.owner) + " \u2014 "),
			);
			renderInline(span, note.text);
			row.appendChild(span);
			box.appendChild(row);
		});
	}
	// Notes are edited per-move from the line editors above; this section is the
	// read-only reference (and what prints/exports).
	const footLines = current.lines.filter((l) => l.tag === "foot");
	const mainL = current.lines.find((l) => l.isMain) || current.lines[0];
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
				span.appendChild(document.createTextNode(" \u2014 "));
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
		download(slug() + ".pgn", current.pgn, "application/x-chess-pgn");
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
		copy.textContent = "Copied \u2713";
		setTimeout(() => (copy.textContent = "Copy report"), 1500);
	};
	bar.append(printBtn, pgn, md, copy);
	// print/PDF options: which diagrams appear in the Lines (print) cards
	const pOpts = el("div", { className: "printopts" });
	const chk = (label, key, def) => {
		const lab = el("label", {}, [
			label + " ",
			el("input", {
				type: "checkbox",
				checked: current[key] == null ? def : current[key],
			}),
		]);
		lab.querySelector("input").onchange = (e) => {
			current[key] = e.target.checked;
			renderApp();
		};
		return lab;
	};
	pOpts.append(
		"Cards: ",
		chk("final-position image", "showFinalBoard", true),
		chk("latest-divergence image", "showFirstDivBoard", false),
		" Table: ",
		chk("split table by trie", "showSplitTrie", false),
	);
	bar.appendChild(pOpts);
	return bar;
}

function slug() {
	return (current.name || "opening-table")
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
	const g = grid(current.lines);
	const L = [];
	if (current.name) L.push("# " + current.name, "");
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
					? "\u2192 " +
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
				current = {
					id: current.id,
					name: "",
					pgn: ta.value,
					lines: collectLines(nodes),
					orientation: "horizontal",
					showBoards: false,
					preview: "table",
					boardSize: current.boardSize,
					showFinalBoard: true,
					showFirstDivBoard: false,
					sideWidth: current.sideWidth,
					sel: null,
				};
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
		current.sideWidth = w;
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
