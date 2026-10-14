import { test, beforeEach, after } from "node:test";
import assert from "node:assert";
import { Chess } from "chess.js";
import { installDom } from "./helpers.mjs";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { namesFromNodes, variationTree } from "../src/names.js";
import { DEFAULT_SETTINGS, buildDeck, emptyProgress, markKnown, normalizeSettings, newSession, loadProgress } from "../src/train.js";
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

const learned = [];
function mount({ ui = newTrainUi(), t = tree, d = deck, settings = {}, progress = emptyProgress() } = {}) {
	progress.settings = normalizeSettings({ types: ALL, ...settings });
	const root = document.createElement("div");
	document.body.append(root); // change events only fire on connected inputs
	const draw = () => root.replaceChildren(trainPanel(ui, { tree: t, deck: d, progress, workbookId: "t1", learn: (n) => learned.push(n.name) }, draw, NOW));
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
	click(row(root, "...d6 Sicilians"), ".tr-open");
	assert.match(row(root, "Najdorf").textContent, /locked/);
	assert.doesNotMatch(row(root, "...d6 Sicilians").textContent, /locked/);
	click(row(root, "...d6 Sicilians"), ".tr-open");
	assert.ok(!row(root, "Najdorf"));
	assert.match($(root, ".tr-count").textContent, /\d+ due · \d+ new/);
	done();
});

test("outline: Known, Skip, Reset update progress and save", () => {
	const { root, progress } = mount();
	const key = v("...d6 Sicilians").key;
	click(row(root, "...d6 Sicilians"), ".tr-known");
	assert.strictEqual(progress.cards[`name|${key}`].streak, 5);
	assert.match(row(root, "...d6 Sicilians").querySelector(".tr-bar span").style.width, /^[1-9]/);
	assert.ok(store.get("ott-train:t1").includes(`name|${key}`));
	click(row(root, "...d6 Sicilians"), ".tr-skip");
	assert.ok(progress.cards[`name|${key}`].skip);
	assert.match(row(root, "...d6 Sicilians").textContent, /skipped/);
	assert.strictEqual($(row(root, "...d6 Sicilians"), ".tr-skip").textContent, "Unskip");
	click(row(root, "...d6 Sicilians"), ".tr-skip");
	assert.ok(!progress.cards[`name|${key}`].skip);
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
	click(row(m.root, "Najdorf"), ".tr-open");
	assert.ok(row(m.root, "English Attack"));
	assert.ok(!row(m.root, "...d6 Sicilians"));
	click(m.root, ".tr-whole");
	assert.strictEqual(m.ui.scope, null);
	assert.ok(row(m.root, "...d6 Sicilians"));
	done();
});

test("empty tree: hint, and Nothing due when there is nothing to drill", () => {
	const { root } = mount({ t: variationTree([], {}), d: [] });
	assert.match($(root, ".tr-empty").textContent, /Name this position/);
	assert.ok($(root, ".tr-start").disabled);
	assert.match($(root, ".tr-start").textContent, /Nothing due/);
	done();
});

test("a whole session: right answers, results, Enter for Next, summary", () => {
	const { root, ui } = mount({ settings: { sessionLength: 4, bookSide: "black" } });
	click(root, ".tr-start");
	assert.match($(root, ".tr-progress").textContent, /Question 1 of 4/);
	// a right answer on a card not yet learned comes back, so the session runs past four answers
	let n = 0;
	while ($(root, ".tr-question")) {
		solve(root, ui);
		assert.ok($(root, ".tr-result.right"), `card ${ui.card.id}`);
		if (n++ % 2) $(root, ".tr-question").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		else click(root, ".tr-next");
	}
	assert.ok(n > 4);
	const sum = $(root, ".tr-summary");
	assert.match(sum.textContent, new RegExp(`Right ${n} / ${n}`));
	assert.doesNotMatch(sum.textContent, /next review/i);
	click(root, ".tr-back");
	assert.ok($(root, ".tr-outline"));
	done();
});

