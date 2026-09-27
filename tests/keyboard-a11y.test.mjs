// tests/keyboard-a11y.test.mjs
// The board without a mouse: its keys, the typed-move box, the shortcut help,
// and what it tells a screen reader.
import { test } from "node:test";
import assert from "node:assert";
import { installDom } from "./helpers.mjs";
import { analysisPanel, spokenSan, BOARD_KEYS } from "../src/analysis-view.js";
import { describePieces } from "../src/board-input.js";
import {
	activeLine,
	goTo,
	newScratch,
	play,
	typedMove,
} from "../src/analysis.js";
import { announce, focusKey, restoreFocus, trapTab } from "../src/a11y.js";

const sans = (...m) => m.map((san) => ({ san }));
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Three lines: 1.e4 e5 2.Nf3 Nc6 3.Bb5, with 1...c5 and 2...d6 off it.
function forked() {
	const s = newScratch(sans("e4", "e5", "Nf3", "Nc6", "Bb5"));
	goTo(s, 1);
	play(s, "c5");
	s.active = 0;
	goTo(s, 3);
	play(s, "d6");
	s.active = 0;
	goTo(s, 0);
	return s;
}

const press = (node, key, opts = {}) =>
	node.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));

// ---- analysis.js

test("a typed move is read as SAN or as from-to, forgivingly", () => {
	const s = newScratch();
	assert.strictEqual(typedMove(s, "e4"), "e4");
	assert.strictEqual(typedMove(s, "Nf3"), "Nf3");
	assert.strictEqual(typedMove(s, "nf3"), "Nf3", "a lower-case piece letter");
	assert.strictEqual(typedMove(s, " g1f3 "), "Nf3", "from-to");
	assert.strictEqual(typedMove(s, "g1-f3"), "Nf3");
	assert.strictEqual(typedMove(s, "e5"), null, "not legal here");
	assert.strictEqual(typedMove(s, "hello"), null);
	assert.strictEqual(typedMove(s, ""), null);
	const c = newScratch(sans("e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"));
	assert.strictEqual(typedMove(c, "0-0"), "O-O", "zeros for castling");
	assert.strictEqual(typedMove(c, "o-o"), "O-O");
	assert.strictEqual(typedMove(c, "Bxf7+"), "Bxf7+");
	assert.strictEqual(typedMove(c, "Bxf7"), "Bxf7+", "the check mark can be left off");
	const promo = newScratch(sans("a4", "b5", "axb5", "a6", "bxa6", "Nc6", "a7", "Rb8"));
	assert.strictEqual(typedMove(promo, "a7a8q"), "a8=Q");
	assert.strictEqual(typedMove(promo, "a8=N"), "a8=N");
});

// ---- speaking

test("a move is spoken as words", () => {
	assert.strictEqual(spokenSan("e4"), "e4");
	assert.strictEqual(spokenSan("Nf3"), "knight f3");
	assert.strictEqual(spokenSan("exd5"), "e takes d5");
	assert.strictEqual(spokenSan("Nbxd2+"), "knight b takes d2, check");
	assert.strictEqual(spokenSan("e8=Q#"), "e8 promotes to queen, mate");
	assert.strictEqual(spokenSan("O-O"), "castles kingside");
	assert.strictEqual(spokenSan("O-O-O+"), "castles queenside, check");
	assert.strictEqual(spokenSan("??"), "??", "anything else as it is");
});

test("the pieces are listed in words", () => {
	assert.strictEqual(
		describePieces(START),
		"White: King e1, Queen d1, Rooks a1 h1, Bishops c1 f1, Knights b1 g1, Pawns a2 b2 c2 d2 e2 f2 g2 h2. " +
			"Black: King e8, Queen d8, Rooks a8 h8, Bishops c8 f8, Knights b8 g8, Pawns a7 b7 c7 d7 e7 f7 g7 h7.",
	);
	assert.strictEqual(describePieces("8/8/8/8/8/8/8/K1k5 w - - 0 1"), "White: King a1. Black: King c1.");
});

