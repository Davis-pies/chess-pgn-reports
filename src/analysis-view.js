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
import { drawArrows, interactiveBoard } from "./board-input.js";
import {
	activeLine,
	back,
	checkpoint,
	forward,
	goTo,
	clearShown,
	moveLine,
	pin,
	shown,
	toggleShowAll,
	play,
	playAll,
	positionOf,
	removeLine,
	scratchPgn,
	select,
	sharedPrefix,
	stepLine,
	through,
	truncate,
	undo,
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
import { formatScore, numberedFrom, whiteShare } from "./engine.js";
import { FULL } from "./engine-store.js";
import { getCurrent } from "./state.js";
import { visibleLines } from "./visibility.js";

// "1.e4 e5 2.Nf3". Deliberately not render.js's movesText: that one formats a
// notebook line's divergent tail against a mainline, which a scratch has no
// notion of.
export function numberedMoves(moves) {
	return moves
		.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m.san}` : m.san))
		.join(" ");
}

const noteOn = (line, ply) =>
	(line.comments || []).find((c) => c.ply === ply)?.text || "";

const BOARD_SIZE = 480;
// Where the eval bar stood, carried across redraws so a new position starts
// the bar from the last reading rather than from even.
let lastShare = 0.5; // viewBox units; CSS scales it to the column

export function analysisPanel(
	scratch,
	onChange,
	{ onAdded = onChange, engine = null, flavors = null } = {},
) {
	// tabIndex -1 rather than 0: the panel is focusable so the arrow keys have
	// somewhere to land, but it is not a tab stop of its own -- tabbing should
	// still walk the actual controls. app.js focuses it after appending.
	const panel = el("div", { className: "analysis", tabIndex: -1 });
	const pos = positionOf(scratch);

	// Mutate, then redraw: every control below is one of these.
	const act = (fn) => () => {
		fn();
		onChange();
	};
	// ... and the ones that throw work away keep an undo first.
	const risky = (fn) => act(() => {
		checkpoint(scratch);
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
		f: () => (scratch.flipped = !scratch.flipped),
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
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.target.closest("input, textarea, select")) return; // the caret's, while typing a note
		if (e.key === " " && e.target.closest("button")) return; // Space presses a focused button
		const fn = keys[e.key];
		if (!fn) return;
		e.preventDefault();
		fn();
		onChange();
	};

	// ---- left column: board, status, navigation
	const left = el("div", { className: "an-left" });
	const board = interactiveBoard(
		pos.fen,
		(san) => {
			play(scratch, san);
			onChange();
		},
		{
			flipped: scratch.flipped,
			size: BOARD_SIZE,
			lastMove: pos.lastMove,
			check: pos.check,
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
	left.appendChild(el("div", { className: "an-boardrow" }, [bar, board]));

	const status = el("div", { className: "an-status" });
	if (pos.over) {
		status.textContent = pos.over;
		status.classList.add("over");
	} else {
		status.textContent = (pos.turn === "w" ? "White" : "Black") + " to move" + (pos.check ? " — check" : "");
	}
	left.appendChild(status);

	const btn = (cls, text, title, onclick, disabled = false) =>
		el("button", { className: "chip mini " + cls, textContent: text, title, onclick, disabled });
	const len = activeLine(scratch).moves.length;
	const nav = el("div", { className: "an-nav orow" });
	nav.append(
		btn("an-start", "⏮", "Back to the start (Home)", act(() => goTo(scratch, 0)), scratch.at === 0),
		btn("an-back", "◀", "Back one move (←)", act(() => back(scratch)), scratch.at === 0),
		btn("an-fwd", "▶", "Forward one move (→)", act(() => forward(scratch)), scratch.at === len),
		btn("an-end", "⏭", "To the end of the line (End)", act(() => goTo(scratch, len)), scratch.at === len),
		// Flip changes nothing about the scratch's moves, so it is kept apart
		// from the controls that do.
		btn("an-flip", "⇅ Flip", "Show the board from the other side (F)", act(() => {
			scratch.flipped = !scratch.flipped;
		})),
		btn(
			"an-cut",
			"✂ Delete from here",
			"Delete the moves after this one in this line",
			risky(() => truncate(scratch)),
			scratch.at === len,
		),
	);
	left.appendChild(nav);
	left.appendChild(
		el("div", {
			className: "an-keys",
			textContent: "Keys: ← → step · Home/End · ↑ ↓ switch line · F flip" + (engine ? " · E engine · Space best move" : ""),
		}),
	);
	// shown in place of the keys on a touch screen (see style.css)
	left.appendChild(
		el("div", {
			className: "an-touch-hint",
			textContent: "Swipe the board left or right to step through the moves",
		}),
	);

	// ---- right column: engine, lines, note, commit
	const right = el("div", { className: "an-right" });
	if (engine) right.appendChild(engineBox(engine, scratch, pos, onChange, { board, bar, flavors }));

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
	const list = el("div", { className: "an-lines" });
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
			mv.onclick = (e) => {
				e.stopPropagation();
				select(scratch, i);
				goTo(scratch, j + 1);
				onChange();
			};
			movesBox.appendChild(mv);
		});
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
		const small = (cls, text, title, fn, disabled) =>
			el("button", {
				className: "chip mini " + cls,
				textContent: text,
				title,
				disabled,
				onclick: (e) => {
					e.stopPropagation();
					fn();
				},
			});
		if (on.length > 1) {
			tools.append(
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
		tools.appendChild(small("an-del", "✕", "Delete this line", risky(() => removeLine(scratch, i))));
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
	right.appendChild(noteTools(scratch, onChange));

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

	// Tools that do not change the lines: copying out, and starting over.
	const copy = (text, what) => () => {
		const done = () => (msg.textContent = `${what} copied.`);
		try {
			navigator.clipboard.writeText(text).then(done, () => (msg.textContent = text));
		} catch {
			msg.textContent = text;
		}
	};
	const extra = el("div", { className: "orow an-tools" });
	extra.append(
		btn("an-copy-fen", "Copy FEN", "Copy this position as FEN", copy(pos.fen, "FEN")),
		btn("an-copy-pgn", "Copy PGN", "Copy every line here as one PGN, the first line as the main line", copy(scratchPgn(scratch), "PGN")),
		btn("an-clear", "Clear lines", "Delete the lines on view and start again from this position", risky(() => clearShown(scratch))),
	);
	if (scratch.undo) extra.appendChild(btn("an-undo", "↶ Undo", "Undo the last delete", act(() => undo(scratch))));
	right.appendChild(extra);

	panel.append(left, right);
	return panel;
}

// "12...Nf6", the move the cursor sits after.
// "8.Qd2" or "7...Qb6": the last move of a list of SANs from move one.
function sanLabel(sans) {
	const j = sans.length - 1;
	return j % 2 === 0 ? `${j / 2 + 1}.${sans[j]}` : `${(j + 1) / 2}...${sans[j]}`;
}

const moveLabel = (s) => sanLabel(activeLine(s).moves.slice(0, s.at).map((m) => m.san));

// The engine's corner. Built once per panel; `paint` refills it from the
// engine's state and is what the engine calls as its output comes in.
function engineBox(engine, scratch, pos, onChange, { board, bar, flavors }) {
	const box = el("div", { className: "an-engine" });
	const on = engine.state.enabled;
	const toggle = el("button", {
		className: "chip mini an-engine-toggle" + (on ? " primary" : ""),
		textContent: on ? "Engine on" : "Engine off",
		title: "Stockfish, running on this device (E)",
		onclick: () => {
			engine.enable(!on);
			onChange();
		},
	});
	const info = el("span", { className: "an-engine-info" });
	const opts = el("span", { className: "an-engine-opts" });
	if (on) {
		const pick = (cls, label, values, current, set) => {
			const s = el("select", { className: cls, title: label });
			values.forEach(([v, text]) => {
				const o = el("option", { value: String(v), textContent: text });
				if (v === current) o.selected = true;
				s.appendChild(o);
			});
			s.onchange = () => set(Number(s.value));
			return s;
		};
		opts.append(
			pick("an-engine-pv", "Lines shown", [[1, "1 line"], [2, "2 lines"], [3, "3 lines"], [5, "5 lines"]], engine.multiPv, (n) => engine.setMultiPv(n)),
			depthBox(engine),
		);
	}
	if (on && flavors) {
		const f = el("select", { className: "an-engine-flavor", title: "Which Stockfish 19 to run" });
		[["lite", "Lite · 1.8 MB"], ["full", "Full · 99 MB"]].forEach(([v, text]) => {
			f.appendChild(el("option", { value: v, textContent: text, selected: v === flavors.state.flavor }));
		});
		f.onchange = () => flavors.choose(f.value);
		opts.prepend(f);
	}
	box.appendChild(el("div", { className: "an-engine-head" }, [toggle, info, opts]));
	if (flavors) box.appendChild(fullBox(flavors));
	const lines = el("div", { className: "an-pvs" });
	box.appendChild(lines);
	const deeper = el("button", {
		className: "chip mini an-deeper",
		textContent: "Go deeper",
		title: "Keep searching this position until you move on",
		onclick: () => engine.deeper(),
	});

	const paint = (st) => {
		const fresh = st.fen === pos.fen;
		bar.hidden = !st.enabled;
		if (!st.enabled) {
			info.textContent = "Stockfish 19, on this device";
			lines.replaceChildren();
			drawArrows(board, []);
			return;
		}
		const shown = fresh ? st.lines.filter(Boolean) : [];
		if (st.status === "error") info.textContent = "Engine failed: " + st.error;
		else if (pos.over) info.textContent = "Game over";
		else if (st.status === "loading" || (st.status === "idle" && !shown.length)) info.textContent = "Loading Stockfish…";
		else if (!shown.length) info.textContent = "Thinking…";
		else {
			const knps = st.nps ? ` · ${Math.round(st.nps / 1000)}k nodes/s` : "";
			info.textContent = `depth ${st.depth}${st.status === "done" ? " ✓" : ""}${st.status === "searching" ? knps : ""}`;
		}
		// the bar and its number follow the best line, from White's side
		// Between positions there is no best line yet; the bar holds where it
		// was rather than dropping to even and climbing back.
		const best = shown[0];
		if (best) lastShare = whiteShare(best.score);
		bar.firstChild.style.height = `${(lastShare * 100).toFixed(1)}%`;
		bar.title = best ? `${formatScore(best.score)} from White's side` : "";
		// One row per line asked for, whether or not the search has filled it
		// yet, so the box keeps its height from one move to the next instead
		// of collapsing while the new search starts and growing back.
		const slots = pos.over ? 0 : Math.max(engine.multiPv - shown.length, 0);
		const waiting = Array.from({ length: slots }, () =>
			el("div", { className: "an-pv empty" }, [
				el("span", { className: "an-score", textContent: "…" }),
			]),
		);
		lines.replaceChildren(
			...shown.map((l) => {
				const sans = l.moves.map((m) => m.san);
				const labels = numberedFrom(pos.fen, sans.slice(0, 12));
				const row = el("div", { className: "an-pv" }, [
					el("span", {
						className: "an-score" + (l.score.mate != null || l.score.cp > 0 ? " w" : l.score.cp < 0 ? " b" : ""),
						textContent: formatScore(l.score),
					}),
				]);
				labels.forEach((text, j) => {
					row.appendChild(
						el("button", {
							className: "an-pvmove",
							textContent: text,
							title: j === 0 ? "Play this move" : "Play the line up to here",
							onclick: () => {
								playAll(scratch, sans.slice(0, j + 1));
								onChange();
							},
						}),
					);
				});
				return row;
			}),
			...waiting,
		);
		// The actions keep their place too: disabled, or held invisible, while
		// there is nothing for them to act on.
		if (!pos.over) {
			const acts = el("div", { className: "orow an-engine-acts" });
			// The verdict into the note on the move just played, where the
			// notebook and its PGN will carry it.
			if (scratch.at) {
				acts.appendChild(
					el("button", {
						className: "chip mini an-note-eval",
						textContent: "Note eval",
						title: "Add the engine's evaluation to the note on this move",
						disabled: !best,
						onclick: () => {
							const line = activeLine(scratch);
							line.comments = line.comments || [];
							line.comments.push({
								ply: scratch.at - 1,
								text: `Stockfish: ${formatScore(best.score)} (depth ${best.depth}), ${numberedFrom(pos.fen, best.moves.slice(0, 4).map((m) => m.san)).join(" ")}`,
							});
							onChange();
						},
					}),
				);
			}
			deeper.style.visibility = best && st.status !== "searching" ? "" : "hidden";
			acts.appendChild(deeper);
			lines.appendChild(acts);
		}
		drawArrows(
			board,
			shown.map((l, i) => ({ from: l.moves[0].from, to: l.moves[0].to, weight: i === 0 ? 0.85 : 0.35 })),
		);
	};
	engine.onUpdate = paint;
	paint(engine.state);
	if (on && !pos.over) engine.analyse(pos.fen);
	return box;
}

