import { test, beforeEach, after } from "node:test";
import assert from "node:assert";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { namesFromNodes, variationTree } from "../src/names.js";
import {
	DEFAULT_SETTINGS, buildDeck, normalizeSettings, emptyProgress, loadProgress, saveProgress, moveProgress,
	learnedCard, masteredCard, isLearned, isMastered, unlockedKeys, bookOpen, newSession, current, answer, sessionSummary,
	markKnown, skip, resetVar, checkName, nameChoices, orderStep, checkFamily, checkBook, allTags,
} from "../src/train.js";

const PGN = `1. e4 c5 2. Nf3 d6 {[%name "...d6 Sicilians"]} (2... e6 {[%name "...e6 Sicilians"] [%tags "e6"]} 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 d6 {[%name "Scheveningen"] Small centre.}) 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 e6 {[%name "Scheveningen"]} (5... a6 {[%name "Najdorf"] [%tags "d6; Nc3 committed"]} 6. Be3 {[%name "English Attack"]}) *`;
const { nodes } = parsePgn(PGN);
const lines = collectLines(nodes);
const tree = variationTree(lines, namesFromNodes(nodes));
const S = { ...DEFAULT_SETTINGS, types: { name: true, order: true, family: true, book: true } };
const deck = buildDeck(tree, lines, S);
const v = (n) => [...tree.byKey.values()].find((x) => x.name === n);
const ownOf = (vkey) => deck.filter((c) => c.vkey === vkey && c.type !== "book");
const ids = (d, t) => d.filter((c) => c.type === t).map((c) => c.id);
const NOW = 1e12;

let store;
beforeEach(() => {
	store = new Map();
	global.localStorage = {
		getItem: (k) => (store.has(k) ? store.get(k) : null),
		setItem: (k, x) => store.set(k, String(x)),
		removeItem: (k) => store.delete(k),
	};
});
after(() => delete global.localStorage);

test("deck: name/order per node, family for tagged, black-to-move book cards from a named position", () => {
	assert.strictEqual(ids(deck, "name").length, 5);
	assert.strictEqual(ids(deck, "order").length, 5);
	assert.deepStrictEqual(ids(deck, "family").length, 2);
	const off = buildDeck(tree, lines, DEFAULT_SETTINGS);
	assert.strictEqual(ids(off, "family").length, 0);
	const book = deck.filter((c) => c.type === "book");
	assert.ok(book.length > 0);
	for (const c of book) assert.strictEqual(c.sans.length % 2, 1); // black to move
	assert.ok(book.every((c) => tree.byKey.has(c.vkey)));
	// after 4...Nf6 5.Nc3 the mainline plays e6, the variation a6/d6 ... shared key merges
	const c5 = book.find((c) => c.sans.join(" ") === "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3".replace("Nf3 d6", "Nf3 d6"));
	assert.deepStrictEqual(c5.moves, ["e6", "a6"]);
	assert.strictEqual(c5.main, "e6");
	assert.strictEqual(c5.vkey, v("...d6 Sicilians").key);
	assert.strictEqual(c5.level, 1);
	// bookSide both / white
	assert.ok(buildDeck(tree, lines, { ...S, bookSide: "both" }).filter((c) => c.type === "book").length > book.length);
	assert.ok(buildDeck(tree, lines, { ...S, bookSide: "white" }).filter((c) => c.type === "book").every((c) => c.sans.length % 2 === 0));
	// notes: the comment on a move is kept under its SAN
	const withNote = [{ moves: [{ san: "e4", ply: 1 }, { san: "e5", ply: 2 }], comments: [{ ply: 2, text: "Open game." }], isMain: true }];
	const t0 = variationTree(withNote, {});
	const d0 = buildDeck(t0, withNote, { ...S, bookSide: "both" });
	assert.deepStrictEqual(d0.map((c) => [c.vkey, c.moves, c.notes]), [["", ["e4"], {}], ["", ["e5"], { e5: "Open game." }]]);
	assert.strictEqual(d0[0].main, "e4");
});

test("learned and mastered read the streak against the two settings", () => {
	const rec = (streak) => ({ streak, seen: NOW, skip: false });
	assert.ok(!learnedCard(rec(1), S) && learnedCard(rec(2), S));
	assert.ok(!masteredCard(rec(4), S) && masteredCard(rec(5), S));
	assert.ok(!learnedCard(undefined, S) && !masteredCard(undefined, S));
	assert.ok(learnedCard(rec(1), { ...S, learnStreak: 1 }));
});

