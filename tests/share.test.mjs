// tests/share.test.mjs
import { test } from "node:test";
import assert from "node:assert";
import { installDom } from "./helpers.mjs";
import { parsePositionHash, positionHash, positionLink, positionSlug, standaloneBoardSvg } from "../src/share.js";
import { openLinkedPosition, shareTools } from "../src/share-tools.js";
import { newScratch, playAll, positionOf, activeLine } from "../src/analysis.js";
import { getMode, getScratch, setMode, setScratch } from "../src/state.js";

const sans = (list) => list.map((m) => m.san);

test("a position link round-trips its moves and orientation", () => {
	const moves = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6", "O-O", "f6"];
	const h = positionHash(moves, { flipped: true });
	assert.match(h, /^#moves=e4,e5,Nf3/);
	assert.match(h, /&flip=1$/);
	assert.deepStrictEqual(parsePositionHash(h), { moves: moves.map((san) => ({ san })), flipped: true });
});

test("SAN's +, # and = survive the link", () => {
	// Fool's mate ends in a mate, and a promotion needs "="
	const mate = ["f3", "e5", "g4", "Qh4#"];
	assert.deepStrictEqual(sans(parsePositionHash(positionHash(mate)).moves), mate);
	const check = ["e4", "e5", "Bc4", "Nc6", "Bxf7+"];
	assert.deepStrictEqual(sans(parsePositionHash(positionHash(check)).moves), check);
	const promo = ["a4", "b5", "axb5", "a6", "bxa6", "Bb7", "axb7", "Nc6", "bxa8=Q"];
	assert.deepStrictEqual(sans(parsePositionHash(positionHash(promo)).moves), promo);
});

test("a link is cut at its first illegal move, and anything else is not a link", () => {
	assert.deepStrictEqual(sans(parsePositionHash("#moves=e4,e5,Ke3,Nf3").moves), ["e4", "e5"]);
	assert.deepStrictEqual(parsePositionHash("#moves="), { moves: [], flipped: false });
	assert.strictEqual(parsePositionHash(""), null);
	assert.strictEqual(parsePositionHash("#section-2"), null);
});

test("the link keeps the page's address and replaces any hash", () => {
	assert.strictEqual(
		positionLink(["d4"], {}, "https://example.test/app/?x=1#old"),
		"https://example.test/app/?x=1#moves=d4",
	);
});

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

test("the panel's share row copies a link and saves PGN and SVG files", async () => {
	const done = installDom();
	const copied = [];
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText: async (t) => copied.push(t) },
		configurable: true,
	});
	const saved = [];
	URL.createObjectURL = (b) => (saved.push(b), "blob:x");
	URL.revokeObjectURL = () => {};
	const s = newScratch();
	playAll(s, ["d4", "d5", "c4"]);
	s.flipped = true;
	const msg = document.createElement("div");
	const row = shareTools(s, positionOf(s), msg);
	row.querySelector(".an-copy-link").click();
	await new Promise((r) => setTimeout(r, 0));
	assert.strictEqual(copied[0], "http://localhost/#moves=d4,d5,c4&flip=1");
	assert.strictEqual(msg.textContent, "Link copied.");

	const names = [];
	document.addEventListener("click", (e) => e.target.download && names.push(e.target.download), true);
	row.querySelector(".an-save-pgn").click();
	row.querySelector(".an-save-svg").click();
	assert.deepStrictEqual(names, ["after-2-c4.pgn", "after-2-c4.svg"]);
	assert.match(await saved[0].text(), /1\. d4 d5 2\. c4 \*/);
	assert.match(await saved[1].text(), /^<svg/);
	done();
});

test("a link opens the board there, onto the analysis already on it", () => {
	const done = installDom();
	window.history.replaceState(null, "", "/#moves=e4,c5,Nf3&flip=1");
	setScratch(null);
	setMode("report");
	assert.strictEqual(openLinkedPosition(), true);
	assert.strictEqual(getMode(), "analysis");
	assert.deepStrictEqual(sans(activeLine(getScratch()).moves), ["e4", "c5", "Nf3"]);
	assert.strictEqual(getScratch().flipped, true);
	assert.strictEqual(window.location.hash, "", "the hash is cleared once used");

	// a second link keeps the first line and opens a new one beside it
	window.history.replaceState(null, "", "/#moves=d4");
	openLinkedPosition();
	assert.strictEqual(getScratch().lines.length, 2);
	assert.deepStrictEqual(sans(activeLine(getScratch()).moves), ["d4"]);

	window.history.replaceState(null, "", "/#other");
	assert.strictEqual(openLinkedPosition(), false);
	setScratch(null);
	setMode("report");
	done();
});
