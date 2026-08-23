// Rendering: DOM tables and linear print cards over the shared grid (table.js),
// plus self-contained SVG board diagrams. Built with DOM nodes via createElementNS
// (no innerHTML, no DOMParser) so it runs identically in the browser and in jsdom
// tests, and prints cleanly. Board colors stay fixed so diagrams read on both the
// light and dark page themes.

import { fenAt } from "./pgn.js";
import { renderInline } from "./dom.js";

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

// A move cell, plus any per-move symbol mark and referenced note markers.
function moveCell(c, ply, noteByPly) {
	const e = td(c ? c.text : "", c ? c.cls : "");
	if (c && c.mark) e.appendChild(document.createTextNode(" " + c.mark));
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
		if (v.letter) {
			const s = document.createElement("sup");
			s.textContent = "[" + v.letter + "]";
			c.appendChild(s);
		}
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
export function cardMovesText(v) {
	const parts = [];
	if (v.tag !== "mainline" && v.d > 0) {
		const pm = v.moves[v.d - 1];
		const num = pm.ply % 2 === 0 ? Math.floor(pm.ply / 2) + 1 + ". " : "";
		parts.push("\u22ef " + num + pm.san);
	}
	const range = v.tag === "mainline" ? v.moves : v.moves.slice(v.d);
	range.forEach((m) => {
		const num = m.ply % 2 === 0 ? Math.floor(m.ply / 2) + 1 + ". " : "";
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
	if (v.tag !== "mainline" && v.d > 0) {
		const pm = v.moves[v.d - 1];
		const num = pm.ply % 2 === 0 ? Math.floor(pm.ply / 2) + 1 + ". " : "";
		seg("\u22ef " + num + pm.san);
	}
	const range = v.tag === "mainline" ? v.moves : v.moves.slice(v.d);
	range.forEach((m) => {
		const num = m.ply % 2 === 0 ? Math.floor(m.ply / 2) + 1 + ". " : "";
		const mark = v.marks && v.marks[m.ply] ? " " + v.marks[m.ply] : "";
		seg(num + m.san + mark);
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
		if (v.letter) {
			const s = document.createElement("sup");
			s.textContent = "[" + v.letter + "]";
			head.appendChild(s);
		}
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
					text: note.foot ? footnoteText(note.foot) : strip(note.text),
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
				row.textContent = `[${o.n}] ${ref} \u2014 ${o.text}`;
				notesBox.appendChild(row);
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
		.map(
			(m) =>
				(m.ply % 2 === 0 ? Math.floor(m.ply / 2) + 1 + ". " : "") +
				m.san +
				(marks && marks[m.ply] ? " " + marks[m.ply] : ""),
		)
		.join(" ");
}

// A footnote-derived note: "Sicilian: ⋯ 1.e4 1...c5 = — commentary". The moves
// shown are the footnote's own tail, prefixed with the last shared move for
// context, and any notes on those moves render as inline superscripts.
export function appendFootnote(container, foot) {
	const t = (s) => container.appendChild(document.createTextNode(s));
	if (foot.name) t(foot.name + ": ");
	if (foot.d > 0) {
		const pm = foot.moves[foot.d - 1];
		t("⋯ " + fullmoveLabel(pm.ply) + pm.san + " ");
	}
	foot.moves.slice(foot.d).forEach((m, i) => {
		if (i) t(" ");
		const mark = foot.marks && foot.marks[m.ply] ? " " + foot.marks[m.ply] : "";
		t(fullmoveLabel(m.ply) + m.san + mark);
		const refs = (foot.noteByPly && foot.noteByPly[m.ply]) || [];
		if (refs.length) {
			const sup = document.createElement("sup");
			sup.textContent = refs.join(",");
			container.appendChild(sup);
		}
	});
	if (foot.eval) t(" " + foot.eval);
	if (foot.note) {
		t(" — ");
		renderInline(container, foot.note);
	}
}

// Same footnote, as plain text for exports that have no DOM. Inline note
// markers are dropped: a text export has no superscripts to render them as.
export function footnoteText(foot) {
	const pm = foot.d > 0 ? foot.moves[foot.d - 1] : null;
	const ctx = pm ? "⋯ " + fullmoveLabel(pm.ply) + pm.san + " " : "";
	const tail = foot.moves
		.slice(foot.d)
		.map(
			(m) =>
				fullmoveLabel(m.ply) +
				m.san +
				(foot.marks && foot.marks[m.ply] ? " " + foot.marks[m.ply] : ""),
		)
		.join(" ");
	return (
		(foot.name ? foot.name + ": " : "") +
		ctx +
		tail +
		(foot.eval ? " " + foot.eval : "") +
		(foot.note ? " — " + foot.note : "")
	);
}