test("unlocking: roots, then children of a learned node, then via also", () => {
	let p = emptyProgress();
	const names = (p) => [...unlockedKeys(tree, deck, p, S)].map((k) => tree.byKey.get(k).name).sort();
	assert.deepStrictEqual(names(p), ["...d6 Sicilians", "...e6 Sicilians"]);
	markKnown(p, v("...d6 Sicilians").key, deck, S, NOW);
	assert.deepStrictEqual(names(p), ["...d6 Sicilians", "...e6 Sicilians", "Najdorf", "Scheveningen"]);
	assert.ok(isMastered(v("...d6 Sicilians").key, deck, p, S));
	assert.ok(bookOpen(v("...d6 Sicilians").key, deck, p, S));
	assert.ok(!bookOpen(v("Najdorf").key, deck, p, S));
	assert.ok(bookOpen("", deck, p, S));
	p = emptyProgress();
	markKnown(p, v("...e6 Sicilians").key, deck, S, NOW);
	assert.ok(names(p).includes("Scheveningen"));
	assert.ok(!names(p).includes("Najdorf"));
	// learned is enough to unlock; mastery is not needed
	p = emptyProgress();
	const root = v("...d6 Sicilians");
	for (const c of ownOf(root.key)) p.cards[c.id] = { streak: 2, seen: NOW, skip: false };
	assert.ok(isLearned(root.key, deck, p, S) && !isMastered(root.key, deck, p, S));
	assert.ok(names(p).includes("Najdorf") && bookOpen(root.key, deck, p, S));
	p.cards[ownOf(root.key)[0].id].streak = 1;
	assert.ok(!isLearned(root.key, deck, p, S) && !names(p).includes("Najdorf"));
	// a record on a child's card unlocks it too
	p = emptyProgress();
	p.cards[`name|${v("Najdorf").key}`] = { streak: 0, seen: NOW, skip: false };
	assert.ok(names(p).includes("Najdorf"));
	// a variation with no non-book cards counts as learned and mastered
	assert.ok(isLearned("nowhere", deck, emptyProgress(), S) && isMastered("nowhere", deck, emptyProgress(), S));
});

test("newSession: in progress, then new, then re-checks, with their limits", () => {
	const p = emptyProgress();
	const root = v("...d6 Sicilians").key;
	const e6 = v("...e6 Sicilians").key;
	const rec = (streak, seen) => ({ streak, seen, skip: false });
	p.cards[`name|${root}`] = rec(1, NOW - 5);
	p.cards[`order|${root}`] = rec(0, NOW - 9);
	p.cards[`name|${e6}`] = rec(5, NOW - 1);
	p.cards[`family|${e6}`] = rec(5, NOW - 2);
	const fresh = { ...S, newPerSession: 3, sessionLength: 0 };
	let s = newSession(deck, tree, p, fresh, {});
	assert.deepStrictEqual(s.queue.slice(0, 2).map((c) => c.id), [`order|${root}`, `name|${root}`], "in progress, least recently asked first");
	assert.deepStrictEqual(s.queue[2].id, `order|${e6}`, "new, shallowest first");
	assert.deepStrictEqual(s.queue.slice(3).map((c) => c.id), [`family|${e6}`, `name|${e6}`], "re-checks, longest ago first");
	assert.strictEqual(s.queue.length, 5);
	assert.strictEqual(s.newLeft, 2);
	assert.strictEqual(current(s).id, `order|${root}`);
	assert.strictEqual(newSession(deck, tree, p, { ...fresh, reviews: 1 }, {}).queue.length, 4);
	assert.strictEqual(newSession(deck, tree, p, { ...fresh, reviews: 0, newPerSession: 0 }, {}).queue.length, 2);
	s = newSession(deck, tree, p, { ...fresh, sessionLength: 4 }, {});
	assert.strictEqual(s.queue.length, 4);
	assert.strictEqual(newSession(deck, tree, p, { ...fresh, newPerSession: 99 }, {}).newLeft, 98);
});