test("every question draws its board at one size, asked and answered", () => {
	const board = (root) => $(root, ".tr-question svg:not(.tr-hint svg)").getAttribute("width");
	for (const type of ["name", "order", "family", "book"]) {
		const c = deck.find((x) => x.type === type);
		const m = mount({ settings: { bookSide: "black", orderHint: true } });
		m.ui.session = { queue: [c], i: 0, results: [], unlockedBefore: new Set() };
		m.ui.card = c;
		m.ui.screen = "question";
		m.draw();
		assert.strictEqual(board(m.root), "320", `${type}, asked`);
		solve(m.root, m.ui);
		assert.strictEqual(board(m.root), "320", `${type}, answered`);
	}
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
	set('[name="learnStreak"]', "value", "3");
	set('[name="tag-d6"]', "checked", true);
	assert.ok(s);
	// every control reports a change without breaking the settings
	for (const n of root.querySelectorAll(".tr-settings input, .tr-settings select")) n.dispatchEvent(new window.Event("change"));
	assert.strictEqual(progress.settings.types.family, false);
	assert.strictEqual(progress.settings.nameMode, "typed");
	assert.strictEqual(progress.settings.choices, 6);
	assert.strictEqual(progress.settings.bookSide, "both");
	assert.strictEqual(progress.settings.learnStreak, 3);
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

test("summary lists what was learned, mastered, slipped and unlocked", () => {
	const m = mount();
	const progress = m.progress;
	const root = v("...d6 Sicilians").key;
	m.ui.session = newSession(deck, tree, progress, progress.settings, {});
	markKnown(progress, root, deck, progress.settings, NOW);
	m.ui.screen = "summary";
	m.draw();
	const t = $(m.root, ".tr-summary").textContent;
	assert.match(t, /Right 0 \/ 0/);
	assert.match(t, /Learned: \.\.\.d6 Sicilians/);
	assert.match(t, /Mastered: \.\.\.d6 Sicilians/);
	assert.match(t, /Unlocked: Scheveningen, Najdorf/);
	assert.match(t, /Still locked: 1 variation(?!s)/);
	assert.doesNotMatch(t, /Next review|Back to learned/);
	m.ui.session.before.mastered.add(v("Najdorf").key);
	m.draw();
	assert.match($(m.root, ".tr-summary").textContent, /Back to learned: Najdorf/);
	done();
});

test("a stale deck never quizzes a type switched off in settings", () => {
	const { root, ui, draw } = mount({ settings: { types: { name: false, order: true, family: false, book: false } } });
	click(root, ".tr-start");
	assert.ok(ui.session.queue.length > 0 && ui.session.queue.every((c) => c.type === "order"));
	ui.screen = "outline";
	draw();
	click(row(root, "...d6 Sicilians"), ".tr-practice");
	assert.ok(ui.session.queue.every((c) => c.type === "order"));
	done();
});

test("digit keys pick a choice even with a choice button focused", () => {
	const key = v("...d6 Sicilians").key;
	const c = deck.find((x) => x.id === `name|${key}`);
	const m = mount();
	m.ui.session = { queue: [c], i: 0, results: [], unlockedBefore: new Set() };
	m.ui.card = c;
	m.ui.screen = "question";
	m.draw();
	const btns = m.root.querySelectorAll(".tr-choice");
	btns[0].dispatchEvent(new window.KeyboardEvent("keydown", { key: "2", bubbles: true }));
	assert.strictEqual(m.ui.picked, m.ui.choices[1]);
	done();
});

test("outline: a variation reached another way says so", () => {
	const { root } = mount();
	const sch = row(root, "Scheveningen");
	assert.ok(!sch || !$(sch, ".tr-also") || /also reached from/.test($(sch, ".tr-also").textContent));
	const t = variationTree([], {});
	const a = { key: "a", fen: tree.roots[0].fen, name: "A", tags: [], parent: null, also: [], children: [], level: 1, orders: [["e4"]] };
	const b = { ...a, key: "b", name: "B" };
	const c = { ...a, key: "c", name: "C", parent: a, also: [b], level: 2 };
	a.children.push(c);
	t.byKey.set("a", a).set("b", b).set("c", c);
	t.roots.push(a, b);
	const m = mount({ t, d: [], ui: Object.assign(newTrainUi(), { open: new Set(["a"]) }) });
	assert.strictEqual($(row(m.root, "C"), ".tr-also").textContent, "also reached from B");
	assert.ok(!$(row(m.root, "A"), ".tr-also"));
	done();
});

test("outline: Rename calls back with the variation, from its action chips", () => {
	const seen = [];
	const progress = emptyProgress();
	progress.settings = normalizeSettings({ types: ALL });
	const root = document.createElement("div");
	document.body.append(root);
	const ui = newTrainUi();
	root.append(trainPanel(ui, { tree, deck, progress, workbookId: "t1", rename: (n) => seen.push(n.name) }, () => {}, NOW));
	click(row(root, "...d6 Sicilians"), ".tr-acts .tr-rename");
	assert.deepStrictEqual(seen, ["...d6 Sicilians"]);
	done();
});

test("outline: the tag filter lists tagged variations and limits Start", () => {
	const m = mount();
	const sel = $(m.root, ".tr-tagfilter");
	assert.deepStrictEqual([...sel.options].map((o) => o.value), ["", "Nc3 committed", "d6", "e6"]);
	sel.value = "e6";
	sel.dispatchEvent(new window.Event("change"));
	assert.strictEqual(m.ui.tag, "e6");
	const names = [...m.root.querySelectorAll(".tr-name")].map((n) => n.textContent);
	assert.deepStrictEqual(names, ["...e6 Sicilians/Sicilian e6"]);
	click(m.root, ".tr-start");
	const below = new Set([v("...e6 Sicilians/Sicilian e6").key]);
	const add = (x) => x.children.forEach((c) => { below.add(c.key); add(c); });
	add(v("...e6 Sicilians/Sicilian e6"));
	assert.ok(m.ui.session.queue.length > 0);
	assert.ok(m.ui.session.queue.every((c) => below.has(c.vkey)));
	done();
});

test("outline: Nothing due explains Practice and Known", () => {
	const t = variationTree(lines, namesFromNodes(nodes));
	const d = buildDeck(t, lines, { ...DEFAULT_SETTINGS, types: ALL });
	const m = mount({ settings: { newPerSession: 0 }, t, d });
	assert.ok($(m.root, ".tr-start").disabled);
	assert.match($(m.root, ".tr-hint").textContent, /Nothing due now\. Use Practice/);
	done();
});

test("a wrong name says what was answered", () => {
	const key = v("...e6 Sicilians/Sicilian e6").key;
	const c = deck.find((x) => x.id === `name|${key}`);
	const m = mount({ settings: { nameMode: "typed" } });
	m.ui.session = { queue: [c], i: 0, results: [], unlockedBefore: new Set() };
	m.ui.card = c;
	m.ui.screen = "question";
	m.draw();
	$(m.root, ".tr-typed").value = "banana";
	click(m.root, ".tr-check");
	assert.match($(m.root, ".tr-result").textContent, /You answered: banana/);
	done();
});

test("name and family boards: Flip toggles, and Black readers start flipped", () => {
	const key = v("...e6 Sicilians/Sicilian e6").key;
	const first = (m) => $(m.root, "rect[data-sq]").dataset.sq;
	for (const type of ["name", "family"]) {
		const c = deck.find((x) => x.id === `${type}|${key}`);
		const start = (settings) => {
			const m = mount({ settings });
			m.ui.session = { queue: [c], i: 0, results: [], unlockedBefore: new Set() };
			m.ui.card = c;
			m.ui.screen = "question";
			m.draw();
			return m;
		};
		const white = first(start({ bookSide: "white" }));
		const m = start({ bookSide: "black" });
		assert.notStrictEqual(first(m), white, "Black readers see it flipped");
		click(m.root, ".tr-flip");
		assert.strictEqual(m.ui.flipped, true);
		assert.strictEqual(first(m), white, "flipping by hand turns it back");
	}
	done();
});

test("outline: Learn calls back with the variation", () => {
	const { root } = mount();
	learned.length = 0;
	click(row(root, "...d6 Sicilians"), ".tr-acts .tr-learn");
	assert.deepStrictEqual(learned, ["...d6 Sicilians"]);
	done();
});

test("a first card of a variation offers to learn it after answering, never before", () => {
	const { root, ui, progress } = mount({ settings: { bookSide: "black" } });
	learned.length = 0;
	click(row(root, "...d6 Sicilians"), ".tr-practice");
	assert.ok(!$(root, ".tr-question .tr-learn"), "not before the answer");
	const vk = ui.card.vkey;
	solve(root, ui);
	click(root, ".tr-result .tr-learn");
	assert.deepStrictEqual(learned, [tree.byKey.get(vk).name]);
	// another card of the same variation was seen: no hint on the next one
	const other = deck.find((c) => c.vkey === vk && c.id !== ui.card.id);
	assert.ok(progress.cards[ui.card.id].seen > 0 && other);
	click(root, ".tr-next");
	if (ui.card && ui.card.vkey === vk) {
		solve(root, ui);
		assert.ok(!$(root, ".tr-result .tr-learn"));
	}
	done();
});
