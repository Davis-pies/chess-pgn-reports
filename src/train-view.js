// src/train-view.js
// The Train window's screens: the outline of named variations, the settings,
// one question at a time, and the summary. Like studyPanel it is a pure
// function of its state (the ui object plus the progress): every control
// mutates them, saves, and calls onChange, which redraws.
//
// The caller owns `deck`: it must rebuild it from progress.settings (buildDeck)
// before every render, i.e. in its onChange. As a guard against a stale deck,
// sessions never include a card type switched off in settings.types.

import { Chess } from "chess.js";
import { el, renderInline } from "./dom.js";
import { chipBtn } from "./analysis-view.js";
import { boardSvg } from "./render.js";
import { interactiveBoard } from "./board-input.js";
import {
	DEFAULT_SETTINGS, allTags, answer, checkBook, checkFamily, checkName, current, isLearned, isMastered, learnedCard,
	isTricky, markKnown, masteredCard, nameChoices, newSession, normalizeSettings, orderStep, resetVar, saveProgress, sessionSummary, skip,
	unlockedKeys, unlocksIfLearned,
} from "./train.js";

// Every question draws its board at one size, asked or answered, so the board
// does not jump between cards (Name questions used to be smaller than Order).
// The size on screen is style.css's (.tr-body), which scales the drawing.
const BOARD = 320;

export function newTrainUi(scope = null) {
	return {
		screen: "outline", session: null, card: null,
		picked: null, typed: "", played: [], answered: null,
		ticked: [], choices: null, // the family ticks and the name choices, kept so a redraw doesn't reshuffle
		scope, open: new Set(), flipped: false, tag: "",
	};
}

const TYPES = ["name", "order", "family", "book"];

