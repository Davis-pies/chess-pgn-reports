// src/share.js
// Getting a position off the analysis board: as a link that reopens the board
// there, as a picture of the board, and as a PGN file. The pure parts (the
// link's format, the standalone SVG) are separate from the buttons, so they
// can be tested without a browser.

import { Chess } from "chess.js";
import { boardSvg } from "./render.js";

// ---- position links
//
// A link carries the moves from move one, not a FEN: the board is a list of
// lines played from the start, and a FEN cannot be replayed into one. The
// moves go in the hash so nothing reaches a server, SAN by SAN, each escaped
// (SAN has "+", "#" and "=" in it) and joined by commas.

const HASH_KEY = "moves";

export function positionHash(sans, { flipped = false } = {}) {
	const moves = sans.map(encodeURIComponent).join(",");
	return `#${HASH_KEY}=${moves}${flipped ? "&flip=1" : ""}`;
}

// The page's own address with the position's hash in place of any other.
export function positionLink(sans, opts = {}, href = window.location.href) {
	return href.split("#")[0] + positionHash(sans, opts);
}

// The inverse, trusting nothing: a link can be typed or cut short. The moves
// are replayed and cut at the first that is not legal. Null when the hash is
// not a position link at all; an empty move list is the start position.
export function parsePositionHash(hash) {
	const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
	if (!params.has(HASH_KEY)) return null;
	// URLSearchParams has already decoded the value once, so a SAN's own
	// escaped "+" is back to "+" and the commas are the only separators left
	const raw = params.get(HASH_KEY).split(",").filter(Boolean);
	const chess = new Chess();
	const moves = [];
	for (const san of raw) {
		try {
			moves.push({ san: chess.move(san).san });
		} catch {
			break;
		}
	}
	return { moves, flipped: params.get("flip") === "1" };
}

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
