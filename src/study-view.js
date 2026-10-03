// src/study-view.js
// The study view: the workbook read on a board, line by line, with its notes
// written out beside the moves and the engine to hand. Nothing in it writes to
// the workbook -- no tagging, naming, notes or adding lines; that is the
// analysis board's job. The board, the nav row, the typed-move box and the
// engine box are the analysis board's own (analysis-view.js, engine-view.js),
// so a key or a button does the same thing in both.
//
// Like analysisPanel it is a pure function of its state (study.js): every
// control mutates the study and calls onChange, which redraws the panel.

import { el, renderInline } from "./dom.js";
import { activeLine, back, forward, goTo, positionOf, stepBranch } from "./analysis.js";
import { boardAndEngine, boardRow, chipBtn, helpDialog, moveBox, navRow, speak, statusLine } from "./analysis-view.js";
import { engineBox } from "./engine-view.js";
import { appendFootnote } from "./render.js";
import { markSym } from "./nags.js";
import { defaultLineName } from "./tree.js";
import { backToBook, ownFrom, readLine, stepStudyLine, studyMark, studyNotes, studyPlay, studyPlayAll } from "./study.js";

export const STUDY_KEYS = [
	["← →", "Back / forward one move"],
	["Home / End", "To the start / end of the line"],
	["↑ ↓", "The previous / next line of the workbook"],
	["[ ]", "Back / on to where this line meets another"],
	["F", "Flip the board"],
	["M", "Type a move (SAN like Nf3, or g1f3)"],
	["B", "Back to the book, after moves of your own"],
	["E", "Engine on / off"],
	["Space", "Play the engine's best move"],
	["?", "This list"],
	["Esc", "Close this list, then the study"],
];

// "12.Nf3" or "12...Nf6"; `first` writes a Black move with its number.
const moveText = (ply, san, first = true) =>
	ply % 2 === 0 ? `${ply / 2 + 1}.${san}` : first ? `${(ply + 1) / 2}...${san}` : san;

// A line's name; an unnamed one (the app names every line, so only a bare
// workbook has these) by its place in the study, as the editor would name it.
const lineName = (study, i) => {
	const line = study.lines[i];
	if (line.off) return "Your moves";
	return line.src.name || defaultLineName(!!line.src.isMain, i + 1);
};

export function studyPanel(study, onChange, { engine = null, flavors = null } = {}) {
	const panel = el("div", { className: "analysis study", tabIndex: -1 });
	panel.setAttribute("aria-label", "Study. Press ? for keyboard shortcuts.");
	const pos = positionOf(study);
	const line = activeLine(study);
	const play = (san) => studyPlay(study, san);
	const act = (fn) => () => {
		fn();
		onChange();
	};

	const keys = {
		ArrowLeft: () => back(study),
		ArrowRight: () => forward(study),
		Home: () => goTo(study, 0),
		End: () => goTo(study, line.moves.length),
		ArrowUp: () => stepStudyLine(study, -1),
		ArrowDown: () => stepStudyLine(study, 1),
		"[": () => stepBranch(study, -1),
		"]": () => stepBranch(study, 1),
		f: () => (study.flipped = !study.flipped),
		b: () => backToBook(study),
		"?": () => (study.help = !study.help),
	};
	if (engine) {
		keys.e = () => engine.enable(!engine.state.enabled);
		keys[" "] = () => {
			const best = engine.state.enabled && engine.state.fen === pos.fen && engine.state.lines[0];
			if (best) play(best.moves[0].san);
		};
	}
	panel.onkeydown = (e) => {
		if (e.key === "Escape" && study.help) {
			e.stopPropagation();
			study.help = false;
			onChange();
			return;
		}
		if (e.target.closest("input, textarea, select")) return;
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === " " && e.target.closest("button")) return;
		const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
		if (k === "m" || k === "/") {
			e.preventDefault();
			panel.querySelector(".an-type")?.focus();
			return;
		}
		const fn = keys[k];
		if (!fn) return;
		e.preventDefault();
		fn();
		onChange();
	};

	// ---- left column: the board and its controls
	const left = el("div", { className: "an-left" });
	const { row, board, bar } = boardRow(study, pos, play, onChange);
	// the engine's lines right under the board, as on the analysis board
	left.appendChild(
		boardAndEngine(
			panel,
			row,
			engine && engineBox(engine, pos, onChange, { board, bar, flavors, playLine: (sans) => studyPlayAll(study, sans) }),
			engine,
		),
	);
	left.appendChild(statusLine(pos));
	left.appendChild(navRow(study, act));
	left.appendChild(moveBox(study, play, onChange));
	const helpBtn = el("button", {
		className: "an-help-open",
		textContent: "? all keys",
		title: "Keyboard shortcuts (?)",
		onclick: act(() => (study.help = true)),
	});
	helpBtn.setAttribute("aria-keyshortcuts", "Shift+?");
	helpBtn.setAttribute("aria-haspopup", "dialog");
	left.appendChild(
		el("div", { className: "an-keys" }, [
			"Keys: ← → step · Home/End · ↑ ↓ switch line · [ ] branch points · F flip" +
				(engine ? " · E engine · Space best move" : "") +
				" · ",
			helpBtn,
		]),
	);
	left.appendChild(
		el("div", { className: "an-touch-hint", textContent: "Swipe the board left or right to step through the moves" }),
	);

	// ---- right column: the line and its notes
	const right = el("div", { className: "an-right" });
	const { notes, foot } = studyNotes(line.moves, line.src, study.numbering);
	// The note on the move just played comes before the move list: on a
	// phone the columns stack, and a long game's moves pushed it off the
	// screen. The move list and the notes scroll in their own boxes, kept on
	// the move the board is at.
	right.appendChild(lineHead(study, line, foot, onChange));
	right.appendChild(hereBox(study, notes));
	const sheet = moveSheet(study, line, notes, onChange);
	const list = notesList(study, line, notes, onChange);
	right.append(sheet, list);
	// once the panel is on the page, where the boxes have a layout
	queueMicrotask(() => {
		keepInView(sheet, sheet.querySelector(".an-move.at"));
		keepInView(list, list.querySelector(".st-note.here") || list.querySelector(".st-note.ahead"));
	});

	panel.append(left, right);
	if (study.help)
		panel.appendChild(
			helpDialog(
				act(() => (study.help = false)),
				STUDY_KEYS.filter(([k]) => engine || (k !== "E" && k !== "Space")),
			),
		);
	speak(study, pos);
	return panel;
}

