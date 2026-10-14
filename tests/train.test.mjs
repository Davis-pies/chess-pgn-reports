import { test, beforeEach, after } from "node:test";
import assert from "node:assert";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { namesFromNodes, variationTree } from "../src/names.js";
import {
	DAY, DEFAULT_SETTINGS, buildDeck, normalizeSettings, emptyProgress, loadProgress, saveProgress, moveProgress,
	isDue, isMastered, unlockedKeys, bookOpen, newSession, current, answer, sessionSummary,
	markKnown, skip, resetVar, setBox, checkName, nameChoices, orderStep, checkFamily, checkBook, allTags,
} from "../src/train.js";

const PGN = `1. e4 c5 2. Nf3 d6 {[%name "...d6 Sicilians"]} (2... e6 {[%name "...e6 Sicilians"] [%tags "e6"]} 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 d6 {[%name "Scheveningen"] Small centre.}) 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 e6 {[%name "Scheveningen"]} (5... a6 {[%name "Najdorf"] [%tags "d6; Nc3 committed"]} 6. Be3 {[%name "English Attack"]}) *`;
const { nodes } = parsePgn(PGN);
const lines = collectLines(nodes);
const tree = variationTree(lines, namesFromNodes(nodes));
const S = { ...DEFAULT_SETTINGS, types: { name: true, order: true, family: true, book: true } };
const deck = buildDeck(tree, lines, S);
const v = (n) => [...tree.byKey.values()].find((x) => x.name === n);
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

test("isDue: box 0, box 2 around its interval, skipped, and missing", () => {
	assert.strictEqual(isDue({ box: 0, seen: NOW, skip: false }, S, NOW), true);
	const rec = { box: 2, seen: NOW, skip: false };
	assert.strictEqual(isDue(rec, S, NOW + 3 * DAY - 1), false);
	assert.strictEqual(isDue(rec, S, NOW + 3 * DAY), true);
	assert.strictEqual(isDue({ ...rec, skip: true }, S, NOW + 9 * DAY), false);
	assert.strictEqual(isDue(undefined, S, NOW), false);
});

test("unlocking: roots, then children of a mastered node, then via also", () => {
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
	// a record on a child's card unlocks it too
	p = emptyProgress();
	p.cards[`name|${v("Najdorf").key}`] = { box: 1, seen: NOW, skip: false };
	assert.ok(names(p).includes("Najdorf"));
	// a variation with no non-book cards counts as mastered
	assert.ok(isMastered("nowhere", deck, emptyProgress(), S));
});

test("newSession: due before new, caps, scope and practice", () => {
	const p = emptyProgress();
	const root = v("...d6 Sicilians").key;
	const dueId = `name|${root}`;
	p.cards[dueId] = { box: 1, seen: NOW - 5 * DAY, skip: false };
	p.cards[`order|${root}`] = { box: 1, seen: NOW - 9 * DAY, skip: false };
	const fresh = { ...S, newPerSession: 3, sessionLength: 0 };
	let s = newSession(deck, tree, p, fresh, { now: NOW });
	assert.deepStrictEqual(s.queue.slice(0, 2).map((c) => c.id), [`order|${root}`, dueId]);
	assert.strictEqual(s.queue.length, 5);
	assert.ok(s.queue.slice(2).every((c) => !p.cards[c.id] && c.level === 1));
	assert.strictEqual(current(s).id, `order|${root}`);
	s = newSession(deck, tree, p, { ...fresh, sessionLength: 4 }, { now: NOW });
	assert.strictEqual(s.queue.length, 4);
	// scope: Najdorf's subtree only, practice ignores the lock
	const naj = v("Najdorf").key;
	assert.strictEqual(newSession(deck, tree, p, fresh, { now: NOW, scope: naj }).queue.length, 0);
	const pr = newSession(deck, tree, p, { ...S, sessionLength: 0 }, { now: NOW, scope: naj, practice: true });
	assert.deepStrictEqual([...new Set(pr.queue.map((c) => c.vkey))].sort(), [naj, v("English Attack").key].sort());
	assert.ok(pr.queue.length >= 5);
	assert.strictEqual(newSession(deck, tree, p, { ...S, sessionLength: 2 }, { now: NOW, practice: true }).queue.length, 2);
	// book cards of an open variation join; of a closed one do not
	markKnown(p, root, deck, S, NOW);
	const open = newSession(deck, tree, p, { ...S, newPerSession: 99, sessionLength: 0 }, { now: NOW });
	assert.ok(open.queue.some((c) => c.type === "book" && c.vkey === root));
	assert.ok(!open.queue.some((c) => c.type === "book" && c.vkey === naj));
	// skipped cards stay out
	skip(p, root, deck, true);
	assert.ok(!newSession(deck, tree, p, { ...S, newPerSession: 99 }, { now: NOW }).queue.some((c) => c.vkey === root));
	// a due book card
	const bk = deck.find((c) => c.type === "book" && c.vkey === root);
	const q = emptyProgress();
	markKnown(q, root, deck, S, NOW);
	q.cards[bk.id] = { box: 1, seen: NOW - 2 * DAY, skip: false };
	assert.strictEqual(newSession(deck, tree, q, { ...S, newPerSession: 0 }, { now: NOW }).queue[0].id, bk.id);
});