// Getting the full engine: offered when it is chosen and not yet on this
// device, with the download's progress, and a way round a blocked download.
// Painted in place from the flavor manager's state, like the engine box.
function fullBox(flavors) {
	const box = el("div", { className: "an-full" });
	const fileIn = el("input", { type: "file", accept: ".wasm,application/wasm", hidden: true });
	fileIn.onchange = () => fileIn.files[0] && flavors.loadFile(fileIn.files[0]);
	const btn = (cls, text, onclick, primary) =>
		el("button", { className: "chip mini " + cls + (primary ? " primary" : ""), textContent: text, onclick });
	const MB = (n) => (n / 1048576).toFixed(0);
	const paint = (st) => {
		box.hidden = !st.offer && st.status !== "downloading" && st.flavor !== "full";
		if (st.flavor === "full" && !st.offer) {
			box.replaceChildren(
				el("span", { className: "an-full-note", textContent: "Full engine, loaded from this browser." }),
				btn("an-full-forget", "Remove download", () => flavors.forget()),
			);
			return;
		}
		if (st.status === "downloading") {
			const pct = st.total ? (st.loaded / st.total) * 100 : 0;
			box.replaceChildren(
				el("span", { className: "an-full-note", textContent: `Downloading the full engine… ${MB(st.loaded)} of ${MB(st.total)} MB` }),
				el("div", { className: "an-progress" }, [el("div", { style: `width:${pct.toFixed(1)}%` })]),
			);
			return;
		}
		const kids = [];
		if (st.status === "error") {
			const link = el("a", { href: FULL.manual, target: "_blank", rel: "noopener", textContent: "Stockfish.js releases" });
			kids.push(
				el("div", { className: "an-full-err" }, [
					`Could not get the full engine: ${st.error}. You can download `,
					el("code", { textContent: "stockfish-19-single.wasm" }),
					" from the ",
					link,
					" page yourself and load it here.",
				]),
			);
		} else {
			kids.push(
				el("span", {
					className: "an-full-note",
					textContent:
						"The full engine is much stronger, and a one-time 99 MB download. It is kept in this browser, so it is only fetched once.",
				}),
			);
		}
		kids.push(
			el("div", { className: "orow an-full-acts" }, [
				btn("an-full-get", st.status === "error" ? "Try again" : "Download 99 MB", () => flavors.download(), true),
				btn("an-full-file", "Load file…", () => fileIn.click()),
				btn("an-full-cancel", "Not now", () => flavors.choose("lite")),
			]),
			fileIn,
		);
		box.replaceChildren(...kids);
	};
	flavors.onUpdate = paint;
	paint(flavors.state);
	return box;
}

