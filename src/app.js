// Browser glue: import PGN, tag each line, render the table, persist notebook.
import { parsePgn, fenAt } from "./pgn.js";
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
	sel: null, // { l: line, ply } — the move the symbol row targets (null = line-end)
};

// Flatten every line's own comments into the numbered Notes list (mainline
// first, then each variation). Each entry remembers its owning line, so notes
// are attached to a specific line rather than to a (colliding) ply.
function allNotes() {
	const out = [];
	current.lines.forEach((l) => {
		(l.comments || []).forEach((c) => {
			out.push({ ply: c.ply, text: c.text, owner: l, n: out.length + 1 });
		});
	});
	return out;
}

const $ = (id) => document.getElementById(id);

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
	const save = el("button", { textContent: "Save" });
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

	// side: controls + the table, fixed to the left with its own scroll
	side.appendChild(orientationToggle());
	const t = el("div", { className: "pv-table" });
	t.appendChild(el("h3", { textContent: "Table" }));
	renderTable(t, g, current.orientation, {
		showBoards: current.showBoards,
		boardSize: current.boardSize,
	});
	side.appendChild(t);
	appendPrintTables(side, g); // print-only horizontal slices (hidden on screen)
	layout.appendChild(side);

	// main: management, cards (print preview), reference sections
	main.appendChild(notebookList());
	main.appendChild(helpPanel());
	const markupBox = markupPanel();
	const notesBox = notesFootnotesPanel();
	main.appendChild(markupBox);
	const c = el("div", { className: "pv-cards" });
	c.appendChild(
		el("h3", { textContent: "Print view — one line, one position" }),
	);
	renderCards(c, g, { notes: allNotes(), boardSize: current.boardSize });
	main.appendChild(c);
	main.appendChild(notesBox);
	main.appendChild(exportBar());
	layout.appendChild(main);
	wrap.appendChild(layout);

	// `preview` flips the main pane between the editors and the print cards
	const useCards = current.preview === "cards";
	markupBox.classList.toggle("hidden", useCards);
	notesBox.classList.toggle("hidden", useCards);
	c.classList.toggle("hidden", !useCards);
	return wrap;
}

// Print/PDF horizontal table. The mainline is always shown as the reference
// column; the side lines are split into vertical slices of ~16 columns so the
// table wraps across pages instead of being cut off or scaled.
function appendPrintTables(box, g) {
	const wrap = el("div", { className: "pv-htable" });
	wrap.appendChild(el("h3", { textContent: "Table" }));
	const mainV = g.vars[0]; // mainline sorts first
	const others = g.vars.slice(1);
	const size = 15; // mainline + 15 = 16 columns per slice
	if (mainV && others.length > size) {
		for (let i = 0; i < others.length; i += size) {
			const vars = [mainV, ...others.slice(i, i + size)];
			renderTable(wrap, { ...g, vars }, "horizontal", { showBoards: false });
		}
	} else {
		renderTable(wrap, g, "horizontal", { showBoards: false });
	}
	box.appendChild(wrap);
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
	renderApp();
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
			const key = m.ply + ":" + m.san;
			if (!node.children.has(key))
				node.children.set(key, {
					children: new Map(),
					leaf: null,
					move: m,
				});
			node = node.children.get(key);
		}
		node.leaf = l;
	}
	return root;
}

function countLeaves(node) {
	let n = node.leaf ? 1 : 0;
	node.children.forEach((c) => (n += countLeaves(c)));
	return n;
}

function renderTrieNode(container, node, nameCounter, depth) {
	// a lone line (leaf, no fork): render it directly, no collapsing wrapper
	if (!node.children.size && node.leaf) {
		container.appendChild(lineEditor(node.leaf, nameCounter.n++));
		return;
	}
	// a single-child chain with no leaf: inline it so lone lines don't get
	// buried under nested groups — only fork points become collapsible groups
	if (!node.leaf && node.children.size === 1) {
		node.children.forEach((c) =>
			renderTrieNode(container, c, nameCounter, depth),
		);
		return;
	}
	const det = el("details", { className: "lgroup" });
	det.open = depth <= 1;
	const head = fullmoveLabel(node.move.ply) + node.move.san;
	const count = countLeaves(node);
	det.appendChild(
		el("summary", {
			className: "lg-head",
			textContent: `${head} \u00b7 ${count} lines`,
		}),
	);
	const body = el("div", { className: "lgroup-body" });
	if (node.leaf) body.appendChild(lineEditor(node.leaf, nameCounter.n++));
	node.children.forEach((c) => renderTrieNode(body, c, nameCounter, depth + 1));
	det.appendChild(body);
	container.appendChild(det);
}

