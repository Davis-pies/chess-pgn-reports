import { fenMap } from "./pgn.js";
import { posKey } from "./audit.js";
import { isMainLine } from "./tree.js";

// Train mode's logic, no DOM: cards from the variation tree, answer checks,
// streaks, unlocking, sessions and the saved progress. Nothing here depends on
// the clock: a card's streak is what the reader knows now, and `seen` only
// orders the queue.

export const DEFAULT_SETTINGS = {
	types: { name: true, order: true, family: false, book: true },
	nameMode: "choice",
	choices: 4,
	showMoves: false,
	orderHint: false,
	familyShowName: true,
	familyGroup: [],
	bookSide: "black",
	bookRule: "any",
	learnStreak: 2,
	masterStreak: 5,
	newPerSession: 5,
	reviews: 3,
	sessionLength: 20,
};

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// --- deck -------------------------------------------------------------

export function buildDeck(tree, lines, settings) {
	const deck = [];
	const on = settings.types;
	for (const v of tree.byKey.values()) {
		const base = { key: v.key, vkey: v.key, level: v.level };
		if (on.name) deck.push({ id: `name|${v.key}`, type: "name", ...base });
		if (on.order) deck.push({ id: `order|${v.key}`, type: "order", ...base });
		if (on.family && v.tags.length) deck.push({ id: `family|${v.key}`, type: "family", ...base });
	}
	if (on.book) deck.push(...bookCards(tree, lines, settings));
	return deck;
}

// One card per position where the reader is to move, merged across lines.
function bookCards(tree, lines, settings) {
	const want = settings.bookSide === "white" ? "w" : settings.bookSide === "black" ? "b" : null;
	const cards = new Map();
	for (const line of lines) {
		const fens = fenMap(line.moves);
		let vkey = ""; // nearest named position at or before this one
		let started = tree.roots.length === 0; // with names, no cards before the first
		line.moves.forEach((m, i) => {
			const fen = i ? fens.get(line.moves[i - 1].ply) : START;
			const sans = line.moves.slice(0, i).map((x) => x.san);
			if (i) {
				const key = posKey(fen);
				if (tree.byKey.has(key)) { vkey = key; started = true; }
			}
			if (!started || (want && fen.split(" ")[1] !== want)) return;
			const key = posKey(fen);
			let c = cards.get(key);
			if (!c) {
				const v = tree.byKey.get(vkey);
				c = { id: `book|${key}`, type: "book", key, vkey, level: v ? v.level : 0, sans, moves: [], main: null, notes: {} };
				cards.set(key, c);
			}
			if (!c.moves.includes(m.san)) c.moves.push(m.san);
			if (isMainLine(line) && !c.main) c.main = m.san;
			const note = (line.comments || []).find((x) => x.ply === m.ply);
			if (note && !(m.san in c.notes)) c.notes[m.san] = note.text;
		});
	}
	return [...cards.values()];
}

// --- settings and storage ------------------------------------------------

const isInt = (x, min, max = Infinity) => Number.isInteger(x) && x >= min && x <= max;
const isStrs = (a) => Array.isArray(a) && a.every((x) => typeof x === "string");
const VALID = {
	types: (x) => !!x && typeof x === "object",
	nameMode: (x) => x === "choice" || x === "typed",
	choices: (x) => isInt(x, 2, 8),
	showMoves: (x) => typeof x === "boolean",
	orderHint: (x) => typeof x === "boolean",
	familyShowName: (x) => typeof x === "boolean",
	familyGroup: isStrs,
	bookSide: (x) => ["white", "black", "both"].includes(x),
	bookRule: (x) => x === "any" || x === "main",
	learnStreak: (x) => isInt(x, 1, 10),
	masterStreak: (x) => isInt(x, 1, 20),
	newPerSession: (x) => isInt(x, 0, 50),
	reviews: (x) => isInt(x, 0, 20),
	sessionLength: (x) => isInt(x, 0),
};

