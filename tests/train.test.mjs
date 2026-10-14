import { test, beforeEach, after } from "node:test";
import assert from "node:assert";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { namesFromNodes, variationTree } from "../src/names.js";
import {
	DEFAULT_SETTINGS, buildDeck, normalizeSettings, emptyProgress, loadProgress, saveProgress, mergeProgress, parseProgress, progressFor, hasProgress,
	learnedCard, masteredCard, isLearned, isMastered, unlockedKeys, bookOpen, newSession, current, answer, sessionSummary,
	markKnown, skip, resetVar, isTricky, unlocksIfLearned, checkName, nameChoices, orderStep, checkFamily, checkBook, allTags,
} from "../src/train.js";

const PGN = `1. e4 c5 2. Nf3 d6 {[%name "...d6 Sicilians"]} (2... e6 {[%name "...e6 Sicilians"] [%tags "e6"]} 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 d6 {[%name "Scheveningen"] Small centre.}) 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 e6 {[%name "Scheveningen"]} (5... a6 {[%name "Najdorf"] [%tags "d6; Nc3 committed"]} 6. Be3 {[%name "English Attack"]}) *`;
const { nodes } = parsePgn(PGN);
const lines = collectLines(nodes);
const tree = variationTree(lines, namesFromNodes(nodes));
const S = { ...DEFAULT_SETTINGS, types: { name: true, order: true, family: true, book: true }, introNew: false };
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
		key: (i) => [...store.keys()][i] ?? null,
		get length() {
			return store.size;
		},
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
	markKnown(p, v("...d6 Sicilians").key, deck, S);
	assert.deepStrictEqual(names(p), ["...d6 Sicilians", "...e6 Sicilians", "Najdorf", "Scheveningen"]);
	assert.ok(isMastered(v("...d6 Sicilians").key, deck, p, S));
	assert.ok(bookOpen(v("...d6 Sicilians").key, deck, p, S));
	assert.ok(!bookOpen(v("Najdorf").key, deck, p, S));
	assert.ok(bookOpen("", deck, p, S));
	p = emptyProgress();
	markKnown(p, v("...e6 Sicilians").key, deck, S);
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

test("newSession: in progress, then new up to learning at once, then a re-check", () => {
	const p = emptyProgress();
	const root = v("...d6 Sicilians").key;
	const e6 = v("...e6 Sicilians").key;
	const rec = (streak, seen) => ({ streak, seen, skip: false });
	p.asked = 100;
	p.cards[`name|${root}`] = rec(1, 5);
	p.cards[`order|${root}`] = rec(0, 1);
	p.cards[`name|${e6}`] = rec(5, 9);
	p.cards[`family|${e6}`] = rec(5, 8);
	const flow = { ...S, sessionLength: 0 };
	const s = newSession(deck, tree, p, flow, {});
	// started cards first, least recently asked first; then new ones (order|e6 is
	// the only unasked card open); then one mastered card for a re-check
	assert.deepStrictEqual(s.queue.map((c) => c.id), [`order|${root}`, `name|${root}`, `order|${e6}`, `family|${e6}`]);
	assert.strictEqual(current(s).id, `order|${root}`);
	// no re-checks when switched off, or when the card was asked too recently
	assert.deepStrictEqual(newSession(deck, tree, p, { ...flow, recheckEvery: 0 }, {}).queue.map((c) => c.id), [`order|${root}`, `name|${root}`, `order|${e6}`]);
	p.cards[`family|${e6}`].seen = 95;
	p.cards[`name|${e6}`].seen = 98;
	assert.ok(!newSession(deck, tree, p, flow, {}).queue.some((c) => c.id.endsWith(`|${e6}`) && c.type !== "order"), "spacing: fewer than 10 answers since");
	// learned but not mastered cards come back as re-checks too
	p.cards[`name|${e6}`] = rec(2, 3);
	assert.ok(newSession(deck, tree, p, flow, {}).queue.some((c) => c.id === `name|${e6}`));
	// "learning at once" bounds the new cards: started ones count towards it
	const none = emptyProgress();
	assert.strictEqual(newSession(deck, tree, none, { ...flow, learning: 3 }, {}).queue.length, 3);
	assert.strictEqual(newSession(deck, tree, none, { ...flow, learning: 1 }, {}).queue.length, 1);
	assert.strictEqual(newSession(deck, tree, p, { ...flow, learning: 1, recheckEvery: 0 }, {}).queue.length, 2, "two started cards: nothing new joins");
});

const drive = (s, p, st, right = () => true, max = 500) => {
	let n = 0;
	while (current(s) && n++ < max) answer(s, p, current(s), right(current(s)), st, { deck, tree });
	return s;
};

test("flow: learning a card brings the next new one in while others are still in flight", () => {
	const p = emptyProgress();
	const one = { ...S, learnStreak: 1, learning: 2, sessionLength: 0, recheckEvery: 0 };
	const s = newSession(deck, tree, p, one, {});
	const [a, b] = s.queue;
	assert.strictEqual(s.queue.length, 2);
	answer(s, p, a, true, one, { deck, tree });
	assert.strictEqual(s.queue.slice(s.i).length, 2, "b is still in flight and one new card took a's place");
	assert.ok(s.queue.slice(s.i).includes(b) && !s.queue.slice(s.i).includes(a));
	// a miss keeps the card in flight: nothing joins for it
	const n = s.queue.length;
	answer(s, p, current(s), false, one, { deck, tree });
	assert.strictEqual(s.queue.length, n + 1, "only the requeued copy");
});

