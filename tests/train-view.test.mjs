import { test, beforeEach, after } from "node:test";
import assert from "node:assert";
import { Chess } from "chess.js";
import { installDom } from "./helpers.mjs";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { namesFromNodes, variationTree } from "../src/names.js";
import { DEFAULT_SETTINGS, buildDeck, emptyProgress, normalizeSettings, newSession, loadProgress } from "../src/train.js";
import { newTrainUi, trainPanel } from "../src/train-view.js";

const PGN = `1. e4 c5 2. Nf3 d6 {[%name "...d6 Sicilians"]} (2... e6 {[%name "...e6 Sicilians/Sicilian e6"] [%tags "e6"]} 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 d6 {[%name "Scheveningen"]}) 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 e6 {[%name "Scheveningen"]} (5... a6 {[%name "Najdorf"] [%tags "d6; Nc3 committed"]} 6. Be3 {[%name "English Attack"]}) *`;
const { nodes } = parsePgn(PGN);
const lines = collectLines(nodes);
const tree = variationTree(lines, namesFromNodes(nodes));
const ALL = { name: true, order: true, family: true, book: true };
const deck = buildDeck(tree, lines, { ...DEFAULT_SETTINGS, types: ALL });
const v = (n) => [...tree.byKey.values()].find((x) => x.name === n);
const NOW = 1e12;

let store;
let done;
beforeEach(() => {
	store = new Map();
	global.localStorage = {
		getItem: (k) => (store.has(k) ? store.get(k) : null),
		setItem: (k, x) => store.set(k, String(x)),
		removeItem: (k) => store.delete(k),
	};
	done = installDom();
});
after(() => delete global.localStorage);

function mount({ ui = newTrainUi(), t = tree, d = deck, l = lines, settings = {}, progress = emptyProgress() } = {}) {
	progress.settings = normalizeSettings({ types: ALL, ...settings });
	const root = document.createElement("div");
	document.body.append(root); // change events only fire on connected inputs
	const draw = () => root.replaceChildren(trainPanel(ui, { tree: t, deck: d, progress, lines: l, workbookId: "t1" }, draw, NOW));
	draw();
	return { root, ui, progress, draw };
}
const $ = (root, sel) => root.querySelector(sel);
const click = (root, sel) => {
	const n = typeof sel === "string" ? $(root, sel) : sel;
	assert.ok(n, `no ${sel}`);
	n.click();
};
const row = (root, name) => [...root.querySelectorAll(".tr-var")].find((r) => $(r, ".tr-name").textContent === name);
const fire = (board, sq, type) =>
	board.querySelector(`rect[data-sq="${sq}"]`).dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true }));
const move = (root, chess, san) => {
	const m = chess.move(san);
	fire($(root, ".an-board"), m.from, "mousedown");
	fire($(root, ".an-board"), m.to, "mouseup");
};

// answers the current card correctly
function solve(root, ui) {
	const c = ui.card;
	if (c.type === "name") click(root, [...root.querySelectorAll(".tr-choice")].find((b) => b.textContent === tree.byKey.get(c.key).name));
	if (c.type === "order") {
		const chess = new Chess();
		for (const san of tree.byKey.get(c.key).orders[0]) move(root, chess, san);
	}
	if (c.type === "family") {
		for (const t of tree.byKey.get(c.key).tags) click(root, `.tr-tag input[value="${t}"]`);
		click(root, ".tr-check");
	}
	if (c.type === "book") {
		const chess = new Chess();
		c.sans.forEach((s) => chess.move(s));
		move(root, chess, c.main);
	}
}

test("outline: roots listed, children behind a toggle, locked badge", () => {
	const { root } = mount();
	assert.ok(row(root, "...d6 Sicilians") && row(root, "...e6 Sicilians/Sicilian e6"));
	assert.ok(!row(root, "Najdorf"));
	click(row(root, "...d6 Sicilians"), ".tr-toggle");
	assert.match(row(root, "Najdorf").textContent, /locked/);
	assert.doesNotMatch(row(root, "...d6 Sicilians").textContent, /locked/);
	click(row(root, "...d6 Sicilians"), ".tr-toggle");
	assert.ok(!row(root, "Najdorf"));
	assert.match($(root, ".tr-count").textContent, /\d+ due · \d+ new/);
	done();
});