test("newSession: scope, practice, book cards, skipped cards", () => {
	const p = emptyProgress();
	const root = v("...d6 Sicilians").key;
	const fresh = { ...S, newPerSession: 3, sessionLength: 0 };
	// scope: Najdorf's subtree only (still locked); practice ignores the lock
	const naj = v("Najdorf").key;
	assert.strictEqual(newSession(deck, tree, p, fresh, { scope: naj }).queue.length, 0);
	const pr = newSession(deck, tree, p, { ...S, sessionLength: 0 }, { scope: naj, practice: true });
	assert.deepStrictEqual([...new Set(pr.queue.map((c) => c.vkey))].sort(), [naj, v("English Attack").key].sort());
	assert.ok(pr.queue.length >= 5);
	assert.strictEqual(pr.newLeft, 0);
	assert.strictEqual(newSession(deck, tree, p, { ...S, sessionLength: 2 }, { practice: true }).queue.length, 2);
	// book cards of a learned variation join; of a closed one do not
	markKnown(p, root, deck, S, NOW);
	const open = newSession(deck, tree, p, { ...S, newPerSession: 99, sessionLength: 0 }, {});
	assert.ok(open.queue.some((c) => c.type === "book" && c.vkey === root));
	assert.ok(!open.queue.some((c) => c.type === "book" && c.vkey === naj));
	// skipped cards stay out
	skip(p, root, deck, true);
	assert.ok(!newSession(deck, tree, p, { ...S, newPerSession: 99 }, {}).queue.some((c) => c.vkey === root));
	assert.ok(!newSession(deck, tree, p, S, { practice: true }).queue.some((c) => c.vkey === root));
	// a started book card is asked again
	const bk = deck.find((c) => c.type === "book" && c.vkey === root);
	const q = emptyProgress();
	markKnown(q, root, deck, S, NOW);
	q.cards[bk.id] = { streak: 1, seen: NOW - 2, skip: false };
	assert.strictEqual(newSession(deck, tree, q, { ...S, newPerSession: 0 }, {}).queue[0].id, bk.id);
});

test("newSession: an unnamed workbook is one book variation", () => {
	const ls = [{ moves: [{ san: "e4", ply: 1 }, { san: "e5", ply: 2 }], comments: [], isMain: true }];
	const t = variationTree(ls, {});
	const d = buildDeck(t, ls, S);
	assert.strictEqual(d.length, 1);
	assert.strictEqual(newSession(d, t, emptyProgress(), S, {}).queue.length, 1);
});

const hand = (queue, extra = {}) => ({ queue, i: 0, results: [], unlockedBefore: new Set(), practice: false, newLeft: 0, ...extra });

test("answer: the streak climbs to the master setting and a miss drops it a stage", () => {
	const p = emptyProgress();
	const c = deck[0];
	let s;
	for (let k = 0; k < 7; k++) {
		s = hand([c]);
		answer(s, p, c, true, S, NOW);
	}
	assert.strictEqual(p.cards[c.id].streak, 5);
	assert.deepStrictEqual(s.results[0], { id: c.id, right: true, from: 5, to: 5, unlocked: [] });
	assert.strictEqual(p.cards[c.id].seen, NOW);
	// mastered: a miss leaves it learned, three right answers master it again
	answer(hand([c]), p, c, false, S, NOW);
	assert.strictEqual(p.cards[c.id].streak, 2);
	assert.ok(learnedCard(p.cards[c.id], S) && !masteredCard(p.cards[c.id], S));
	for (let k = 0; k < 3; k++) answer(hand([c]), p, c, true, S, NOW);
	assert.ok(masteredCard(p.cards[c.id], S));
	// not mastered: a miss starts again
	p.cards[c.id].streak = 4;
	answer(hand([c]), p, c, false, S, NOW);
	assert.strictEqual(p.cards[c.id].streak, 0);
	p.cards[c.id].streak = 1;
	answer(hand([c]), p, c, false, S, NOW);
	assert.strictEqual(p.cards[c.id].streak, 0);
});

test("answer: skip is kept; a miss returns three questions later", () => {
	const p = emptyProgress();
	const c = deck[0];
	p.cards[c.id] = { streak: 0, seen: 1, skip: true };
	const w = hand([c, deck[1], deck[2], deck[3], deck[4]]);
	answer(w, p, c, false, S, NOW);
	assert.strictEqual(p.cards[c.id].skip, true);
	assert.strictEqual(w.i, 1);
	assert.strictEqual(w.queue[3], c);
	const end = hand([c]);
	answer(end, p, c, false, S, NOW);
	assert.deepStrictEqual(end.queue, [c, c]);
	assert.strictEqual(current({ queue: [c], i: 1 }), null);
});