test("flow: a long session keeps unlocking, down to level 3; without a limit it runs to the end", () => {
	const p = emptyProgress();
	const s = drive(newSession(deck, tree, p, { ...S, sessionLength: 30 }, {}), p, { ...S, sessionLength: 30 });
	assert.strictEqual(s.results.length, 30);
	const sum = sessionSummary(s, tree, deck, p, S);
	assert.ok(sum.unlocked.includes("English Attack") && sum.unlocked.includes("Najdorf"), "level 2 and level 3 opened in the session");
	// no limit: it ends when nothing is left to ask
	const q = emptyProgress();
	const t = drive(newSession(deck, tree, q, { ...S, sessionLength: 0 }, {}), q, { ...S, sessionLength: 0 });
	assert.strictEqual(current(t), null);
	assert.ok(t.results.length > 30);
	assert.strictEqual(sessionSummary(t, tree, deck, q, S).locked, 0);
});

test("flow: the session length ends the queue after that many answers", () => {
	const p = emptyProgress();
	const st = { ...S, sessionLength: 3 };
	const s = newSession(deck, tree, p, st, {});
	for (let k = 0; k < 3; k++) answer(s, p, current(s), false, st, { deck, tree });
	assert.strictEqual(current(s), null);
	assert.strictEqual(s.queue.length, s.i);
});

test("flow: re-checks join every recheckEvery answers and respect spacing", () => {
	const p = emptyProgress();
	for (const k of [v("...d6 Sicilians").key, v("...e6 Sicilians").key]) markKnown(p, k, deck, S);
	const mastered = new Set(Object.keys(p.cards));
	p.asked = 200;
	const st = { ...S, learning: 1, recheckEvery: 3, sessionLength: 0 };
	const s = newSession(deck, tree, p, st, {});
	assert.strictEqual(s.queue.filter((c) => mastered.has(c.id)).length, 1, "the opening queue has one");
	assert.strictEqual(s.queue.length, 2, "and one new card");
	for (let k = 0; k < 9; k++) answer(s, p, current(s), true, st, { deck, tree });
	const rechecks = s.results.filter((r) => mastered.has(r.id));
	assert.ok(rechecks.length >= 3 && rechecks.length <= 5, `about one in three: ${rechecks.length}`);
	assert.strictEqual(new Set(rechecks.map((r) => r.id)).size, rechecks.length, "none twice within the spacing");
	const off = emptyProgress();
	markKnown(off, v("...d6 Sicilians").key, deck, S);
	off.asked = 200;
	const known = new Set(Object.keys(off.cards));
	const t = drive(newSession(deck, tree, off, { ...st, recheckEvery: 0 }, {}), off, { ...st, recheckEvery: 0 }, () => true, 12);
	assert.ok(t.results.length > 0 && t.results.every((r) => !known.has(r.id)));
});

test("newSession: scope, practice, book cards, skipped cards", () => {
	const p = emptyProgress();
	const root = v("...d6 Sicilians").key;
	const fresh = { ...S, sessionLength: 0 };
	// scope: Najdorf's subtree only (still locked); practice ignores the lock
	const naj = v("Najdorf").key;
	assert.strictEqual(newSession(deck, tree, p, fresh, { scope: naj }).queue.length, 0);
	const pr = newSession(deck, tree, p, { ...S, sessionLength: 0 }, { scope: naj, practice: true });
	assert.deepStrictEqual([...new Set(pr.queue.map((c) => c.vkey))].sort(), [naj, v("English Attack").key].sort());
	assert.ok(pr.queue.length >= 5);
	assert.strictEqual(newSession(deck, tree, p, { ...S, sessionLength: 2 }, { practice: true }).queue.length, 2);
	// book cards of a learned variation join; of a closed one do not
	markKnown(p, root, deck, S);
	const open = newSession(deck, tree, p, { ...S, learning: 20, sessionLength: 0 }, {});
	assert.ok(open.queue.some((c) => c.type === "book" && c.vkey === root));
	assert.ok(!open.queue.some((c) => c.type === "book" && c.vkey === naj));
	// skipped cards stay out
	skip(p, root, deck, true);
	assert.ok(!newSession(deck, tree, p, { ...S, learning: 20 }, {}).queue.some((c) => c.vkey === root));
	assert.ok(!newSession(deck, tree, p, S, { practice: true }).queue.some((c) => c.vkey === root));
	// a started book card is asked again
	const bk = deck.find((c) => c.type === "book" && c.vkey === root);
	const q = emptyProgress();
	markKnown(q, root, deck, S);
	q.cards[bk.id] = { streak: 1, seen: NOW - 2, skip: false };
	assert.strictEqual(newSession(deck, tree, q, S, {}).queue[0].id, bk.id);
});

