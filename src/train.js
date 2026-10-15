import { Chess } from "chess.js";
import { fenMap } from "./pgn.js";
import { posKey } from "./audit.js";
import { isMainLine } from "./tree.js";
import { fullmoveLabel } from "./render.js";

// Train mode's logic, no DOM: cards from the variation tree, answer checks,
// streaks, unlocking, sessions and the saved progress. Nothing here depends on
// the clock: a card's streak is what the reader knows now, and `seen` is a
// position in the answer count (`progress.asked`), which orders the queue and
// spaces the re-checks.

// A learned card's streak grows only when this many other questions have been
// answered since it was last asked: spacing counted in questions, not time
// (research note 2026-10-14-train-learning-research.md, findings 1-2).
const SPACING = 10;
// misses of one card in a session before it is set aside as tricky (finding 7)
const TRICKY = 3;

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
	learnStreak: 3,
	masterStreak: 5,
	missCost: 2,
	newVariations: 3,
	recheckEvery: 3,
	sessionLength: 20,
	introNew: true,
};

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// --- deck -------------------------------------------------------------

// Every line's comments, by the moves that lead to them. A PGN keeps a
// comment only on the line that owns its move: a sideline's line has none of
// the notes on the moves it shares with the mainline, and a sub-variation's
// line none of its parent's. Reading one line lost them (Davis, 2026-10-14:
// no notes at all on "New: ...Nc6 Sicilians", whose first line was a
// sub-variation's), so a variation's notes are looked up here instead.
function commentsByPath(lines) {
	const out = new Map();
	for (const l of lines) {
		let path = "";
		for (const m of l.moves) {
			path += ` ${m.san}`;
			for (const c of l.comments || []) {
				if (c.ply === m.ply && c.text) (out.get(path) || out.set(path, new Set()).get(path)).add(c.text);
			}
		}
	}
	return out;
}

// The workbook's comments on the moves that reach a variation by its first
// move order: `at` is the move's index in that order, `own` marks the comments
// on the move that reaches the variation. `from` is where its own moves begin,
// after the nearest named position before it (the start, at level 1). A
// question's result shows only the `own` notes; the intro steps through the
// moves from `from` and shows one move's notes at a time (2026-10-14: every
// note at once was a wall of text at level 1).
// `on` lists the named positions that order passes through before the
// variation: its parent, the parent's parent and so on, and an `also` parent
// the order goes by.
function notesOf(v, tree, comments) {
	const order = v.orders[0];
	const chess = new Chess();
	let from = 0;
	let path = "";
	const notes = [];
	const on = [];
	order.forEach((san, at) => {
		chess.move(san);
		path += ` ${san}`;
		const key = posKey(chess.fen());
		if (at < order.length - 1 && tree.byKey.has(key)) {
			from = at + 1;
			on.push(key);
		}
		for (const text of comments.get(path) || []) notes.push({ at, move: fullmoveLabel(at) + san, text, own: at === order.length - 1 });
	});
	return { from, notes, on };
}

// A variation's family: the top-level variation it sits under (Davis,
// 2026-10-15: a run of ...d6 lines trained "I'm doing d6 Sicilians right now"
// instead of recognising the position). Before any named position, "".
function familyOf(tree, vkey) {
	let v = tree.byKey.get(vkey);
	while (v?.parent) v = v.parent;
	return v ? v.key : "";
}

