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
	DAY, allTags, answer, checkBook, checkFamily, checkName, current, isDue, markKnown, nameChoices,
	newSession, normalizeSettings, orderStep, resetVar, saveProgress, sessionSummary, setBox, skip, unlockedKeys,
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

export function trainPanel(ui, { tree, deck, progress, workbookId, rename, learn }, onChange, now = Date.now()) {
	const settings = progress.settings;
	const panel = el("div", { className: "analysis train", tabIndex: -1 });
	const save = () => saveProgress(workbookId, progress);
	const act = (fn) => () => {
		fn();
		save();
		onChange();
	};
	const live = deck.filter((c) => settings.types[c.type]);
	// the variations the tag filter keeps: those carrying the tag, and below them
	const tagged = (() => {
		if (!ui.tag || !allTags(tree).includes(ui.tag)) return null;
		const set = new Set();
		const add = (v) => { set.add(v.key); v.children.forEach(add); };
		for (const v of tree.byKey.values()) if (v.tags.includes(ui.tag)) add(v);
		return set;
	})();
	const begin = (opts) => {
		ui.session = newSession(live, tree, progress, settings, { now, keys: tagged, ...opts });
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
		const queue = newSession(live, tree, progress, settings, { now, scope: ui.scope, keys: tagged }).queue;
		const fresh = queue.filter((c) => !progress.cards[c.id]).length;
		const head = el("div", { className: "tr-head" });
		const start = chipBtn("tr-start", queue.length ? "Start" : "Nothing due", "Study what is due, then new cards", act(() => begin({ scope: ui.scope })), !queue.length);
		head.append(
			start,
			chipBtn("tr-settings-open", "Settings", "Choose the question types and the schedule", act(() => (ui.screen = "settings"))),
			el("span", { className: "tr-count", textContent: `${queue.length - fresh} due · ${fresh} new` }),
		);
		if (ui.scope !== null) head.append(chipBtn("tr-whole", "Whole workbook", "List every variation", act(() => (ui.scope = null))));
		const tags = allTags(tree);
		if (tags.length) {
			const sel = el("select", { className: "tr-tagfilter st-pick", title: "Show only the variations with this tag" }, [
				el("option", { value: "", textContent: "All variations" }),
				...tags.map((t) => el("option", { value: t, textContent: t, selected: t === ui.tag })),
			]);
			sel.onchange = act(() => (ui.tag = sel.value));
			head.append(sel);
		}
		box.append(head);
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
			const own = deck.filter((c) => c.vkey === n.key);
			const solid = own.filter((c) => c.type !== "book");
			const mastered = solid.filter((c) => (progress.cards[c.id]?.box ?? -1) >= settings.masteryBox).length;
			const due = own.filter((c) => isDue(progress.cards[c.id], settings, now)).length;
			const skipped = own.length > 0 && own.every((c) => progress.cards[c.id]?.skip);
			const open = ui.open.has(n.key);
			const r = el("div", { className: "tr-var" });
			r.append(
				n.children.length
					? chipBtn("tr-open", open ? "▾" : "▸", open ? "Hide the sub-variations" : "Show the sub-variations", act(() => (open ? ui.open.delete(n.key) : ui.open.add(n.key))))
					: el("span", { className: "tr-toggle-gap" }),
				el("span", { className: "tr-name", textContent: n.name }),
				el("span", { className: "tr-level", textContent: `L${n.level}` }),
			);
			if (n.also.length) r.append(el("span", { className: "tr-also", textContent: `also reached from ${n.also.map((a) => a.name).join(", ")}` }));
			const bar = el("span", { className: "tr-bar", title: `${mastered} of ${solid.length} mastered` }, el("span"));
			bar.firstChild.style.width = `${solid.length ? Math.round((100 * mastered) / solid.length) : 0}%`;
			r.append(bar, el("span", { className: "tr-due", textContent: due ? `${due} due` : "" }));
			if (!unlocked.has(n.key)) r.append(el("span", { className: "tr-badge", textContent: "locked" }));
			if (skipped) r.append(el("span", { className: "tr-badge", textContent: "skipped" }));
			const box = el("select", { className: "tr-box st-pick", title: "Put this variation's cards in a box" }, [
				el("option", { value: "", textContent: "Box…" }),
				...[0, 1, 2, 3, 4, 5].map((b) => el("option", { value: String(b), textContent: `Box ${b}` })),
			]);
			box.onchange = act(() => box.value !== "" && setBox(progress, n.key, deck, +box.value, now));
			const acts = el("span", { className: "tr-acts" });
			acts.append(
				chipBtn("tr-learn", "Learn", "Play through this variation with its notes", () => learn(n)),
				chipBtn("tr-practice", "Practice", "Drill this variation and below, due or not", act(() => begin({ scope: n.key, practice: true }))),
				chipBtn("tr-known", "Known", "Count its cards as mastered", act(() => markKnown(progress, n.key, deck, settings, now))),
				chipBtn("tr-skip", skipped ? "Unskip" : "Skip", "Leave its cards out", act(() => skip(progress, n.key, deck, !skipped))),
				chipBtn("tr-reset", "Reset", "Forget the progress on its cards", () => {
					if (!confirm(`Reset the progress on ${n.name}?`)) return;
					resetVar(progress, n.key, deck);
					save();
					onChange();
				}),
				chipBtn("tr-rename", "Rename…", "Rename or retag this position", () => rename(n)),
				box,
			);
			r.append(acts);
			li.append(r);
			if (open && n.children.length) li.append(list(n.children));
			return li;
		};
		if (!queue.length) box.append(el("p", { className: "tr-hint", textContent: "Nothing due now. Use Practice on a variation to drill it anyway, or Known to mark it learned and unlock what's below it." }));
		box.append(list(roots));
		return box;
	}

	// --- settings ----------------------------------------------------------

	function settingsScreen() {
		const s = settings;
		// every change goes back through normalizeSettings, so a bad value is
		// replaced by the default rather than stored
		const set = (patch) => act(() => (progress.settings = normalizeSettings({ ...progress.settings, ...patch })))();
		const field = (label, control) => el("label", { className: "tr-field" }, [el("span", { textContent: label }), control]);
		const check = (name, label, on, change) => {
			const i = el("input", { type: "checkbox", name, checked: on });
			i.onchange = () => change(i.checked);
			return field(label, i);
		};
		const num = (name, label, value, change, min, max) => {
			const i = el("input", { type: "number", name, value: String(value), min, max });
			i.onchange = () => change(i.valueAsNumber);
			return field(label, i);
		};
		const pick = (name, label, value, options, change) => {
			const sel = el("select", { name }, options.map((o) => el("option", { value: o, textContent: o, selected: o === value })));
			sel.onchange = () => change(sel.value);
			return field(label, sel);
		};
		const box = el("div", { className: "tr-settings" });
		for (const t of TYPES) box.append(check(`type-${t}`, `${t[0].toUpperCase()}${t.slice(1)} questions`, s.types[t], (on) => set({ types: { ...s.types, [t]: on } })));
		box.append(
			pick("nameMode", "Name questions", s.nameMode, ["choice", "typed"], (x) => set({ nameMode: x })),
			num("choices", "Choices", s.choices, (n) => set({ choices: n }), 2, 8),
			check("showMoves", "Show the moves", s.showMoves, (on) => set({ showMoves: on })),
			check("orderHint", "Order questions: show the target", s.orderHint, (on) => set({ orderHint: on })),
			check("familyShowName", "Family questions: show the name", s.familyShowName, (on) => set({ familyShowName: on })),
		);
		const group = el("fieldset", { className: "tr-field" }, [el("legend", { textContent: "Family group (none: any tag)" })]);
		for (const t of allTags(tree)) {
			group.append(check(`tag-${t}`, t, s.familyGroup.includes(t), (on) => set({ familyGroup: on ? [...s.familyGroup, t] : s.familyGroup.filter((x) => x !== t) })));
		}
		box.append(
			group,
			pick("bookSide", "Book side", s.bookSide, ["white", "black", "both"], (x) => set({ bookSide: x })),
			pick("bookRule", "Book rule", s.bookRule, ["any", "main"], (x) => set({ bookRule: x })),
			num("masteryBox", "Mastered from box", s.masteryBox, (n) => set({ masteryBox: n }), 1, 5),
		);
		s.intervals.forEach((d, i) => box.append(num(`interval-${i}`, `Days in box ${i}`, d, (n) => set({ intervals: s.intervals.map((x, j) => (j === i ? n : x)) }), 0)));
		box.append(
			num("newPerSession", "New cards per session", s.newPerSession, (n) => set({ newPerSession: n }), 0),
			num("sessionLength", "Session length (0: no limit)", s.sessionLength, (n) => set({ sessionLength: n }), 0),
			chipBtn("tr-settings-done", "Done", "Back to the outline", act(() => (ui.screen = "outline"))),
		);
		return box;
	}

	// --- questions -----------------------------------------------------------

	function questionScreen() {
		const card = ui.card;
		const node = tree.byKey.get(card.key);
		const box = el("div", { className: "tr-question" });
		const total = ui.session.queue.length;
		const place = ui.answered ? ui.session.i : ui.session.i + 1;
		const prompt = el("p", { className: "tr-prompt" });
		const body = el("div", { className: "tr-body" });
		box.append(el("p", { className: "tr-progress", textContent: `Question ${place} of ${total}` }), prompt, body);

		const next = () => {
			setCard();
			onChange();
		};
		const finish = (right, detail, notes = {}) => {
			// before answer() counts this card as seen
			const fresh = !deck.some((c) => c.vkey === card.vkey && progress.cards[c.id]?.seen > 0);
			answer(ui.session, progress, card, right, settings, now);
			save();
			ui.answered = { right, detail, notes, fresh };
			onChange();
		};
		let typedInput = null; // the typed-name field, when this question has one
		panel.onkeydown = (e) => {
			if (e.key === "Enter") {
				if (e.target.closest?.("button")) return; // a focused button handles Enter itself
				if (ui.answered) next();
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

		if (card.type === "name") {
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
				finish(right, detail, card.notes);
			};
			body.append(ui.answered ? boardSvg(chess.fen(), BOARD, { flipped }) : interactiveBoard(chess.fen(), play, { size: BOARD, flipped }), flip());
		}

		if (ui.answered) {
			const { right, detail, notes, fresh } = ui.answered;
			const res = el("div", { className: `tr-result ${right ? "right" : "wrong"}` }, [el("strong", { textContent: right ? "Right" : "Not quite" })]);
			for (const d of detail) res.append(el("p", { textContent: d }));
			for (const [san, text] of Object.entries(notes)) {
				const p = el("p", { className: "tr-note" }, [`${san}: `]);
				renderInline(p, text);
				res.append(p);
			}
			const v = fresh && tree.byKey.get(card.vkey);
			if (v) res.append(chipBtn("tr-learn", "New to you? Learn it", "Play through this variation with its notes", () => learn(v)));
			res.append(chipBtn("tr-next", "Next", "Next question (Enter)", next));
			box.append(res);
		}
		return box;
	}

	// --- summary ---------------------------------------------------------------

	function summaryScreen() {
		const sum = sessionSummary(ui.session, tree, deck, progress, settings, now);
		const total = sum.right + sum.wrong;
		const name = (id) => {
			const c = deck.find((x) => x.id === id);
			return c ? `${nameOf(c.vkey)} (${c.type})` : id;
		};
		const box = el("div", { className: "tr-summary" }, [el("h3", { textContent: `Right ${sum.right} / ${total}` })]);
		const list = (title, items) => items.length && box.append(el("p", { textContent: `${title}: ${items.join(", ")}` }));
		list("Moved up", sum.up.map(name));
		list("Moved down", sum.down.map(name));
		list("Newly unlocked", sum.unlocked);
		const unit = (n, word) => `in ${n} ${word}${n === 1 ? "" : "s"}`;
		const ahead = sum.nextDue === null ? 0 : sum.nextDue - now;
		// sessionSummary only looks ahead, so a card already overdue means "now"
		const overdue = Object.values(progress.cards).some((r) => isDue(r, settings, now));
		let wait = "nothing scheduled";
		if (overdue) wait = "now";
		else if (ahead >= DAY) wait = unit(Math.ceil(ahead / DAY), "day");
		else if (ahead > 0) wait = unit(Math.ceil(ahead / 3600000), "hour");
		box.append(
			el("p", { textContent: `Next review: ${wait}` }),
			chipBtn("tr-back", "Back to the outline", "", act(() => (ui.screen = "outline"))),
		);
		return box;
	}
}