// Scroll a box (not the page around it) so `item` is in view. A box that
// does not scroll, or an item already in view, is left as it is.
function keepInView(box, item) {
	if (!item || !box.isConnected) return;
	const top = item.offsetTop - box.offsetTop;
	if (top < box.scrollTop || top + item.offsetHeight > box.scrollTop + box.clientHeight)
		box.scrollTop = Math.max(0, top - box.clientHeight / 3);
}

// What the line being read is: its name, the footnote it is if it is one, the
// evaluation and commentary written on the line as a whole -- or, for moves of
// the reader's own, where they left the book.
function lineHead(study, line, foot, onChange) {
	const head = el("div", { className: "st-head" });
	head.appendChild(linePicker(study, onChange));
	if (foot) head.appendChild(el("span", { className: "st-tag", textContent: `footnote [${foot.n}]` }));
	if (line.off) {
		const left = line.offAt
			? `Off the book after ${moveText(line.offAt - 1, line.moves[line.offAt - 1].san)}`
			: "Off the book from the start";
		head.appendChild(el("span", { className: "st-off", textContent: left + ". Nothing here is saved." }));
		head.appendChild(
			chipBtn("st-book", "↩ Back to the book", "Back to where you left the workbook's lines (B)", () => {
				backToBook(study);
				onChange();
			}),
		);
		return head;
	}
	const meta = line.src.meta || {};
	if (meta.eval) head.appendChild(el("span", { className: "st-eval", textContent: meta.eval }));
	if (meta.note) {
		const note = el("div", { className: "st-linenote" });
		renderInline(note, meta.note);
		head.appendChild(note);
	}
	return head;
}

// The line written out, each move with its symbol and its note markers. A
// click on a move goes to it.
function moveSheet(study, line, notes, onChange) {
	const box = el("div", { className: "st-moves an-line-moves" });
	box.setAttribute("aria-label", "Moves of this line");
	const markers = new Map();
	notes.forEach((n) => {
		if (!markers.has(n.ply)) markers.set(n.ply, []);
		if (!markers.get(n.ply).includes(n.label)) markers.get(n.ply).push(n.label);
	});
	line.moves.forEach((m, j) => {
		const sym = markSym(studyMark(line, j));
		const mv = el("button", {
			className:
				"an-move" +
				(j === study.at - 1 ? " at" : "") +
				(line.off && j >= line.offAt ? " st-own" : ""),
			textContent: moveText(j, m.san, j === 0) + (sym ? " " + sym : ""),
			onclick: () => {
				goTo(study, j + 1);
				onChange();
			},
		});
		if (j === study.at - 1) mv.setAttribute("aria-current", "step");
		const marks = markers.get(j);
		if (marks) {
			mv.appendChild(el("sup", { textContent: "[" + marks.join(",") + "]" }));
			mv.setAttribute("aria-label", `${moveText(j, m.san)}, note ${marks.join(", ")}`);
		}
		box.appendChild(mv);
	});
	if (!line.moves.length) box.appendChild(el("span", { className: "an-empty", textContent: "(no moves)" }));
	return box;
}

