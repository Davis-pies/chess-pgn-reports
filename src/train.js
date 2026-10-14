import { fenMap } from "./pgn.js";
import { posKey } from "./audit.js";
import { isMainLine } from "./tree.js";

// Train mode's logic, no DOM: cards from the variation tree, answer checks,
// Leitner scheduling, unlocking, sessions and the saved progress.

export const DAY = 86400000;
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
	masteryBox: 3,
	intervals: [0, 1, 3, 7, 16, 35],
	newPerSession: 10,
	sessionLength: 20,
};

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MAX_BOX = 5;

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
	choices: (x) => isInt(x, 2, 12),
	showMoves: (x) => typeof x === "boolean",
	orderHint: (x) => typeof x === "boolean",
	familyShowName: (x) => typeof x === "boolean",
	familyGroup: isStrs,
	bookSide: (x) => ["white", "black", "both"].includes(x),
	bookRule: (x) => x === "any" || x === "main",
	masteryBox: (x) => isInt(x, 1, MAX_BOX),
	intervals: (x) => Array.isArray(x) && x.length === MAX_BOX + 1 && x.every((n) => typeof n === "number" && n >= 0),
	newPerSession: (x) => isInt(x, 0),
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
	out.intervals = [...out.intervals];
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
			if (r && isInt(r.box, 0, MAX_BOX) && typeof r.seen === "number") cards[k] = { box: r.box, seen: r.seen, skip: !!r.skip };
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

// --- scheduling and unlocking -----------------------------------------------

const dueAt = (rec, settings) => rec.seen + settings.intervals[rec.box] * DAY;

export const isDue = (rec, settings, now) => !!rec && !rec.skip && (rec.box === 0 || now >= dueAt(rec, settings));

const masteredBy = (cards, progress, settings) =>
	cards.every((c) => (progress.cards[c.id]?.box ?? -1) >= settings.masteryBox);
const ownCards = (vkey, deck) => deck.filter((c) => c.vkey === vkey && c.type !== "book");

export const isMastered = (vkey, deck, progress, settings) => masteredBy(ownCards(vkey, deck), progress, settings);

export function unlockedKeys(tree, deck, progress, settings) {
	const mastered = new Map();
	const touched = new Set();
	const cards = new Map();
	for (const c of deck) {
		if (progress.cards[c.id]) touched.add(c.vkey);
		if (c.type !== "book") (cards.get(c.vkey) || cards.set(c.vkey, []).get(c.vkey)).push(c);
	}
	const done = (v) => {
		if (!mastered.has(v.key)) mastered.set(v.key, masteredBy(cards.get(v.key) || [], progress, settings));
		return mastered.get(v.key);
	};
	const out = new Set();
	for (const v of tree.byKey.values()) {
		if (!v.parent || done(v.parent) || v.also.some(done) || touched.has(v.key)) out.add(v.key);
	}
	return out;
}

// Only mastery is checked here, not unlocking: newSession checks both. (A
// mastered variation has records, and a record unlocks it, so the tree isn't
// needed.)
export const bookOpen = (vkey, deck, progress, settings) => vkey === "" || isMastered(vkey, deck, progress, settings);

// --- sessions ------------------------------------------------------------

function inScope(tree, scope) {
	if (scope === null) return null;
	const set = new Set([scope]);
	const add = (v) => v.children.forEach((c) => { set.add(c.key); add(c); });
	if (tree.byKey.has(scope)) add(tree.byKey.get(scope));
	return set;
}