test("answer: a right answer comes back until the card is learned, then not", () => {
	const p = emptyProgress();
	const c = deck[0];
	const s = hand([c, deck[1], deck[2], deck[3], deck[4]]);
	answer(s, p, c, true, S, NOW);
	assert.strictEqual(s.queue.filter((x) => x === c).length, 2, "streak 1 of 2: back");
	assert.strictEqual(s.queue[3], c);
	s.i = 3;
	answer(s, p, c, true, S, NOW + 1);
	assert.strictEqual(s.queue.filter((x) => x === c).length, 2, "learned: not again");
	assert.strictEqual(p.cards[c.id].streak, 2);
});

test("answer: with a context it names what it unlocked and deepens the session", () => {
	const p = emptyProgress();
	const root = v("...d6 Sicilians");
	const ctx = { deck, tree };
	const one = { ...S, learnStreak: 1, newPerSession: 2, sessionLength: 0 };
	const s = newSession(deck, tree, p, { ...one, newPerSession: 0 }, {});
	s.queue = s.pool.filter((c) => c.vkey === root.key && c.type !== "book");
	s.pool = s.pool.filter((c) => c.vkey !== v("...e6 Sicilians").key); // keep the other root out of it
	s.newLeft = 2;
	assert.strictEqual(s.queue.length, 2);
	// the root's name card is learned at once; its order card is not yet, so nothing unlocks
	const nameCard = s.queue[0];
	const orderCard = s.queue[1];
	let r = answer(s, p, nameCard, true, one, NOW, ctx);
	assert.deepStrictEqual(r.unlocked, []);
	r = answer(s, p, orderCard, true, one, NOW, ctx);
	assert.deepStrictEqual(r.unlocked.sort(), ["Najdorf", "Scheveningen"]);
	// two new cards join, shallowest level first: the learned root's book cards
	// (level 1) come before its children's questions
	assert.strictEqual(s.queue.length, 4);
	assert.ok(s.queue.slice(2).every((c) => !p.cards[c.id] && c.type === "book" && c.vkey === root.key));
	assert.strictEqual(s.newLeft, 0);
	// no more once newLeft is spent
	const before = s.queue.length;
	answer(s, p, s.queue[2], true, one, NOW, ctx);
	assert.strictEqual(s.queue.length, before);
});

test("answer: deepening respects the session length and never runs in practice", () => {
	const root = v("...d6 Sicilians");
	const one = { ...S, learnStreak: 1, newPerSession: 9, sessionLength: 2 };
	const p = emptyProgress();
	const s = newSession(deck, tree, p, { ...one, newPerSession: 0 }, {});
	s.queue = s.pool.filter((c) => c.vkey === root.key && c.type !== "book");
	s.newLeft = 9;
	assert.ok(s.pool.length > 2);
	answer(s, p, s.queue[0], true, one, NOW, { deck, tree });
	answer(s, p, s.queue[1], true, one, NOW, { deck, tree });
	assert.strictEqual(s.queue.length, 2, "the queue was already at the length limit");
	const q = emptyProgress();
	const pr = newSession(deck, tree, q, { ...one, sessionLength: 0 }, { practice: true });
	const n = pr.queue.length;
	const r = answer(pr, q, pr.queue[0], true, one, NOW, { deck, tree });
	assert.deepStrictEqual(r.unlocked, []);
	assert.strictEqual(pr.queue.length, n);
});

test("sessionSummary: learned, mastered, slipped, unlocked and locked", () => {
	const p = emptyProgress();
	const root = v("...d6 Sicilians").key;
	const e6 = v("...e6 Sicilians").key;
	for (const c of ownOf(e6)) p.cards[c.id] = { streak: 5, seen: NOW, skip: false };
	const s = newSession(deck, tree, p, { ...S, sessionLength: 0 }, {});
	const a = deck.find((c) => c.id === `name|${root}`);
	const b = deck.find((c) => c.id === `order|${root}`);
	for (let k = 0; k < 2; k++) answer(s, p, a, true, S, NOW);
	answer(s, p, b, true, S, NOW);
	answer(s, p, b, true, S, NOW);
	answer(s, p, b, false, S, NOW); // not mastered: back to 0
	const m = sessionSummary(s, tree, deck, p, S);
	assert.strictEqual(m.right, 4);
	assert.strictEqual(m.wrong, 1);
	assert.deepStrictEqual(m.learned, []);
	assert.deepStrictEqual(m.slipped, []);
	assert.strictEqual(m.locked, 2, "Najdorf and English Attack");
	// the second variation slips: a mastered card missed
	const e6name = deck.find((c) => c.id === `name|${e6}`);
	answer(s, p, e6name, false, S, NOW);
	assert.deepStrictEqual(sessionSummary(s, tree, deck, p, S).slipped, ["...e6 Sicilians"]);
	// both of the root's cards reach the learn setting, then the master setting
	for (let k = 0; k < 2; k++) answer(s, p, b, true, S, NOW);
	let m2 = sessionSummary(s, tree, deck, p, S);
	assert.deepStrictEqual(m2.learned, ["...d6 Sicilians"]);
	assert.deepStrictEqual(m2.mastered, []);
	assert.deepStrictEqual(m2.unlocked, ["Najdorf"], "Scheveningen was open already, through the e6 root");
	markKnown(p, root, deck, S, NOW);
	m2 = sessionSummary(s, tree, deck, p, S);
	assert.deepStrictEqual(m2.mastered, ["...d6 Sicilians"]);
});