test("outline: Known, Skip, Reset, Box update progress and save", () => {
	const { root, progress } = mount();
	const key = v("...d6 Sicilians").key;
	click(row(root, "...d6 Sicilians"), ".tr-known");
	assert.strictEqual(progress.cards[`name|${key}`].box, 3);
	assert.match(row(root, "...d6 Sicilians").querySelector(".tr-bar span").style.width, /^[1-9]/);
	assert.ok(store.get("ott-train:t1").includes(`name|${key}`));
	click(row(root, "...d6 Sicilians"), ".tr-skip");
	assert.ok(progress.cards[`name|${key}`].skip);
	assert.match(row(root, "...d6 Sicilians").textContent, /skipped/);
	assert.strictEqual($(row(root, "...d6 Sicilians"), ".tr-skip").textContent, "Unskip");
	click(row(root, "...d6 Sicilians"), ".tr-skip");
	assert.ok(!progress.cards[`name|${key}`].skip);
	const sel = $(row(root, "...d6 Sicilians"), ".tr-box");
	sel.value = "4";
	sel.dispatchEvent(new window.Event("change"));
	assert.strictEqual(progress.cards[`name|${key}`].box, 4);
	const asked = [];
	globalThis.confirm = (m) => !asked.push(m) && false;
	click(row(root, "...d6 Sicilians"), ".tr-reset");
	assert.ok(progress.cards[`name|${key}`], "declined: kept");
	globalThis.confirm = () => true;
	click(row(root, "...d6 Sicilians"), ".tr-reset");
	delete globalThis.confirm;
	assert.strictEqual(asked.length, 1);
	assert.ok(!progress.cards[`name|${key}`]);
	done();
});

test("outline: Practice starts a scoped question screen, scope shows the subtree only", () => {
	const m = mount();
	click(row(m.root, "...d6 Sicilians"), ".tr-practice");
	assert.ok($(m.root, ".tr-question"));
	assert.strictEqual(m.ui.card.vkey, v("...d6 Sicilians").key);
	m.ui.screen = "outline";
	m.ui.scope = v("Najdorf").key;
	m.draw();
	assert.ok(row(m.root, "Najdorf") && row(m.root, "English Attack") === undefined);
	click(row(m.root, "Najdorf"), ".tr-toggle");
	assert.ok(row(m.root, "English Attack"));
	assert.ok(!row(m.root, "...d6 Sicilians"));
	click(m.root, ".tr-whole");
	assert.strictEqual(m.ui.scope, null);
	assert.ok(row(m.root, "...d6 Sicilians"));
	done();
});

test("empty tree: hint, and Nothing due when there is nothing to drill", () => {
	const { root } = mount({ t: variationTree([], {}), d: [], l: [] });
	assert.match($(root, ".tr-empty").textContent, /Name this position/);
	assert.ok($(root, ".tr-start").disabled);
	assert.match($(root, ".tr-start").textContent, /Nothing due/);
	done();
});

test("a whole session: right answers, results, Enter for Next, summary", () => {
	const { root, ui } = mount({ settings: { sessionLength: 4, bookSide: "black" } });
	click(root, ".tr-start");
	assert.match($(root, ".tr-progress").textContent, /Question 1 of 4/);
	for (let i = 0; i < 4; i++) {
		assert.ok($(root, ".tr-question"));
		solve(root, ui);
		assert.ok($(root, ".tr-result.right"), `card ${ui.card.id}`);
		if (i % 2) $(root, ".tr-question").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		else click(root, ".tr-next");
	}
	const sum = $(root, ".tr-summary");
	assert.match(sum.textContent, /Right 4 \/ 4/);
	assert.match(sum.textContent, /next review/i);
	click(root, ".tr-back");
	assert.ok($(root, ".tr-outline"));
	done();
});

test("name question: wrong choice, keys 1-9, typed mode accepts an alias", () => {
	const key = v("...e6 Sicilians/Sicilian e6").key;
	const c = deck.find((x) => x.id === `name|${key}`);
	const start = (settings) => {
		const m = mount({ settings });
		m.ui.session = { queue: [c], i: 0, results: [], unlockedBefore: new Set() };
		m.ui.card = c;
		m.ui.screen = "question";
		m.draw();
		return m;
	};
	let m = start({});
	const choices = [...m.root.querySelectorAll(".tr-choice")];
	assert.strictEqual(choices.length, 4);
	m.root.firstChild.dispatchEvent(new window.KeyboardEvent("keydown", { key: "1", bubbles: true }));
	assert.ok($(m.root, ".tr-result"));
	assert.match($(m.root, ".tr-result").textContent, /Sicilian e6/);
	m = start({ nameMode: "typed", showMoves: true });
	assert.match($(m.root, ".tr-moves").textContent, /e4/);
	$(m.root, ".tr-typed").value = "sicilian E6";
	click(m.root, ".tr-check");
	assert.ok($(m.root, ".tr-result.right"));
	m = start({ nameMode: "typed" });
	$(m.root, ".tr-typed").value = "nope";
	$(m.root, ".tr-typed").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	assert.ok($(m.root, ".tr-result.wrong"));
	done();
});

test("order question: a wrong first move, then a right run listing other orders", () => {
	const key = v("Scheveningen").key;
	const c = deck.find((x) => x.id === `order|${key}`);
	const m = mount({ settings: { orderHint: true } });
	const setup = () => {
		m.ui.session = { queue: [c], i: 0, results: [], unlockedBefore: new Set() };
		m.ui.card = c;
		m.ui.screen = "question";
		m.ui.played = [];
		m.ui.answered = null;
		m.draw();
	};
	setup();
	assert.match($(m.root, ".tr-prompt").textContent, /Play the moves to the Scheveningen/);
	assert.ok($(m.root, ".tr-hint svg"));
	move(m.root, new Chess(), "d4");
	assert.ok($(m.root, ".tr-result.wrong"));
	setup();
	const chess = new Chess();
	for (const san of tree.byKey.get(key).orders[0]) move(m.root, chess, san);
	assert.ok($(m.root, ".tr-result.right"));
	assert.match($(m.root, ".tr-result").textContent, /Also reached by/);
	done();
});