export function normalizeSettings(raw) {
	const out = {};
	for (const k of Object.keys(DEFAULT_SETTINGS)) {
		const x = raw && raw[k];
		out[k] = x !== undefined && VALID[k](x) ? x : DEFAULT_SETTINGS[k];
	}
	out.types = { ...DEFAULT_SETTINGS.types };
	for (const t of Object.keys(out.types)) if (raw && raw.types && typeof raw.types[t] === "boolean") out.types[t] = raw.types[t];
	out.familyGroup = [...out.familyGroup];
	if (out.masterStreak < out.learnStreak) out.masterStreak = out.learnStreak; // mastered is never easier than learned
	return out;
}

export const emptyProgress = () => ({ settings: normalizeSettings(null), cards: {} });

const storeKey = (id) => `ott-train:${id || "unsaved"}`;

export function loadProgress(id) {
	try {
		const raw = JSON.parse(localStorage.getItem(storeKey(id)));
		if (!raw || typeof raw !== "object") return emptyProgress();
		const cards = {};
		for (const [k, r] of Object.entries(raw.cards || {})) {
			// a first-version record ({ box, seen, skip }) has no streak: it starts again
			if (r && typeof r.seen === "number") cards[k] = { streak: isInt(r.streak, 0) ? r.streak : 0, seen: r.seen, skip: !!r.skip };
		}
		return { settings: normalizeSettings(raw.settings), cards };
	} catch {
		return emptyProgress(); // missing storage or unreadable JSON
	}
}

export function saveProgress(id, progress) {
	try {
		localStorage.setItem(storeKey(id), JSON.stringify(progress));
		return true;
	} catch {
		return false;
	}
}

export function moveProgress(fromId, toId) {
	try {
		const raw = localStorage.getItem(storeKey(fromId));
		if (raw === null) return;
		localStorage.setItem(storeKey(toId), raw);
		localStorage.removeItem(storeKey(fromId));
	} catch {
		// nothing to move
	}
}

// --- streaks and unlocking -----------------------------------------------------

export const learnedCard = (rec, s) => (rec?.streak ?? 0) >= s.learnStreak;
export const masteredCard = (rec, s) => (rec?.streak ?? 0) >= s.masterStreak;

const allBy = (test) => (cards, progress, settings) => cards.every((c) => test(progress.cards[c.id], settings));
const learnedBy = allBy(learnedCard);
const masteredBy = allBy(masteredCard);
const ownCards = (vkey, deck) => deck.filter((c) => c.vkey === vkey && c.type !== "book");

export const isLearned = (vkey, deck, progress, settings) => learnedBy(ownCards(vkey, deck), progress, settings);
export const isMastered = (vkey, deck, progress, settings) => masteredBy(ownCards(vkey, deck), progress, settings);

export function unlockedKeys(tree, deck, progress, settings) {
	const learned = new Map();
	const touched = new Set();
	const cards = new Map();
	for (const c of deck) {
		if (progress.cards[c.id]) touched.add(c.vkey);
		if (c.type !== "book") (cards.get(c.vkey) || cards.set(c.vkey, []).get(c.vkey)).push(c);
	}
	const done = (v) => {
		if (!learned.has(v.key)) learned.set(v.key, learnedBy(cards.get(v.key) || [], progress, settings));
		return learned.get(v.key);
	};
	const out = new Set();
	for (const v of tree.byKey.values()) {
		if (!v.parent || done(v.parent) || v.also.some(done) || touched.has(v.key)) out.add(v.key);
	}
	return out;
}

// Only learning is checked here, not unlocking: the callers check both. (A
// learned variation has records, and a record unlocks it, so the tree isn't
// needed.)
export const bookOpen = (vkey, deck, progress, settings) => vkey === "" || isLearned(vkey, deck, progress, settings);

// --- sessions ------------------------------------------------------------