test("the board is labelled with the move and described by its pieces", () => {
	const done = installDom();
	const s = newScratch(sans("e4", "c5", "Nf3"));
	goTo(s, 2);
	const panel = analysisPanel(s, () => {});
	const svg = panel.querySelector(".an-board svg");
	assert.strictEqual(svg.getAttribute("aria-label"), "Board after 1... c5, White to move");
	const desc = panel.querySelector("#" + svg.getAttribute("aria-describedby"));
	assert.match(desc.textContent, /^White: King e1/);
	assert.match(desc.textContent, /Pawns a7 b7 c5 d7/);
	goTo(s, 0);
	assert.strictEqual(
		analysisPanel(s, () => {}).querySelector(".an-board svg").getAttribute("aria-label"),
		"Board at the start, White to move",
	);
	done();
});

test("each position is read out once, as it is reached", () => {
	const done = installDom();
	const s = newScratch(sans("e4", "e5", "Nf3"));
	analysisPanel(s, () => {});
	const live = document.getElementById("sr-live");
	assert.ok(live, "a live region is made on the body");
	assert.strictEqual(live.getAttribute("aria-live"), "polite");
	assert.strictEqual(live.textContent, "After 2. knight f3. Black to move.");
	goTo(s, 0);
	analysisPanel(s, () => {});
	assert.strictEqual(live.textContent, "Start position. White to move.");
	// a redraw that moved nothing says nothing new
	live.textContent = "";
	analysisPanel(s, () => {});
	assert.strictEqual(live.textContent, "");
	done();
});

test("the same announcement twice is still a change the reader hears", () => {
	const done = installDom();
	announce("Check.");
	const live = document.getElementById("sr-live");
	const first = live.textContent;
	announce("Check.");
	assert.notStrictEqual(live.textContent, first);
	assert.strictEqual(live.textContent.trim(), "Check.");
	assert.strictEqual(document.querySelectorAll("#sr-live").length, 1, "one region, reused");
	done();
});

// ---- the panel's keys

test("P and ? do what the help says", () => {
	const done = installDom();
	const s = forked();
	let redraws = 0;
	const panel = analysisPanel(s, () => redraws++);
	press(panel, "p");
	assert.strictEqual(activeLine(s).pinned, true);
	press(panel, "P");
	assert.strictEqual(activeLine(s).pinned, false, "Caps Lock makes no difference");
	press(panel, "?");
	assert.strictEqual(s.help, true);
	assert.strictEqual(redraws, 3);
	done();
});

test("keys typed into a box stay in the box", () => {
	const done = installDom();
	const s = forked();
	const panel = analysisPanel(s, () => {});
	document.body.appendChild(panel);
	press(panel.querySelector(".an-type"), "ArrowRight");
	press(panel.querySelector(".an-type"), "f");
	assert.strictEqual(s.at, 0);
	assert.strictEqual(s.flipped, false);
	done();
});

test("M and / go to the move box, N to the note box", () => {
	const done = installDom();
	const s = newScratch(sans("e4"));
	let redraws = 0;
	const panel = analysisPanel(s, () => redraws++);
	document.body.appendChild(panel);
	press(panel, "m");
	assert.strictEqual(document.activeElement, panel.querySelector(".an-type"));
	panel.focus();
	press(panel, "/");
	assert.strictEqual(document.activeElement, panel.querySelector(".an-type"));
	panel.focus();
	press(panel, "n");
	assert.strictEqual(document.activeElement, panel.querySelector(".cedit input"));
	assert.strictEqual(redraws, 0, "focus moves; nothing is redrawn");
	done();
});

// ---- the move box

test("a move typed and entered is played", () => {
	const done = installDom();
	const s = newScratch();
	let redraws = 0;
	const panel = analysisPanel(s, () => redraws++);
	const box = panel.querySelector(".an-type");
	assert.strictEqual(box.getAttribute("aria-label"), "Type a move");
	box.value = "nf3";
	press(box, "Enter");
	assert.deepStrictEqual(activeLine(s).moves.map((m) => m.san), ["Nf3"]);
	assert.strictEqual(redraws, 1);
	done();
});