test("family question: tick the tags; a group makes it radio buttons", () => {
	const key = v("Najdorf").key;
	const c = deck.find((x) => x.id === `family|${key}`);
	const start = (settings) => {
		const m = mount({ settings });
		m.ui.session = { queue: [c], i: 0, results: [], unlockedBefore: new Set() };
		m.ui.card = c;
		m.ui.screen = "question";
		m.draw();
		return m;
	};
	let m = start({});
	assert.match($(m.root, ".tr-prompt").textContent, /Najdorf/);
	click(m.root, '.tr-tag input[value="d6"]');
	click(m.root, ".tr-check");
	assert.ok($(m.root, ".tr-result.wrong"));
	m = start({ familyShowName: false, familyGroup: ["d6", "e6"] });
	assert.doesNotMatch($(m.root, ".tr-prompt").textContent, /Najdorf/);
	assert.strictEqual(m.root.querySelectorAll('.tr-tag input[type="radio"]').length, 2);
	click(m.root, '.tr-tag input[value="d6"]');
	click(m.root, ".tr-check");
	assert.ok($(m.root, ".tr-result.right"));
	m = start({});
	click(m.root, '.tr-tag input[value="d6"]');
	click(m.root, '.tr-tag input[value="d6"]');
	assert.deepStrictEqual(m.ui.ticked, []);
	done();
});

test("book question: a wrong move shows the book moves and the note", () => {
	const base = deck.find((x) => x.type === "book" && x.moves.length === 2);
	const c = { ...base, notes: { a6: "Najdorf idea." } };
	const m = mount({ settings: { bookSide: "black" } });
	m.ui.session = { queue: [c], i: 0, results: [], unlockedBefore: new Set() };
	m.ui.card = c;
	m.ui.screen = "question";
	m.draw();
	assert.match($(m.root, ".tr-prompt").textContent, /find the move/);
	const chess = new Chess();
	c.sans.forEach((s) => chess.move(s));
	move(m.root, chess, "g6");
	const r = $(m.root, ".tr-result.wrong");
	assert.match(r.textContent, /e6/);
	assert.match(r.textContent, /a6: Najdorf idea\./);
	click(m.root, ".tr-flip");
	assert.strictEqual(m.ui.flipped, true);
	done();
});

test("settings: changes persist to localStorage; Done returns", () => {
	const { root, progress } = mount();
	click(root, ".tr-settings-open");
	const s = $(root, ".tr-settings");
	const set = (sel, prop, val, ev = "change") => {
		const n = $(root, sel);
		n[prop] = val;
		n.dispatchEvent(new window.Event(ev));
	};
	set('[name="type-family"]', "checked", false);
	set('[name="nameMode"]', "value", "typed");
	set('[name="choices"]', "value", "6");
	set('[name="showMoves"]', "checked", true);
	set('[name="bookSide"]', "value", "both");
	set('[name="interval-1"]', "value", "2");
	set('[name="tag-d6"]', "checked", true);
	assert.ok(s);
	// every control reports a change without breaking the settings
	for (const n of root.querySelectorAll(".tr-settings input, .tr-settings select")) n.dispatchEvent(new window.Event("change"));
	assert.strictEqual(progress.settings.types.family, false);
	assert.strictEqual(progress.settings.nameMode, "typed");
	assert.strictEqual(progress.settings.choices, 6);
	assert.strictEqual(progress.settings.bookSide, "both");
	assert.strictEqual(progress.settings.intervals[1], 2);
	assert.deepStrictEqual(progress.settings.familyGroup, ["d6"]);
	set('[name="tag-d6"]', "checked", false);
	assert.deepStrictEqual(progress.settings.familyGroup, []);
	const saved = loadProgress("t1");
	assert.strictEqual(saved.settings.choices, 6);
	assert.strictEqual(saved.settings.showMoves, true);
	click(root, ".tr-settings-done");
	assert.ok($(root, ".tr-outline"));
	done();
});

test("summary lists moved cards and says when the next review is", () => {
	const m = mount();
	const progress = m.progress;
	const c = deck.find((x) => x.id === `name|${v("...d6 Sicilians").key}`);
	m.ui.session = newSession(deck, tree, progress, progress.settings, { now: NOW });
	m.ui.session.results.push({ id: c.id, right: true, from: 0, to: 1 }, { id: deck.find((x) => x.type === "book").id, right: false, from: 2, to: 1 });
	progress.cards[c.id] = { box: 2, seen: NOW, skip: false };
	m.ui.screen = "summary";
	m.draw();
	const t = $(m.root, ".tr-summary").textContent;
	assert.match(t, /Right 1 \/ 2/);
	assert.match(t, /\.\.\.d6 Sicilians \(name\)/);
	assert.match(t, /in 3 days/);
	progress.cards = {};
	m.draw();
	assert.match($(m.root, ".tr-summary").textContent, /nothing scheduled/);
	done();
});
