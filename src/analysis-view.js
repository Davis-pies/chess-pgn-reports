// src/analysis-view.js
// Analysis mode's panel. It owns no state of its own: everything it draws
// comes from the scratch it is handed, and every control mutates that scratch
// and calls onChange, which is what rebuilds the panel. That keeps the view a
// pure function of the scratch, the same contract the report panels keep with
// current.lines.
//
// The one exception is the engine, whose output arrives many times a second.
// Rebuilding the panel for each would drop a half-typed note and a piece
// being dragged, so the engine's parts -- its box, the eval bar, the arrows --
// are repainted in place by a listener the panel installs on the engine.

import { el } from "./dom.js";
import { announce } from "./a11y.js";
import { interactiveBoard } from "./board-input.js";
import {
	activeLine,
	back,
	branchPoints,
	checkpoint,
	forward,
	goTo,
	clearShown,
	moveLine,
	moveToTop,
	pin,
	redo,
	redoLabel,
	rename,
	shown,
	toggleShowAll,
	play,
	playAll,
	positionOf,
	removeLine,
	select,
	sharedPrefix,
	stepBranch,
	stepLine,
	through,
	truncate,
	typedMove,
	undo,
	undoLabel,
} from "./analysis.js";
import {
	commitAll,
	commitLine,
	inNotebook,
	notebookNotes,
	saveAllNotes,
	saveNote,
} from "./analysis-commit.js";
import { commentEditor } from "./line-editor.js";
import { shareTools } from "./share-tools.js";
import { engineBox } from "./engine-view.js";
import { getCurrent } from "./state.js";
import { loadPrefs, savePrefs } from "./prefs.js";
import { visibleLines } from "./visibility.js";

