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
export function renderTable(container, grid, orientation) {
	const { vars, maxPly } = grid;
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
			(v.collapsed ? " collapsed" : "");
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
				(v.collapsed ? " collapsed" : "");
			if (v.onclick) {
				wireExpandControl(th, v.onclick, !v.collapsed);
				th.title = v.collapsed ? v.name || "expand branch" : "collapse branch";
			}
			const cue = v.collapsed ? "\u25b8 " : v.onclick ? "\u25be " : "";
			th.textContent = cue + (v.name || v.label) + (v.eval ? " " + v.eval : "");
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
				if (v === vars[0]) c.classList.add("main-col", "sticky-col");
				if (v.onclick && v.collapsed) {
					c.classList.add("clickable");
					wireExpandControl(c, v.onclick, false);
				}
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
				if (v.onclick && v.collapsed) {
					c.classList.add("clickable");
					wireExpandControl(c, v.onclick, false);
				}
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
export function appendFootnote(container, foot) {
	const t = (s) => container.appendChild(document.createTextNode(s));
	if (foot.name) t(foot.name + ": ");
	const tail = appendFootMoves(container, foot);
	if (foot.eval) t((tail.length ? " " : "") + foot.eval);
	if (foot.note) {
		// The dash separates moves from commentary. A footnote that shares
		// everything it has with its parent has no moves to separate, so the
		// commentary follows the name directly instead of a dangling dash.
		if (tail.length || foot.eval) t(" — ");
		renderInline(container, foot.note);
	}
	// A group's members hang below it as nested labelled rows, one level of
	// indentation per depth (the nesting does the indenting; see .fnode in
	// style.css). A lone footnote has no children and stops here, leaving its
	// own sub-notes to the caller's own appendSubNotes — only a group renders
	// them here, because its branches have to follow them.
	if (!foot.children || !foot.children.length) return;
	renderSubNotes(container, foot);
	foot.children.forEach((c) => appendFootNode(container, c));
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
function appendFootNode(container, node) {
	const row = el("div", { className: "fnode d" + node.depth });
	row.appendChild(el("sup", { textContent: "[" + node.label + "]" }));
	const span = document.createElement("span");
	const t = (s) => span.appendChild(document.createTextNode(s));
	if (node.name) t(node.name + ": ");
	const tail = appendFootMoves(span, node);
	if (node.eval) t((tail.length ? " " : "") + node.eval);
	if (node.note) {
		if (tail.length || node.eval) t(" — ");
		renderInline(span, node.note);
	}
	row.appendChild(span);
	renderSubNotes(row, node);
	(node.children || []).forEach((c) => appendFootNode(row, c));
	container.appendChild(row);
}

// A footnote's own notes, as labelled rows nested under it. Rendered as a
// sibling block rather than inside appendFootnote so each consumer can place
// and indent it — the panel and the print block both style .subnote.
//
// A GROUP is the exception: its own notes have to sit above its branches, which
// only appendFootnote can place, so it renders them itself and this is a no-op.
// Callers can go on pairing appendFootnote with appendSubNotes unconditionally
// without a group's notes appearing twice.
export function appendSubNotes(container, foot) {
	if (foot.children && foot.children.length) return;
	renderSubNotes(container, foot);
}

function renderSubNotes(container, foot) {
	(foot.subNotes || []).forEach((s) => {
		const row = document.createElement("div");
		row.className = "subnote";
		const sup = document.createElement("sup");
		sup.textContent = "[" + s.label + "]";
		row.appendChild(sup);
		const span = document.createElement("span");
		renderInline(span, s.text);
		row.appendChild(span);
		container.appendChild(row);
	});
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
