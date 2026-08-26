// Rendering: DOM tables and linear print cards over the shared grid (table.js),
// plus self-contained SVG board diagrams. Built with DOM nodes via createElementNS
// (no innerHTML, no DOMParser) so it runs identically in the browser and in jsdom
// tests, and prints cleanly. Board colors stay fixed so diagrams read on both the
// light and dark page themes.

import { fenAt } from "./pgn.js";
import { el, renderInline } from "./dom.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Pieces come from the inline cburnett sprite (assets/pieces.svg, injected by
// the app): white = light fill with dark outline, black = dark. Board colors
// stay fixed so diagrams read on both the light and dark page themes.
const PIECE_IDS = {
	P: "wP",
	N: "wN",
	B: "wB",
	R: "wR",
	Q: "wQ",
	K: "wK",
	p: "bP",
	n: "bN",
	b: "bB",
	r: "bR",
	q: "bQ",
	k: "bK",
};
const NS = "http://www.w3.org/2000/svg";
const LIGHT_SQ = "#f0d9b5";
const DARK_SQ = "#b58863";
const FILES = "abcdefgh";

function fenGrid(fen) {
	const ranks = (fen || START_FEN).split(" ")[0].split("/");
	// a well-formed FEN board field always has exactly 8 ranks; anything else
	// (truncated, garbage, malformed input) falls back to the start position
	// rather than leaving boardSvg to index a missing row
	if (ranks.length !== 8) return fenGrid(START_FEN);
	return ranks.map((rank) => {
		const row = [];
		for (const ch of rank) {
			if (/[1-8]/.test(ch)) for (let k = 0; k < +ch; k++) row.push(null);
			else row.push(ch);
		}
		return row;
	});
}

// Build an SVG <svg> board for a FEN position. Pieces are <use> references into
// the injected cburnett sprite, each padded for spacing; coordinates are drawn
// on the a-file and 1st rank.
export function boardSvg(fen, size = 220) {
	const grid = fenGrid(fen);
	const sq = size / 8;
	const pad = Math.max(2, sq * 0.1);
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
	svg.setAttribute("width", size);
	svg.setAttribute("height", size);
	svg.setAttribute("shape-rendering", "geometricPrecision");
	svg.classList.add("board-svg");
	// accessible name: boards otherwise carry no text alternative for screen
	// reader users, on screen or in the printed PDF
	const turn = (fen || START_FEN).split(" ")[1] === "b" ? "Black" : "White";
	svg.setAttribute("role", "img");
	svg.setAttribute("aria-label", `Chess position, ${turn} to move`);
	for (let r = 0; r < 8; r++) {
		for (let f = 0; f < 8; f++) {
			const x = f * sq;
			const y = r * sq;
			const light = (r + f) % 2 === 0;
			const rect = document.createElementNS(NS, "rect");
			rect.setAttribute("x", x);
			rect.setAttribute("y", y);
			rect.setAttribute("width", sq);
			rect.setAttribute("height", sq);
			rect.setAttribute("fill", light ? LIGHT_SQ : DARK_SQ);
			svg.appendChild(rect);

			const p = grid[r][f];
			if (p && PIECE_IDS[p]) {
				const u = document.createElementNS(NS, "use");
				u.setAttribute("href", "#" + PIECE_IDS[p]);
				u.setAttribute("x", x + pad);
				u.setAttribute("y", y + pad);
				const ps = sq - pad * 2;
				u.setAttribute("width", ps);
				u.setAttribute("height", ps);
				svg.appendChild(u);
			}

			if (f === 0 || r === 7) {
				const coord = document.createElementNS(NS, "text");
				const font = Math.max(7, sq * 0.16);
				coord.setAttribute("font-size", font);
				coord.setAttribute("font-weight", "600");
				coord.setAttribute("fill", light ? "#a5825c" : "#f0d9b5");
				if (f === 0 && r !== 7) {
					coord.setAttribute("x", x + 1.5);
					coord.setAttribute("y", y + font - 1);
					coord.textContent = String(8 - r);
				} else if (r === 7) {
					coord.setAttribute("x", x + sq - 1.5);
					coord.setAttribute("y", y + sq - 1);
					coord.setAttribute("text-anchor", "end");
					coord.textContent = FILES[f];
				}
				svg.appendChild(coord);
			}
		}
	}
	return svg;
}