// One note's body: a numbered note's text, a footnote's moves and notes, or a
// lettered note's text -- rendered by the same code as the Notes list.
function noteBody(container, n) {
	if (n.sub) renderInline(container, n.sub.text);
	else if (n.entry.foot) appendFootnote(container, n.entry.foot);
	else renderInline(container, n.entry.text);
}

// The notes on the move just played, large, where the eye is.
function hereBox(study, notes) {
	const box = el("div", { className: "st-here" });
	box.setAttribute("aria-live", "polite");
	const here = study.at ? notes.filter((n) => n.ply === study.at - 1) : [];
	if (!here.length) {
		box.classList.add("empty");
		box.textContent = study.at ? "No note on this move." : "The start position.";
		return box;
	}
	here.forEach((n) => {
		const row = el("div", { className: "st-here-note" }, [el("sup", { textContent: "[" + n.label + "]" })]);
		noteBody(row, n);
		box.appendChild(row);
	});
	return box;
}

// Every note along the line, in order. The one on the move just played is
// marked; the ones still ahead are quieter. A click on a note goes to its
// move, and a footnote offers its own line to read.
function notesList(study, line, notes, onChange) {
	const box = el("div", { className: "st-notes" });
	box.appendChild(el("div", { className: "an-sec", textContent: `Notes on this line (${notes.length})` }));
	if (!notes.length) {
		box.appendChild(el("div", { className: "an-note-hint", textContent: "This line has no notes." }));
		return box;
	}
	notes.forEach((n) => {
		const row = el("div", {
			className: "st-note nt" + (n.ply === study.at - 1 ? " here" : n.ply >= study.at ? " ahead" : ""),
		});
		const go = el("button", {
			className: "st-note-go",
			textContent: `[${n.label}] ${line.moves[n.ply] ? moveText(n.ply, line.moves[n.ply].san) : ""}`,
			title: "Go to this move",
			onclick: () => {
				goTo(study, n.ply + 1);
				onChange();
			},
		});
		row.appendChild(go);
		const body = el("div", { className: "st-note-body" });
		noteBody(body, n);
		row.appendChild(body);
		const fl = n.entry && n.entry.foot ? footLine(study, n.entry.foot) : null;
		if (fl !== null && fl !== study.active)
			row.appendChild(
				chipBtn("st-read-foot", "Read this footnote", "Follow the footnote's line on the board", () => {
					study.active = fl;
					goTo(study, n.entry.foot.d + 1);
					onChange();
				}),
			);
		box.appendChild(row);
	});
	return box;
}

// The study line a footnote is: the footnote's own line, or a group's first
// member. Null if none is in the study.
function footLine(study, foot) {
	let node = foot;
	while (!node.line && node.children && node.children.length) node = node.children[0];
	const i = study.lines.findIndex((l) => !l.off && l.src === node.line);
	return i === -1 ? null : i;
}

// Which line is being read, and the way to any other: ◀ ▶ step through the
// workbook's lines in order (↑ ↓ do the same), and the drop-down goes
// straight to one. Each line is listed by name with the move it leaves the
// others on, so lines named only "Line 7" can still be told apart.
function linePicker(study, onChange) {
	const book = study.lines.map((l, i) => i).filter((i) => !study.lines[i].off);
	const line = activeLine(study);
	const go = (dir) => () => {
		stepStudyLine(study, dir);
		onChange();
	};
	const box = el("div", { className: "st-picker" });
	const one = book.length < 2;
	box.appendChild(chipBtn("st-prev", "◀", "Previous line (↑)", go(-1), one, "Previous line", "ArrowUp"));
	box.appendChild(el("span", { className: "st-name", textContent: lineName(study, study.active) }));
	box.appendChild(chipBtn("st-next", "▶", "Next line (↓)", go(1), one, "Next line", "ArrowDown"));
	const sel = el("select", { className: "st-pick", title: "Go to a line" });
	sel.setAttribute("aria-label", "Go to a line");
	if (line.off) sel.appendChild(el("option", { value: String(study.active), textContent: "Your moves", selected: true }));
	book.forEach((i, k) => {
		const l = study.lines[i];
		const d = ownFrom(study, i);
		const label = `${k + 1}. ${lineName(study, i)}` + (k && l.moves[d] ? ` · ${moveText(d, l.moves[d].san)}` : "");
		sel.appendChild(el("option", { value: String(i), textContent: label, selected: i === study.active }));
	});
	sel.onchange = () => {
		readLine(study, Number(sel.value));
		onChange();
	};
	box.appendChild(sel);
	const k = book.indexOf(study.active);
	box.appendChild(
		el("span", { className: "st-count", textContent: k === -1 ? `${book.length} lines` : `${k + 1} of ${book.length}` }),
	);
	return box;
}