test("manual: markKnown masters and unlocks, skip on/off, resetVar", () => {
	const p = emptyProgress();
	const k = v("Najdorf").key;
	const mine = deck.filter((c) => c.vkey === k);
	markKnown(p, k, deck, S, NOW);
	for (const c of mine) assert.strictEqual(!!p.cards[c.id], c.type !== "book");
	assert.deepStrictEqual(p.cards[`name|${k}`], { streak: 5, seen: NOW, skip: false });
	assert.ok(isMastered(k, deck, p, S));
	assert.ok(unlockedKeys(tree, deck, p, S).has(v("English Attack").key));
	resetVar(p, k, deck);
	assert.deepStrictEqual(p.cards, {});
	skip(p, k, deck, true);
	assert.strictEqual(Object.keys(p.cards).length, mine.length);
	assert.deepStrictEqual(p.cards[`name|${k}`], { streak: 0, seen: 0, skip: true });
	skip(p, k, deck, false);
	assert.deepStrictEqual(p.cards, {});
	markKnown(p, k, deck, S, NOW);
	skip(p, k, deck, true);
	skip(p, k, deck, false);
	assert.strictEqual(p.cards[`name|${k}`].skip, false);
	assert.strictEqual(p.cards[`name|${k}`].streak, 5);
});

test("checkName and nameChoices", () => {
	assert.ok(checkName("kan", "Kan/Paulsen"));
	assert.ok(checkName("Paulsen", "Kan/Paulsen"));
	assert.ok(checkName("kan/paulsen", "Kan/Paulsen"));
	assert.ok(checkName("  e6   sicilians ", "...e6 Sicilians"));
	assert.ok(!checkName("", "Kan/Paulsen"));
	assert.ok(!checkName("najdorf", "Scheveningen"));
	const card = deck.find((c) => c.id === `name|${v("Scheveningen").key}`);
	const c = nameChoices(card, tree, S, () => 0);
	assert.strictEqual(c.length, 4);
	assert.ok(c.includes("Scheveningen"));
	assert.ok(c.includes("Najdorf")); // same level 2
	assert.ok(!c.includes("English Attack"));
	assert.strictEqual(nameChoices(card, tree, { ...S, choices: 9 }, () => 0).length, 5);
	assert.strictEqual(nameChoices(card, tree, { ...S, choices: 2 }, () => 0).length, 2);
});

test("orderStep over two move orders", () => {
	const orders = v("Scheveningen").orders;
	assert.deepStrictEqual(orderStep(orders, [], "e4"), { ok: true, done: false, accepted: ["e4"] });
	const via = "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3".split(" ");
	assert.deepStrictEqual(orderStep(orders, via.slice(0, 8), "Nc3"), { ok: true, done: false, accepted: ["Nc3"] });
	const r = orderStep(orders, "e4 c5 Nf3".split(" "), "d6");
	assert.ok(r.ok && !r.done);
	assert.deepStrictEqual(r.accepted.sort(), ["d6", "e6"]);
	assert.strictEqual(orderStep(orders, "e4 c5 Nf3".split(" "), "g6").ok, false);
	assert.deepStrictEqual(orderStep(orders, "e4 c5 Nf3".split(" "), "g6").accepted.sort(), ["d6", "e6"]);
	const last = orderStep(orders, "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3".split(" "), "e6");
	assert.ok(last.ok && last.done);
	assert.deepStrictEqual(orderStep(orders, ["x"], "y"), { ok: false, done: false, accepted: [] });
});