// Append a board for `fen` to `container` (internal helper).
export function appendBoard(container, fen, size = 220) {
	container.appendChild(boardSvg(fen, size));
	return container.lastElementChild;
}

export function fullmoveLabel(ply) {
	const n = Math.floor(ply / 2) + 1;
	return ply % 2 === 0 ? `${n}.` : `${n}...`;
}

// Make a clickable collapse/expand control (a bare td/th with an onclick)
// operable from the keyboard: focusable, announced as a button with its
// expanded/collapsed state, and triggerable with Enter or Space.
function wireExpandControl(el, handler, expanded) {
	el.tabIndex = 0;
	el.setAttribute("role", "button");
	el.setAttribute("aria-expanded", String(expanded));
	el.onclick = handler;
	el.onkeydown = (e) => {
		if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
			e.preventDefault();
			handler(e);
		}
	};
}

// The shading that marks an open group's block: every column (or row) the
// group's ▾ would fold shares one class, and a group nested inside another
// alternates to the second shade so the nesting reads. `grp-start` is the
// group's own column, where the control lives.
function groupClass(v) {
	if (!v.gdepth) return "";
	return (
		" grp g" + (((v.gdepth - 1) % 2) + 1) + (v.gstart ? " grp-start" : "")
	);
}

function td(text, cls) {
	const e = document.createElement("td");
	if (text) e.textContent = text;
	if (cls) e.className = cls;
	return e;
}

// A per-move symbol (=, ±, ∞, !, …) as its own element. The gap before it is a
// CSS margin rather than a space character: the move text is monospace, where a
// literal space is a full character cell — exactly as wide as the gap between
// whole moves — so the symbol read as a floating token instead of belonging to
// the move it annotates. Plain-text exports have no CSS and keep a real space.
function markEl(sym) {
	const e = document.createElement("span");
	e.className = "mv-mark";
	e.textContent = sym;
	return e;
}

// A move cell, plus any per-move symbol mark and referenced note markers.
function moveCell(c, ply, noteByPly) {
	const e = td(c ? c.text : "", c ? c.cls : "");
	if (c && c.mark) e.appendChild(markEl(c.mark));
	const notes = noteByPly && noteByPly[ply];
	if (notes && notes.length) {
		// comma-separated so multiple notes at one move stay readable
		const s = document.createElement("sup");
		s.textContent = notes.join(",");
		e.appendChild(s);
	}
	return e;
}