export function buildDeck(tree, lines, settings) {
	const deck = [];
	const on = settings.types;
	const comments = commentsByPath(lines);
	for (const v of tree.byKey.values()) {
		const { from, notes, on: path } = notesOf(v, tree, comments);
		const base = { key: v.key, vkey: v.key, level: v.level, family: familyOf(tree, v.key), on: path };
		// an intro is a step, not a question: it is never stored and never counts
		if (settings.introNew) deck.push({ id: `intro|${v.key}`, type: "intro", ...base, notes, from });
		if (on.name) deck.push({ id: `name|${v.key}`, type: "name", ...base, notes });
		if (on.order) deck.push({ id: `order|${v.key}`, type: "order", ...base, notes });
		if (on.family && v.tags.length) deck.push({ id: `family|${v.key}`, type: "family", ...base, notes });
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
				const on = sans.map((_, k) => posKey(fens.get(line.moves[k].ply))).filter((x) => tree.byKey.has(x));
				c = { id: `book|${key}`, type: "book", key, vkey, level: v ? v.level : 0, family: familyOf(tree, vkey), on, sans, moves: [], main: null, notes: {} };
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
	missCost: (x) => isInt(x, 1, 5),
	newVariations: (x) => isInt(x, 1, 20),
	recheckEvery: (x) => isInt(x, 0, 50),
	introNew: (x) => typeof x === "boolean",
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

export const emptyProgress = () => ({ settings: normalizeSettings(null), cards: {}, asked: 0 });

// One store for the whole browser: cards are keyed by position, so any
// workbook, saved or not, a reloaded or edited PGN, or a file finds the
// progress on every position it still has. Before this, progress lived under
// `ott-train:<workbook id>` and an unsaved workbook's slot was cleared on every
// load, so reloading the PGN lost everything (Davis, 2026-10-14).
const KEY = "ott-train";
const OLD = `${KEY}:`;

// Saved or file data to a progress object, tolerating every older shape.
export function parseProgress(raw) {
	if (!raw || typeof raw !== "object") return emptyProgress();
	const cards = {};
	for (const [k, r] of Object.entries(raw.cards || {})) {
		// a first-version record ({ box, seen, skip }) has no streak: it starts again
		if (r && typeof r.seen === "number") {
			cards[k] = { streak: isInt(r.streak, 0) ? r.streak : 0, seen: r.seen, skip: !!r.skip };
			if (r.tricky === true) cards[k].tricky = true;
		}
	}
	let asked = raw.asked;
	if (!isInt(asked, 0)) {
		// saved when `seen` was a timestamp: number the answers 1..n in that
		// order. A seen of 0 is a record that only holds a skip, never asked.
		const asc = Object.values(cards).filter((r) => r.seen > 0).sort((a, b) => a.seen - b.seen);
		asc.forEach((r, i) => (r.seen = i + 1));
		asked = asc.length;
	}
	return { settings: normalizeSettings(raw.settings), cards, asked };
}

// Fold `from` into `into`: per card the record with the higher streak (a tie:
// the later `seen`); `from`'s settings only when told `into` has none saved.
// An incoming `seen` counts another store's answers; `asked` is raised to
// cover it, or the spacing rule would see a card asked in the future.
export function mergeProgress(into, from, takeSettings = false) {
	for (const [k, r] of Object.entries(from.cards)) {
		const mine = into.cards[k];
		if (!mine || r.streak > mine.streak || (r.streak === mine.streak && r.seen > mine.seen)) {
			into.cards[k] = { ...r };
			into.asked = Math.max(into.asked, r.seen);
		}
	}
	if (takeSettings) into.settings = from.settings;
	return into;
}

// The records for a deck's own cards plus the settings: what Save to file writes.
export function progressFor(progress, deck) {
	const cards = {};
	for (const c of deck) if (progress.cards[c.id]) cards[c.id] = progress.cards[c.id];
	return { settings: progress.settings, asked: progress.asked, cards };
}

export const hasProgress = () => {
	try {
		return localStorage.getItem(KEY) !== null;
	} catch {
		return false;
	}
};

// Older per-workbook keys are merged in once, then removed. Their `seen`
// counts belong to different answer counters, so they are renumbered together
// in the order they had.
function migrate(store) {
	const olds = [];
	for (let i = 0; i < localStorage.length; i++) {
		const k = localStorage.key(i);
		if (k.startsWith(OLD)) olds.push(k);
	}
	if (!olds.length) return store;
	olds.sort();
	let p = store;
	let fresh = !hasProgress();
	for (const k of olds) {
		try {
			p = mergeProgress(p, parseProgress(JSON.parse(localStorage.getItem(k))), fresh);
			fresh = false;
		} catch {
			// unreadable JSON: nothing to take
		}
		localStorage.removeItem(k);
	}
	const seen = Object.values(p.cards).filter((r) => r.seen > 0).sort((a, b) => a.seen - b.seen);
	seen.forEach((r, i) => (r.seen = i + 1));
	p.asked = seen.length;
	saveProgress(p);
	return p;
}

export function loadProgress() {
	try {
		let p;
		try {
			p = parseProgress(JSON.parse(localStorage.getItem(KEY)));
		} catch {
			p = emptyProgress(); // unreadable JSON
		}
		return migrate(p);
	} catch {
		return emptyProgress(); // missing storage
	}
}

export function saveProgress(progress) {
	try {
		localStorage.setItem(KEY, JSON.stringify(progress));
		return true;
	} catch {
		return false;
	}
}

// --- streaks and unlocking -----------------------------------------------------

export const learnedCard = (rec, s) => (rec?.streak ?? 0) >= s.learnStreak;
export const masteredCard = (rec, s) => (rec?.streak ?? 0) >= s.masterStreak;

const allBy = (test) => (cards, progress, settings) => cards.every((c) => test(progress.cards[c.id], settings));
const learnedBy = allBy(learnedCard);
const masteredBy = allBy(masteredCard);
// the cards that count towards a variation: not its book moves, not its intro
const solid = (c) => c.type !== "book" && c.type !== "intro";
const ownCards = (vkey, deck) => deck.filter((c) => c.vkey === vkey && solid(c));

export const isLearned = (vkey, deck, progress, settings) => learnedBy(ownCards(vkey, deck), progress, settings);
export const isMastered = (vkey, deck, progress, settings) => masteredBy(ownCards(vkey, deck), progress, settings);

export function unlockedKeys(tree, deck, progress, settings) {
	const learned = new Map();
	const touched = new Set();
	const cards = new Map();
	for (const c of deck) {
		if (progress.cards[c.id]) touched.add(c.vkey);
		if (solid(c)) (cards.get(c.vkey) || cards.set(c.vkey, []).get(c.vkey)).push(c);
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
// Shared by the opening queue and by refill, which asks again after an answer
// unlocks more.
function openTest(deck, progress, settings, unlocked) {
	const memo = new Map();
	return (c) => {
		if (c.vkey === "") return true;
		if (!memo.has(c.vkey)) memo.set(c.vkey, [unlocked.has(c.vkey), bookOpen(c.vkey, deck, progress, settings)]);
		const [open, booked] = memo.get(c.vkey);
		return open && (c.type !== "book" || booked);
	};
}

// The cards a session in this scope draws from (`pool`: in scope, not
// skipped) and those of them that may be asked now (`open`). The outline counts
// with it, so what it promises is what Start does.
export function scopeCards(deck, tree, progress, settings, { scope = null, keys = null }) {
	const sc = inScope(tree, scope);
	const cards = deck.filter((c) => c.type !== "intro");
	const pool = cards.filter((c) => (!sc || sc.has(c.vkey)) && (!keys || keys.has(c.vkey)) && !progress.cards[c.id]?.skip);
	const ok = openTest(cards, progress, settings, unlockedKeys(tree, cards, progress, settings));
	return { pool, open: pool.filter(ok) };
}

// which variations are learned / mastered, to tell afterwards what changed
const states = (tree, deck, progress, settings) => {
	const keys = [...tree.byKey.keys()];
	return {
		learned: new Set(keys.filter((k) => isLearned(k, deck, progress, settings))),
		mastered: new Set(keys.filter((k) => isMastered(k, deck, progress, settings))),
	};
};

// New cards: names, orders and families before book moves, then shallowest
// level first; the sorts are stable, so deck order breaks ties.
const byNewness = (a, b) => (a.type === "book") - (b.type === "book") || a.level - b.level;

// Spread the cards of one variation apart (finding 6): a name question right
// after its order question gives it away. A block is one non-book card, or all
// of a variation's book cards as one run in deck order. Blocks go in priority
// order, but never right after a block of the same family while a later block
// of another can go there, nor of the same variation while another can; `last`
// is the card that comes before.
function interleave(cards, deck, last = null) {
	const rank = new Map(deck.map((c, i) => [c.id, i]));
	const runs = new Map();
	const blocks = [];
	for (const c of cards) {
		if (c.type !== "book") blocks.push([c]);
		else if (runs.has(c.vkey)) runs.get(c.vkey).push(c);
		else blocks.push(runs.set(c.vkey, [c]).get(c.vkey));
	}
	for (const run of runs.values()) run.sort((a, b) => rank.get(a.id) - rank.get(b.id));
	const out = [];
	while (blocks.length) {
		let k = blocks.findIndex((b) => b[0].family !== last?.family);
		if (k < 0) k = Math.max(0, blocks.findIndex((b) => b[0].vkey !== last?.vkey));
		const [block] = blocks.splice(k, 1);
		out.push(...block);
		last = block[block.length - 1];
	}
	return out;
}

// Put each variation's intro (when it has one, hasn't been shown this session
// and none of its cards has been answered right yet) just before its first
// card. "Answered right", not "asked": progress from before intros existed
// holds variations asked but never shown, which were then quizzed cold
// (Davis, 2026-10-14, on the Fischer Attack); and one only ever missed is
// worth seeing again.
function withIntros(session, progress, cards) {
	const out = [];
	for (const c of cards) {
		const intro = session.intros.get(c.vkey);
		if (intro && !session.introduced.has(c.vkey) && !session.pool.some((x) => x.vkey === c.vkey && progress.cards[x.id]?.streak > 0)) {
			session.introduced.add(c.vkey);
			out.push(intro);
		}
		out.push(c);
	}
	return out;
}

// How many other questions come between a variation's intro and its first
// question (Davis, 2026-10-14: a question right after its intro "feels like a
// free correct answer"). Where the queue cannot supply them, fewer is fine; a
// right answer given sooner than this after the intro does not count.
const AFTER_INTRO = 3;

// Make each queued intro come AFTER_INTRO other questions before its
// variation's first one, run after every change to the queue's tail. The intro
// moves earlier (never before the card now showing); if the tail is too short
// for that, questions of other variations are pulled forward from after the
// first one. A variation with an intro still queued is never pulled from: its
// questions must not come before it, and moving them would undo its spacing.
function spaceIntros(session) {
	const q = session.queue;
	for (let a = session.i; a < q.length; a++) {
		if (q[a].type !== "intro") continue;
		const [intro] = q.splice(a, 1);
		let b = q.findIndex((c, k) => k >= a && c.vkey === intro.vkey);
		if (b < 0) {
			q.splice(a, 0, intro);
			continue;
		}
		let at = b;
		for (let n = 0; at > session.i && n < AFTER_INTRO; at--) if (q[at - 1].type !== "intro") n++;
		at = Math.min(at, a); // an intro already further ahead stays there
		for (let need = AFTER_INTRO - q.slice(at, b).filter((c) => c.type !== "intro").length; need > 0; need--) {
			const k = q.findIndex((c, j) => j > b && c.vkey !== intro.vkey && c.type !== "intro" && !q.some((x, y) => y >= session.i && x.type === "intro" && x.vkey === c.vkey));
			if (k < 0) break;
			q.splice(b++, 0, ...q.splice(k, 1));
		}
		q.splice(at, 0, intro);
	}
}

// Feed the flow (Davis, 2026-10-14: a session should keep unlocking, not stop
// at a batch fixed up front). Run after the opening queue and after every
// answer: new cards join while fewer than `newVariations` variations are in
// flight (with a card queued and not yet learned, so a variation learned just
// now makes room, and so does the next one it unlocked), and every
// `recheckEvery` answers one learned card comes back for a spaced check. A card
// set aside as tricky is not in flight: it would clog the flow for the rest of
// the session. The cap counts variations, not questions (Davis, 2026-10-14:
// five new questions were nearly always the sibling variations one parent had
// just unlocked, so a session was drilling look-alike new lines against each
// other instead of recalling older ones).
function refill(session, progress, settings, ctx) {
	if (session.practice) return;
	if (settings.sessionLength > 0 && session.results.length >= settings.sessionLength) {
		session.queue = session.queue.slice(0, session.i); // the length is reached: nothing more is asked
		return;
	}
	const cards = ctx.deck.filter((c) => c.type !== "intro");
	const ok = openTest(cards, progress, settings, unlockedKeys(ctx.tree, cards, progress, settings));
	const rest = session.queue.slice(session.i).filter((c) => c.type !== "intro");
	const queued = new Set(rest.map((c) => c.id));
	const rec = (c) => progress.cards[c.id];
	const more = [];
	let starved = false;
	// while two of the last five answers were misses, nothing new joins
	if (session.results.slice(-5).filter((r) => !r.right).length < 2) {
		const flying = rest.filter((c) => !learnedCard(rec(c), settings) && !session.tricky.has(c.id));
		const inFlight = new Set(flying.map((c) => c.vkey));
		const families = new Set(flying.map((c) => c.family));
		// a new variation from a family with nothing in flight goes first, so
		// that the families are mixed rather than learned one after another
		const fresh = session.pool.filter((x) => !rec(x) && !queued.has(x.id) && ok(x)).sort(byNewness);
		for (const mixed of [true, false]) {
			for (const c of fresh) {
				if (more.includes(c) || (!inFlight.has(c.vkey) && (inFlight.size >= settings.newVariations || (mixed && families.has(c.family))))) continue;
				inFlight.add(c.vkey);
				families.add(c.family);
				more.push(c);
			}
		}
		starved = inFlight.size < settings.newVariations;
	}
	// Starved (fewer variations left to learn than may be learned at once), a
	// re-check comes after every answer: otherwise the last line's book moves
	// were asked over and over, and once everything was learned a session held
	// one re-check and ended (Davis, 2026-10-14). Questions not yet mastered
	// come before mastered ones, so finishing mastery does not wait behind
	// what is known cold. A question asked in this session is not re-checked in
	// it (one recall per session is the relearning pattern), which also ends a
	// session with no length limit.
	if (settings.recheckEvery > 0 && (starved || session.sinceRecheck >= settings.recheckEvery)) {
		const asked = new Set(session.results.map((r) => r.id));
		// A variation whose line was just played or shown, by a question or an
		// intro of one below it, is practised already (Davis, 2026-10-15: the
		// Najdorf straight after the Najdorf with 6.Be3): not re-checked until
		// SPACING answers have passed, unless nothing else is left to ask.
		const byId = new Map(ctx.deck.map((c) => [c.id, c]));
		const recent = session.results.slice(-SPACING).map((r) => byId.get(r.id));
		for (const [vkey, at] of session.passed) if (session.results.length - at < SPACING) recent.push(session.intros.get(vkey));
		const near = new Set(recent.flatMap((c) => c?.on ?? []));
		const dues = session.pool
			.filter((c) => !queued.has(c.id) && !asked.has(c.id) && rec(c) && learnedCard(rec(c), settings) && ok(c) && progress.asked - rec(c).seen >= SPACING)
			.sort((a, b) => masteredCard(rec(a), settings) - masteredCard(rec(b), settings) || rec(a).seen - rec(b).seen);
		const due = dues.find((c) => !near.has(c.vkey)) ?? (rest.length || more.length ? undefined : dues[0]);
		// asked next, not behind the new questions already queued, which would
		// leave whole stretches with nothing older in them; but not beside a
		// question of its own family, nor of its own variation, which would give
		// one away
		if (due) {
			session.queue.splice(spot(session.queue, session.i, due), 0, due);
			session.sinceRecheck = 0;
		}
	}
	const last = session.queue[session.queue.length - 1] ?? null;
	session.queue.push(...withIntros(session, progress, interleave(more, cards, last)));
	spaceIntros(session);
}

export function newSession(deck, tree, progress, settings, { scope = null, practice = false, keys = null }) {
	const unlockedBefore = unlockedKeys(tree, deck, progress, settings);
	const cards = deck.filter((c) => c.type !== "intro");
	const { pool, open } = scopeCards(deck, tree, progress, settings, { scope, keys });
	const intros = new Map(deck.filter((c) => c.type === "intro").map((c) => [c.vkey, c]));
	const base = {
		i: 0, results: [], unlockedBefore, practice, scope, pool, before: states(tree, cards, progress, settings),
		intros, introduced: new Set(), passed: new Map(), tricky: new Set(),
		sinceRecheck: settings.recheckEvery, // the opening queue gets a re-check at once
	};
	if (practice) return { ...base, queue: settings.sessionLength > 0 ? pool.slice(0, settings.sessionLength) : pool };
	const rec = (c) => progress.cards[c.id];
	// sorts are stable, so deck order breaks ties
	const started = open.filter((c) => rec(c) && !learnedCard(rec(c), settings)).sort((a, b) => rec(a).seen - rec(b).seen);
	const session = { ...base, queue: withIntros(base, progress, interleave(started, cards)) };
	refill(session, progress, settings, { deck, tree });
	return session;
}

export const current = (s) => s.queue[s.i] || null;

// Where to put `card` from `from` on: the first place with no card of its
// family on either side; failing that (a session within one family), none of
// its variation; failing that, the end.
function spot(q, from, card) {
	const free = (key) => {
		for (let at = from; at < q.length; at++) if (q[at][key] !== card[key] && q[at - 1]?.[key] !== card[key]) return at;
		return -1;
	};
	const at = free("family");
	return at >= 0 ? at : free("vkey") >= 0 ? free("vkey") : q.length;
}

// A miss, or a right answer on a card not yet learned, comes back three
// questions later, a little further to keep it away from its family.
function requeue(session, card) {
	session.queue.splice(spot(session.queue, Math.min(session.i + 3, session.queue.length), card), 0, card);
}

// Finding 3: while two of the last five answers were misses, cards never asked
// leave the queue (with their intros); refill brings them back later.
function holdBack(session, progress) {
	const rest = session.queue.slice(session.i);
	const kept = rest.filter((c) => c.type !== "intro" && progress.cards[c.id]);
	for (const c of rest) if (c.type === "intro") session.introduced.delete(c.vkey);
	session.queue = [...session.queue.slice(0, session.i), ...kept];
}

// Playing a variation's moves plays those of every named position they pass
// through (Davis, 2026-10-15): each of those variations' order card is
// answered right too, under the same spacing rule, all the way up. A credit
// that would come too soon leaves the record alone, or practising a line below
// would keep restarting its spacing and it would never be re-checked. A miss
// is not passed up (Davis: "failures shouldn't count towards parent
// failures"): `played` holds only the moves before it, and those were right.
// Nothing is credited for an answer right after its intro, which showed
// those moves too. Returns the names of the variations credited.
function credit(progress, { deck, tree, played }, settings, own) {
	const chess = new Chess();
	const out = [];
	for (const san of played) {
		chess.move(san);
		const c = deck.find((x) => x.id === `order|${posKey(chess.fen())}`);
		if (!c || c.id === own || progress.cards[c.id]?.skip) continue;
		const r = progress.cards[c.id] || { streak: 0, seen: 0, skip: false };
		if (learnedCard(r, settings) && r.streak < settings.masterStreak && progress.asked - r.seen < SPACING) continue;
		progress.cards[c.id] = { ...r, streak: Math.min(r.streak + 1, settings.masterStreak), seen: progress.asked };
		out.push(tree.byKey.get(c.vkey).name);
	}
	return out;
}

// `ctx` ({ deck, tree }) lets an answer that learns a card refill the session
// at once, with the cards it unlocked among them; an order answer adds
// `played`, the moves played right, to credit the variations they pass through.
export function answer(session, progress, card, right, settings, ctx = null) {
	if (card.type === "intro") { // a step, not a question: nothing is scored or stored
		session.i++;
		session.passed.set(card.vkey, session.results.length); // answers so far, to space its questions out
		return { id: card.id, intro: true };
	}
	const rec = progress.cards[card.id] || { streak: 0, seen: 0, skip: false };
	const from = rec.streak;
	const before = ctx && unlockedKeys(ctx.tree, ctx.deck, progress, settings);
	const learnedBefore = learnedCard(rec, settings);
	// a right answer on a learned card counts only after enough other questions
	const spaced = right && learnedBefore && from < settings.masterStreak && (progress.asked ?? 0) - rec.seen < SPACING;
	// ... and so does one asked fewer than AFTER_INTRO answers after its variation's intro
	const shown = session.passed.get(card.vkey);
	const justShown = right && shown !== undefined && session.results.length - shown < AFTER_INTRO;
	const tooSoon = spaced || justShown;
	// A miss takes "A miss takes away" right answers off, down to none, the same
	// for every card (Davis, 2026-10-14). It replaced two rules: a mastered
	// card dropped to the learn setting, and any other card started again at
	// 0, which threw away a nearly learned card's progress for one slip. With
	// the defaults a mastered card (5) still lands on learned (3).
	const to = !right ? Math.max(0, from - settings.missCost) : tooSoon ? from : Math.min(from + 1, settings.masterStreak);
	progress.asked = (progress.asked ?? 0) + 1;
	const saved = { ...rec, streak: to, seen: progress.asked };
	if (right && !learnedBefore && learnedCard(saved, settings)) delete saved.tricky;
	const result = { id: card.id, right, from, to, unlocked: [] };
	if (tooSoon) Object.assign(result, { tooSoon: true, soon: justShown ? "intro" : "spacing" });
	session.results.push(result);
	const tricky = !right && session.results.filter((r) => r.id === card.id && !r.right).length >= TRICKY;
	if (tricky) {
		saved.tricky = true;
		session.tricky.add(card.id);
	}
	progress.cards[card.id] = saved;
	if (card.type === "order" && ctx?.played && !justShown) result.also = credit(progress, ctx, settings, card.id);
	if (!tricky && (!right || !learnedCard(saved, settings))) requeue(session, card);
	session.i++;
	if (session.practice) return result;
	session.sinceRecheck++;
	if (session.results.slice(-5).filter((r) => !r.right).length >= 2) holdBack(session, progress);
	if (!ctx) return result;
	const after = unlockedKeys(ctx.tree, ctx.deck, progress, settings);
	result.unlocked = [...after].filter((k) => !before.has(k)).map((k) => ctx.tree.byKey.get(k).name);
	refill(session, progress, settings, ctx);
	return result;
}

export function sessionSummary(session, tree, deck, progress, settings) {
	const counted = session.results.filter((r) => !r.tooSoon);
	const right = counted.filter((r) => r.right).length;
	const now = states(tree, deck, progress, settings);
	const names = (keys) => keys.map((k) => tree.byKey.get(k).name);
	const unlocked = unlockedKeys(tree, deck, progress, settings);
	return {
		right,
		wrong: counted.length - right,
		soon: session.results.length - counted.length,
		learned: names([...now.learned].filter((k) => !session.before.learned.has(k))),
		mastered: names([...now.mastered].filter((k) => !session.before.mastered.has(k))),
		slipped: names([...session.before.mastered].filter((k) => !now.mastered.has(k))),
		unlocked: names([...unlocked].filter((k) => !session.unlockedBefore.has(k))),
		locked: tree.byKey.size - unlocked.size,
		tricky: [...session.tricky].map((id) => {
			const vkey = deck.find((c) => c.id === id)?.vkey ?? "";
			return { id, vkey, name: tree.byKey.get(vkey)?.name ?? "Book" };
		}),
	};
}

// Any card of the variation, book moves included, missed three times in a
// session and not learned since.
export const isTricky = (vkey, deck, progress) => deck.some((c) => c.vkey === vkey && progress.cards[c.id]?.tricky);

// How many variations learning this one would open: its children and the ones
// that list it among their `also` parents, not unlocked now.
export function unlocksIfLearned(vkey, tree, deck, progress, settings) {
	const v = tree.byKey.get(vkey);
	if (!v) return 0;
	const unlocked = unlockedKeys(tree, deck, progress, settings);
	return [...tree.byKey.values()].filter((x) => (x.parent === v || x.also.includes(v)) && !unlocked.has(x.key)).length;
}

// --- manual overrides, per variation ----------------------------------------

const inVar = (vkey, deck) => deck.filter((c) => c.vkey === vkey && c.type !== "intro");

export function markKnown(progress, vkey, deck, settings) {
	for (const c of ownCards(vkey, deck)) progress.cards[c.id] = { streak: settings.masterStreak, seen: progress.asked ?? 0, skip: false };
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

// The wrong answers, hardest first (Davis, 2026-10-14: questions should be
// difficult and ensure understanding; research findings 3 and 6). Ranks of
// confusability: 1 siblings (same parent; the roots are each other's), 2 a
// shared tag, 3 the same level, 4 the rest. A variation the reader has met
// (any card asked) comes before an unmet one, whatever the ranks, so an
// unmet name only fills. A card not yet learned takes one sibling at most and
// the farther ranks after it, so that the choice is not a tie-break between
// near twins; a learned one takes the closest first.
export function nameChoices(card, tree, settings, rng, { progress, deck } = {}) {
	const right = tree.byKey.get(card.key);
	const learned = !!progress && learnedCard(progress.cards[card.id], settings);
	const met = new Set(deck && progress ? deck.filter((c) => progress.cards[c.id]).map((c) => c.vkey) : []);
	const rank = (v) => (v.parent === right.parent ? 1 : v.tags.some((t) => right.tags.includes(t)) ? 2 : v.level === right.level ? 3 : 4);
	const names = new Set([right.name]);
	const others = [];
	for (const v of shuffle([...tree.byKey.values()], rng)) if (!names.has(v.name) && names.add(v.name)) others.push(v);
	const order = (pool) => {
		const by = (r) => pool.filter((v) => rank(v) === r);
		const [first, ...more] = by(1);
		const ranks = learned ? [by(1), by(2), by(3), by(4)] : [first ? [first] : [], by(3), by(4), by(2), more];
		return ranks.flat();
	};
	const picked = [...order(others.filter((v) => met.has(v.key))), ...order(others.filter((v) => !met.has(v.key)))];
	return shuffle([right.name, ...picked.slice(0, settings.choices - 1).map((v) => v.name)], rng);
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

// Squares whose piece (type and colour, or none) differs between two FENs, so
// a wrong answer's feedback can highlight where the two positions part.
export function positionDiff(fenA, fenB) {
	const a = new Chess(fenA).board();
	const b = new Chess(fenB).board();
	const piece = (sq) => (sq ? sq.color + sq.type : "");
	const out = [];
	a.forEach((row, r) => row.forEach((sq, f) => {
		if (piece(sq) !== piece(b[r][f])) out.push(`${"abcdefgh"[f]}${8 - r}`);
	}));
	return out;
}

// The first move where two variations' main orders part, as "2...d6" style
// labels, so feedback can say where the names split. A move missing from a
// shorter order (one a prefix of the other) gives "".
export function divergence(a, b) {
	const x = a.orders[0];
	const y = b.orders[0];
	let at = 0;
	while (at < x.length && at < y.length && x[at] === y[at]) at++;
	const label = (order) => (at < order.length ? fullmoveLabel(at) + order[at] : "");
	return { a: label(x), b: label(y) };
}

// The name of the shortest variation whose order starts with all of `sans`
// (the moves a learner has just played), or null. Used to say "That leads to
// the <name>" when a wrong move follows a named variation's order.
export function leadsTo(tree, sans) {
	let best = null;
	let bestLen = Infinity;
	for (const v of tree.byKey.values()) {
		for (const o of v.orders) {
			if (o.length >= sans.length && o.length < bestLen && sans.every((s, i) => o[i] === s)) {
				best = v;
				bestLen = o.length;
			}
		}
	}
	return best ? best.name : null;
}

export const allTags = (tree) => [...new Set([...tree.byKey.values()].flatMap((v) => v.tags))].sort();