export function trainPanel(ui, { tree, deck, progress, workbookId, rename, learn }, onChange) {
	const settings = progress.settings;
	const panel = el("div", { className: "analysis train", tabIndex: -1 });
	const save = () => saveProgress(workbookId, progress);
	const act = (fn) => () => {
		fn();
		save();
		onChange();
	};
	const live = deck.filter((c) => c.type === "intro" || settings.types[c.type]);
	// the variations the tag filter keeps: those carrying the tag, and below them
	const tagged = (() => {
		if (!ui.tag || !allTags(tree).includes(ui.tag)) return null;
		const set = new Set();
		const add = (v) => { set.add(v.key); v.children.forEach(add); };
		for (const v of tree.byKey.values()) if (v.tags.includes(ui.tag)) add(v);
		return set;
	})();
	const begin = (opts) => {
		ui.session = newSession(live, tree, progress, settings, { keys: tagged, ...opts });
		ui.screen = "question";
		setCard();
	};
	const setCard = () => {
		ui.card = current(ui.session);
		Object.assign(ui, { picked: null, typed: "", played: [], answered: null, ticked: [], choices: null });
		if (!ui.card) ui.screen = "summary";
	};
	const nameOf = (vkey) => (tree.byKey.get(vkey)?.name ?? "Book");

	if (ui.screen === "settings") panel.append(settingsScreen());
	else if (ui.screen === "question" && ui.card) panel.append(questionScreen());
	else if (ui.screen === "summary" && ui.session) panel.append(summaryScreen());
	else panel.append(outlineScreen());
	return panel;

	// --- outline ---------------------------------------------------------

	function outlineScreen() {
		const box = el("div", { className: "tr-outline" });
		const queue = newSession(live, tree, progress, settings, { scope: ui.scope, keys: tagged }).queue.filter((c) => c.type !== "intro");
		const started = queue.filter((c) => progress.cards[c.id] && !masteredCard(progress.cards[c.id], settings)).length;
		const fresh = queue.filter((c) => !progress.cards[c.id]).length;
		const head = el("div", { className: "tr-head" });
		const start = chipBtn("tr-start", queue.length ? "Start" : "Nothing to train", "Start a session: questions in progress first, then new ones, then a few to re-check", act(() => begin({ scope: ui.scope })), !queue.length);
		head.append(
			start,
			chipBtn("tr-settings-open", "Settings", "Choose the question types, how many right answers learn and master a question, and the session sizes", act(() => (ui.screen = "settings"))),
			el("span", {
				className: "tr-count",
				title: "What a session would hold: questions in progress, new questions (up to the session limit) and mastered ones to re-check",
				textContent: `${started} in progress · ${fresh} new · ${queue.length - started - fresh} to re-check`,
			}),
		);
		if (ui.scope !== null) head.append(chipBtn("tr-whole", "Whole workbook", "List every variation, not just this subtree", act(() => (ui.scope = null))));
		const tags = allTags(tree);
		if (tags.length) {
			const sel = el("select", { className: "tr-tagfilter st-pick", title: "Show only the variations with this tag (and those below them)" }, [
				el("option", { value: "", textContent: "All variations" }),
				...tags.map((t) => el("option", { value: t, textContent: t, selected: t === ui.tag })),
			]);
			sel.onchange = act(() => (ui.tag = sel.value));
			head.append(sel);
		}
		box.append(head);
		if (tree.byKey.size) {
			const learnedN = [...tree.byKey.keys()].filter((k) => isLearned(k, deck, progress, settings)).length;
			const masteredN = [...tree.byKey.keys()].filter((k) => isMastered(k, deck, progress, settings)).length;
			const depth = Math.max(0, ...[...unlockedKeys(tree, deck, progress, settings)].map((k) => tree.byKey.get(k).level));
			box.append(el("p", {
				className: "tr-overview",
				title: "Learned: its name, order and family questions each answered right in a row often enough. Learning a variation opens the ones below it.",
				textContent: `Learned ${learnedN} of ${tree.byKey.size} variations · ${masteredN} mastered · open to level ${depth}`,
			}));
		}
		if (!tree.byKey.size) {
			box.append(el("p", { className: "tr-empty", textContent: "Name positions (right-click a move in the table → Name this position…) to be quizzed on them. Until then, Start drills the book moves." }));
			return box;
		}
		const unlocked = unlockedKeys(tree, deck, progress, settings);
		let roots = ui.scope !== null && tree.byKey.has(ui.scope) ? [tree.byKey.get(ui.scope)] : tree.roots;
		// under a tag filter the tagged variations head the list, wherever they sit
		if (tagged) roots = [...tagged].map((k) => tree.byKey.get(k)).filter((v) => !v.parent || !tagged.has(v.parent.key));
		const list = (nodes) => {
			const ul = el("ul", { className: "tr-tree" });
			for (const n of nodes) ul.append(varRow(n, unlocked));
			return ul;
		};
		const varRow = (n, unlocked) => {
			const li = el("li");
			const own = deck.filter((c) => c.vkey === n.key && c.type !== "intro");
			const solid = own.filter((c) => c.type !== "book");
			const mastered = solid.filter((c) => masteredCard(progress.cards[c.id], settings)).length;
			const streaks = solid.reduce((sum, c) => sum + Math.min(progress.cards[c.id]?.streak ?? 0, settings.masterStreak), 0);
			const skipped = own.length > 0 && own.every((c) => progress.cards[c.id]?.skip);
			const open = ui.open.has(n.key);
			const r = el("div", { className: "tr-var" });
			r.append(
				n.children.length
					? chipBtn("tr-open", open ? "▾" : "▸", open ? "Hide the sub-variations" : "Show the sub-variations", act(() => (open ? ui.open.delete(n.key) : ui.open.add(n.key))))
					: el("span", { className: "tr-toggle-gap" }),
				el("span", { className: "tr-name", textContent: n.name }),
				el("span", { className: "tr-level", title: `Level ${n.level}: how deep this is among named positions`, textContent: `L${n.level}` }),
			);
			if (solid.length) {
				const state = isMastered(n.key, deck, progress, settings) ? "mastered" : isLearned(n.key, deck, progress, settings) ? "learned" : "";
				if (state) r.append(el("span", { className: "tr-state", title: state === "mastered" ? "Every question answered right often enough to master" : "Every question learned: what is below it is open", textContent: state }));
			}
			if (n.also.length) r.append(el("span", { className: "tr-also", title: "Another line reaches this position too", textContent: `also reached from ${n.also.map((a) => a.name).join(", ")}` }));
			const bar = el("span", { className: "tr-bar", title: `${mastered} of ${solid.length} questions mastered` }, el("span"));
			bar.firstChild.style.width = `${solid.length ? Math.round((100 * streaks) / (solid.length * settings.masterStreak)) : 0}%`;
			r.append(bar);
			if (!unlocked.has(n.key)) r.append(el("span", { className: "tr-badge", title: "Learn the variation above it to open this one", textContent: "locked" }));
			if (skipped) r.append(el("span", { className: "tr-badge", title: "Left out of sessions", textContent: "skipped" }));
			if (isTricky(n.key, deck, progress)) r.append(el("span", { className: "tr-badge", title: "A question here was missed three times: Learn it before drilling it again", textContent: "tricky" }));
			const acts = el("span", { className: "tr-acts" });
			acts.append(
				chipBtn("tr-learn", "Learn", "Play through this variation with its notes", () => learn(n)),
				chipBtn("tr-practice", "Practice", "Drill this variation and below now, whatever their state; answers still count", act(() => begin({ scope: n.key, practice: true }))),
				chipBtn("tr-known", "Known", "Count its questions as mastered (unlocks what's below)", act(() => markKnown(progress, n.key, deck, settings))),
				chipBtn("tr-skip", skipped ? "Unskip" : "Skip", "Leave its questions out of sessions", act(() => skip(progress, n.key, deck, !skipped))),
				chipBtn("tr-reset", "Reset", "Forget the progress on its questions", () => {
					if (!confirm(`Reset the progress on ${n.name}?`)) return;
					resetVar(progress, n.key, deck);
					save();
					onChange();
				}),
				chipBtn("tr-rename", "Rename…", "Rename or retag this position", () => rename(n)),
			);
			r.append(acts);
			li.append(r);
			if (open && n.children.length) li.append(list(n.children));
			return li;
		};
		if (!queue.length) box.append(el("p", { className: "tr-hint", textContent: "Nothing to train here yet: Practice drills a variation anyway, Known unlocks what's below it." }));
		box.append(list(roots));
		return box;
	}

	// --- settings ----------------------------------------------------------

	function settingsScreen() {
		const s = settings;
		// every change goes back through normalizeSettings, so a bad value is
		// replaced by the default rather than stored
		const set = (patch) => act(() => (progress.settings = normalizeSettings({ ...progress.settings, ...patch })))();
		const field = (label, control, tip) => el("label", { className: "tr-field", title: tip }, [el("span", { textContent: label }), control]);
		const check = (name, label, on, change, tip) => {
			const i = el("input", { type: "checkbox", name, checked: on });
			i.onchange = () => change(i.checked);
			return field(label, i, tip);
		};
		const num = (name, label, value, change, min, max, tip) => {
			const i = el("input", { type: "number", name, value: String(value), min, ...(max === undefined ? {} : { max }) });
			i.onchange = () => change(i.valueAsNumber);
			return field(label, i, tip);
		};
		// `labels` shows a friendlier word than the stored value
		const pick = (name, label, value, options, change, tip, labels = {}) => {
			const sel = el("select", { name }, options.map((o) => el("option", { value: o, textContent: labels[o] ?? o, selected: o === value })));
			sel.onchange = () => change(sel.value);
			return field(label, sel, tip);
		};
		const D = DEFAULT_SETTINGS;
		const onOff = (x) => (x ? "on" : "off");
		const group = (title, ...children) => el("fieldset", { className: "tr-group" }, [el("legend", { textContent: title }), ...children]);
		const box = el("div", { className: "tr-settings" });
		const typeTips = {
			name: "Show a named position's board and ask what it is called.",
			order: "Name a position and ask for the moves that reach it, played on the board.",
			family: "Ask which tags a position carries.",
			book: "Play through a variation's moves: the board plays the other side and you play yours.",
		};
		box.append(
			group("Questions", ...TYPES.map((t) => check(`type-${t}`, `${t[0].toUpperCase()}${t.slice(1)}`, s.types[t], (on) => set({ types: { ...s.types, [t]: on } }), `${typeTips[t]} Default ${onOff(D.types[t])}.`))),
			group("Name questions",
				pick("nameMode", "Answer by", s.nameMode, ["choice", "typed"], (x) => set({ nameMode: x }), `Pick the name from choices, or type it. Default ${D.nameMode === "choice" ? "choose" : "type"}.`, { choice: "choose", typed: "type" }),
				num("choices", "Choices", s.choices, (n) => set({ choices: n }), 2, 8, `How many names to pick from, 2 to 8. Default ${D.choices}.`),
				check("showMoves", "Show the moves", s.showMoves, (on) => set({ showMoves: on }), `Show the moves that lead to the position. Default ${onOff(D.showMoves)}.`),
			),
			group("Order questions",
				check("orderHint", "Show the target position", s.orderHint, (on) => set({ orderHint: on }), `Show the position to reach, small, while you play the moves. Default ${onOff(D.orderHint)}.`),
			),
		);
		const tags = allTags(tree);
		const tagGroup = el("fieldset", { className: "tr-subgroup", title: "Ask a Family question about one group of tags only, picking the tag from that group. With none ticked, any tag can be asked. Default none." }, [el("legend", { textContent: "Ask within one group: tags in the group" })]);
		for (const t of tags) {
			tagGroup.append(check(`tag-${t}`, t, s.familyGroup.includes(t), (on) => set({ familyGroup: on ? [...s.familyGroup, t] : s.familyGroup.filter((x) => x !== t) }), `Put ${t} in the group.`));
		}
		box.append(
			group("Family questions",
				check("familyShowName", "Show the name", s.familyShowName, (on) => set({ familyShowName: on }), `Say the position's name in the question. Default ${onOff(D.familyShowName)}.`),
				tagGroup,
			),
			group("Book questions",
				pick("bookSide", "You play", s.bookSide, ["white", "black", "both"], (x) => set({ bookSide: x }), `The side whose moves you are asked for. Default ${D.bookSide}.`),
				pick("bookRule", "Accept", s.bookRule, ["any", "main"], (x) => set({ bookRule: x }), `Which move counts as right: any book move, or only the mainline's. Default ${D.bookRule === "any" ? "any book move" : "the mainline's only"}.`, { any: "any book move", main: "the mainline's only" }),
			),
			group("Progress",
				num("learnStreak", "Right in a row to learn", s.learnStreak, (n) => set({ learnStreak: n }), 1, 10, `How many right answers in a row learn a question; learning every question of a variation unlocks what is below it. 1 to 10. Default ${D.learnStreak}.`),
				num("masterStreak", "Right in a row to master", s.masterStreak, (n) => set({ masterStreak: n }), 1, 20, `How many right answers in a row master a question. Never below the learn setting. 1 to 20. Default ${D.masterStreak}.`),
			),
			group("Sessions",
				check("introNew", "Show a new variation first", s.introNew, (on) => set({ introNew: on }), `Before the first question on a variation, show its position, the moves that reach it and the workbook's notes. Default ${onOff(D.introNew)}.`),
				num("newPerSession", "New questions per session", s.newPerSession, (n) => set({ newPerSession: n }), 0, 50, `How many questions never asked before a session adds. 0 to 50. Default ${D.newPerSession}.`),
				num("reviews", "Re-checks per session", s.reviews, (n) => set({ reviews: n }), 0, 20, `How many mastered questions a session asks again, the ones asked longest ago. 0 to 20. Default ${D.reviews}.`),
				num("sessionLength", "Questions per session (0: no limit)", s.sessionLength, (n) => set({ sessionLength: n }), 0, undefined, `The most questions in a session; 0 for no limit. Default ${D.sessionLength}.`),
			),
			chipBtn("tr-settings-done", "Done", "Back to the outline", act(() => (ui.screen = "outline"))),
		);
		return box;
	}

	// --- questions -----------------------------------------------------------

	function questionScreen() {
		const card = ui.card;
		const node = tree.byKey.get(card.key);
		const box = el("div", { className: "tr-question" });
		// intros are steps, not questions: only the others are counted
		const asked = (n) => ui.session.queue.slice(0, n).filter((c) => c.type !== "intro").length;
		const total = asked(Infinity);
		const place = card.type === "intro" ? asked(ui.session.i) + 1 : ui.answered ? asked(ui.session.i) : asked(ui.session.i + 1);
		const prompt = el("p", { className: "tr-prompt" });
		const body = el("div", { className: "tr-body" });
		// the card's level and streak, never the variation's name: it would give a name question away
		const streak = progress.cards[card.id]?.streak ?? 0;
		const rec = progress.cards[card.id];
		const standing = masteredCard(rec, settings) ? "mastered"
			: learnedCard(rec, settings) ? `learned · ${streak} of ${settings.masterStreak} right to master`
			: `${streak} of ${settings.learnStreak} right to learn`;
		const opens = card.vkey === "" || isLearned(card.vkey, deck, progress, settings) ? 0 : unlocksIfLearned(card.vkey, tree, deck, progress, settings);
		const status = el("p", {
			className: "tr-status",
			title: `Answer it right ${settings.learnStreak} times in a row to learn it (unlocking what's below), ${settings.masterStreak} times to master it. A miss on a mastered question drops it back to learned; any other miss starts the count again.`,
			textContent: `${card.vkey === "" ? "" : `Level ${card.level} · `}${standing}${opens ? ` · learn it to unlock ${opens} variation${opens === 1 ? "" : "s"}` : ""}`,
		});
		box.append(el("p", { className: "tr-progress", textContent: `Question ${place} of ${total}` }), prompt, ...(card.type === "intro" ? [] : [status]), body);

		const next = () => {
			setCard();
			onChange();
		};
		const finish = (right, detail) => {
			const { unlocked, tooSoon } = answer(ui.session, progress, card, right, settings, { deck: live, tree });
			save();
			ui.answered = { right, detail, tooSoon: !!tooSoon, unlocked };
			onChange();
		};
		// an intro is passed, not answered: nothing is scored or stored
		const gotIt = () => {
			answer(ui.session, progress, card, true, settings);
			next();
		};
		let typedInput = null; // the typed-name field, when this question has one
		panel.onkeydown = (e) => {
			if (e.key === "Enter") {
				if (e.target.closest?.("button")) return; // a focused button handles Enter itself
				if (card.type === "intro") gotIt();
				else if (ui.answered) next();
				else if (typedInput && e.target === typedInput) pickName(typedInput.value);
				return;
			}
			const n = +e.key;
			if (!ui.answered && ui.choices && n >= 1 && n <= ui.choices.length) pickName(ui.choices[n - 1]);
		};
		const flip = () => chipBtn("tr-flip", "Flip", "Turn the board round", act(() => (ui.flipped = !ui.flipped)));
		const pickName = (text) => {
			ui.picked = ui.typed = text;
			const right = checkName(text, node.name);
			finish(right, right ? [`Answer: ${node.name}`] : [`Answer: ${node.name}`, `You answered: ${text}`]);
		};
		// the reader's side at the bottom (Black: flipped), unless turned by hand
		const readerFlip = (settings.bookSide === "black") !== ui.flipped;

		// a note: the move it is on, then the workbook's text
		const noteLine = (label, text) => {
			const p = el("p", { className: "tr-note" }, [`${label} `]);
			renderInline(p, text);
			return p;
		};
		if (card.type === "intro") {
			prompt.textContent = `New: ${node.name}`;
			body.append(boardSvg(node.fen, BOARD, { flipped: readerFlip }), flip());
			// the moves and notes go where a question's result goes, beside the
			// board on a wide window, so the buttons stay in view
			box.append(el("div", { className: "tr-result tr-intro" }, [
				el("p", { className: "tr-moves", textContent: node.orders[0].join(" ") }),
				...card.notes.map((n) => noteLine(n.move, n.text)),
				el("div", { className: "tr-acts" }, [
					chipBtn("tr-learn", "Learn it", "Play through this variation with its notes in Study", () => learn(node)),
					chipBtn("tr-next", "Got it", "Go on to the questions (Enter)", gotIt),
				]),
			]));
		} else if (card.type === "name") {
			prompt.textContent = "What is this position called?";
			body.append(boardSvg(node.fen, BOARD, { flipped: readerFlip }));
			if (!ui.answered) body.append(flip());
			if (settings.showMoves) body.append(el("p", { className: "tr-moves", textContent: node.orders[0].join(" ") }));
			if (!ui.answered && settings.nameMode === "choice") {
				ui.choices ||= nameChoices(card, tree, settings, Math.random);
				body.append(el("div", { className: "tr-choices" }, ui.choices.map((name, i) =>
					el("button", { className: "tr-choice chip", textContent: name, title: `Key ${i + 1}`, onclick: () => pickName(name) }))));
			} else if (!ui.answered) {
				typedInput = el("input", { className: "tr-typed", type: "text", value: ui.typed, placeholder: "Name" });
				body.append(typedInput, chipBtn("tr-check", "Check", "Check the name", () => pickName(typedInput.value)));
			}
		} else if (card.type === "order") {
			prompt.textContent = `Play the moves to the ${node.name}`;
			const chess = new Chess();
			ui.played.forEach((s) => chess.move(s));
			const play = (san) => {
				const step = orderStep(node.orders, ui.played, san);
				if (!step.ok) return finish(false, [`Expected: ${step.accepted.join(" or ")}`]);
				ui.played.push(san);
				if (!step.done) return onChange(); // on to the next move
				const others = node.orders.filter((o) => o.join(" ") !== ui.played.join(" ")).map((o) => o.join(" "));
				finish(true, others.length ? [`Also reached by: ${others.join("; ")}`] : []);
			};
			body.append(ui.answered ? boardSvg(chess.fen(), BOARD, { flipped: ui.flipped }) : interactiveBoard(chess.fen(), play, { size: BOARD, flipped: ui.flipped }));
			if (settings.orderHint) body.append(el("div", { className: "tr-hint" }, boardSvg(node.fen, 140, { flipped: ui.flipped })));
			body.append(flip());
		} else if (card.type === "family") {
			const group = settings.familyGroup;
			const tags = group.length ? node.tags.filter((t) => group.includes(t)) : node.tags;
			prompt.textContent = settings.familyShowName ? `Which families does the ${node.name} belong to?` : "Which families does this position belong to?";
			body.append(boardSvg(node.fen, BOARD, { flipped: readerFlip }));
			if (!ui.answered) body.append(flip());
			const options = group.length ? group : allTags(tree);
			const radio = group.length > 0;
			const list = el("div", { className: "tr-tags" });
			for (const t of options) {
				const i = el("input", { type: radio ? "radio" : "checkbox", name: "tr-tag", value: t, checked: ui.ticked.includes(t), disabled: !!ui.answered });
				i.onchange = () => {
					ui.ticked = radio ? [t] : i.checked ? [...ui.ticked, t] : ui.ticked.filter((x) => x !== t);
				};
				list.append(el("label", { className: "tr-tag" }, [i, t]));
			}
			body.append(list);
			if (!ui.answered) body.append(chipBtn("tr-check", "Check", "Check the families", () => finish(checkFamily(ui.ticked, tags), [`Answer: ${tags.join(", ") || "none"}`])));
		} else {
			const chess = new Chess();
			card.sans.forEach((s) => chess.move(s));
			prompt.textContent = `${nameOf(card.vkey)}: find the move`;
			body.append(el("p", { className: "tr-moves", textContent: card.sans.join(" ") || "(start position)" }));
			const blackToPlay = settings.bookSide === "both" ? chess.turn() === "b" : settings.bookSide === "black";
			const flipped = blackToPlay !== ui.flipped; // the reader's side at the bottom, unless flipped by hand
			const play = (san) => {
				const right = checkBook(card, san, settings);
				const detail = [`Book: ${card.moves.join(", ")}${card.main ? ` (main: ${card.main})` : ""}`];
				finish(right, detail);
			};
			body.append(ui.answered ? boardSvg(chess.fen(), BOARD, { flipped }) : interactiveBoard(chess.fen(), play, { size: BOARD, flipped }), flip());
		}

		if (ui.answered) {
			const { right, detail, tooSoon, unlocked } = ui.answered;
			const res = el("div", { className: `tr-result ${right ? "right" : "wrong"}` }, [el("strong", { textContent: right ? "Right" : "Not quite" })]);
			if (tooSoon) res.append(el("p", { className: "tr-soon", title: "A learned question's streak grows only after 10 other questions have been answered since it was last asked", textContent: "Too soon to count towards mastery: it counts when other questions come in between." }));
			for (const d of detail) res.append(el("p", { textContent: d }));
			// a book card keeps its notes by move, the others have a list
			const notes = Array.isArray(card.notes) ? card.notes.map((n) => [n.move, n.text]) : Object.entries(card.notes);
			for (const [move, text] of notes) res.append(noteLine(Array.isArray(card.notes) ? move : `${move}:`, text));
			if (unlocked.length) res.append(el("p", { className: "tr-unlocked", textContent: `Unlocked: ${unlocked.join(", ")}` }));
			res.append(chipBtn("tr-next", "Next", "Next question (Enter)", next));
			box.append(res);
		}
		return box;
	}

	// --- summary ---------------------------------------------------------------

	function summaryScreen() {
		const sum = sessionSummary(ui.session, tree, deck, progress, settings);
		const total = sum.right + sum.wrong;
		const box = el("div", { className: "tr-summary" }, [el("h3", { textContent: `Right ${sum.right} / ${total}` })]);
		const list = (title, items, tip) => items.length && box.append(el("p", { title: tip, textContent: `${title}: ${items.join(", ")}` }));
		list("Learned", sum.learned, "Every question in it is now learned");
		list("Mastered", sum.mastered, "Every question in it is now mastered");
		list("Back to learned", sum.slipped, "Mastered before, missed this time: answer it right again to re-master it");
		list("Unlocked", sum.unlocked, "Opened by what you learned");
		if (sum.tricky.length) {
			box.append(el("p", { title: "Missed three times: study it before drilling it again", textContent: `Tricky: ${sum.tricky.map((t) => `${t.name} (${t.id.split("|")[0] === "book" ? "book move" : t.id.split("|")[0]})`).join(", ")}` }));
			for (const key of new Set(sum.tricky.map((t) => t.vkey).filter((k) => k !== ""))) {
				box.append(chipBtn("tr-learn", `Learn it: ${tree.byKey.get(key).name}`, "Missed three times: study it before drilling it again", () => learn(tree.byKey.get(key))));
			}
		}
		if (sum.locked) box.append(el("p", { title: "Learn the variations above them to open these", textContent: `Still locked: ${sum.locked} variation${sum.locked === 1 ? "" : "s"}` }));
		box.append(chipBtn("tr-back", "Back to the outline", "Leave the summary", act(() => (ui.screen = "outline"))));
		return box;
	}
}