// Saving notes into the notebook without adding a line: the one on this move,
// or all of them. Beside them, what the notebook says on this move now, when
// that is not what the board says -- so a save never overwrites a note the
// user could not see. A save redraws the report behind the window, and with it
// the panel, so its outcome rides on the scratch to the next draw.
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

// Search depth as a number: any depth, 0 for no limit. Applied when the box
// is left or Enter is pressed, not per keystroke, so typing "25" never starts
// a depth-2 search on the way. Anything that is not a whole number from 0 to
// 99 puts the box back to the depth in force.
function depthBox(engine) {
	const input = el("input", {
		type: "number",
		className: "an-engine-depth",
		min: "0",
		max: "99",
		step: "1",
		value: String(engine.depth),
		title: "How deep to search (0 = no limit)",
	});
	const hint = el("span", { className: "an-depth-inf", textContent: engine.depth ? "" : "∞" });
	input.onchange = () => {
		const d = Number(input.value);
		if (input.value.trim() === "" || !Number.isInteger(d) || d < 0 || d > 99) {
			input.value = String(engine.depth);
			return;
		}
		hint.textContent = d ? "" : "∞";
		engine.setDepth(d);
	};
	return el("label", { className: "an-engine-depthbox" }, ["depth ", input, hint]);
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
	box.appendChild(
		el("div", { className: "an-sec" }, [
			el("span", {
				textContent:
					(herePos.length ? `Workbook lines through ${sanLabel(herePos.map((m) => m.san))}` : "Workbook lines") +
					` (${lines.length})`,
			}),
		]),
	);
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
