// src/share-tools.js
// The analysis panel's row of ways out: copying the position or its lines,
// saving them as files. None of them changes the scratch.

import { el } from "./dom.js";
import { playedMoves, scratchPgn } from "./analysis.js";
import { download } from "./export.js";
import { positionSlug, standaloneBoardSvg, svgToPng } from "./share.js";

// the size a saved board is drawn at, in px
const IMAGE_SIZE = 480;

// `msg` is the panel's status line: it says what happened, and shows the text
// itself where the clipboard is out of reach, so it can be copied by hand.
export function shareTools(scratch, pos, msg) {
	const sans = playedMoves(scratch).map((m) => m.san);
	const name = positionSlug(sans);
	const btn = (cls, text, title, onclick) =>
		el("button", { className: "chip mini " + cls, textContent: text, title, onclick });
	const copy = (text, what) => () => {
		const done = () => (msg.textContent = `${what} copied.`);
		try {
			navigator.clipboard.writeText(text).then(done, () => (msg.textContent = text));
		} catch {
			msg.textContent = text;
		}
	};
	const svg = () => standaloneBoardSvg(pos.fen, IMAGE_SIZE, { flipped: scratch.flipped });
	const png = () =>
		svgToPng(svg(), IMAGE_SIZE).then(
			(b) => download(name + ".png", b, "image/png"),
			() => (msg.textContent = "The PNG could not be drawn; try SVG."),
		);

	const row = el("div", { className: "orow an-share" });
	row.append(
		btn("an-copy-fen", "Copy FEN", "Copy this position as FEN", copy(pos.fen, "FEN")),
		btn("an-copy-pgn", "Copy PGN", "Copy every line here as one PGN, the first line as the main line", copy(scratchPgn(scratch), "PGN")),
		btn("an-save-pgn", "Save PGN", "Save every line here as a PGN file, the first line as the main line", () =>
			download(name + ".pgn", scratchPgn(scratch), "application/x-chess-pgn"),
		),
		btn("an-save-svg", "Save SVG", "Save this board as an SVG image", () => download(name + ".svg", svg(), "image/svg+xml")),
		btn("an-save-png", "Save PNG", "Save this board as a PNG image", png),
	);
	return row;
}