test("newSession: an unnamed workbook is one book variation", () => {
	const ls = [{ moves: [{ san: "e4", ply: 1 }, { san: "e5", ply: 2 }], comments: [], isMain: true }];
	const t = variationTree(ls, {});
	const d = buildDeck(t, ls, S);
	assert.strictEqual(d.length, 1);
	assert.strictEqual(newSession(d, t, emptyProgress(), S, { now: NOW }).queue.length, 1);
});

test("answer: right climbs to 5, wrong drops to 1 and returns 3 later", () => {
	const p = emptyProgress();
	const c = deck[0];
	let s;
	for (let k = 0; k < 6; k++) {
		s = { queue: [c, deck[1], deck[2], deck[3], deck[4]], i: 0, results: [], unlockedBefore: new Set() };
		answer(s, p, c, true, S, NOW);
	}
	assert.strictEqual(p.cards[c.id].box, 5);
	assert.deepStrictEqual(s.results[0], { id: c.id, right: true, from: 5, to: 5 });
	assert.strictEqual(p.cards[c.id].seen, NOW);
	const w = { queue: [c, deck[1], deck[2], deck[3], deck[4]], i: 0, results: [], unlockedBefore: new Set() };
	answer(w, p, c, false, S, NOW);
	assert.strictEqual(p.cards[c.id].box, 1);
	assert.strictEqual(w.i, 1);
	assert.strictEqual(w.queue[3], c);
	const end = { queue: [c], i: 0, results: [], unlockedBefore: new Set() };
	answer(end, p, c, false, S, NOW);
	assert.deepStrictEqual(end.queue, [c, c]);
	assert.strictEqual(current({ queue: [c], i: 1 }), null);
});

test("answer: a requeued miss is not promoted again in the same session", () => {
	const p = emptyProgress();
	const c = deck[0];
	const s = { queue: [c], i: 0, results: [], unlockedBefore: new Set() };
	answer(s, p, c, false, S, NOW);
	answer(s, p, c, true, S, NOW + 1);
	assert.strictEqual(p.cards[c.id].box, 1, "stays in box 1");
	assert.strictEqual(p.cards[c.id].seen, NOW + 1);
	answer(s, p, c, false, S, NOW + 2);
	assert.strictEqual(p.cards[c.id].box, 1);
});