test("newSession: an unnamed workbook is one book variation", () => {
	const ls = [{ moves: [{ san: "e4", ply: 1 }, { san: "e5", ply: 2 }], comments: [], isMain: true }];
	const t = variationTree(ls, {});
	const d = buildDeck(t, ls, S);
	assert.strictEqual(d.length, 1);
	assert.strictEqual(newSession(d, t, emptyProgress(), S, {}).queue.length, 1);
});

const hand = (queue, extra = {}) => ({ queue, i: 0, results: [], unlockedBefore: new Set(), practice: false, sinceRecheck: 0, pool: [], intros: new Map(), introduced: new Set(), tricky: new Set(), ...extra });

test("answer: the streak climbs to the master setting and a miss drops it a stage", () => {
	const p = emptyProgress();
	const c = deck[0];
	let s;
	for (let k = 0; k < 7; k++) {
		s = hand([c]);
		p.asked += 10; // a learned card's streak grows only after enough other questions
		answer(s, p, c, true, S);
	}
	assert.strictEqual(p.cards[c.id].streak, 5);
	assert.deepStrictEqual(s.results[0], { id: c.id, right: true, from: 5, to: 5, unlocked: [] });
	assert.strictEqual(p.cards[c.id].seen, p.asked);
	// mastered: a miss leaves it learned, three right answers master it again
	answer(hand([c]), p, c, false, S);
	assert.strictEqual(p.cards[c.id].streak, 2);
	assert.ok(learnedCard(p.cards[c.id], S) && !masteredCard(p.cards[c.id], S));
	for (let k = 0; k < 3; k++) {
		p.asked += 10;
		answer(hand([c]), p, c, true, S);
	}
	assert.ok(masteredCard(p.cards[c.id], S));
	// not mastered: a miss starts again
	p.cards[c.id].streak = 4;
	answer(hand([c]), p, c, false, S);
	assert.strictEqual(p.cards[c.id].streak, 0);
	p.cards[c.id].streak = 1;
	answer(hand([c]), p, c, false, S);
	assert.strictEqual(p.cards[c.id].streak, 0);
});

test("answer: skip is kept; a miss returns three questions later", () => {
	const p = emptyProgress();
	const c = deck[0];
	p.cards[c.id] = { streak: 0, seen: 1, skip: true };
	const w = hand([c, deck[1], deck[2], deck[3], deck[4]]);
	answer(w, p, c, false, S);
	assert.strictEqual(p.cards[c.id].skip, true);
	assert.strictEqual(w.i, 1);
	assert.strictEqual(w.queue[3], c);
	const end = hand([c]);
	answer(end, p, c, false, S);
	assert.deepStrictEqual(end.queue, [c, c]);
	assert.strictEqual(current({ queue: [c], i: 1 }), null);
});

test("answer: a right answer comes back until the card is learned, then not", () => {
	const p = emptyProgress();
	const c = deck[0];
	const s = hand([c, deck[1], deck[2], deck[3], deck[4]]);
	answer(s, p, c, true, S);
	assert.strictEqual(s.queue.filter((x) => x === c).length, 2, "streak 1 of 2: back");
	assert.strictEqual(s.queue[3], c);
	s.i = 3;
	answer(s, p, c, true, S);
	assert.strictEqual(s.queue.filter((x) => x === c).length, 2, "learned: not again");
	assert.strictEqual(p.cards[c.id].streak, 2);
});

test("answer: with a context it names what it unlocked and refills the session", () => {
	const p = emptyProgress();
	const root = v("...d6 Sicilians");
	const ctx = { deck, tree };
	const one = { ...S, learnStreak: 1, learning: 2, sessionLength: 0, recheckEvery: 0 };
	const s = newSession(deck, tree, p, one, {});
	s.queue = s.pool.filter((c) => c.vkey === root.key && c.type !== "book");
	s.pool = s.pool.filter((c) => c.vkey !== v("...e6 Sicilians").key); // keep the other root out of it
	assert.strictEqual(s.queue.length, 2);
	// the root's name card is learned at once; its order card is not yet, so nothing unlocks
	const nameCard = s.queue[0];
	const orderCard = s.queue[1];
	let r = answer(s, p, nameCard, true, one, ctx);
	assert.deepStrictEqual(r.unlocked, []);
	assert.strictEqual(s.queue.length, 2, "the order card is still in flight and nothing new is open");
	r = answer(s, p, orderCard, true, one, ctx);
	assert.deepStrictEqual(r.unlocked.sort(), ["Najdorf", "Scheveningen"]);
	// two new cards join, questions before book moves even at a shallower level,
	// (the two taken share a variation, so nothing could be spread)
	assert.strictEqual(s.queue.length, 4);
	assert.ok(s.queue.slice(2).every((c) => !p.cards[c.id] && c.type !== "book" && c.vkey !== root.key));
	// learning one of them makes room for exactly one more
	const before = s.queue.length;
	answer(s, p, s.queue[2], true, one, ctx);
	assert.strictEqual(s.queue.length, before + 1);
});