function markupPanel() {
	const box = el("div", { className: "markup" });
	box.appendChild(
		el("h3", {
			textContent:
				"The mainline is the reference row. Promote a sideline to make it the mainline; tag the rest Sideline or Footnote.",
		}),
	);
	// mainline first, then the side lines grouped as a trie of shared divergence
	const main = current.lines.find((l) => l.isMain) || current.lines[0];
	box.appendChild(lineEditor(main, 0));
	const counter = { n: 1 };
	const trie = buildTrie(current.lines, main);
	trie.children.forEach((c) => renderTrieNode(box, c, counter, 1));
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

function lineEditor(l, idx) {
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
	row.appendChild(name);
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
	row.appendChild(tags);
	row.appendChild(moveStrip(l));
	// the symbol/comment panel only appears when a move (or line-end) is selected
	if (current.sel && current.sel.l === l) row.appendChild(movePanel(l));
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
		const hasNote = (l.comments || []).some((c) => c.ply === m.ply);
		// numbered note references for this move's chip ("[2]" / "[2][5]")
		const noteRefs = allNotes()
			.filter((n) => n.owner === l && n.ply === m.ply)
			.map((n) => "[" + n.n + "]")
			.join("");
		const sel = current.sel && current.sel.l === l && current.sel.ply === m.ply;
		const b = el("button", {
			type: "button",
			className:
				"move-chip" + (sel ? " on" : "") + (hasNote ? " has-note" : ""),
			textContent: num + m.san + (mark ? " \u00b7 " + mark : "") + noteRefs,
		});
		b.onclick = () => {
			current.sel =
				current.sel && current.sel.l === l && current.sel.ply === m.ply
					? null
					: { l, ply: m.ply };
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
	const cur = atEnd
		? (l.meta && l.meta.eval) || ""
		: (l.marks || {})[selPly] || "";
	const mm = atEnd ? null : l.moves.find((x) => x.ply === selPly);
	const label = atEnd ? "line-end" : fullmoveLabel(selPly) + (mm ? mm.san : "");
	box.appendChild(
		el("div", { className: "symlabel", textContent: "@ " + label + ":" }),
	);
	// a static board of the selected move's position
	if (!atEnd) {
		const board = el("div", { className: "mp-board" });
		appendBoard(board, fenAt(l.moves, selPly), 260);
		box.appendChild(board);
	}
	const apply = (sym) => {
		if (atEnd) {
			l.meta = { ...(l.meta || {}), eval: cur === sym ? "" : sym };
		} else {
			l.marks = l.marks || {};
			if (cur === sym) delete l.marks[selPly];
			else l.marks[selPly] = sym;
			if (!Object.keys(l.marks).length) l.marks = undefined;
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
	if (!atEnd) box.appendChild(commentEditor(selPly, l));
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

// Edit/add notes attached to a specific move (plies are shared app-wide).
function commentEditor(ply, l) {
	const wrap = el("div", { className: "cedit" });
	const mine = (l.comments || []).filter((c) => c.ply === ply);
	mine.forEach((c) => {
		const row = el("div", { className: "nt" });
		const inp = el("input", { className: "lno", value: c.text });
		inp.oninput = () => {
			c.text = inp.value;
		};
		const del = el("button", {
			type: "button",
			className: "chip mini danger",
			textContent: "\u2715",
		});
		del.onclick = () => {
			l.comments.splice(l.comments.indexOf(c), 1);
			renderApp();
		};
		row.append(inp, del);
		wrap.appendChild(row);
	});
	const addInp = el("input", {
		className: "lno",
		placeholder: mine.length ? "add another note…" : "note at this move…",
	});
	const add = el("button", {
		type: "button",
		className: "chip",
		textContent: "Add note",
	});
	add.onclick = () => {
		if (addInp.value.trim()) {
			l.comments = l.comments || [];
			l.comments.push({ ply, text: addInp.value.trim() });
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
		try {
			const { nodes } = parsePgn(ta.value);
			if (!nodes.length) {
				alert("No moves found in PGN");
				return;
			}
			current = {
				id: current.id,
				name: "",
				pgn: ta.value,
				lines: collectLines(nodes),
				orientation: "horizontal",
				showBoards: false,
				preview: "table",
				boardSize: current.boardSize,
				sel: null,
			};
			renderApp();
		} catch (e) {
			alert("Could not read PGN: " + e.message);
		}
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