test("an illegal move is refused, said so, and left to fix", () => {
	const done = installDom();
	const s = newScratch();
	let redraws = 0;
	const panel = analysisPanel(s, () => redraws++);
	const box = panel.querySelector(".an-type");
	box.value = "Ke2";
	press(box, "Enter");
	assert.strictEqual(activeLine(s).moves.length, 0);
	assert.strictEqual(redraws, 0);
	assert.strictEqual(box.getAttribute("aria-invalid"), "true");
	assert.strictEqual(box.value, "Ke2");
	const msg = panel.querySelector("#" + box.getAttribute("aria-describedby"));
	assert.strictEqual(msg.textContent, "Ke2 is not a legal move here.");
	assert.strictEqual(msg.getAttribute("role"), "status");
	// typing again clears the complaint
	box.value = "Ke";
	box.dispatchEvent(new window.Event("input"));
	assert.strictEqual(box.hasAttribute("aria-invalid"), false);
	assert.strictEqual(msg.textContent, "");
	done();
});

test("Escape in the move box clears it first, then lets the board close", () => {
	const done = installDom();
	const panel = analysisPanel(newScratch(), () => {});
	const outer = document.createElement("div");
	outer.appendChild(panel);
	let escaped = 0;
	outer.addEventListener("keydown", (e) => e.key === "Escape" && escaped++);
	const box = panel.querySelector(".an-type");
	box.value = "Nf";
	press(box, "Escape");
	assert.strictEqual(box.value, "");
	assert.strictEqual(escaped, 0, "the board stays open");
	press(box, "Escape");
	assert.strictEqual(escaped, 1, "an empty box passes Escape on");
	done();
});

// ---- the help

test("the help lists the keys, in a dialog, and closes on Escape before the board does", () => {
	const done = installDom();
	const s = newScratch();
	s.help = true;
	let redraws = 0;
	const panel = analysisPanel(s, () => redraws++, { engine: null });
	const dlg = panel.querySelector(".an-help");
	assert.strictEqual(dlg.getAttribute("role"), "dialog");
	assert.strictEqual(dlg.getAttribute("aria-modal"), "true");
	assert.strictEqual(panel.querySelector("#" + dlg.getAttribute("aria-labelledby")).textContent, "Keyboard shortcuts");
	const keys = [...dlg.querySelectorAll("kbd")].map((k) => k.textContent);
	assert.ok(keys.includes("[ / ]"));
	assert.ok(!keys.includes("E") && !keys.includes("Space"), "no engine keys without an engine");
	assert.strictEqual(dlg.querySelectorAll("tr").length, BOARD_KEYS.length - 2);

	const outer = document.createElement("div");
	outer.appendChild(panel);
	let escaped = 0;
	outer.addEventListener("keydown", (e) => e.key === "Escape" && escaped++);
	press(panel, "Escape");
	assert.strictEqual(s.help, false);
	assert.strictEqual(escaped, 0, "the board did not see it");
	assert.strictEqual(redraws, 1);
	done();
});

test("the help opens from its button and shuts from Close or its backdrop", () => {
	const done = installDom();
	const s = newScratch();
	analysisPanel(s, () => {}).querySelector(".an-help-open").click();
	assert.strictEqual(s.help, true);
	analysisPanel(s, () => {}).querySelector(".an-help-close").click();
	assert.strictEqual(s.help, false);
	s.help = true;
	const wrap = analysisPanel(s, () => {}).querySelector(".an-help-wrap");
	wrap.querySelector("table").click();
	assert.strictEqual(s.help, true, "a click inside it leaves it open");
	wrap.click();
	assert.strictEqual(s.help, false);
	done();
});

// ---- names

test("glyph buttons have names, and the moves say which is current", () => {
	const done = installDom();
	const s = forked();
	goTo(s, 1);
	const panel = analysisPanel(s, () => {});
	const name = (sel) => panel.querySelector(sel).getAttribute("aria-label");
	assert.strictEqual(name(".an-back"), "Back one move");
	assert.strictEqual(panel.querySelector(".an-back").getAttribute("aria-keyshortcuts"), "ArrowLeft");
	assert.strictEqual(name(".an-fwd"), "Forward one move");
	assert.strictEqual(name(".an-del"), "Delete this line (line 1)");
	assert.strictEqual(name(".an-pin"), "Pin (line 1)");
	assert.strictEqual(name(".an-down"), "Move this line down (line 1)");
	const cur = panel.querySelectorAll('.an-move[aria-current="step"]');
	assert.strictEqual(cur.length, 1);
	assert.strictEqual(cur[0].getAttribute("aria-label"), "1. e4");
	assert.strictEqual(panel.querySelector(".an-lines").getAttribute("role"), "list");
	assert.match(panel.querySelector(".an-line").getAttribute("aria-label"), /^Line 1, being played/);
	assert.strictEqual(panel.querySelector(".an-nav").getAttribute("role"), "toolbar");
	done();
});