test("checkFamily, checkBook, allTags", () => {
	assert.ok(checkFamily(["b", "a"], ["a", "b"]));
	assert.ok(!checkFamily(["a"], ["a", "b"]));
	assert.ok(!checkFamily(["a", "c"], ["a", "b"]));
	const card = { moves: ["e6", "a6"], main: "e6" };
	assert.ok(checkBook(card, "a6", { bookRule: "any" }));
	assert.ok(!checkBook(card, "a6", { bookRule: "main" }));
	assert.ok(checkBook(card, "e6", { bookRule: "main" }));
	assert.ok(checkBook({ moves: ["a6"], main: null }, "a6", { bookRule: "main" }));
	assert.deepStrictEqual(allTags(tree), ["Nc3 committed", "d6", "e6"]);
});

test("progress: round trip, move, repair and unreadable data", () => {
	assert.deepStrictEqual(loadProgress("a"), emptyProgress());
	const p = emptyProgress();
	p.cards["name|x"] = { streak: 2, seen: 5, skip: false };
	p.settings.choices = 6;
	assert.strictEqual(saveProgress("a", p), true);
	assert.deepStrictEqual(loadProgress("a"), p);
	moveProgress("a", "b");
	assert.deepStrictEqual(loadProgress("b"), p);
	assert.strictEqual(store.has("ott-train:a"), false);
	moveProgress("nothing", "c");
	assert.strictEqual(store.has("ott-train:c"), false);
	saveProgress(null, p);
	assert.ok(store.has("ott-train:unsaved"));
	store.set("ott-train:z", "{nope");
	assert.deepStrictEqual(loadProgress("z"), emptyProgress());
	store.set("ott-train:z", JSON.stringify({ settings: { choices: "x", bogus: 1, nameMode: "typed", masteryBox: 2, intervals: [1], masterStreak: 1, learnStreak: 3 }, cards: { a: { streak: 9 }, b: 3, c: { streak: 2, seen: 4, skip: true }, d: { box: 4, seen: 6, skip: false }, e: { streak: -1, seen: 1 } } }));
	const r = loadProgress("z");
	assert.strictEqual(r.settings.choices, 4);
	assert.strictEqual(r.settings.nameMode, "typed");
	assert.ok(!("bogus" in r.settings) && !("intervals" in r.settings) && !("masteryBox" in r.settings));
	assert.strictEqual(r.settings.learnStreak, 3);
	assert.strictEqual(r.settings.masterStreak, 3, "raised to the learn setting");
	assert.deepStrictEqual(r.cards, {
		c: { streak: 2, seen: 4, skip: true },
		d: { streak: 0, seen: 6, skip: false }, // a first-version record starts again
		e: { streak: 0, seen: 1, skip: false },
	});
	assert.deepStrictEqual(normalizeSettings(null), DEFAULT_SETTINGS);
	assert.deepStrictEqual(
		[DEFAULT_SETTINGS.learnStreak, DEFAULT_SETTINGS.masterStreak, DEFAULT_SETTINGS.newPerSession, DEFAULT_SETTINGS.reviews],
		[2, 5, 5, 3],
	);
	const range = (k, ok, bad) => {
		for (const x of ok) assert.strictEqual(normalizeSettings({ [k]: x })[k], x, `${k} ${x}`);
		for (const x of bad) assert.strictEqual(normalizeSettings({ [k]: x })[k], DEFAULT_SETTINGS[k], `${k} ${x}`);
	};
	range("learnStreak", [1, 10], [0, 11, 1.5]);
	range("masterStreak", [2, 20], [0, 21]);
	range("reviews", [0, 20], [-1, 21]);
	range("newPerSession", [0, 50], [-1, 51]);
	range("choices", [2, 8], [1, 9]);
	assert.strictEqual(normalizeSettings({ learnStreak: 6, masterStreak: 4 }).masterStreak, 6);
	assert.strictEqual(normalizeSettings({ types: { name: false, x: 1 } }).types.name, false);
	assert.strictEqual(normalizeSettings({ bookSide: "up", familyGroup: ["a", 3] }).bookSide, "black");
	assert.deepStrictEqual(normalizeSettings({ familyGroup: ["a"] }).familyGroup, ["a"]);
	global.localStorage.setItem = () => { throw new Error("full"); };
	assert.strictEqual(saveProgress("q", p), false);
	delete global.localStorage;
	assert.deepStrictEqual(loadProgress("q"), emptyProgress());
	assert.strictEqual(saveProgress("q", p), false);
	moveProgress("q", "r");
});