test("answer: the session length stops the refill, and practice never refills", () => {
	const root = v("...d6 Sicilians");
	const one = { ...S, learnStreak: 1, learning: 2, sessionLength: 2, recheckEvery: 0 };
	const p = emptyProgress();
	const s = newSession(deck, tree, p, one, {});
	s.queue = s.pool.filter((c) => c.vkey === root.key && c.type !== "book");
	assert.ok(s.pool.length > 2);
	answer(s, p, s.queue[0], true, one, { deck, tree });
	answer(s, p, s.queue[1], true, one, { deck, tree });
	assert.strictEqual(s.queue.length, 2, "the length is reached: nothing joins");
	const q = emptyProgress();
	const pr = newSession(deck, tree, q, { ...one, sessionLength: 0 }, { practice: true });
	const n = pr.queue.length;
	const r = answer(pr, q, pr.queue[0], true, one, { deck, tree });
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
	for (let k = 0; k < 2; k++) answer(s, p, a, true, S);
	answer(s, p, b, true, S);
	answer(s, p, b, true, S);
	answer(s, p, b, false, S); // not mastered: back to 0
	const m = sessionSummary(s, tree, deck, p, S);
	assert.strictEqual(m.right, 4);
	assert.strictEqual(m.wrong, 1);
	assert.deepStrictEqual(m.learned, []);
	assert.deepStrictEqual(m.slipped, []);
	assert.strictEqual(m.locked, 2, "Najdorf and English Attack");
	// the second variation slips: a mastered card missed
	const e6name = deck.find((c) => c.id === `name|${e6}`);
	answer(s, p, e6name, false, S);
	assert.deepStrictEqual(sessionSummary(s, tree, deck, p, S).slipped, ["...e6 Sicilians"]);
	// both of the root's cards reach the learn setting, then the master setting
	for (let k = 0; k < 2; k++) answer(s, p, b, true, S);
	let m2 = sessionSummary(s, tree, deck, p, S);
	assert.deepStrictEqual(m2.learned, ["...d6 Sicilians"]);
	assert.deepStrictEqual(m2.mastered, []);
	assert.deepStrictEqual(m2.unlocked, ["Najdorf"], "Scheveningen was open already, through the e6 root");
	markKnown(p, root, deck, S);
	m2 = sessionSummary(s, tree, deck, p, S);
	assert.deepStrictEqual(m2.mastered, ["...d6 Sicilians"]);
});