// Populates `container` with the table (+ optional board diagrams).
// `trace` is the line the preview is highlighting: { litByVar, onTrace }, where
// litByVar is trace.js's Map(var -> Set(ply)) — or null when nothing is traced,
// which leaves the columns as click targets without dimming anything. Supplied
// ONLY by renderTrieTable; appendPrintTables passes nothing, so the printed
// report carries no dimming and no click handlers, the same containment the
// grouping itself has.
export function renderTable(container, grid, orientation, trace) {
	const { vars, maxPly } = grid;
	const lit = trace && trace.litByVar;
	// A column's header follows its cells: lit when the column contributes at
	// least one move to the traced line, so the two can never disagree.
	const traceClass = (v) => (!lit ? "" : lit.has(v) ? " traced" : " faded");
	const cellTrace = (c, v, ply) => {
		if (!lit) return;
		c.classList.add(lit.get(v)?.has(ply) ? "traced" : "faded");
	};
	// Move cells trace; headers fold. A group column's cells used to expand it,
	// which meant a reader clicking a move to see where it sits got the table
	// reshaped under them instead. Its ▸/▾ header is the fold control, and its
	// cells trace the stem — how the reader gets to that group — like any other
	// column.
	//
	// `traceable`, not `clickable`: the latter means "this folds a branch"
	// everywhere else in the table, and quietly widening it to cover a second,
	// unrelated affordance would make every count of fold controls wrong.
	const wireTrace = (el, v) => {
		if (!trace || !v.moves) return;
		el.classList.add("traceable");
		el.tabIndex = 0;
		el.setAttribute("role", "button");
		el.setAttribute("aria-pressed", String(!!lit?.has(v)));
		const go = (e) => {
			if (e && e.stopPropagation) e.stopPropagation();
			trace.onTrace(v);
		};
		el.onclick = go;
		el.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
				e.preventDefault();
				go(e);
			}
		};
	};
	// Right-click opens the context menu on the move under the cursor. The
	// browser's own menu is suppressed only where ours takes over. `contextmenu`
	// is also what the keyboard Menu key and Shift+F10 fire, so this is not a
	// mouse-only affordance on cells wireTrace has already made focusable.
	// The discoverable half of a gesture that is otherwise invisible. It sits on
	// a LINE column's header only: a group header is already the fold control,
	// and a header has no move, so this opens the line half of the menu.
	const menuButton = (v) => {
		if (!trace || !trace.onMenu || !v.moves || v.onclick) return null;
		const b = document.createElement("button");
		b.type = "button";
		b.className = "tmenu-open";
		b.textContent = "\u22ee";
		b.title = "actions for this line";
		b.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			trace.onMenu(v, null, e);
		};
		return b;
	};
	const wireMenu = (el, v, ply) => {
		if (!trace || !trace.onMenu || !v.moves) return;
		el.oncontextmenu = (e) => {
			e.preventDefault();
			e.stopPropagation();
			trace.onMenu(v, ply, e);
		};
	};
	const labels = {};
	// number every WHITE (even) ply, not just the mainline's — rows that only
	// exist because of a side line keep their move number
	for (let ply = 0; ply <= maxPly; ply++)
		labels[ply] = ply % 2 === 0 ? fullmoveLabel(ply) : "";

	const table = document.createElement("table");
	table.className = "tbl" + (orientation === "horizontal" ? " tbl-h" : "");

	const varHead = (v) => {
		const c = document.createElement("td");
		c.className =
			"var-head" +
			(v.onclick ? " clickable" : "") +
			(v.collapsed ? " collapsed" : "") +
			groupClass(v) +
			traceClass(v);
		if (!v.onclick) wireTrace(c, v);
		if (v.onclick) {
			wireExpandControl(c, v.onclick, !v.collapsed);
			c.title = v.collapsed ? v.name || "expand branch" : "collapse branch";
		}
		if (v.collapsed) {
			const cue = document.createElement("span");
			cue.className = "collapse-cue";
			cue.textContent = "\u25b8 ";
			c.appendChild(cue);
		} else if (v.onclick) {
			const cue = document.createElement("span");
			cue.className = "collapse-cue";
			cue.textContent = "\u25be ";
			c.appendChild(cue);
		}
		if (v.label) {
			const tag = document.createElement("span");
			tag.className = "tag " + v.tag;
			tag.textContent = v.label;
			c.appendChild(tag);
		}
		c.appendChild(document.createTextNode(" " + (v.name || "")));
		const mb = menuButton(v);
		if (mb) c.appendChild(mb);
		wireMenu(c, v, null);
		return c;
	};

	if (orientation === "horizontal") {
		// rows = ply, columns = variations
		const head = document.createElement("tr");
		const plyTh = document.createElement("th");
		plyTh.className = "ply-col sticky-col";
		plyTh.textContent = "ply";
		head.appendChild(plyTh);
		vars.forEach((v, i) => {
			const th = document.createElement("th");
			th.className =
				"var-head" +
				(i === 0 ? " main-col sticky-col" : "") +
				(v.onclick ? " clickable" : "") +
				(v.collapsed ? " collapsed" : "") +
				groupClass(v) +
				traceClass(v);
			if (!v.onclick) wireTrace(th, v);
			if (v.onclick) {
				wireExpandControl(th, v.onclick, !v.collapsed);
				th.title = v.collapsed ? v.name || "expand branch" : "collapse branch";
			}
			const cue = v.collapsed ? "\u25b8 " : v.onclick ? "\u25be " : "";
			th.textContent = cue + (v.name || v.label) + (v.eval ? " " + v.eval : "");
			const mb = menuButton(v);
			if (mb) th.appendChild(mb);
			// A header has no move, so this is the line half of the menu — and
			// on a GROUP header, the group's actions. Right-click never folds:
			// that stays on the left-click the ▸/▾ advertises.
			wireMenu(th, v, null);
			head.appendChild(th);
		});
		table.appendChild(head);
		for (let ply = 0; ply <= maxPly; ply++) {
			const tr = document.createElement("tr");
			const num = document.createElement("th");
			num.className = "ply-col sticky-col";
			if (labels[ply]) num.textContent = labels[ply];
			tr.appendChild(num);
			for (const v of vars) {
				const c = moveCell(v.cells[ply], ply, v.noteByPly);
				c.className += groupClass(v);
				if (v === vars[0]) c.classList.add("main-col", "sticky-col");
				cellTrace(c, v, ply);
				wireTrace(c, v);
				// only where the column actually has a move at this ply
				if (v.cells[ply]) wireMenu(c, v, ply);
				tr.appendChild(c);
			}
			table.appendChild(tr);
		}
	} else {
		// vertical: rows = variations, columns = ply
		const head = document.createElement("tr");
		const vth = document.createElement("th");
		vth.className = "sticky-col";
		vth.textContent = "Variation";
		head.appendChild(vth);
		for (let ply = 0; ply <= maxPly; ply++) {
			const th = document.createElement("th");
			if (labels[ply]) th.textContent = labels[ply];
			head.appendChild(th);
		}
		head.appendChild(document.createElement("th"));
		table.appendChild(head);
		for (const v of vars) {
			const tr = document.createElement("tr");
			const vh = varHead(v);
			vh.classList.add("sticky-col");
			tr.appendChild(vh);
			for (let ply = 0; ply <= maxPly; ply++) {
				const c = moveCell(v.cells[ply], ply, v.noteByPly);
				c.className += groupClass(v);
				cellTrace(c, v, ply);
				wireTrace(c, v);
				// only where the column actually has a move at this ply
				if (v.cells[ply]) wireMenu(c, v, ply);
				tr.appendChild(c);
			}
			tr.appendChild(td(v.eval, "eval"));
			table.appendChild(tr);
		}
	}
	container.appendChild(table);
}