function inScope(tree, scope) {
	if (scope === null) return null;
	const set = new Set([scope]);
	const add = (v) => v.children.forEach((c) => { set.add(c.key); add(c); });
	if (tree.byKey.has(scope)) add(tree.byKey.get(scope));
	return set;
}

// "May be asked now": the variation is unlocked and, for a book card, learned.
// Shared by the opening queue and by deepening, which asks again after an
// answer unlocks more.
function openTest(deck, progress, settings, unlocked) {
	const memo = new Map();
	return (c) => {
		if (c.vkey === "") return true;
		if (!memo.has(c.vkey)) memo.set(c.vkey, [unlocked.has(c.vkey), bookOpen(c.vkey, deck, progress, settings)]);
		const [open, booked] = memo.get(c.vkey);
		return open && (c.type !== "book" || booked);
	};
}

// which variations are learned / mastered, to tell afterwards what changed
const states = (tree, deck, progress, settings) => {
	const keys = [...tree.byKey.keys()];
	return {
		learned: new Set(keys.filter((k) => isLearned(k, deck, progress, settings))),
		mastered: new Set(keys.filter((k) => isMastered(k, deck, progress, settings))),
	};
};

export function newSession(deck, tree, progress, settings, { scope = null, practice = false, keys = null }) {
	const unlockedBefore = unlockedKeys(tree, deck, progress, settings);
	const sc = inScope(tree, scope);
	// `keys` is a further limit (the outline's tag filter); it only narrows the
	// cards, so unlocking still sees the whole deck
	const pool = deck.filter((c) => (!sc || sc.has(c.vkey)) && (!keys || keys.has(c.vkey)) && !progress.cards[c.id]?.skip);
	const cap = (q) => (settings.sessionLength > 0 ? q.slice(0, settings.sessionLength) : q);
	const base = { i: 0, results: [], unlockedBefore, practice, pool, before: states(tree, deck, progress, settings) };
	if (practice) return { ...base, queue: cap(pool), newLeft: 0 };
	const ok = openTest(deck, progress, settings, unlockedBefore);
	const open = pool.filter(ok);
	const rec = (c) => progress.cards[c.id];
	const bySeen = (a, b) => rec(a).seen - rec(b).seen; // sorts are stable, so deck order breaks ties
	const started = open.filter((c) => rec(c) && !masteredCard(rec(c), settings)).sort(bySeen);
	const fresh = open
		.filter((c) => !rec(c))
		.sort((a, b) => a.level - b.level)
		.slice(0, settings.newPerSession);
	const recheck = open.filter((c) => rec(c) && masteredCard(rec(c), settings)).sort(bySeen).slice(0, settings.reviews);
	return { ...base, queue: cap([...started, ...fresh, ...recheck]), newLeft: settings.newPerSession - fresh.length };
}

export const current = (s) => s.queue[s.i] || null;

// `ctx` ({ deck, tree }) lets an answer that unlocks variations pull their new
// cards into the session at once, so a first sitting goes deeper than level 1.
export function answer(session, progress, card, right, settings, now, ctx = null) {
	const rec = progress.cards[card.id] || { streak: 0, seen: 0, skip: false };
	const from = rec.streak;
	const before = ctx && unlockedKeys(ctx.tree, ctx.deck, progress, settings);
	// a miss takes a card down one stage: a mastered card to learned, any other to the start
	const to = right ? Math.min(from + 1, settings.masterStreak) : masteredCard(rec, settings) ? settings.learnStreak : 0;
	progress.cards[card.id] = { ...rec, streak: to, seen: now };
	const result = { id: card.id, right, from, to, unlocked: [] };
	session.results.push(result);
	// a miss, and a right answer on a card not yet learned, come back three questions later
	if (!right || !learnedCard(progress.cards[card.id], settings)) session.queue.splice(Math.min(session.i + 3, session.queue.length), 0, card);
	session.i++;
	if (!ctx || session.practice) return result;
	const after = unlockedKeys(ctx.tree, ctx.deck, progress, settings);
	result.unlocked = [...after].filter((k) => !before.has(k)).map((k) => ctx.tree.byKey.get(k).name);
	if (session.newLeft > 0) {
		const ok = openTest(ctx.deck, progress, settings, after);
		const queued = new Set(session.queue);
		const room = settings.sessionLength > 0 ? settings.sessionLength - queued.size : Infinity;
		const more = session.pool
			.filter((c) => !progress.cards[c.id] && !queued.has(c) && ok(c))
			.sort((a, b) => a.level - b.level)
			.slice(0, Math.max(0, Math.min(session.newLeft, room)));
		session.queue.push(...more);
		session.newLeft -= more.length;
	}
	return result;
}