export function newSession(deck, tree, progress, settings, { now, scope = null, practice = false, keys = null }) {
	const unlockedBefore = unlockedKeys(tree, deck, progress, settings);
	const sc = inScope(tree, scope);
	// `keys` is a further limit (the outline's tag filter); it only narrows the
	// cards, so unlocking still sees the whole deck
	const cards = deck.filter((c) => (!sc || sc.has(c.vkey)) && (!keys || keys.has(c.vkey)));
	const cap = (q) => (settings.sessionLength > 0 ? q.slice(0, settings.sessionLength) : q);
	if (practice) return { queue: cap(cards), i: 0, results: [], unlockedBefore };
	const open = new Map();
	const ok = (c) => {
		if (c.vkey === "") return true;
		if (!open.has(c.vkey)) open.set(c.vkey, [unlockedBefore.has(c.vkey), bookOpen(c.vkey, deck, progress, settings)]);
		const [unlocked, booked] = open.get(c.vkey);
		return unlocked && (c.type !== "book" || booked);
	};
	const index = new Map(deck.map((c, n) => [c, n]));
	const due = cards.filter((c) => ok(c) && isDue(progress.cards[c.id], settings, now));
	// a variation's book cards go as a run: they share their earliest due time
	const when = new Map();
	for (const c of due) {
		const k = c.type === "book" ? c.vkey : c.id;
		const t = dueAt(progress.cards[c.id], settings);
		when.set(k, Math.min(when.get(k) ?? Infinity, t));
	}
	const key = (c) => when.get(c.type === "book" ? c.vkey : c.id);
	due.sort((a, b) => key(a) - key(b) || index.get(a) - index.get(b));
	const fresh = cards
		.filter((c) => !progress.cards[c.id] && ok(c))
		.sort((a, b) => a.level - b.level || index.get(a) - index.get(b))
		.slice(0, settings.newPerSession);
	return { queue: cap([...due, ...fresh]), i: 0, results: [], unlockedBefore };
}

export const current = (s) => s.queue[s.i] || null;

export function answer(session, progress, card, right, settings, now) {
	const rec = progress.cards[card.id] || { box: 0, seen: 0, skip: false };
	const from = rec.box;
	// a card requeued after a miss can't climb again in the same session
	const again = session.results.some((r) => r.id === card.id);
	const to = right ? (again ? from : Math.min(from + 1, MAX_BOX)) : 1;
	progress.cards[card.id] = { ...rec, box: to, seen: now };
	session.results.push({ id: card.id, right, from, to });
	if (!right) session.queue.splice(Math.min(session.i + 3, session.queue.length), 0, card);
	session.i++;
}

export function sessionSummary(session, tree, deck, progress, settings, now) {
	const first = new Map();
	let right = 0;
	for (const r of session.results) {
		if (r.right) right++;
		const f = first.get(r.id);
		first.set(r.id, { from: f ? f.from : r.from, to: r.to });
	}
	const moved = (sign) => [...first].filter(([, r]) => Math.sign(r.to - r.from) === sign).map(([id]) => id);
	const times = Object.values(progress.cards).filter((r) => !r.skip).map((r) => dueAt(r, settings)).filter((t) => t > now);
	return {
		right,
		wrong: session.results.length - right,
		up: moved(1),
		down: moved(-1),
		unlocked: [...unlockedKeys(tree, deck, progress, settings)].filter((k) => !session.unlockedBefore.has(k)).map((k) => tree.byKey.get(k).name),
		nextDue: times.length ? Math.min(...times) : null,
	};
}

// --- manual overrides, per variation ----------------------------------------

const inVar = (vkey, deck) => deck.filter((c) => c.vkey === vkey);

export function markKnown(progress, vkey, deck, settings, now) {
	for (const c of ownCards(vkey, deck)) progress.cards[c.id] = { box: settings.masteryBox, seen: now, skip: false };
}

export function skip(progress, vkey, deck, on) {
	for (const c of inVar(vkey, deck)) {
		const rec = progress.cards[c.id];
		if (on) progress.cards[c.id] = { ...(rec || { box: 0, seen: 0 }), skip: true };
		else if (rec) {
			rec.skip = false;
			if (rec.seen === 0 && rec.box === 0) delete progress.cards[c.id]; // only existed to be skipped
		}
	}
}

export function resetVar(progress, vkey, deck) {
	for (const c of inVar(vkey, deck)) delete progress.cards[c.id];
}

export function setBox(progress, vkey, deck, box, now) {
	for (const c of inVar(vkey, deck)) progress.cards[c.id] = { skip: false, ...progress.cards[c.id], box, seen: now };
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