// Linear print view: each line as a labeled card with its moves and a position
// diagram, one after another (vs the packed table).
// Moves text for a card: sidelines get a leading ellipsis + the preceding
// (shared) move for divergence context, and every move that has notes gets its
// [n] references appended inline so the moves point at the notes below.
// Standard algebraic pairing: a move number on White's half-move, none on
// Black's ("1. e4 e5 2. Nf3"). The FIRST move of a run is the exception — it
// always carries its own number, "2...Nc6" for Black, because a bare "Nc6"
// gives the reader no move to hang the line on. Sidelines, footnotes and the
// ellipsis context move all start mid-game, so they hit this constantly.
function moveNum(ply, first) {
	return ply % 2 === 0 || first ? fullmoveLabel(ply) : "";
}

export function cardMovesText(v) {
	const parts = [];
	const ctx = v.tag !== "mainline" && v.d > 0 ? v.moves[v.d - 1] : null;
	if (ctx) {
		const num = moveNum(ctx.ply, true);
		parts.push("\u22ef " + (num ? num + " " : "") + ctx.san);
	}
	const range = v.tag === "mainline" ? v.moves : v.moves.slice(v.d);
	range.forEach((m, i) => {
		// the context move is the ply right before the range, so the range's
		// first move reads as its natural pair and needs no forced number
		const n = moveNum(m.ply, i === 0 && !ctx);
		const num = n ? n + " " : "";
		const mark = v.marks && v.marks[m.ply] ? " " + v.marks[m.ply] : "";
		const refs = ((v.noteByPly && v.noteByPly[m.ply]) || [])
			.map((n) => "[" + n + "]")
			.join("");
		parts.push(num + m.san + mark + refs);
	});
	return parts.join("  ");
}