// ---- a11y.js

test("focus is found again in a redrawn tree by what the control is", () => {
	const done = installDom();
	const build = () => {
		const root = document.createElement("div");
		root.innerHTML =
			'<button class="chip mini an-back">b</button><button class="chip mini primary an-add">1</button><button class="chip mini primary an-add">2</button><button class="chip mini an-fwd" disabled>f</button><span>x</span>';
		document.body.replaceChildren(root);
		return root;
	};
	let root = build();
	const key = focusKey(root, root.querySelectorAll(".an-add")[1]);
	assert.deepStrictEqual(key, { sel: "button.an-add", n: 1 });
	root = build();
	assert.strictEqual(restoreFocus(root, key), true);
	assert.strictEqual(document.activeElement, root.querySelectorAll(".an-add")[1]);
	assert.strictEqual(restoreFocus(root, { sel: "button.an-fwd", n: 0 }), false, "not a disabled one");
	assert.strictEqual(restoreFocus(root, { sel: "button.gone", n: 0 }), false);
	assert.strictEqual(restoreFocus(root, null), false);
	assert.strictEqual(focusKey(root, root.querySelector("span")), null, "nothing to name it by");
	assert.strictEqual(focusKey(root, root), null);
	assert.strictEqual(focusKey(root, document.body), null, "outside the tree");
	// one fewer of them now: the last there is, rather than none
	root.querySelectorAll(".an-add")[1].remove();
	assert.strictEqual(restoreFocus(root, key), true);
	assert.strictEqual(document.activeElement, root.querySelector(".an-add"));
	done();
});

test("Tab wraps round inside a dialog", () => {
	const done = installDom();
	const box = document.createElement("div");
	box.innerHTML = '<button id="a">a</button><button disabled>x</button><input id="b"><button id="c">c</button><button hidden>h</button>';
	document.body.appendChild(box);
	const tab = (shiftKey) => {
		const e = new window.KeyboardEvent("keydown", { key: "Tab", shiftKey, cancelable: true });
		trapTab(box, e);
		return e.defaultPrevented;
	};
	box.querySelector("#c").focus();
	assert.strictEqual(tab(false), true);
	assert.strictEqual(document.activeElement.id, "a");
	assert.strictEqual(tab(true), true);
	assert.strictEqual(document.activeElement.id, "c");
	box.querySelector("#b").focus();
	assert.strictEqual(tab(false), false, "in the middle, Tab is left to the browser");
	document.activeElement.blur();
	assert.strictEqual(tab(false), true, "from outside, into the first");
	assert.strictEqual(document.activeElement.id, "a");
	const other = new window.KeyboardEvent("keydown", { key: "a", cancelable: true });
	trapTab(box, other);
	assert.strictEqual(other.defaultPrevented, false);
	trapTab(document.createElement("div"), new window.KeyboardEvent("keydown", { key: "Tab" }));
	done();
});

test("the promotion picker takes the focus, and Escape backs out of it alone", () => {
	const done = installDom();
	const s = newScratch(sans("a4", "b5", "axb5", "a6", "bxa6", "Nc6", "a7", "Rb8"));
	const panel = analysisPanel(s, () => {});
	document.body.appendChild(panel);
	const sq = (name, type) =>
		panel.querySelector(`rect[data-sq="${name}"]`).dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true }));
	sq("a7", "mousedown");
	sq("a8", "mouseup");
	const promo = panel.querySelector(".an-promo");
	assert.strictEqual(promo.getAttribute("role"), "dialog");
	assert.strictEqual(document.activeElement, promo.querySelector(".an-promo-pick"), "on the queen");
	let escaped = 0;
	document.body.addEventListener("keydown", (e) => e.key === "Escape" && escaped++);
	press(document.activeElement, "x"); // any other key is no business of the picker's
	assert.ok(panel.querySelector(".an-promo"));
	press(document.activeElement, "Escape");
	assert.strictEqual(panel.querySelector(".an-promo"), null, "the picker is gone");
	assert.strictEqual(escaped, 0, "and the board never saw the Escape");
	assert.strictEqual(activeLine(s).moves.length, 8, "nothing was played");
	done();
});
