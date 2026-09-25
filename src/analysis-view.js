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
	moveLine,
	newScratch,
	play,
	playAll,
	positionOf,
	removeLine,
	scratchPgn,
	select,
	sharedPrefix,
	stepLine,
	truncate,
	undo,
} from "./analysis.js";
import { commitAll, commitLine, inNotebook } from "./analysis-commit.js";
import { commentEditor } from "./line-editor.js";
import { formatScore, numberedFrom, whiteShare } from "./engine.js";
import { FULL } from "./engine-store.js";

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

const BOARD_SIZE = 480; // viewBox units; CSS scales it to the column

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
		{ flipped: scratch.flipped, size: BOARD_SIZE, lastMove: pos.lastMove, check: pos.check },
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

	// ---- right column: engine, lines, note, commit
	const right = el("div", { className: "an-right" });
	if (engine) right.appendChild(engineBox(engine, scratch, pos, onChange, { board, bar, flavors }));

	const listHead = el("div", { className: "an-sec" }, [
		el("span", { textContent: `Your lines (${scratch.lines.filter((l) => l.moves.length).length})` }),
	]);
	right.appendChild(listHead);
	const list = el("div", { className: "an-lines" });
	scratch.lines.forEach((line, i) => {
		const row = el("div", {
			className: "an-line" + (i === scratch.active ? " active" : ""),
		});
		// Clicking the row anywhere but on a move selects the line; clicking a
		// move selects the line AND puts the cursor after that move, which is
		// how you get back to a position you want to branch from again.
		row.onclick = act(() => select(scratch, i));
		const movesBox = el("div", { className: "an-line-moves" });
		if (!line.moves.length) {
			movesBox.appendChild(el("span", { className: "an-empty", textContent: "(no moves yet — play one on the board)" }));
		}
		const shared = sharedPrefix(scratch, i);
		line.moves.forEach((m, j) => {
			const mv = el("button", {
				className:
					"an-move" +
					(i === scratch.active && j === scratch.at - 1 ? " at" : "") +
					(j < shared ? " shared" : "") +
					(noteOn(line, j) ? " has-note" : ""),
				textContent: j % 2 === 0 ? `${j / 2 + 1}.${m.san}` : m.san,
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
		if (scratch.lines.length > 1) {
			tools.append(
				small("an-up", "↑", "Move this line up", act(() => moveLine(scratch, i, -1)), i === 0),
				small("an-down", "↓", "Move this line down", act(() => moveLine(scratch, i, 1)), i === scratch.lines.length - 1),
			);
		}
		tools.appendChild(small("an-del", "✕", "Delete this line", risky(() => removeLine(scratch, i))));
		row.appendChild(tools);
		list.appendChild(row);
	});
	right.appendChild(list);

	// Notes on the move just played, in the notebook's own note editor: a
	// scratch line keeps comments in the same shape a notebook line does.
	right.appendChild(el("div", { className: "an-sec", textContent: scratch.at ? `Note on ${moveLabel(scratch)}` : "Note" }));
	right.appendChild(
		scratch.at
			? commentEditor(scratch.at - 1, [activeLine(scratch)])
			: el("div", { className: "an-note-hint", textContent: "Play a move to note it." }),
	);

	// The commit bar. A line that goes in hands over to onAdded, which closes
	// the window in the app. A refusal changes nothing, so it does not redraw:
	// the reason is written into the panel on screen and stays there.
	const msg = el("div", { className: "an-msg", role: "status" });
	const addBtn = (cls, text, title, add) =>
		el("button", {
			className: "chip " + cls,
			textContent: text,
			title,
			onclick: () => {
				const refused = add();
				if (refused) msg.textContent = refused;
				else onAdded();
			},
		});
	const one = (opts) => {
		const r = commitLine(activeLine(scratch), opts);
		return r.ok ? null : r.reason;
	};
	const commit = el("div", { className: "orow an-commit" });
	commit.append(
		addBtn("primary an-add", "Add as new line", "File the selected line in the notebook as a sideline", () => one()),
		addBtn("an-add-foot", "Add as footnote", "File the selected line in the notebook as a footnote", () => one({ tag: "foot" })),
		addBtn("an-add-all", "Add all", "File every line here in the notebook", () => {
			const r = commitAll(scratch);
			return r.added ? null : "Nothing added: every line is empty or already in the notebook.";
		}),
	);
	right.append(el("div", { className: "an-sec", textContent: "Save to notebook" }), commit, msg);

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
		btn("an-clear", "New board", "Start again from the opening position", risky(() => {
			const fresh = newScratch();
			scratch.lines = fresh.lines;
			scratch.active = 0;
			scratch.at = 0;
		})),
	);
	if (scratch.undo) extra.appendChild(btn("an-undo", "↶ Undo", "Undo the last delete", act(() => undo(scratch))));
	right.appendChild(extra);

	panel.append(left, right);
	return panel;
}

// "12...Nf6", the move the cursor sits after.
function moveLabel(s) {
	const j = s.at - 1;
	const san = activeLine(s).moves[j].san;
	return j % 2 === 0 ? `${j / 2 + 1}.${san}` : `${(j + 1) / 2}...${san}`;
}

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
			pick("an-engine-depth", "How deep to search", [[16, "depth 16"], [20, "depth 20"], [22, "depth 22"], [26, "depth 26"], [30, "depth 30"], [0, "∞ no limit"]], engine.depth, (d) => engine.setDepth(d)),
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
		const best = shown[0];
		const share = best ? whiteShare(best.score) : 0.5;
		bar.firstChild.style.height = `${(share * 100).toFixed(1)}%`;
		bar.title = best ? `${formatScore(best.score)} from White's side` : "";
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
		);
		if (shown.length) {
			const acts = el("div", { className: "orow an-engine-acts" });
			// The verdict into the note on the move just played, where the
			// notebook and its PGN will carry it.
			if (scratch.at) {
				acts.appendChild(
					el("button", {
						className: "chip mini an-note-eval",
						textContent: "Note eval",
						title: "Add the engine's evaluation to the note on this move",
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
			if (st.status !== "searching") acts.appendChild(deeper);
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
