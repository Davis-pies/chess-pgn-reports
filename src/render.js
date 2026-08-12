// Rendering: inline SVG board diagrams from FEN, and a DOM table built from the
// shared grid (table.js). horizontal/vertical differ only in which axis the
// variations run along. Built with DOM nodes (no innerHTML) so user text needs
// no string escaping.

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const PIECES = {
	P: "\u2659",
	N: "\u2658",
	B: "\u2657",
	R: "\u2656",
	Q: "\u2655",
	K: "\u2654",
	p: "\u265F",
	n: "\u265E",
	b: "\u265D",
	r: "\u265C",
	q: "\u265B",
	k: "\u265A",
};

export function fenToSvg(fen, size = 180) {
	const ranks = (fen || START_FEN).split(" ")[0].split("/");
	// expand a rank like "4p3" into 8 cells (piece char or null)
	const grid = ranks.map((rank) => {
		const row = [];
		for (const ch of rank) {
			if (/[1-8]/.test(ch)) for (let k = 0; k < +ch; k++) row.push(null);
			else row.push(ch);
		}
		return row;
	});
	const sq = size / 8;
	let s = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`;
	for (let r = 0; r < 8; r++) {
		for (let f = 0; f < 8; f++) {
			const x = f * sq;
			const y = r * sq;
			const light = (r + f) % 2 === 0;
			// always draw the square so empty squares are visible
			s += `<rect x="${x}" y="${y}" width="${sq}" height="${sq}" fill="${light ? "#f0d9b5" : "#b58863"}"/>`;
			const p = grid[r][f];
			if (p && PIECES[p]) {
				s += `<text x="${x + sq / 2}" y="${y + sq * 0.82}" font-size="${sq * 0.78}" text-anchor="middle" fill="#111">${PIECES[p]}</text>`;
			}
		}
	}
	return s + "</svg>";
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

// Populates `container` with the table (+ optional board diagrams).
export function renderTable(container, grid, orientation, opts = {}) {
	const { vars, maxPly, mainMoves } = grid;
	const labels = {};
	mainMoves.forEach((m) => (labels[m.ply] = fullmoveLabel(m.ply)));

	const table = document.createElement("table");
	table.className = "tbl";

	const varHead = (v, th) => {
		const c = document.createElement(th ? "th" : "td");
		c.className = "var-head";
		const tag = document.createElement("span");
		tag.className = "tag " + v.tag;
		tag.textContent = v.tag;
		c.appendChild(tag);
		c.appendChild(document.createTextNode(" " + v.name));
		return c;
	};

	if (orientation === "horizontal") {
		// rows = ply, columns = variations
		const head = document.createElement("tr");
		head.appendChild(document.createElement("th")).textContent = "ply";
		vars.forEach((v) => {
			const th = document.createElement("th");
			th.textContent = v.name || v.tag;
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
				tr.appendChild(td(c ? c.text : "", c ? c.cls : ""));
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
			tr.appendChild(varHead(v, false));
			for (let ply = 0; ply <= maxPly; ply++) {
				const c = v.cells[ply];
				tr.appendChild(td(c ? c.text : "", c ? c.cls : ""));
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
			const svgDoc = new DOMParser().parseFromString(
				fenToSvg(v.fen),
				"image/svg+xml",
			);
			fig.appendChild(document.importNode(svgDoc.documentElement, true));
			const cap = document.createElement("figcaption");
			cap.textContent = v.name || v.tag;
			fig.appendChild(cap);
			boards.appendChild(fig);
		}
		container.appendChild(boards);
	}
}
