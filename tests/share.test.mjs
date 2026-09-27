// tests/share.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { installDom } from "./helpers.mjs";
import { positionSlug, standaloneBoardSvg } from "../src/share.js";
import { shareTools } from "../src/share-tools.js";
import { newScratch, playAll, positionOf } from "../src/analysis.js";

test("files are named after the position", () => {
	assert.strictEqual(positionSlug([]), "start");
	assert.strictEqual(positionSlug(["e4"]), "after-1-e4");
	assert.strictEqual(positionSlug(["e4", "c5"]), "after-1b-c5");
	assert.strictEqual(positionSlug(["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6", "Be3", "e5", "Nb3", "Be6", "f3", "Be7", "Qd2", "O-O", "O-O-O", "Nbd7", "g4", "b5", "g5", "b4", "Ne2", "Ne8", "f4", "a5", "f5", "a4", "Nbd4", "exd4", "Nxd4", "b3", "Kb1", "bxc2+"]), "after-18b-bxc2");
});

test("a saved board carries the pieces it draws and nothing it does not", () => {
	const done = installDom(
		'<!DOCTYPE html><svg><symbol id="wK" viewBox="0 0 45 45"><path d="M1 1"/></symbol>' +
			'<symbol id="bK" viewBox="0 0 45 45"/><symbol id="wQ" viewBox="0 0 45 45"/></svg>',
	);
	const text = standaloneBoardSvg("4k3/8/8/8/8/8/8/4K3 w - - 0 1", 400);
	assert.match(text, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
	assert.match(text, /<symbol id="wK"[^>]*><path d="M1 1"/);
	assert.match(text, /<symbol id="bK"/);
	assert.doesNotMatch(text, /id="wQ"/, "a piece not on the board is not copied in");
	assert.doesNotMatch(text, /class="board-svg"/, "the page's styling does not travel");
	done();
});

test("the panel's share row saves PGN and SVG files", async () => {
	const done = installDom();
	const saved = [];
	URL.createObjectURL = (b) => {
		saved.push(b);
		return "blob:x";
	};
	URL.revokeObjectURL = () => {};
	const s = newScratch();
	playAll(s, ["d4", "d5", "c4"]);
	s.flipped = true;
	const msg = document.createElement("div");
	const row = shareTools(s, positionOf(s), msg);
	const names = [];
	document.addEventListener("click", (e) => e.target.download && names.push(e.target.download), true);
	row.querySelector(".an-save-pgn").click();
	row.querySelector(".an-save-svg").click();
	assert.deepStrictEqual(names, ["after-2-c4.pgn", "after-2-c4.svg"]);
	assert.match(await saved[0].text(), /1\. d4 d5 2\. c4 \*/);
	assert.match(await saved[1].text(), /^<svg/);
	done();
});
