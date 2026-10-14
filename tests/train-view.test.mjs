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
	const draw = () => root.replaceChildren(trainPanel(ui, { tree: t, deck: d, progress, workbookId: "t1", learn: (n) => learned.push(n.name) }, draw));
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
	assert.match($(root, ".tr-count").textContent, /\d+ in progress · \d+ new · \d+ to re-check/);
	done();
});

test("outline: Known, Skip, Reset update progress and save", () => {
	const { root, progress } = mount();
	const key = v("...d6 Sicilians").key;
	click(row(root, "...d6 Sicilians"), ".tr-known");
	assert.strictEqual(progress.cards[`name|${key}`].streak, 5);
	assert.match(row(root, "...d6 Sicilians").querySelector(".tr-bar span").style.width, /^100%/);
	assert.strictEqual($(row(root, "...d6 Sicilians"), ".tr-state").textContent, "mastered");
	assert.ok(!$(root, ".tr-box") && !$(root, ".tr-due"));
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

test("empty tree: hint, and Nothing to train when there is nothing to drill", () => {
	const { root } = mount({ t: variationTree([], {}), d: [] });
	assert.match($(root, ".tr-empty").textContent, /Name this position/);
	assert.ok($(root, ".tr-start").disabled);
	assert.match($(root, ".tr-start").textContent, /Nothing to train/);
	done();
});

test("a whole session: right answers, results, Enter for Next, summary", () => {
	const { root, ui } = mount({ settings: { sessionLength: 4, bookSide: "black" } });
	click(root, ".tr-start");
	assert.match($(root, ".tr-progress").textContent, /Question 1 of 4/);
	// a right answer on a card not yet learned comes back, so the session runs past four answers
	let n = 0;
	const enter = () => $(root, ".tr-question").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	while ($(root, ".tr-question")) {
		if (ui.card.type === "intro") { // Got it, or Enter, passes an intro without a question
			if (ui.session.i % 2) enter();
			else click(root, ".tr-next");
			continue;
		}
		solve(root, ui);
		assert.ok($(root, ".tr-result.right"), `card ${ui.card.id}`);
		if (n++ % 2) enter();
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
	markKnown(progress, root, deck, progress.settings);
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
	assert.ok(ui.session.queue.length > 0 && ui.session.queue.every((c) => c.type === "order" || c.type === "intro"));
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
	root.append(trainPanel(ui, { tree, deck, progress, workbookId: "t1", rename: (n) => seen.push(n.name) }, () => {}));
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

test("outline: an empty queue explains Practice and Known", () => {
	const t = variationTree(lines, namesFromNodes(nodes));
	const d = buildDeck(t, lines, { ...DEFAULT_SETTINGS, types: ALL });
	const m = mount({ settings: { newPerSession: 0 }, t, d });
	assert.ok($(m.root, ".tr-start").disabled);
	assert.match($(m.root, ".tr-hint").textContent, /Nothing to train here yet: Practice drills a variation anyway, Known unlocks/);
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

test("a new variation opens with its intro: position, moves, notes, Learn it and Got it", () => {
	const t = intro();
	const { root, ui, progress } = t.m;
	assert.strictEqual(ui.card.type, "intro");
	const q = $(root, ".tr-question");
	assert.strictEqual($(q, ".tr-prompt").textContent, `New: ${tree.byKey.get(ui.card.key).name}`);
	assert.ok($(q, ".an-board, svg"), "the board");
	assert.strictEqual($(q, ".tr-moves").textContent, tree.byKey.get(ui.card.key).orders[0].join(" "));
	assert.ok(!$(q, ".tr-status") && !$(q, ".tr-choices") && !$(q, ".tr-result"));
	assert.match($(q, ".tr-progress").textContent, /^Question 1 of \d+$/);
	assert.deepStrictEqual([...q.querySelectorAll(".tr-note")].map((n) => n.textContent), ui.card.notes.map((n) => `${n.move} ${n.text}`));
	learned.length = 0;
	click(q, ".tr-learn");
	assert.deepStrictEqual(learned, [tree.byKey.get(ui.card.key).name]);
	// Got it: on to the first question, nothing scored or stored, the count unchanged
	const before = ui.card;
	click(root, ".tr-next");
	assert.notStrictEqual(ui.card.type, "intro");
	assert.strictEqual(ui.card.vkey, before.vkey);
	assert.deepStrictEqual([ui.session.results.length, Object.keys(progress.cards).length, progress.asked], [0, 0, 0]);
	assert.match($(root, ".tr-progress").textContent, /^Question 1 of \d+$/);
	// Enter does the same on the next intro
	while (ui.card.type !== "intro") {
		solve(root, ui);
		click(root, ".tr-next");
		if (!ui.card) break;
	}
	if (ui.card) {
		const at = ui.session.i;
		$(root, ".tr-question").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		assert.strictEqual(ui.session.i, at + 1);
	}
	done();
});

// a session started from the outline, at its first (intro) card
function intro(settings = {}) {
	const m = mount({ settings: { bookSide: "black", sessionLength: 0, ...settings } });
	m.ui.screen = "outline";
	click(m.root, ".tr-start");
	return { m };
}

test("question numbers skip the intros", () => {
	const { m } = intro();
	const nonIntro = m.ui.session.queue.filter((c) => c.type !== "intro").length;
	assert.ok(m.ui.session.queue.length > nonIntro);
	const seen = [];
	while (m.ui.card) {
		if (m.ui.card.type === "intro") click(m.root, ".tr-next");
		else {
			seen.push($(m.root, ".tr-progress").textContent);
			solve(m.root, m.ui);
			assert.match($(m.root, ".tr-progress").textContent, new RegExp(`^Question ${seen.length} of`), "the same number after answering");
			click(m.root, ".tr-next");
		}
		if (m.ui.screen !== "question") break;
	}
	assert.strictEqual(seen[0], `Question 1 of ${nonIntro}`);
	assert.deepStrictEqual(seen.slice(0, 3).map((x) => +x.match(/\d+/)[0]), [1, 2, 3]);
	done();
});

test("with the setting off a session has no intros", () => {
	const d = buildDeck(tree, lines, { ...DEFAULT_SETTINGS, introNew: false, types: ALL });
	const m = mount({ d, settings: { introNew: false } });
	click(m.root, ".tr-start");
	assert.ok(m.ui.session.queue.every((c) => c.type !== "intro") && m.ui.card.type !== "intro");
	done();
});

test("notes follow every answer: name and order show the notes on the way to the variation", () => {
	const pgn = `1. e4 {King pawn.} c5 2. Nf3 {[%name "Open"] Develops [the knight](x).} d6 *`;
	const { nodes: ns } = parsePgn(pgn);
	const ls = collectLines(ns);
	const t = variationTree(ls, namesFromNodes(ns));
	const d = buildDeck(t, ls, { ...DEFAULT_SETTINGS, introNew: false, types: ALL });
	const m = mount({ t, d, settings: { introNew: false, types: { name: true, order: false, family: false, book: false } } });
	click(m.root, ".tr-start");
	solveIn(m, t);
	const notes = [...m.root.querySelectorAll(".tr-result .tr-note")].map((n) => n.textContent);
	assert.strictEqual(notes.length, 2);
	assert.strictEqual(notes[0], "1.e4 King pawn.");
	assert.match(notes[1], /^2\.Nf3 Develops /);
	assert.ok(!$(m.root, ".tr-result .tr-learn"), "no learn-it chip after answering any more");
	// the notes come after the detail line
	const kids = [...$(m.root, ".tr-result").children].map((c) => c.className || c.tagName);
	assert.ok(kids.indexOf("tr-note") > kids.indexOf("P"));
	done();
});
function solveIn(m, t) {
	const c = m.ui.card;
	click(m.root, [...m.root.querySelectorAll(".tr-choice")].find((b) => b.textContent === t.byKey.get(c.key).name) || ".tr-choice");
}

test("a right answer too soon says so and does not count", () => {
	const key = v("Najdorf").key;
	const c = deck.find((x) => x.id === `name|${key}`);
	const m = mount();
	m.progress.asked = 5;
	m.progress.cards[c.id] = { streak: 2, seen: 4, skip: false };
	sessionOf(m, c);
	solve(m.root, m.ui);
	assert.strictEqual($(m.root, ".tr-result strong").textContent, "Right");
	assert.match($(m.root, ".tr-result .tr-soon").textContent, /^Too soon to count towards mastery: it counts when other questions come in between\.$/);
	assert.ok($(m.root, ".tr-soon").title);
	assert.strictEqual(m.progress.cards[c.id].streak, 2);
	m.progress.asked = 40;
	sessionOf(m, c);
	solve(m.root, m.ui);
	assert.ok(!$(m.root, ".tr-soon"));
	assert.strictEqual(m.progress.cards[c.id].streak, 3);
	done();
});

test("the summary lists tricky questions with Learn it; the outline badges them", () => {
	const root = v("...d6 Sicilians").key;
	const a = deck.find((x) => x.id === `name|${root}`);
	const b = deck.find((x) => x.id === `order|${root}`);
	const book = deck.find((x) => x.type === "book");
	const m = mount();
	learned.length = 0;
	m.progress.cards[a.id] = { streak: 0, seen: 1, skip: false, tricky: true };
	m.ui.session = { queue: [], i: 0, results: [], unlockedBefore: new Set(), practice: false, newLeft: 0, pool: [], intros: new Map(), introduced: new Set(), tricky: new Set([a.id, b.id, book.id]), before: { learned: new Set(), mastered: new Set() } };
	m.ui.screen = "summary";
	m.draw();
	const text = [...m.root.querySelectorAll(".tr-summary p")].find((p) => p.textContent.startsWith("Tricky:"));
	assert.ok(text.textContent.startsWith("Tricky: ...d6 Sicilians (name), ...d6 Sicilians (order), "));
	assert.match(text.textContent, new RegExp(`${book.vkey ? tree.byKey.get(book.vkey).name : "Book"} \\(book move\\)`));
	assert.ok(text.title);
	const chips = [...m.root.querySelectorAll(".tr-summary .tr-learn")];
	assert.strictEqual(chips.length, new Set([root, book.vkey].filter((k) => k !== "")).size, "one per variation");
	chips[0].click();
	assert.deepStrictEqual(learned, ["...d6 Sicilians"]);
	m.ui.screen = "outline";
	m.draw();
	const badge = (name) => [...row(m.root, name).querySelectorAll(".tr-badge")].find((x) => x.textContent === "tricky");
	assert.ok(badge("...d6 Sicilians") && /missed three times/i.test(badge("...d6 Sicilians").title));
	assert.ok(!badge("...e6 Sicilians/Sicilian e6"));
	done();
});

test("the question status says how many variations learning it would unlock, until it is learned", () => {
	const root = v("...d6 Sicilians").key;
	const c = deck.find((x) => x.id === `name|${root}`);
	const m = mount();
	sessionOf(m, c);
	assert.match($(m.root, ".tr-status").textContent, / · learn it to unlock 2 variations$/);
	sessionOf(m, deck.find((x) => x.id === `name|${v("...e6 Sicilians/Sicilian e6").key}`));
	assert.match($(m.root, ".tr-status").textContent, / · learn it to unlock 1 variation$/, "singular");
	sessionOf(m, c);
	for (const x of deck.filter((y) => y.vkey === root && y.type !== "book" && y.type !== "intro")) m.progress.cards[x.id] = { streak: 2, seen: 1, skip: false };
	m.draw();
	assert.doesNotMatch($(m.root, ".tr-status").textContent, /unlock/);
	const e6 = deck.find((x) => x.id === `name|${v("English Attack").key}`);
	sessionOf(m, e6);
	assert.doesNotMatch($(m.root, ".tr-status").textContent, /unlock/, "no children");
	done();
});

const sessionOf = (m, c, extra = {}) => {
	m.ui.session = { queue: [c], i: 0, results: [], unlockedBefore: new Set(), practice: false, newLeft: 0, pool: [], intros: new Map(), introduced: new Set(), tricky: new Set(), ...extra };
	m.ui.card = c;
	m.ui.screen = "question";
	Object.assign(m.ui, { answered: null, played: [], choices: null });
	m.draw();
};

test("question status: level and streak towards learned, then mastered; never the name", () => {
	const key = v("Najdorf").key;
	const c = deck.find((x) => x.id === `name|${key}`);
	const m = mount();
	const status = () => $(m.root, ".tr-status").textContent;
	sessionOf(m, c);
	assert.strictEqual(status(), "Level 2 · 0 of 2 right to learn · learn it to unlock 1 variation");
	assert.doesNotMatch(status(), /Najdorf/);
	assert.match($(m.root, ".tr-status").title, /2 times in a row to learn it.*5 times to master/);
	m.progress.cards[c.id] = { streak: 1, seen: NOW, skip: false };
	m.draw();
	assert.match(status(), /^Level 2 · 1 of 2 right to learn/);
	// the variation's other cards are learned too: nothing left to unlock by learning it
	for (const x of deck.filter((y) => y.vkey === key && y.type !== "book" && y.type !== "intro")) m.progress.cards[x.id] = { streak: 2, seen: NOW, skip: false };
	m.draw();
	assert.strictEqual(status(), "Level 2 · learned · 2 of 5 right to master");
	m.progress.cards[c.id].streak = 5;
	m.draw();
	assert.strictEqual(status(), "Level 2 · mastered");
	// a book card outside any named variation has no level
	const b = { ...deck.find((x) => x.type === "book"), vkey: "", level: 0 };
	sessionOf(m, b);
	assert.strictEqual(status(), "0 of 2 right to learn");
	done();
});

test("an answer that unlocks variations says so and the new questions join the session", () => {
	const root = v("...d6 Sicilians").key;
	const name = deck.find((x) => x.id === `name|${root}`);
	const m = mount({ settings: { learnStreak: 1, types: { name: true, order: true, family: false, book: false } } });
	m.progress.cards[`order|${root}`] = { streak: 1, seen: NOW, skip: false };
	sessionOf(m, name, { pool: deck.filter((c) => c.type === "name" || c.type === "order"), newLeft: 6 });
	assert.ok(!$(m.root, ".tr-unlocked"));
	solve(m.root, m.ui);
	assert.match($(m.root, ".tr-result .tr-unlocked").textContent, /^Unlocked: .*Najdorf/);
	assert.ok(m.ui.session.queue.some((c) => c.id === `name|${v("Najdorf").key}`));
	// a right answer that unlocks nothing says nothing
	const e6 = deck.find((x) => x.id === `order|${v("...e6 Sicilians/Sicilian e6").key}`);
	sessionOf(m, e6);
	solve(m.root, m.ui);
	assert.ok(!$(m.root, ".tr-unlocked"));
	done();
});

test("outline: overview, state, bar and tooltips", () => {
	const m = mount();
	const root = v("...d6 Sicilians").key;
	assert.strictEqual($(m.root, ".tr-overview").textContent, "Learned 0 of 5 variations · 0 mastered · open to level 1");
	for (const c of deck.filter((x) => x.vkey === root && x.type !== "book")) m.progress.cards[c.id] = { streak: 2, seen: NOW, skip: false };
	m.draw();
	const r = row(m.root, "...d6 Sicilians");
	assert.strictEqual($(r, ".tr-state").textContent, "learned");
	assert.strictEqual($(r, ".tr-bar span").style.width, "40%");
	assert.strictEqual($(r, ".tr-bar").title, "0 of 2 questions mastered");
	assert.match($(m.root, ".tr-overview").textContent, /^Learned 1 of 5 variations · 0 mastered · open to level 2$/);
	click(r, ".tr-known");
	assert.strictEqual($(row(m.root, "...d6 Sicilians"), ".tr-state").textContent, "mastered");
	assert.match($(m.root, ".tr-overview").textContent, /1 mastered/);
	assert.ok($(row(m.root, "...d6 Sicilians"), ".tr-known").title.includes("unlocks what's below"));
	// every control in the outline explains itself
	click(row(m.root, "...d6 Sicilians"), ".tr-open");
	for (const n of m.root.querySelectorAll("button, select, .tr-count, .tr-overview, .tr-level, .tr-bar, .tr-state, .tr-badge")) {
		assert.ok(n.title, `no tooltip on ${n.className} ${n.textContent}`);
	}
	done();
});

test("settings: grouped, every field has a tooltip with its default, streaks clamp", () => {
	const { root, progress } = mount();
	click(root, ".tr-settings-open");
	const legends = [...root.querySelectorAll(".tr-group > legend")].map((l) => l.textContent);
	assert.deepStrictEqual(legends, ["Questions", "Name questions", "Order questions", "Family questions", "Book questions", "Progress", "Sessions"]);
	const labels = [...root.querySelectorAll(".tr-field > span")].map((l) => l.textContent);
	for (const l of ["Name", "Order", "Family", "Book", "Answer by", "Choices", "Show the moves", "Show the target position", "Show the name", "You play", "Accept", "Right in a row to learn", "Right in a row to master", "Show a new variation first", "New questions per session", "Re-checks per session", "Questions per session (0: no limit)"]) {
		assert.ok(labels.includes(l), l);
	}
	for (const f of root.querySelectorAll(".tr-field")) assert.ok(f.title, `no tooltip on ${f.textContent}`);
	assert.ok($(root, ".tr-subgroup").title);
	assert.match($(root, '[name="learnStreak"]').closest("label").title, /Default 2\./);
	assert.match($(root, '[name="masterStreak"]').closest("label").title, /Default 5\./);
	assert.ok(!$(root, '[name="masteryBox"]') && !$(root, '[name="interval-1"]'));
	const set = (name, val) => {
		const n = $(root, `[name="${name}"]`);
		n.value = val;
		n.dispatchEvent(new window.Event("change"));
	};
	set("learnStreak", "7");
	assert.strictEqual(progress.settings.learnStreak, 7);
	assert.strictEqual(progress.settings.masterStreak, 7, "master is raised to learn");
	set("masterStreak", "9");
	set("reviews", "4");
	set("newPerSession", "6");
	set("sessionLength", "0");
	assert.deepStrictEqual(
		[progress.settings.masterStreak, progress.settings.reviews, progress.settings.newPerSession, progress.settings.sessionLength],
		[9, 4, 6, 0],
	);
	set("newPerSession", "99");
	assert.strictEqual(progress.settings.newPerSession, DEFAULT_SETTINGS.newPerSession, "out of range: the default");
	assert.strictEqual(loadProgress("t1").settings.masterStreak, 9);
	const intro = $(root, '[name="introNew"]');
	assert.ok(intro.checked && /Default on\./.test(intro.closest("label").title));
	intro.checked = false;
	intro.dispatchEvent(new window.Event("change"));
	assert.strictEqual(progress.settings.introNew, false);
	assert.strictEqual(loadProgress("t1").settings.introNew, false);
	done();
});