// Same layout as cardMovesText but built as DOM so note numbers render as
// true superscripts in the Lines (print) view and the printed PDF.
function buildCardMoves(container, v) {
	let first = true;
	const seg = (text) => {
		if (!first) container.appendChild(document.createTextNode("  "));
		first = false;
		container.appendChild(document.createTextNode(text));
	};
	const ctx = v.tag !== "mainline" && v.d > 0 ? v.moves[v.d - 1] : null;
	if (ctx) {
		const num = moveNum(ctx.ply, true);
		seg("\u22ef " + (num ? num + " " : "") + ctx.san);
	}
	const range = v.tag === "mainline" ? v.moves : v.moves.slice(v.d);
	range.forEach((m, i) => {
		const n = moveNum(m.ply, i === 0 && !ctx);
		const num = n ? n + " " : "";
		seg(num + m.san);
		if (v.marks && v.marks[m.ply]) container.appendChild(markEl(v.marks[m.ply]));
		const refs = (v.noteByPly && v.noteByPly[m.ply]) || [];
		if (refs.length) {
			const sup = document.createElement("sup");
			sup.textContent = refs.join(",");
			container.appendChild(sup);
		}
	});
}

export function renderCards(container, grid, opts = {}) {
	const notes = opts.notes || [];
	const strip = (s) =>
		s.replace(/\*\*/g, "").replace(/`/g, "").replace(/\*/g, "").trim();
	const wrap = document.createElement("div");
	wrap.className = "cards";
	// Footnote lines are notes, not cards — they render in the notes block of
	// whichever card carries their anchor.
	const all = grid.vars;
	for (const v of all) {
		const card = document.createElement("section");
		card.className = "card";

		const head = document.createElement("header");
		head.className = "card-head";
		const tag = document.createElement("span");
		tag.className = "tag " + v.tag;
		tag.textContent = v.label;
		head.appendChild(tag);
		const name = document.createElement("span");
		name.className = "card-name";
		name.textContent = v.name;
		head.appendChild(name);
		const ev = document.createElement("span");
		ev.className = "card-eval";
		ev.textContent = v.eval;
		head.appendChild(ev);
		card.appendChild(head);

		const moves = document.createElement("div");
		moves.className = "card-moves";
		buildCardMoves(moves, v);
		card.appendChild(moves);

		const boards = document.createElement("div");
		boards.className = "card-boards";
		const addBoard = (fen, cap) => {
			const b = document.createElement("div");
			b.className = "card-board";
			appendBoard(b, fen, opts.boardSize || 200);
			if (cap) {
				const s = document.createElement("div");
				s.className = "card-board-cap";
				s.textContent = cap;
				b.appendChild(s);
			}
			boards.appendChild(b);
		};
		if (opts.showFinalBoard !== false) addBoard(v.fen, null);
		// "latest divergence": the first move this line no longer shares with
		// ANY other line — its first moment of true uniqueness. Position shown
		// after that move so the move itself is on the board.
		const uniq = opts.uniq && opts.uniq.get(v.moves);
		if (
			opts.showFirstDivBoard &&
			uniq != null &&
			uniq < (v.moves || []).length
		) {
			const mv = v.moves[uniq];
			addBoard(
				fenAt(v.moves, mv.ply),
				"latest divergence " + fullmoveLabel(mv.ply) + mv.san,
			);
		}
		if (boards.childNodes.length) card.appendChild(boards);

		// relevant notes for this line, below the image
		const notesBox = document.createElement("div");
		notesBox.className = "card-notes";
		const owned = [];
		for (const ply in v.noteByPly || {}) {
			v.noteByPly[ply].forEach((n) => {
				const note = notes[n - 1];
				if (!note) return;
				owned.push({
					n,
					ply: Number(ply),
					foot: !!note.foot,
					text: note.foot ? footnoteText(note.foot) : strip(note.text),
					subNotes: note.foot ? footLines(note.foot) : [],
				});
			});
		}
		if (owned.length) {
			const h = document.createElement("div");
			h.className = "card-notes-h";
			h.textContent = "Notes";
			notesBox.appendChild(h);
			owned.forEach((o) => {
				const mv = (v.moves || []).find((m) => m.ply === o.ply);
				const ref = mv ? fullmoveLabel(mv.ply) + mv.san : fullmoveLabel(o.ply);
				const row = document.createElement("div");
				row.className = "nt";
				// A footnote's text already names itself and shows its own branch
				// (spec §6: "Name: moves — commentary"); the move it replaces is
				// not part of it, and the panel, print block and Markdown all omit
				// it too. Only an ordinary note needs saying which move it is on.
				row.textContent = o.foot
					? `[${o.n}] ${o.text}`
					: `[${o.n}] ${ref} \u2014 ${o.text}`;
				notesBox.appendChild(row);
				// A footnote's nested content gets its own indented rows beneath it,
				// the same shape it has on screen and in the print block. A card row
				// is plain text, so the label is already inline in the line.
				o.subNotes.forEach((r) => {
					const s = document.createElement("div");
					// Card rows are flat siblings, so each one carries its own depth
					// rather than inheriting an ancestor's indent — footLines states
					// that depth, so nothing here has to measure whitespace.
					s.className = "nt subnote d" + r.depth;
					// One step per level, however deep the group goes: the same
					// 1.6em step the nested .fnode rows produce on screen and in
					// print, so all four surfaces indent identically (spec goal 4).
					s.style.marginLeft = 1.6 * r.depth + "em";
					// Cards bracket the label ("[a] …") where the text exports write
					// "a. …": a card row sits under note rows that carry bracketed [n]
					// markers, so the labels below it read as the same kind of marker.
					s.textContent = strip("[" + r.label + "] " + r.text);
					notesBox.appendChild(s);
				});
			});
		}
		if (v.note) {
			const row = document.createElement("div");
			row.className = "nt";
			row.textContent = "Note: " + strip(v.note);
			notesBox.appendChild(row);
		}
		if (notesBox.childNodes.length) card.appendChild(notesBox);
		wrap.appendChild(card);
	}
	container.appendChild(wrap);
}

// Standard algebraic pairing: number on White's half-move once ("1. e4 e5 2.
// Nf3"), Black's half-move carries none. Marks (per-move symbols) are
// appended to the move they annotate.
export function fullMovesText(moves, marks) {
	return moves
		.map((m, i) => {
			const n = moveNum(m.ply, i === 0);
			return (
				(n ? n + " " : "") +
				m.san +
				(marks && marks[m.ply] ? " " + marks[m.ply] : "")
			);
		})
		.join(" ");
}

// A footnote-derived note: "Sicilian: 1...c5 = — commentary". The moves shown
// are the footnote's own tail, starting at the move it plays instead of the
// one its [n] marker sits on, and any notes on those moves render as inline
// superscripts. The last shared move is deliberately not shown: the marker
// already says where the branch happens, and leading with a move from before
// it read as though the note diverged earlier than it does.
//
// `container` is the note's ROW, not an inline span: the stem is inline, but a
// footnote's own notes and a group's branches are block rows, and they have to
// be the row's siblings rather than blocks buried inside an inline span. This
// function owns the whole footnote, so it also creates the stem's span itself
// and renders the sub-notes in the one place that can put them above the
// branches.
export function appendFootnote(container, foot) {
	footStem(container, foot);
	renderSubNotes(container, foot);
	// A group's members hang below it as nested labelled rows, one level of
	// indentation per depth (the nesting does the indenting; see .fnode in
	// style.css). A lone footnote has no children and stops here.
	(foot.children || []).forEach((c) => appendFootNode(container, c));
}

// A footnote's inline content — name, moves, evaluation, commentary — as one
// span appended to `container`. Split out of appendFootnote because the
// collapsible notes panel puts this exact stem in a <summary> while its
// sub-notes and branches go in the body below; both callers must produce the
// same stem or the screen and the print report would drift.
export function footStem(container, foot) {
	const span = document.createElement("span");
	const t = (s) => span.appendChild(document.createTextNode(s));
	if (foot.name) t(foot.name + ": ");
	const tail = appendFootMoves(span, foot);
	if (foot.eval) t((tail.length ? " " : "") + foot.eval);
	if (foot.note) {
		// The dash separates moves from commentary. A footnote that shares
		// everything it has with its parent has no moves to separate, so the
		// commentary follows the name directly instead of a dangling dash.
		if (tail.length || foot.eval) t(" — ");
		renderInline(span, foot.note);
	}
	// Nothing inline to show (a footnote with no moves, name, eval or note)
	// leaves no empty span behind.
	if (span.childNodes.length) container.appendChild(span);
}

// One node's move run, with its per-move symbol marks and note markers. Shared
// by a footnote's stem and by every nested group member below it.
function appendFootMoves(container, foot) {
	const t = (s) => container.appendChild(document.createTextNode(s));
	const tail = foot.moves.slice(foot.d);
	tail.forEach((m, i) => {
		if (i) t(" ");
		t(moveNum(m.ply, i === 0) + m.san);
		if (foot.marks && foot.marks[m.ply])
			container.appendChild(markEl(foot.marks[m.ply]));
		const refs = (foot.noteByPly && foot.noteByPly[m.ply]) || [];
		if (refs.length) {
			const sup = document.createElement("sup");
			sup.textContent = refs.join(",");
			container.appendChild(sup);
		}
	});
	return tail;
}

// One member (or inner fork) of a group footnote: its label, its moves, its own
// commentary, then its own notes and its own children, recursively.
// Exported so the collapsible notes panel can render a branch that has nothing
// nested under it exactly the way print and the cards do.
export function appendFootNode(container, node) {
	const row = el("div", { className: "fnode d" + node.depth });
	row.appendChild(el("sup", { textContent: "[" + node.label + "]" }));
	// footStem appends nothing at all for a node with no name, moves, eval or
	// note, where this used to leave an empty span behind. Invisible either way,
	// and it makes a branch's stem identical to a footnote's.
	footStem(row, node);
	renderSubNotes(row, node);
	(node.children || []).forEach((c) => appendFootNode(row, c));
	container.appendChild(row);
}

// A footnote's own notes, as labelled rows nested under it. Block rows, so they
// are siblings of the stem's span rather than children of it, and they sit
// above a group's branches — everything one level inside the note, in label
// order. Placed by appendFootnote, the one function that owns that order, so
// there is no second call for a caller to make (or to make twice).
function renderSubNotes(container, foot) {
	(foot.subNotes || []).forEach((s) => container.appendChild(subNoteRow(s)));
}

// One sub-note as its own labelled row. Exported because the collapsible notes
// panel places these rows itself, inside a <details> body.
export function subNoteRow(s) {
	const row = document.createElement("div");
	row.className = "subnote";
	const sup = document.createElement("sup");
	sup.textContent = "[" + s.label + "]";
	row.appendChild(sup);
	const span = document.createElement("span");
	renderInline(span, s.text);
	row.appendChild(span);
	return row;
}

// A footnote's nested content as flat rows that still KNOW their depth: its own
// notes, and — for a group — each member with its moves, commentary and notes
// beneath it. Depth and label are exactly known here, at the point each row is
// built, so they travel as data. A consumer that indents structurally (the
// cards) reads `.depth` instead of measuring the whitespace a formatter chose.
function footLines(foot, depth = 1) {
	const out = [];
	(foot.subNotes || []).forEach((s) =>
		out.push({ depth, label: s.label, text: s.text }),
	);
	(foot.children || []).forEach((c) => {
		out.push({ depth, label: c.label, text: footnoteText(c) });
		out.push(...footLines(c, depth + 1));
	});
	return out;
}

// The same rows as plain indented lines, for exports with no DOM. Three spaces
// per level, matching the on-screen indent.
export function subNoteLines(foot, depth = 1) {
	return footLines(foot, depth).map(
		(r) => "   ".repeat(r.depth) + r.label + ". " + r.text,
	);
}

// Same footnote, as plain text for exports that have no DOM. Inline note
// markers are dropped: a text export has no superscripts to render them as.
export function footnoteText(foot) {
	const moves = foot.moves
		.slice(foot.d)
		.map(
			(m, i) =>
				moveNum(m.ply, i === 0) +
				m.san +
				(foot.marks && foot.marks[m.ply] ? " " + foot.marks[m.ply] : ""),
		)
		.join(" ");
	const body = [moves, foot.eval].filter(Boolean).join(" ");
	return (
		(foot.name ? foot.name + ": " : "") +
		body +
		(foot.note ? (body ? " — " : "") + foot.note : "")
	);
}