// "1.e4 e5 2.Nf3". Deliberately not render.js's movesText: that one formats a
// notebook line's divergent tail against a mainline, which a scratch has no
// notion of.
export function numberedMoves(moves) {
	return moves
		.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m.san}` : m.san))
		.join(" ");
}

// A move as a screen reader should say it: "Nxf7+" is read letter by letter,
// "knight takes f7, check" is a move.
const PIECE = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight" };
export function spokenSan(san) {
	if (/^O-O-O/.test(san)) return "castles queenside" + (/#$/.test(san) ? ", mate" : /\+$/.test(san) ? ", check" : "");
	if (/^O-O/.test(san)) return "castles kingside" + (/#$/.test(san) ? ", mate" : /\+$/.test(san) ? ", check" : "");
	const m = /^([KQRBN])?([a-h]?[1-8]?)(x)?([a-h][1-8])(?:=([QRBN]))?([+#])?/.exec(san);
	if (!m) return san;
	const [, piece, from, takes, to, promo, mark] = m;
	return [
		piece ? PIECE[piece] + (from ? " " + from : "") : from || "",
		takes ? "takes" : "",
		to,
		promo ? "promotes to " + PIECE[promo] : "",
	]
		.filter(Boolean)
		.join(" ") + (mark === "#" ? ", mate" : mark === "+" ? ", check" : "");
}

// "12... knight f6": a move with its number, for reading out.
const spokenMove = (j, san) => `${Math.floor(j / 2) + 1}${j % 2 ? "..." : "."} ${spokenSan(san)}`;

// Every key the board answers to, for the help it opens with ?. The handlers
// are in the panel; this is what they are called.
export const BOARD_KEYS = [
	["← / →", "Back / forward one move"],
	["Home / End", "To the start / end of the line"],
	["↑ / ↓", "Previous / next line, at the same move"],
	["[ / ]", "Back / forward to where the line meets another"],
	["F", "Flip the board"],
	["M", "Type a move (SAN like Nf3, or g1f3)"],
	["N", "Write a note on the move just played"],
	["P", "Pin or unpin the line being played"],
	["Ctrl+Z", "Undo"],
	["Ctrl+Shift+Z", "Redo"],
	["E", "Engine on / off"],
	["Space", "Play the engine's best move"],
	["?", "This list"],
	["Esc", "Close this list, then the board"],
];

const noteOn = (line, ply) =>
	(line.comments || []).find((c) => c.ply === ply)?.text || "";

const BOARD_SIZE = 480;

export function analysisPanel(
	scratch,
	onChange,
	{ onAdded = onChange, onNotebook = onChange, engine = null, flavors = null } = {},
) {
	// tabIndex -1 rather than 0: the panel is focusable so the arrow keys have
	// somewhere to land, but it is not a tab stop of its own -- tabbing should
	// still walk the actual controls. app.js focuses it after appending.
	const panel = el("div", { className: "analysis", tabIndex: -1 });
	panel.setAttribute("aria-label", "Analysis board. Press ? for keyboard shortcuts.");
	const pos = positionOf(scratch);

	// Mutate, then redraw: every control below is one of these.
	const act = (fn) => () => {
		fn();
		onChange();
	};
	// ... and the ones that change the lines keep an undo first, labelled
	// with what they do so the Undo button can say what it will put back.
	const risky = (label, fn) => act(() => {
		checkpoint(scratch, label);
		fn();
	});

	// On the panel rather than the document: the listener dies with the element,
	// so a re-render cannot leave a stack of handlers behind all stepping the
	// same cursor. Clicks land on controls inside the panel, so keydown after a
	// click still bubbles here.
	const keys = {
		ArrowLeft: () => back(scratch),
		ArrowRight: () => forward(scratch),
		Home: () => goTo(scratch, 0),
		End: () => goTo(scratch, activeLine(scratch).moves.length),
		ArrowUp: () => stepLine(scratch, -1),
		ArrowDown: () => stepLine(scratch, 1),
		"[": () => stepBranch(scratch, -1),
		"]": () => stepBranch(scratch, 1),
		f: () => (scratch.flipped = !scratch.flipped),
		p: () => pin(scratch, scratch.active),
		"?": () => (scratch.help = !scratch.help),
	};
	// Keys that move focus rather than change the scratch: nothing to redraw.
	const focusKeys = {
		m: () => panel.querySelector(".an-type")?.focus(),
		"/": () => panel.querySelector(".an-type")?.focus(),
		n: () => panel.querySelector(".cedit input")?.focus(),
	};
	if (engine) {
		keys.e = () => engine.enable(!engine.state.enabled);
		// the engine's first choice, if it has one for this very position
		keys[" "] = () => {
			const best = engine.state.enabled && engine.state.fen === pos.fen && engine.state.lines[0];
			if (best) play(scratch, best.moves[0].san);
		};
	}
	panel.onkeydown = (e) => {
		// The help is the innermost thing open, so Escape closes it and not the
		// board around it.
		if (e.key === "Escape" && scratch.help) {
			e.stopPropagation();
			scratch.help = false;
			onChange();
			return;
		}
		if (e.target.closest("input, textarea, select")) return; // the caret's, while typing a note
		// Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes; any other
		// modified key is the browser's.
		if ((e.ctrlKey || e.metaKey) && !e.altKey) {
			const k = e.key.toLowerCase();
			const fn = k === "z" ? (e.shiftKey ? redo : undo) : k === "y" ? redo : null;
			if (!fn) return;
			e.preventDefault();
			fn(scratch);
			onChange();
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.key === " " && e.target.closest("button")) return; // Space presses a focused button
		// a letter with Caps Lock on is the same key
		const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
		if (focusKeys[k]) {
			e.preventDefault();
			focusKeys[k]();
			return;
		}
		const fn = keys[k];
		if (!fn) return;
		e.preventDefault();
		fn();
		onChange();
	};

	// ---- left column: board, engine, status, navigation
	const left = el("div", { className: "an-left" });
	const { row, board, bar } = boardRow(scratch, pos, (san) => play(scratch, san), onChange);
	left.appendChild(row);
	// The engine's lines go right under the board, where the eye already is
	// and where they stay put however long the panel beside them grows.
	if (engine)
		left.appendChild(
			engineBox(engine, pos, onChange, {
				board,
				bar,
				flavors,
				playLine: (sans) => playAll(scratch, sans),
				noteEval: scratch.at
					? (text) => {
							const line = activeLine(scratch);
							line.comments = line.comments || [];
							line.comments.push({ ply: scratch.at - 1, text });
						}
					: null,
			}),
		);
	left.appendChild(statusLine(pos));
	const len = activeLine(scratch).moves.length;
	left.appendChild(
		navRow(scratch, act, [
			chipBtn(
				"an-cut",
				"✂ Delete from here",
				"Delete the moves after this one in this line",
				risky("delete from here", () => truncate(scratch)),
				scratch.at === len,
			),
		]),
	);
	left.appendChild(moveBox(scratch, (san) => play(scratch, san), onChange));
	const helpBtn = el("button", {
		className: "an-help-open",
		textContent: "? all keys",
		title: "Keyboard shortcuts (?)",
		onclick: act(() => (scratch.help = true)),
	});
	helpBtn.setAttribute("aria-keyshortcuts", "Shift+?");
	helpBtn.setAttribute("aria-haspopup", "dialog");
	left.appendChild(
		el("div", { className: "an-keys" }, [
			"Keys: ← → step · Home/End · ↑ ↓ switch line · [ ] branch points · F flip · Ctrl+Z undo" +
				(engine ? " · E engine · Space best move" : "") +
				" · ",
			helpBtn,
		]),
	);
	// shown in place of the keys on a touch screen (see style.css)
	left.appendChild(
		el("div", {
			className: "an-touch-hint",
			textContent: "Swipe the board left or right to step through the moves",
		}),
	);

	// ---- right column: lines, note, commit
	const right = el("div", { className: "an-right" });

	// The lines through the position on the board: the list follows the
	// cursor, so a line that does not lead here is out of view until the
	// cursor goes back to where it does (or it is pinned). The rest are kept,
	// and the heading offers them all, or takes the list back to these.
	const on = shown(scratch);
	const herePos = activeLine(scratch).moves.slice(0, scratch.at);
	const passesHere = (l) => l.moves.length >= herePos.length && herePos.every((m, k) => l.moves[k].san === m.san);
	const counted = (idx) => idx.filter((i) => scratch.lines[i].moves.length).length;
	const throughCount = on.filter((i) => passesHere(scratch.lines[i])).length;
	const offView = counted(scratch.lines.map((_, i) => i)) - counted(on);
	// The board's own lines, as distinct from the workbook's (listed below).
	const listHead = el("div", { className: "an-sec" }, [
		el("span", { textContent: `Analysis lines (${counted(on)})` }),
	]);
	if (scratch.showAll || offView)
		listHead.appendChild(
			el("button", {
				className: "an-showall",
				textContent: scratch.showAll
					? "hide lines not through here"
					: `${offView} more elsewhere — show`,
				title: scratch.showAll
					? "List only the analysis lines through the position on the board"
					: "Also list the analysis lines that do not pass through this position",
				onclick: act(() => toggleShowAll(scratch)),
			}),
		);
	right.appendChild(listHead);
	// Adding a line hands over to onAdded, which closes the window in the app.
	// A refusal changes nothing, so it does not redraw: the reason is written
	// under the list and stays there.
	const msg = el("div", { className: "an-msg", role: "status" });
	const addBtn = (cls, text, title, add) =>
		el("button", {
			className: "chip mini " + cls,
			textContent: text,
			title,
			onclick: (e) => {
				e.stopPropagation();
				const refused = add();
				if (refused) msg.textContent = refused;
				else onAdded();
			},
		});
	const addOne = (line, opts) => () => {
		const r = commitLine(line, opts);
		return r.ok ? null : r.reason;
	};
	// Naming a line happens in place, in a box where its name goes. Enter or
	// leaving the box keeps the name (an empty one clears it), Escape keeps
	// the old one -- and does not close the window, as Escape would elsewhere.
	function nameInput(i) {
		const line = scratch.lines[i];
		const input = el("input", {
			type: "text",
			className: "an-line-name-input",
			value: line.name || "",
			placeholder: "Line name",
		});
		input.setAttribute("aria-label", "Line name");
		let done = false;
		const finish = (keep) => {
			if (done) return;
			done = true;
			scratch.renaming = null;
			const name = input.value.trim();
			if (keep && name !== (line.name || "")) {
				checkpoint(scratch, "rename");
				rename(scratch, i, name);
			}
			onChange();
		};
		input.onclick = (e) => e.stopPropagation();
		input.onkeydown = (e) => {
			if (e.key === "Enter") finish(true);
			else if (e.key === "Escape") {
				e.stopPropagation();
				finish(false);
			}
		};
		input.onblur = () => finish(true);
		// after the app has focused the panel
		setTimeout(() => input.isConnected && input.focus());
		return input;
	}
	const list = el("div", { className: "an-lines", role: "list" });
	list.setAttribute("aria-label", "Analysis lines");
	on.forEach((i, k) => {
		const line = scratch.lines[i];
		const row = el("div", {
			className:
				"an-line" +
				(i === scratch.active ? " active" : "") +
				(!passesHere(line) ? " elsewhere" : ""),
		});
		// Clicking the row anywhere but on a move selects the line, the cursor
		// staying at the position (so the list stays as it is); clicking a move
		// selects the line AND puts the cursor after that move, which is how
		// you get back to a position you want to branch from again.
		row.onclick = act(() => select(scratch, i));
		const movesBox = el("div", { className: "an-line-moves" });
		if (scratch.renaming === i) row.appendChild(nameInput(i));
		else if (line.name)
			row.appendChild(
				el("span", {
					className: "an-line-name",
					textContent: line.name,
					title: "Double-click to rename",
					ondblclick: (e) => {
						e.stopPropagation();
						scratch.renaming = i;
						onChange();
					},
				}),
			);
		if (!line.moves.length) {
			movesBox.appendChild(el("span", { className: "an-empty", textContent: "(no moves yet — play one on the board)" }));
		}
		const shared = sharedPrefix(scratch, i);
		// Where several lines pass through the position on the board, each
		// repeats the moves the heading names, so each picks up at the last of
		// them. A line alone is written out whole: there is nothing to compare
		// it with, and the eye needs the moves that got it there.
		// A row other than the selected one goes further: it starts at the move
		// before it leaves the lines above it, so a list of lines that all run
		// the same way for a while reads as where each one differs rather than
		// as a column of the same opening moves.
		const skip =
			passesHere(line) && throughCount > 1
				? Math.max(herePos.length - 1, i === scratch.active ? 0 : shared - 1, 0)
				: 0;
		if (skip > 0) movesBox.appendChild(el("span", { className: "an-elide", textContent: "…", title: numberedMoves(line.moves.slice(0, skip)) }));
		line.moves.forEach((m, j) => {
			if (j < skip) return;
			const mv = el("button", {
				className:
					"an-move" +
					(i === scratch.active && j === scratch.at - 1 ? " at" : "") +
					(j < shared ? " shared" : "") +
					(noteOn(line, j) ? " has-note" : ""),
				textContent: j % 2 === 0 ? `${j / 2 + 1}.${m.san}` : j === skip ? `${(j + 1) / 2}...${m.san}` : m.san,
				title: noteOn(line, j),
			});
			mv.setAttribute("aria-label", spokenMove(j, m.san) + (noteOn(line, j) ? ", has a note" : ""));
			if (i === scratch.active && j === scratch.at - 1) mv.setAttribute("aria-current", "step");
			mv.onclick = (e) => {
				e.stopPropagation();
				select(scratch, i);
				goTo(scratch, j + 1);
				onChange();
			};
			movesBox.appendChild(mv);
		});
		row.setAttribute("role", "listitem");
		row.setAttribute("aria-label", `Line ${k + 1}${i === scratch.active ? ", being played" : ""}${line.pinned ? ", pinned" : ""}`);
		row.appendChild(movesBox);
		const tools = el("div", { className: "an-line-tools" });
		if (inNotebook(line.moves)) {
			tools.appendChild(el("span", { className: "an-badge", textContent: "in notebook", title: "The notebook already has this line" }));
		} else {
			tools.append(
				addBtn("primary an-add", "+ Line", "Add this line to the notebook as a sideline", addOne(line)),
				addBtn("an-add-foot", "+ Footnote", "Add this line to the notebook as a footnote", addOne(line, { tag: "foot" })),
			);
		}
		// Each of these is a glyph, so each is named for a screen reader, and
		// named with the line it acts on: a list of "Delete" buttons says nothing.
		const which = `line ${k + 1}`;
		const small = (cls, text, title, fn, disabled) => {
			const b = el("button", {
				className: "chip mini " + cls,
				textContent: text,
				title,
				disabled,
				onclick: (e) => {
					e.stopPropagation();
					fn();
				},
			});
			b.setAttribute("aria-label", `${title.split(":")[0]} (${which})`);
			return b;
		};
		if (on.length > 1) {
			tools.append(
				small("an-top", "⤒", "Make this the first line (the trunk of the copied PGN)", risky("move to top", () => moveToTop(scratch, i)), i === 0),
				small("an-up", "↑", "Move this line up", act(() => moveLine(scratch, i, -1)), k === 0),
				small("an-down", "↓", "Move this line down", act(() => moveLine(scratch, i, 1)), k === on.length - 1),
			);
		}
		// A pin holds a line in view wherever the cursor goes, until the board
		// is closed: for keeping one line to compare against while exploring
		// another that leaves it.
		const pinBtn = small(
			"an-pin" + (line.pinned ? " on" : ""),
			"📌",
			line.pinned ? "Unpin: let this line leave the list when it does not pass through the position" : "Pin: keep this line in view until the board is closed",
			act(() => pin(scratch, i)),
		);
		pinBtn.setAttribute("aria-pressed", String(!!line.pinned));
		tools.appendChild(pinBtn);
		tools.appendChild(
			small("an-rename", "✎", line.name ? "Rename this line" : "Name this line (the name goes into the notebook with it)", act(() => {
				scratch.renaming = i;
			})),
		);
		tools.appendChild(small("an-del", "✕", "Delete this line", risky("delete line", () => removeLine(scratch, i))));
		row.appendChild(tools);
		list.appendChild(row);
	});
	right.appendChild(list);
	right.appendChild(msg);
	right.appendChild(workbookLines(scratch, herePos, onChange));

	// Notes on the move just played, in the notebook's own note editor: a
	// scratch line keeps comments in the same shape a notebook line does.
	// The heading is set in capitals; the move inside it keeps its own case,
	// or "Nbd7" reads "NBD7" -- a bishop that isn't there.
	const san = el("span", { className: "an-san", textContent: scratch.at ? moveLabel(scratch) : "" });
	right.appendChild(el("div", { className: "an-sec" }, scratch.at ? ["Note on ", san] : ["Note"]));
	right.appendChild(
		scratch.at
			? commentEditor(scratch.at - 1, [activeLine(scratch)])
			: el("div", { className: "an-note-hint", textContent: "Play a move to note it." }),
	);
	right.appendChild(noteTools(scratch, onNotebook));

	// Every line on view can go into the notebook on its own, from its row,
	// and the lines on view can go in together from here.
	const commit = el("div", { className: "orow an-commit" });
	commit.append(
		addBtn("an-add-all", "Add all lines on view", "File every line in the list in the notebook as a sideline", () => {
			const r = commitAll(scratch);
			return r.added ? null : "Nothing added: every line is empty or already in the notebook.";
		}),
	);
	right.append(commit);

	// Ways out that do not change the lines: copying, saving, a link.
	right.appendChild(shareTools(scratch, pos, msg));

	const extra = el("div", { className: "orow an-tools" });
	extra.append(
		chipBtn("an-clear", "Clear lines", "Delete the lines on view and start again from this position", risky("clear lines", () => clearShown(scratch))),
	);
	const u = undoLabel(scratch);
	const r = redoLabel(scratch);
	if (u) extra.appendChild(chipBtn("an-undo", "↶ Undo " + u, "Undo: " + u + " (Ctrl+Z)", act(() => undo(scratch))));
	if (r) extra.appendChild(chipBtn("an-redo", "↷ Redo " + r, "Redo: " + r + " (Ctrl+Shift+Z)", act(() => redo(scratch))));
	right.appendChild(extra);

	panel.append(left, right);
	if (scratch.help)
		panel.appendChild(
			helpDialog(
				act(() => (scratch.help = false)),
				BOARD_KEYS.filter(([k]) => engine || (k !== "E" && k !== "Space")),
			),
		);
	speak(scratch, pos);
	return panel;
}

// The board and the eval bar beside it. A move made on the board goes to
// `onPlay`; a swipe steps along the line. The engine box paints the bar and
// draws its arrows on the board, so both are handed back with the row.
export function boardRow(scratch, pos, onPlay, onChange) {
	const board = interactiveBoard(
		pos.fen,
		(san) => {
			onPlay(san);
			onChange();
		},
		{
			flipped: scratch.flipped,
			size: BOARD_SIZE,
			lastMove: pos.lastMove,
			check: pos.check,
			label: scratch.at
				? `Board after ${spokenMove(scratch.at - 1, activeLine(scratch).moves[scratch.at - 1].san)}, ${pos.turn === "w" ? "White" : "Black"} to move`
				: `Board at the start, White to move`,
			onSwipe: (dir) => {
				if (dir > 0) forward(scratch);
				else back(scratch);
				onChange();
			},
		},
	);
	const bar = el("div", { className: "an-evalbar" + (scratch.flipped ? " flipped" : "") }, [
		el("div", { className: "an-evalfill" }),
	]);
	bar.setAttribute("role", "img");
	return { row: el("div", { className: "an-boardrow" }, [bar, board]), board, bar };
}

// Whose move it is, or how the game ended.
export function statusLine(pos) {
	const status = el("div", { className: "an-status" });
	if (pos.over) {
		status.textContent = pos.over;
		status.classList.add("over");
	} else {
		status.textContent = (pos.turn === "w" ? "White" : "Black") + " to move" + (pos.check ? " — check" : "");
	}
	return status;
}

// `name` is what a screen reader calls the button, where its text is a glyph
// or says less than the tooltip; `keys` is its shortcut, announced with it.
export function chipBtn(cls, text, title, onclick, disabled = false, name = null, keys = null) {
	const b = el("button", { className: "chip mini " + cls, textContent: text, title, onclick, disabled });
	if (name) b.setAttribute("aria-label", name);
	if (keys) b.setAttribute("aria-keyshortcuts", keys);
	return b;
}

// Stepping along the line and flipping the board: the same buttons, keys and
// names wherever a board is shown. `act` wraps a change in the caller's
// redraw; `extra` are the caller's own buttons, set after these.
export function navRow(scratch, act, extra = []) {
	const btn = chipBtn;
	const len = activeLine(scratch).moves.length;
	const nav = el("div", { className: "an-nav orow" });
	nav.append(
		btn("an-start", "⏮", "Back to the start (Home)", act(() => goTo(scratch, 0)), scratch.at === 0, "Back to the start", "Home"),
		btn("an-prevbranch", "⤺", "Back to where this line meets another ([)", act(() => stepBranch(scratch, -1)), !branchPoints(scratch).some((p) => p < scratch.at), "Back to where this line meets another", "["),
		btn("an-back", "◀", "Back one move (←)", act(() => back(scratch)), scratch.at === 0, "Back one move", "ArrowLeft"),
		btn("an-fwd", "▶", "Forward one move (→)", act(() => forward(scratch)), scratch.at === len, "Forward one move", "ArrowRight"),
		btn("an-nextbranch", "⤻", "On to where this line meets another (])", act(() => stepBranch(scratch, 1)), !branchPoints(scratch).some((p) => p > scratch.at), "On to where this line meets another", "]"),
		btn("an-end", "⏭", "To the end of the line (End)", act(() => goTo(scratch, len)), scratch.at === len, "To the end of the line", "End"),
		// Flip changes nothing about the scratch's moves, so it is kept apart
		// from the controls that do.
		btn("an-flip", "⇅ Flip", "Show the board from the other side (F)", act(() => {
			scratch.flipped = !scratch.flipped;
		}), false, "Flip the board", "F"),
		...extra,
	);
	nav.setAttribute("role", "toolbar");
	nav.setAttribute("aria-label", "Move navigation");
	return nav;
}

// Read out where the board is after anything that moved it: the move just
// played and whose turn it is. Only on a change, so a redraw for a note or a
// pin says nothing.
let lastSpoken = "";
export function speak(scratch, pos) {
	const line = activeLine(scratch);
	const where = scratch.at ? "After " + spokenMove(scratch.at - 1, line.moves[scratch.at - 1].san) : "Start position";
	const text = `${where}. ${pos.over || (pos.turn === "w" ? "White" : "Black") + " to move"}.`;
	if (text === lastSpoken) return;
	lastSpoken = text;
	announce(text);
}

// The keys, in a dialog over the panel. Opened with ? or its button; Esc,
// ? again or Close shuts it (the panel's keydown handles the keys).
// `rows` are [key, what it does] pairs: each board has its own keys.
export function helpDialog(close, rows) {
	const table = el("table", { className: "an-help-keys" }, [
		el("caption", { className: "sr-only", textContent: "Keyboard shortcuts" }),
		el("tbody", {}, rows.map(([k, what]) =>
			el("tr", {}, [el("th", { scope: "row" }, [el("kbd", { textContent: k })]), el("td", { textContent: what })]),
		)),
	]);
	const box = el("div", { className: "an-help modal" }, [
		el("h3", { id: "an-help-title", textContent: "Keyboard shortcuts" }),
		table,
		el("p", { className: "an-help-note", textContent: "Keys work anywhere in the window except while typing in a box. Tab walks the controls; Enter or Space presses one." }),
		el("div", { className: "modal-actions" }, [el("button", { className: "chip an-help-close", textContent: "Close", onclick: close })]),
	]);
	box.setAttribute("role", "dialog");
	box.setAttribute("aria-modal", "true");
	box.setAttribute("aria-labelledby", "an-help-title");
	return el("div", { className: "an-help-wrap", onclick: (e) => e.target === e.currentTarget && close() }, [box]);
}

// A move typed in, for playing without a mouse (or a finger). Enter plays it
// through `onPlay`; a move that is not legal here is said so, and stays in the
// box to fix.
export function moveBox(scratch, onPlay, onChange) {
	const hint = el("span", { className: "an-type-msg", id: "an-type-msg", role: "status" });
	const input = el("input", {
		className: "an-type",
		type: "text",
		placeholder: "Type a move: Nf3, exd5, O-O, g1f3…",
		autocomplete: "off",
		spellcheck: false,
	});
	input.setAttribute("aria-label", "Type a move");
	input.setAttribute("aria-describedby", "an-type-msg");
	input.setAttribute("aria-keyshortcuts", "M");
	input.onkeydown = (e) => {
		if (e.key === "Escape" && input.value) {
			// clear the box first; a second Escape closes the board as usual
			e.stopPropagation();
			input.value = "";
			input.removeAttribute("aria-invalid");
			hint.textContent = "";
			return;
		}
		if (e.key !== "Enter") return;
		e.preventDefault();
		const san = typedMove(scratch, input.value);
		if (!san) {
			input.setAttribute("aria-invalid", "true");
			hint.textContent = input.value.trim() ? `${input.value.trim()} is not a legal move here.` : "";
			return;
		}
		onPlay(san);
		onChange();
	};
	input.oninput = () => {
		input.removeAttribute("aria-invalid");
		hint.textContent = "";
	};
	return el("div", { className: "an-type-row" }, [input, hint]);
}

// "12...Nf6", the move the cursor sits after.
// "8.Qd2" or "7...Qb6": the last move of a list of SANs from move one.
function sanLabel(sans) {
	const j = sans.length - 1;
	return j % 2 === 0 ? `${j / 2 + 1}.${sans[j]}` : `${(j + 1) / 2}...${sans[j]}`;
}

const moveLabel = (s) => sanLabel(activeLine(s).moves.slice(0, s.at).map((m) => m.san));

// Saving notes into the notebook without adding a line: the one on this move,
// or all of them. Beside them, what the notebook says on this move now, when
// that is not what the board says -- so a save never overwrites a note the
// user could not see. A save redraws the report behind the window, and with it
// the panel, so its outcome rides on the scratch to the next draw.
// `onChange` here is the caller's onNotebook: saving a note writes to the
// notebook, so the report behind the window has to be redrawn as well.
function noteTools(scratch, onChange) {
	const box = el("div", { className: "an-note-tools" });
	const line = activeLine(scratch);
	const ply = scratch.at - 1;
	const on = () => shown(scratch).map((i) => scratch.lines[i]);
	const say = (text) => {
		scratch.flash = text;
		onChange();
	};
	if (scratch.at) {
		const nb = notebookNotes(line.moves, ply);
		const here = (line.comments || []).filter((c) => c.ply === ply).map((c) => c.text);
		if (nb === null) {
			box.appendChild(
				el("div", {
					className: "an-note-nb",
					textContent: "This move is not in the notebook yet; its notes go in when its line is added.",
				}),
			);
		} else if (nb.join("\n") !== here.join("\n")) {
			box.appendChild(
				el("div", {
					className: "an-note-nb",
					textContent: "In the notebook: " + (nb.length ? nb.join(" · ") : "no note"),
				}),
			);
		}
		const one = el("button", {
			className: "chip mini an-save-note",
			textContent: "Save note to notebook",
			title: "Make the notebook's note on this move the one here",
			disabled: nb === null,
			onclick: () => {
				const r = saveNote(activeLine(scratch), ply);
				say(r.ok ? (r.notes ? "Note saved to the notebook." : "Note cleared in the notebook.") : r.reason);
			},
		});
		box.appendChild(el("div", { className: "orow an-note-acts" }, [one, saveAll()]));
	} else if (on().some((l) => (l.comments || []).length)) {
		box.appendChild(el("div", { className: "orow an-note-acts" }, [saveAll()]));
	}
	function saveAll() {
		return el("button", {
			className: "chip mini an-save-notes",
			textContent: "Save all notes",
			title: "Save every note here that is on a move the notebook has",
			disabled: !on().some((l) => (l.comments || []).length),
			onclick: () => {
				const { saved, missing } = saveAllNotes(scratch);
				const parts = [];
				parts.push(saved === 1 ? "1 note saved to the notebook." : `${saved} notes saved to the notebook.`);
				if (missing)
					parts.push(
						`${missing} ${missing === 1 ? "is" : "are"} on moves not in the notebook yet; add those lines to keep them.`,
					);
				say(parts.join(" "));
			},
		});
	}
	if (scratch.flash) {
		box.appendChild(el("div", { className: "an-note-msg", role: "status", textContent: scratch.flash }));
		scratch.flash = null;
	}
	return box;
}

// How many workbook lines are listed before the rest wait behind "show".
const WORKBOOK_SHOWN = 30;

// The workbook's lines through the position on the board, read from the
// workbook as it stands -- never copied onto the board, so they are always
// the lines as written, and the board's own list stays the board's analysis.
// Each shows where it goes from here; a click on one of its moves plays the
// line on the board up to that move. The line the board is following is
// marked. Hidden lines stay out, as they do from every other view.
function workbookLines(scratch, herePos, onChange) {
	const box = el("div", { className: "an-wb" });
	const cur = getCurrent();
	if (!cur || !cur.lines.length) return box;
	const lines = visibleLines(cur.lines).filter((l) => through(herePos, l));
	const played = activeLine(scratch).moves;
	const following = (l) =>
		played.length >= herePos.length && played.every((m, k) => !l.moves[k] || l.moves[k].san === m.san) && played.length <= l.moves.length;
	// The heading folds the list away and back: a long workbook pushes the
	// note box and the rest of the panel off the bottom, and some sittings
	// want the board's own lines only. The fold is the viewer's, not the
	// workbook's, so it is kept in prefs and lasts across boards and visits.
	const collapsed = loadPrefs().wbCollapsed;
	const toggle = el("button", {
		// the ▸/▾ is drawn by the stylesheet, so the text is the heading alone
		className: "an-wb-toggle" + (collapsed ? " collapsed" : ""),
		textContent:
			(herePos.length ? `Workbook lines through ${sanLabel(herePos.map((m) => m.san))}` : "Workbook lines") +
			` (${lines.length})`,
		title: collapsed ? "Show the workbook's lines" : "Hide the workbook's lines",
		onclick: () => {
			savePrefs({ wbCollapsed: !collapsed });
			onChange();
		},
	});
	toggle.setAttribute("aria-expanded", String(!collapsed));
	box.appendChild(el("div", { className: "an-sec" }, [toggle]));
	if (collapsed) return box;
	if (!lines.length) {
		box.appendChild(el("div", { className: "an-note-hint", textContent: "None: this position is new to the workbook." }));
		return box;
	}
	const all = scratch.wbAll || lines.length <= WORKBOOK_SHOWN;
	const list = el("div", { className: "an-wb-lines" });
	const rows = all ? lines : lines.slice(0, WORKBOOK_SHOWN);
	rows.forEach((l, i) => {
		const row = el("div", { className: "an-wb-line" + (following(l) ? " active" : "") });
		row.appendChild(el("span", { className: "an-wb-name", textContent: l.name || (l.isMain ? "Mainline" : "") }));
		const moves = el("div", { className: "an-line-moves" });
		// From the move before it leaves the rows above it -- or, for the first,
		// the move that reached the position -- so rows that run together for a
		// while read as where each one differs.
		let shared = 0;
		for (let k = 0; k < i; k++) {
			let n = 0;
			while (n < l.moves.length && n < rows[k].moves.length && l.moves[n].san === rows[k].moves[n].san) n++;
			shared = Math.max(shared, n);
		}
		const from = Math.max(herePos.length - 1, shared - 1, 0);
		if (from > 0) moves.appendChild(el("span", { className: "an-elide", textContent: "…" }));
		for (let j = from; j < l.moves.length; j++) {
			const san = l.moves[j].san;
			const label = j % 2 === 0 ? `${j / 2 + 1}.${san}` : j === from ? `${(j + 1) / 2}...${san}` : san;
			moves.appendChild(
				el("button", {
					className: "an-move" + (j < herePos.length || j < shared ? " shared" : ""),
					textContent: label,
					title: j < herePos.length ? "" : "Play this line on the board up to here",
					onclick: () => {
						if (j < herePos.length) return;
						playAll(scratch, l.moves.slice(herePos.length, j + 1).map((m) => m.san));
						onChange();
					},
				}),
			);
		}
		row.appendChild(moves);
		list.appendChild(row);
	});
	box.appendChild(list);
	if (!all)
		box.appendChild(
			el("button", {
				className: "an-showall",
				textContent: `show all ${lines.length}`,
				onclick: () => {
					scratch.wbAll = true;
					onChange();
				},
			}),
		);
	return box;
}
