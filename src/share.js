// src/share.js
// Getting a position off the analysis board: as a picture of the board, and
// as a PGN file. The pure parts (the standalone SVG, the filename) are
// separate from the buttons, so they can be tested without a browser.

import { boardSvg } from "./render.js";

// ---- board pictures
//
// The board on screen draws its pieces as <use> references into the sprite
// the app injects into the page. A file saved on its own has no page to
// reference, so the pieces it uses are copied into its own <defs>.

const NS = "http://www.w3.org/2000/svg";

export function standaloneBoardSvg(fen, size = 400, { flipped = false, doc = document } = {}) {
	const svg = boardSvg(fen, size, { flipped });
	svg.setAttribute("xmlns", NS);
	svg.removeAttribute("class");
	const ids = new Set([...svg.querySelectorAll("use")].map((u) => u.getAttribute("href").slice(1)));
	const defs = doc.createElementNS(NS, "defs");
	for (const id of ids) {
		const sym = doc.getElementById(id);
		if (sym) defs.appendChild(sym.cloneNode(true));
	}
	svg.prepend(defs);
	// the coordinates inherit the page's font on screen; on their own they
	// need one named
	svg.setAttribute("font-family", "sans-serif");
	return new window.XMLSerializer().serializeToString(svg);
}

// The SVG drawn onto a canvas, as a PNG. Browser only: it needs an <img> that
// actually decodes and a canvas that actually paints.
export function svgToPng(svgText, size) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
		img.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = size;
			canvas.getContext("2d").drawImage(img, 0, 0, size, size);
			URL.revokeObjectURL(url);
			canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no PNG"))), "image/png");
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("board image did not load"));
		};
		img.src = url;
	});
}

// ---- files

// "after-8-Qd2" or "start": a filename part naming the position.
export function positionSlug(sans) {
	const j = sans.length - 1;
	if (j < 0) return "start";
	const n = Math.floor(j / 2) + 1;
	const move = sans[j].replace(/[^a-z0-9]+/gi, "");
	return `after-${n}${j % 2 ? "b" : ""}-${move}`;
}