test("manual: markKnown masters and unlocks, skip on/off, resetVar", () => {
	const p = emptyProgress();
	const k = v("Najdorf").key;
	const mine = deck.filter((c) => c.vkey === k);
	markKnown(p, k, deck, S);
	for (const c of mine) assert.strictEqual(!!p.cards[c.id], c.type !== "book");
	assert.deepStrictEqual(p.cards[`name|${k}`], { streak: 5, seen: 0, skip: false });
	assert.ok(isMastered(k, deck, p, S));
	assert.ok(unlockedKeys(tree, deck, p, S).has(v("English Attack").key));
	resetVar(p, k, deck);
	assert.deepStrictEqual(p.cards, {});
	skip(p, k, deck, true);
	assert.strictEqual(Object.keys(p.cards).length, mine.length);
	assert.deepStrictEqual(p.cards[`name|${k}`], { streak: 0, seen: 0, skip: true });
	skip(p, k, deck, false);
	assert.deepStrictEqual(p.cards, {});
	markKnown(p, k, deck, S);
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

test("progress: round trip, repair and unreadable data", () => {
	assert.deepStrictEqual(loadProgress(), emptyProgress());
	assert.strictEqual(hasProgress(), false);
	const p = emptyProgress();
	p.cards["name|x"] = { streak: 2, seen: 5, skip: false };
	p.settings.choices = 6;
	assert.strictEqual(saveProgress(p), true);
	assert.strictEqual(hasProgress(), true);
	assert.deepStrictEqual(loadProgress(), p);
	store.set("ott-train", "{nope");
	assert.deepStrictEqual(loadProgress(), emptyProgress());
	store.set("ott-train", JSON.stringify({ settings: { choices: "x", bogus: 1, nameMode: "typed", masteryBox: 2, intervals: [1], masterStreak: 1, learnStreak: 3 }, cards: { a: { streak: 9 }, b: 3, c: { streak: 2, seen: 4, skip: true }, d: { box: 4, seen: 6, skip: false }, e: { streak: -1, seen: 1 } } }));
	const r = loadProgress();
	assert.strictEqual(r.settings.choices, 4);
	assert.strictEqual(r.settings.nameMode, "typed");
	assert.ok(!("bogus" in r.settings) && !("intervals" in r.settings) && !("masteryBox" in r.settings));
	assert.strictEqual(r.settings.learnStreak, 3);
	assert.strictEqual(r.settings.masterStreak, 3, "raised to the learn setting");
	assert.deepStrictEqual(r.cards, {
		c: { streak: 2, seen: 2, skip: true }, // timestamps become 1..n in their order
		d: { streak: 0, seen: 3, skip: false }, // a first-version record starts again
		e: { streak: 0, seen: 1, skip: false },
	});
	assert.strictEqual(r.asked, 3);
	assert.deepStrictEqual(normalizeSettings(null), DEFAULT_SETTINGS);
	assert.deepStrictEqual(
		[DEFAULT_SETTINGS.learnStreak, DEFAULT_SETTINGS.masterStreak, DEFAULT_SETTINGS.learning, DEFAULT_SETTINGS.recheckEvery, DEFAULT_SETTINGS.sessionLength],
		[2, 5, 5, 6, 20],
	);
	const range = (k, ok, bad) => {
		for (const x of ok) assert.strictEqual(normalizeSettings({ [k]: x })[k], x, `${k} ${x}`);
		for (const x of bad) assert.strictEqual(normalizeSettings({ [k]: x })[k], DEFAULT_SETTINGS[k], `${k} ${x}`);
	};
	range("learnStreak", [1, 10], [0, 11, 1.5]);
	range("masterStreak", [2, 20], [0, 21]);
	range("learning", [1, 20], [0, 21]);
	range("recheckEvery", [0, 50], [-1, 51]);
	assert.ok(!("newPerSession" in normalizeSettings({ newPerSession: 3, reviews: 2 })) && !("reviews" in normalizeSettings({ reviews: 2 })), "the old batch limits are dropped");
	range("choices", [2, 8], [1, 9]);
	assert.strictEqual(normalizeSettings({ learnStreak: 6, masterStreak: 4 }).masterStreak, 6);
	assert.strictEqual(normalizeSettings({ types: { name: false, x: 1 } }).types.name, false);
	assert.strictEqual(normalizeSettings({ bookSide: "up", familyGroup: ["a", 3] }).bookSide, "black");
	assert.deepStrictEqual(normalizeSettings({ familyGroup: ["a"] }).familyGroup, ["a"]);
	global.localStorage.setItem = () => { throw new Error("full"); };
	assert.strictEqual(saveProgress(p), false);
	delete global.localStorage;
	assert.deepStrictEqual(loadProgress(), emptyProgress());
	assert.strictEqual(hasProgress(), false);
	assert.strictEqual(saveProgress(p), false);
});

test("older per-workbook keys are merged into the one store and removed", () => {
	const rec = (streak, seen) => ({ streak, seen, skip: false });
	store.set("ott-train:a1", JSON.stringify({ asked: 9, settings: { choices: 7 }, cards: { a: rec(1, 3), b: rec(4, 9) } }));
	store.set("ott-train:unsaved", JSON.stringify({ asked: 5, settings: { choices: 3 }, cards: { a: rec(3, 5), c: rec(2, 1) } }));
	store.set("ott-train:bad", "{nope");
	const p = loadProgress();
	assert.deepStrictEqual([...store.keys()].filter((k) => k.startsWith("ott-train")), ["ott-train"]);
	assert.strictEqual(p.cards.a.streak, 3, "the higher streak wins");
	assert.deepStrictEqual(Object.keys(p.cards).sort(), ["a", "b", "c"]);
	assert.strictEqual(p.settings.choices, 7, "the first key's settings");
	// renumbered 1..n in the order they had: c(1), a(5), b(9)
	assert.deepStrictEqual([p.cards.c.seen, p.cards.a.seen, p.cards.b.seen, p.asked], [1, 2, 3, 3]);
	assert.deepStrictEqual(loadProgress(), p, "saved, so the next load reads the store");
	// an existing store keeps its settings
	store.set("ott-train:late", JSON.stringify({ asked: 1, settings: { choices: 2 }, cards: { d: rec(1, 1) } }));
	const q = loadProgress();
	assert.strictEqual(q.settings.choices, 7);
	assert.ok(q.cards.d);
});

test("mergeProgress: higher streak wins, a tie goes to the later answer, settings only when asked", () => {
	const rec = (streak, seen, extra = {}) => ({ streak, seen, skip: false, ...extra });
	const into = { settings: normalizeSettings({ choices: 5 }), asked: 4, cards: { a: rec(3, 4), b: rec(2, 2), c: rec(1, 1) } };
	const from = { settings: normalizeSettings({ choices: 8 }), asked: 12, cards: { a: rec(2, 12), b: rec(2, 7, { tricky: true }), c: rec(4, 3, { skip: true }), d: rec(1, 6) } };
	mergeProgress(into, from);
	assert.strictEqual(into.cards.a.streak, 3, "lower streak ignored");
	assert.strictEqual(into.cards.b.seen, 7, "tie: the later");
	assert.ok(into.cards.b.tricky);
	assert.ok(into.cards.c.skip && into.cards.c.streak === 4, "skip comes with the record");
	assert.ok(into.cards.d);
	assert.strictEqual(into.settings.choices, 5);
	assert.strictEqual(into.asked, 7, "covers the newest incoming answer");
	mergeProgress(into, from, true);
	assert.strictEqual(into.settings.choices, 8);
	assert.deepStrictEqual(parseProgress(null), emptyProgress());
});

test("progressFor keeps only the deck's cards, with the settings", () => {
	const p = emptyProgress();
	p.asked = 9;
	p.cards["name|x"] = { streak: 1, seen: 2, skip: false };
	p.cards["name|y"] = { streak: 1, seen: 3, skip: false };
	const out = progressFor(p, [{ id: "name|x" }, { id: "order|z" }]);
	assert.deepStrictEqual(Object.keys(out.cards), ["name|x"]);
	assert.deepStrictEqual([out.asked, out.settings], [9, p.settings]);
});

// --- the research-backed changes (docs/superpowers/plans/2026-10-14-train-research.md) ---

const SI = { ...S, introNew: true };
const deckI = buildDeck(tree, lines, SI);
const idsOf = (q) => q.map((c) => c.id);

test("notes: every comment on the way, by move, the variation's own marked, and where its own moves begin", () => {
	const pgn = `1. e4 {King pawn.} c5 {Sicilian.} 2. Nf3 {[%name "Open"] Develops.} d6 3. d4 {Centre.} cxd4 4. Nxd4 Nf6 5. Nc3 a6 {[%name "Najdorf"] Sharp.} *`;
	const { nodes: ns } = parsePgn(pgn);
	const ls = collectLines(ns);
	const t = variationTree(ls, namesFromNodes(ns));
	const d = buildDeck(t, ls, { ...S, introNew: true });
	const open = [...t.byKey.values()].find((x) => x.name === "Open");
	const naj = [...t.byKey.values()].find((x) => x.name === "Najdorf");
	const notes = (type, v) => d.find((c) => c.id === `${type}|${v.key}`).notes;
	assert.deepStrictEqual(notes("name", open), [
		{ at: 0, move: "1.e4", text: "King pawn.", own: false },
		{ at: 1, move: "1...c5", text: "Sicilian.", own: false },
		{ at: 2, move: "2.Nf3", text: "Develops.", own: true },
	]);
	assert.deepStrictEqual(notes("order", naj).map((x) => [x.at, x.move, x.own]), [
		[0, "1.e4", false], [1, "1...c5", false], [2, "2.Nf3", false], [4, "3.d4", false], [9, "5...a6", true],
	]);
	// the intro steps from the parent's position (after 2.Nf3) to the Najdorf
	const intro = (v) => d.find((c) => c.id === `intro|${v.key}`);
	assert.strictEqual(intro(open).from, 0);
	assert.strictEqual(intro(naj).from, 3);
	assert.deepStrictEqual(intro(naj).notes, notes("name", naj));
	assert.ok(d.filter((c) => c.type === "book").every((c) => typeof c.notes === "object" && !Array.isArray(c.notes)));
});

test("notes come from whichever line holds them, not the first line through the variation", () => {
	// a comment sits only on the line that owns its move: the sideline's line
	// has no 1...c5 or 2.Nf3 note, and its sub-variation's line (3.Bb5) not even
	// the 2...Nc6 one. With that sub-line first, the intro had no notes at all.
	const pgn = `1. e4 c5 {Why c5.} 2. Nf3 {Organised.} d6 {[%name "D6"]} (2... Nc6 {[%name "Nc6"]} {Nc6 note.} 3. d4 (3. Bb5 {[%name "Ross"]} {Ross note.} g6) cxd4) 3. d4 *`;
	const { nodes: ns } = parsePgn(pgn);
	const ls = collectLines(ns);
	const t = variationTree(ls, namesFromNodes(ns));
	for (const order of [ls, [...ls].reverse()]) {
		const d = buildDeck(t, order, { ...S, introNew: true });
		const intro = (name) => d.find((c) => c.type === "intro" && t.byKey.get(c.key).name === name);
		assert.deepStrictEqual(intro("Nc6").notes.map((n) => [n.move, n.text, n.own]), [
			["1...c5", "Why c5.", false], ["2.Nf3", "Organised.", false], ["2...Nc6", "Nc6 note.", true],
		]);
		assert.strictEqual(intro("Ross").from, 4);
		assert.deepStrictEqual(intro("Ross").notes.filter((n) => n.own).map((n) => n.text), ["Ross note."]);
	}
});

test("intro cards: one per variation when on, never in progress, never counted", () => {
	assert.strictEqual(deckI.filter((c) => c.type === "intro").length, 5);
	assert.strictEqual(deck.filter((c) => c.type === "intro").length, 0);
	assert.strictEqual(normalizeSettings({ introNew: "yes" }).introNew, true);
	const p = emptyProgress();
	const root = v("...d6 Sicilians").key;
	for (const c of ownOf(root)) p.cards[c.id] = { streak: 2, seen: 1, skip: false };
	assert.ok(isLearned(root, deckI, p, SI), "the intro does not stop a variation being learned");
	assert.ok(unlockedKeys(tree, deckI, p, SI).has(v("Najdorf").key));
	skip(p, v("Najdorf").key, deckI, true);
	assert.ok(!("intro|" + v("Najdorf").key in p.cards));
	skip(p, v("Najdorf").key, deckI, false);
	resetVar(p, root, deckI);
	assert.ok(!(`intro|${root}` in p.cards));
	// the first question of a session is the root's intro, shown once, before its first card
	const s = newSession(deckI, tree, emptyProgress(), { ...SI, sessionLength: 0 }, {});
	const at = (id) => s.queue.findIndex((c) => c.id === id);
	assert.strictEqual(s.queue[0].type, "intro");
	for (const k of [root, v("...e6 Sicilians").key]) {
		assert.strictEqual(s.queue.filter((c) => c.id === `intro|${k}`).length, 1);
		assert.ok(at(`intro|${k}`) < Math.min(...s.queue.map((c, i) => (c.vkey === k && c.type !== "intro" ? i : 99))));
	}
	// answering an intro moves on and records nothing
	const pr = emptyProgress();
	const r = answer(s, pr, s.queue[0], true, SI);
	assert.deepStrictEqual(r, { id: s.queue[0].id, intro: true });
	assert.deepStrictEqual([s.i, s.results, pr.cards, pr.asked], [1, [], {}, 0]);
	assert.strictEqual(sessionSummary(s, tree, deckI, pr, SI).right, 0);
	// none in practice, none for a variation already asked, none with the setting off
	assert.ok(!newSession(deckI, tree, emptyProgress(), SI, { practice: true }).queue.some((c) => c.type === "intro"));
	const q = emptyProgress();
	q.cards[`name|${root}`] = { streak: 1, seen: 1, skip: false };
	const started = newSession(deckI, tree, q, SI, {}).queue;
	assert.ok(!started.some((c) => c.id === `intro|${root}`) && started.some((c) => c.id === `intro|${v("...e6 Sicilians").key}`));
	assert.ok(!newSession(deck, tree, emptyProgress(), S, {}).queue.some((c) => c.type === "intro"));
});

test("spacing: a learned card's streak grows only after 10 other questions", () => {
	const c = deck[0];
	const p = emptyProgress();
	p.cards[c.id] = { streak: 2, seen: 5, skip: false };
	p.asked = 14; // 9 answers since
	const s = hand([c]);
	let r = answer(s, p, c, true, S);
	assert.strictEqual(r.tooSoon, true);
	assert.strictEqual(p.cards[c.id].streak, 2);
	assert.deepStrictEqual([r.from, r.to, p.asked, p.cards[c.id].seen], [2, 2, 15, 15]);
	assert.strictEqual(s.queue.length, 1, "learned, so not asked again in this session");
	p.cards[c.id] = { streak: 2, seen: 5, skip: false };
	p.asked = 15; // 10 answers since
	r = answer(hand([c]), p, c, true, S);
	assert.ok(!("tooSoon" in r));
	assert.strictEqual(p.cards[c.id].streak, 3);
	// a card still being learned always counts, and a miss is never "too soon"
	p.cards[c.id] = { streak: 1, seen: p.asked, skip: false };
	assert.strictEqual(answer(hand([c]), p, c, true, S).to, 2);
	p.cards[c.id] = { streak: 3, seen: p.asked, skip: false };
	assert.strictEqual(answer(hand([c]), p, c, false, S).to, 0);
	// the master cap is not "too soon"
	p.cards[c.id] = { streak: 5, seen: p.asked, skip: false };
	assert.ok(!answer(hand([c]), p, c, true, S).tooSoon);
});

test("loadProgress: asked is kept when saved, else the timestamps are renumbered", () => {
	store.set("ott-train", JSON.stringify({ asked: 40, cards: { x: { streak: 1, seen: 33, skip: false, tricky: true }, y: { streak: 0, seen: 0, skip: true } } }));
	assert.deepStrictEqual(loadProgress().cards, { x: { streak: 1, seen: 33, skip: false, tricky: true }, y: { streak: 0, seen: 0, skip: true } });
	assert.strictEqual(loadProgress().asked, 40);
	store.set("ott-train", JSON.stringify({ asked: -1, cards: { x: { streak: 1, seen: 1760000009000, skip: false }, y: { streak: 0, seen: 0, skip: true }, z: { streak: 2, seen: 1760000001000, skip: false } } }));
	const b = loadProgress();
	assert.deepStrictEqual([b.cards.z.seen, b.cards.x.seen, b.cards.y.seen, b.asked], [1, 2, 0, 2]);
});

test("new cards: questions before book moves, then shallowest level first", () => {
	const p = emptyProgress();
	markKnown(p, v("...d6 Sicilians").key, deck, S);
	// the eight unlocked questions are taken before any book move, though the
	// root's book moves are at a shallower level
	const s = newSession(deck, tree, p, { ...S, learning: 8, sessionLength: 0, recheckEvery: 0 }, {});
	assert.strictEqual(s.queue.length, 8);
	assert.ok(s.queue.every((c) => c.type !== "book"));
	assert.ok(newSession(deck, tree, p, { ...S, learning: 9, sessionLength: 0, recheckEvery: 0 }, {}).queue.some((c) => c.type === "book"));
});

test("interleaving: book runs stay together and a variation's cards are kept apart where possible", () => {
	const p = emptyProgress();
	markKnown(p, v("...d6 Sicilians").key, deck, S);
	const s = newSession(deck, tree, p, { ...S, learning: 20, sessionLength: 0, recheckEvery: 0 }, {});
	const keys = s.queue.map((c) => c.vkey);
	for (const k of new Set(keys)) {
		const run = s.queue.map((c, i) => (c.vkey === k && c.type === "book" ? i : -1)).filter((i) => i >= 0);
		assert.ok(run.every((x, i) => i === 0 || x === run[i - 1] + 1), "one run");
	}
	// with only the order and name cards of two variations, they alternate
	const q = emptyProgress();
	const two = deck.filter((c) => ["name", "order"].includes(c.type) && [v("...d6 Sicilians").key, v("...e6 Sicilians").key].includes(c.vkey));
	const t = newSession(two, tree, q, { ...S, learning: 9, sessionLength: 0 }, {});
	assert.deepStrictEqual(t.queue.map((c) => c.vkey).filter((k, i, a) => i && k === a[i - 1]), []);
	// requeues skip a spot that holds the same variation
	const root = v("...d6 Sicilians").key;
	const mk = (id, vkey) => ({ id, type: "name", vkey });
	const [a, b, c, d, e, f] = [mk("a", root), mk("b", "x"), mk("c", "y"), mk("d", root), mk("e", "z"), mk("f", "w")];
	const w = hand([a, b, c, d, e, f]);
	answer(w, emptyProgress(), a, false, S);
	assert.deepStrictEqual(idsOf(w.queue), ["a", "b", "c", "d", "a", "e", "f"], "moved past d, which has the same variation");
});

test("difficulty: two misses in the last five hold back unasked cards and their intros, until they scroll out", () => {
	const st = { ...SI, sessionLength: 0, learning: 3, recheckEvery: 0 };
	const ctx = { deck: deckI, tree };
	const p = emptyProgress();
	const s = newSession(deckI, tree, p, st, {});
	const pass = () => { while (current(s).type === "intro") answer(s, p, current(s), true, st, ctx); };
	const unasked = () => s.queue.slice(s.i).some((c) => !p.cards[c.id] && c.type !== "intro");
	pass();
	answer(s, p, current(s), false, st, ctx);
	assert.ok(unasked(), "one miss holds nothing back");
	pass();
	answer(s, p, current(s), false, st, ctx);
	assert.ok(s.queue.slice(s.i).every((c) => c.type !== "intro" && p.cards[c.id]), "only asked cards remain");
	// nothing joins while it lasts, and new cards (with their intros) resume after
	let resumed = false;
	for (let k = 0; k < 20 && !resumed; k++) {
		pass();
		answer(s, p, current(s), true, st, ctx);
		const held = s.results.slice(-5).filter((r) => !r.right).length >= 2;
		if (held) assert.ok(!unasked(), "held back");
		else resumed = unasked();
	}
	assert.ok(resumed);
	// practice is never held back
	const pr = newSession(deckI, tree, emptyProgress(), { ...SI, sessionLength: 0 }, { practice: true });
	const n = pr.queue.length;
	answer(pr, emptyProgress(), pr.queue[0], false, SI);
	answer(pr, emptyProgress(), pr.queue[1], false, SI);
	assert.ok(pr.queue.length >= n);
});

test("tricky: the third miss sets the card aside, learning clears it, the summary and the outline see it", () => {
	const c = deck[0];
	const p = emptyProgress();
	const s = hand([c, deck[1], deck[2], deck[3], deck[4], deck[5], deck[6]], { before: { learned: new Set(), mastered: new Set() } });
	answer(s, p, c, false, S);
	answer(s, p, c, false, S);
	assert.strictEqual(s.queue.filter((x) => x === c).length, 3, "requeued after the second miss");
	assert.ok(!p.cards[c.id].tricky);
	const before = s.queue.length;
	answer(s, p, c, false, S);
	assert.strictEqual(s.queue.length, before, "not requeued after the third");
	assert.strictEqual(p.cards[c.id].tricky, true);
	assert.ok(s.tricky.has(c.id));
	assert.ok(isTricky(c.vkey, deck, p) && !isTricky("nowhere", deck, p));
	const sum = sessionSummary(s, tree, deck, p, S);
	assert.deepStrictEqual(sum.tricky, [{ id: c.id, vkey: c.vkey, name: tree.byKey.get(c.vkey).name }]);
	// learned again: two right answers in a row clear the mark
	answer(hand([c]), p, c, true, S);
	assert.strictEqual(p.cards[c.id].tricky, true);
	answer(hand([c]), p, c, true, S);
	assert.ok(learnedCard(p.cards[c.id], S) && !("tricky" in p.cards[c.id]));
	// a book card's tricky entry is named after its variation, or "Book"
	const bk = { id: "book|x", type: "book", vkey: "" };
	const s2 = hand([bk], { before: { learned: new Set(), mastered: new Set() } });
	s2.tricky.add(bk.id);
	assert.deepStrictEqual(sessionSummary(s2, tree, [bk], p, S).tricky, [{ id: "book|x", vkey: "", name: "Book" }]);
});

test("unlocksIfLearned counts the children and also-children that are still closed", () => {
	const p = emptyProgress();
	const root = v("...d6 Sicilians").key;
	assert.strictEqual(unlocksIfLearned(root, tree, deck, p, S), 2, "Najdorf and Scheveningen");
	assert.strictEqual(unlocksIfLearned(v("...e6 Sicilians").key, tree, deck, p, S), 1, "Scheveningen is also reached from it");
	assert.strictEqual(unlocksIfLearned(v("English Attack").key, tree, deck, p, S), 0);
	assert.strictEqual(unlocksIfLearned("", tree, deck, p, S), 0);
	markKnown(p, root, deck, S);
	assert.strictEqual(unlocksIfLearned(root, tree, deck, p, S), 0);
});