test("sessionSummary: up, down, unlocked and next due", () => {
	const p = emptyProgress();
	const root = v("...d6 Sicilians").key;
	const s = newSession(deck, tree, p, { ...S, sessionLength: 0 }, { now: NOW });
	const a = deck.find((c) => c.id === `name|${root}`);
	const b = deck.find((c) => c.id === `order|${root}`);
	for (let k = 0; k < 3; k++) answer(s, p, a, true, S, NOW);
	answer(s, p, b, true, S, NOW);
	answer(s, p, b, false, S, NOW);
	const m = sessionSummary(s, tree, deck, p, S, NOW);
	assert.strictEqual(m.right, 4);
	assert.strictEqual(m.wrong, 1);
	assert.deepStrictEqual(m.up, [a.id, b.id]);
	assert.deepStrictEqual(m.down, []);
	assert.strictEqual(m.nextDue, NOW + DAY);
	markKnown(p, root, deck, S, NOW);
	const m2 = sessionSummary(s, tree, deck, p, S, NOW);
	assert.deepStrictEqual(m2.unlocked.sort(), ["Najdorf", "Scheveningen"]);
	const d = { queue: [], i: 0, results: [{ id: "x", right: false, from: 3, to: 1 }], unlockedBefore: new Set() };
	assert.deepStrictEqual(sessionSummary(d, tree, deck, emptyProgress(), S, NOW).down, ["x"]);
	assert.strictEqual(sessionSummary(d, tree, deck, emptyProgress(), S, NOW).nextDue, null);
});

test("manual: markKnown, skip on/off, resetVar, setBox", () => {
	const p = emptyProgress();
	const k = v("Najdorf").key;
	const mine = deck.filter((c) => c.vkey === k);
	markKnown(p, k, deck, S, NOW);
	for (const c of mine) assert.strictEqual(!!p.cards[c.id], c.type !== "book");
	assert.deepStrictEqual(p.cards[`name|${k}`], { box: 3, seen: NOW, skip: false });
	resetVar(p, k, deck);
	assert.deepStrictEqual(p.cards, {});
	skip(p, k, deck, true);
	assert.strictEqual(Object.keys(p.cards).length, mine.length);
	assert.deepStrictEqual(p.cards[`name|${k}`], { box: 0, seen: 0, skip: true });
	skip(p, k, deck, false);
	assert.deepStrictEqual(p.cards, {});
	markKnown(p, k, deck, S, NOW);
	skip(p, k, deck, true);
	skip(p, k, deck, false);
	assert.strictEqual(p.cards[`name|${k}`].skip, false);
	assert.strictEqual(p.cards[`name|${k}`].box, 3);
	setBox(p, k, deck, 2, NOW + 1);
	assert.strictEqual(Object.keys(p.cards).length, mine.length);
	assert.deepStrictEqual(p.cards[`name|${k}`], { box: 2, seen: NOW + 1, skip: false });
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
	p.cards["name|x"] = { box: 2, seen: 5, skip: false };
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
	store.set("ott-train:z", JSON.stringify({ settings: { choices: "x", bogus: 1, nameMode: "typed", intervals: [1] }, cards: { a: { box: 9 }, b: 3, c: { box: 2, seen: 4, skip: true } } }));
	const r = loadProgress("z");
	assert.strictEqual(r.settings.choices, 4);
	assert.strictEqual(r.settings.nameMode, "typed");
	assert.deepStrictEqual(r.settings.intervals, DEFAULT_SETTINGS.intervals);
	assert.ok(!("bogus" in r.settings));
	assert.deepStrictEqual(r.cards, { c: { box: 2, seen: 4, skip: true } });
	assert.deepStrictEqual(normalizeSettings(null), DEFAULT_SETTINGS);
	assert.strictEqual(normalizeSettings({ types: { name: false, x: 1 } }).types.name, false);
	assert.strictEqual(normalizeSettings({ bookSide: "up", masteryBox: 9, familyGroup: ["a", 3] }).bookSide, "black");
	assert.deepStrictEqual(normalizeSettings({ familyGroup: ["a"] }).familyGroup, ["a"]);
	global.localStorage.setItem = () => { throw new Error("full"); };
	assert.strictEqual(saveProgress("q", p), false);
	delete global.localStorage;
	assert.deepStrictEqual(loadProgress("q"), emptyProgress());
	assert.strictEqual(saveProgress("q", p), false);
	moveProgress("q", "r");
});