export function sessionSummary(session, tree, deck, progress, settings) {
	const right = session.results.filter((r) => r.right).length;
	const now = states(tree, deck, progress, settings);
	const names = (keys) => keys.map((k) => tree.byKey.get(k).name);
	const unlocked = unlockedKeys(tree, deck, progress, settings);
	return {
		right,
		wrong: session.results.length - right,
		learned: names([...now.learned].filter((k) => !session.before.learned.has(k))),
		mastered: names([...now.mastered].filter((k) => !session.before.mastered.has(k))),
		slipped: names([...session.before.mastered].filter((k) => !now.mastered.has(k))),
		unlocked: names([...unlocked].filter((k) => !session.unlockedBefore.has(k))),
		locked: tree.byKey.size - unlocked.size,
	};
}

// --- manual overrides, per variation ----------------------------------------

const inVar = (vkey, deck) => deck.filter((c) => c.vkey === vkey);

export function markKnown(progress, vkey, deck, settings, now) {
	for (const c of ownCards(vkey, deck)) progress.cards[c.id] = { streak: settings.masterStreak, seen: now, skip: false };
}

export function skip(progress, vkey, deck, on) {
	for (const c of inVar(vkey, deck)) {
		const rec = progress.cards[c.id];
		if (on) progress.cards[c.id] = { ...(rec || { streak: 0, seen: 0 }), skip: true };
		else if (rec) {
			rec.skip = false;
			if (rec.seen === 0 && rec.streak === 0) delete progress.cards[c.id]; // only existed to be skipped
		}
	}
}

export function resetVar(progress, vkey, deck) {
	for (const c of inVar(vkey, deck)) delete progress.cards[c.id];
}

// --- answer checks ------------------------------------------------------------

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/ +/g, " ").trim();

export function checkName(input, name) {
	const a = norm(input);
	return a !== "" && [name, ...name.split("/")].some((n) => norm(n) === a);
}

function shuffle(list, rng) {
	const a = [...list];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

export function nameChoices(card, tree, settings, rng) {
	const right = tree.byKey.get(card.key);
	const others = [...tree.byKey.values()].filter((v) => v !== right && v.name !== right.name);
	const same = shuffle(others.filter((v) => v.level === right.level), rng);
	const rest = others.filter((v) => v.level !== right.level);
	const names = [...new Set([right.name, ...same.map((v) => v.name), ...rest.map((v) => v.name)])];
	return shuffle(names.slice(0, settings.choices), rng);
}

export function orderStep(orders, played, san) {
	const n = played.length;
	const live = orders.filter((o) => played.every((s, i) => o[i] === s) && o.length > n);
	return {
		ok: live.some((o) => o[n] === san),
		done: live.some((o) => o[n] === san && o.length === n + 1),
		accepted: [...new Set(live.map((o) => o[n]))],
	};
}

export const checkFamily = (selected, tags) => selected.length === tags.length && tags.every((t) => selected.includes(t));

export const checkBook = (card, san, settings) =>
	settings.bookRule === "main" && card.main ? san === card.main : card.moves.includes(san);

export const allTags = (tree) => [...new Set([...tree.byKey.values()].flatMap((v) => v.tags))].sort();
