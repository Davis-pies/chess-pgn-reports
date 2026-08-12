// Rendering: DOM tables and linear print cards over the shared grid (table.js),
// plus self-contained SVG board diagrams. Built with DOM nodes via createElementNS
// (no innerHTML, no DOMParser) so it runs identically in the browser and in jsdom
// tests, and prints cleanly. Board colors stay fixed so diagrams read on both the
// light and dark page themes.

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
function appendBoard(container, fen, size = 220) {
	container.appendChild(boardSvg(fen, size));
	return container.lastElementChild;
}

export function fullmoveLabel(ply) {
	const n = Math.floor(ply / 2) + 1;
	return ply % 2 === 0 ? `${n}.` : `${n}...`;
}

function td(text, cls) {
	const e = document.createElement("td");
	if (text) e.textContent = text;
	if (cls) e.className = cls;
	return e;
}

// A move cell, plus any numbered comment reference marker for that ply.
function moveCell(c, ply, noteByPly) {
	const e = td(c ? c.text : "", c ? c.cls : "");
	const notes = noteByPly && noteByPly[ply];
	if (notes)
		notes.forEach((n) => {
			const s = document.createElement("sup");
			s.textContent = "[" + n + "]";
			e.appendChild(s);
		});
	return e;
}

// Populates `container` with the table (+ optional board diagrams).
export function renderTable(container, grid, orientation, opts = {}) {
	const { vars, maxPly, mainMoves } = grid;
	const labels = {};
	mainMoves.forEach((m) => (labels[m.ply] = fullmoveLabel(m.ply)));

	const table = document.createElement("table");
	table.className = "tbl";

	const varHead = (v) => {
		const c = document.createElement("td");
		c.className = "var-head";
		const tag = document.createElement("span");
		tag.className = "tag " + v.tag;
		tag.textContent = v.label;
		c.appendChild(tag);
		c.appendChild(document.createTextNode(" " + v.name));
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
		head.appendChild(document.createElement("th")).textContent = "ply";
		vars.forEach((v) => {
			const th = document.createElement("th");
			th.textContent = v.name || v.label;
			head.appendChild(th);
		});
		table.appendChild(head);
		for (let ply = 0; ply <= maxPly; ply++) {
			const tr = document.createElement("tr");
			const num = document.createElement("th");
			if (labels[ply]) num.textContent = labels[ply];
			tr.appendChild(num);
			for (const v of vars) {
				const c = v.cells[ply];
				tr.appendChild(moveCell(c, ply, v.noteByPly));
			}
			table.appendChild(tr);
		}
	} else {
		// vertical: rows = variations, columns = ply
		const head = document.createElement("tr");
		head.appendChild(document.createElement("th")).textContent = "Variation";
		for (let ply = 0; ply <= maxPly; ply++) {
			const th = document.createElement("th");
			if (labels[ply]) th.textContent = labels[ply];
			head.appendChild(th);
		}
		head.appendChild(document.createElement("th"));
		table.appendChild(head);
		for (const v of vars) {
			const tr = document.createElement("tr");
			tr.appendChild(varHead(v));
			for (let ply = 0; ply <= maxPly; ply++) {
				const c = v.cells[ply];
				tr.appendChild(moveCell(c, ply, v.noteByPly));
			}
			tr.appendChild(td(v.eval, "eval"));
			table.appendChild(tr);
		}
	}
	container.appendChild(table);

	if (opts.showBoards && vars.length <= 40) {
		const boards = document.createElement("div");
		boards.className = "boards";
		for (const v of vars) {
			const fig = document.createElement("figure");
			fig.className = "board";
			appendBoard(fig, v.fen);
			const cap = document.createElement("figcaption");
			cap.textContent = v.name || v.label;
			fig.appendChild(cap);
			boards.appendChild(fig);
		}
		container.appendChild(boards);
	}
}

// Linear print view: each line as a labeled card with its moves and a position
// diagram, one after another (vs the packed table).
export function renderCards(container, grid, opts = {}) {
	const wrap = document.createElement("div");
	wrap.className = "cards";
	for (const v of grid.vars) {
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
		// split at the divergence: non-main lines show only their tail, not the
		// repeated shared prefix
		moves.textContent =
			v.tag === "mainline"
				? fullMovesText(v.moves)
				: fullMovesText(v.moves.slice(v.d));
		card.appendChild(moves);

		const board = document.createElement("div");
		board.className = "card-board";
		appendBoard(board, v.fen, opts.boardSize || 200);
		card.appendChild(board);
		wrap.appendChild(card);
	}
	container.appendChild(wrap);
}

export function fullMovesText(moves) {
	return moves.map((m) => fullmoveLabel(m.ply) + " " + m.san).join("  ");
}
