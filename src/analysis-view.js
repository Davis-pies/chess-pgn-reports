// src/analysis-view.js
// Analysis mode's panel. It owns no state of its own: everything it draws
// comes from the scratch it is handed, and every control mutates that scratch
// and calls onChange, which is what rebuilds the panel. That keeps the view a
// pure function of the scratch, the same contract the report panels keep with
// current.lines.

import { el } from "./dom.js";
import { interactiveBoard } from "./board-input.js";
import {
	activeLine,
	back,
	fenOf,
	forward,
	goTo,
	play,
	removeLine,
	select,
} from "./analysis.js";
import { commitAll, commitLine } from "./analysis-commit.js";
import { commentEditor } from "./line-editor.js";

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

export function analysisPanel(scratch, onChange, { onAdded = onChange } = {}) {
	// tabIndex -1 rather than 0: the panel is focusable so the arrow keys have
	// somewhere to land, but it is not a tab stop of its own -- tabbing should
	// still walk the actual controls. app.js focuses it after appending.
	const panel = el("div", { className: "analysis", tabIndex: -1 });
	// On the panel rather than the document: the listener dies with the element,
	// so a re-render cannot leave a stack of handlers behind all stepping the
	// same cursor. Clicks land on controls inside the panel, so keydown after a
	// click still bubbles here.
	panel.onkeydown = (e) => {
		if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
		if (e.target.closest("input, textarea")) return; // the caret's, while typing a note
		e.preventDefault();
		if (e.key === "ArrowLeft") back(scratch);
		else forward(scratch);
		onChange();
	};

	const board = interactiveBoard(
		fenOf(scratch),
		(san) => {
			play(scratch, san);
			onChange();
		},
		{ flipped: scratch.flipped },
	);
	panel.appendChild(board);

	const nav = el("div", { className: "an-nav orow" });
	const navBtn = (cls, text, title, fn) =>
		el("button", {
			className: "chip mini " + cls,
			textContent: text,
			title,
			onclick: () => {
				fn();
				onChange();
			},
		});
	nav.append(
		navBtn("an-back", "◀", "Back one move", () => back(scratch)),
		navBtn("an-fwd", "▶", "Forward one move", () => forward(scratch)),
		navBtn("an-start", "⟲", "Back to the start", () => goTo(scratch, 0)),
		// Flip is the one control that changes nothing about the scratch's
		// moves, so it is kept visually apart from the three that do.
		navBtn("an-flip", "Flip", "Show the board from the other side", () => {
			scratch.flipped = !scratch.flipped;
		}),
	);
	panel.appendChild(nav);

	// Notes on the move just played, in the notebook's own note editor: a
	// scratch line keeps comments in the same shape a notebook line does.
	panel.appendChild(
		scratch.at
			? commentEditor(scratch.at - 1, [activeLine(scratch)])
			: el("div", { className: "an-note-hint", textContent: "Play a move to note it." }),
	);

	const list = el("div", { className: "an-lines" });
	scratch.lines.forEach((line, i) => {
		const row = el("div", {
			className: "an-line" + (i === scratch.active ? " active" : ""),
		});
		// Clicking the row anywhere but on a move selects the line; clicking a
		// move selects the line AND puts the cursor after that move, which is
		// how you get back to a position you want to branch from again.
		row.onclick = () => {
			select(scratch, i);
			onChange();
		};
		if (!line.moves.length) {
			row.appendChild(el("span", { className: "an-empty", textContent: "(no moves yet)" }));
		}
		line.moves.forEach((m, j) => {
			const mv = el("button", {
				className:
					"an-move" +
					(i === scratch.active && j === scratch.at - 1 ? " at" : "") +
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
			row.appendChild(mv);
		});
		row.appendChild(
			el("button", {
				className: "chip mini an-del",
				textContent: "✕",
				title: "Delete this line",
				onclick: (e) => {
					e.stopPropagation();
					removeLine(scratch, i);
					onChange();
				},
			}),
		);
		list.appendChild(row);
	});
	panel.appendChild(list);

	// The commit bar. A line that goes in hands over to onAdded, which closes
	// the window in the app. A refusal changes nothing, so it does not redraw:
	// the reason is written into the panel on screen and stays there.
	const msg = el("div", { className: "an-msg" });
	const addBtn = (cls, text, add) =>
		el("button", {
			className: "chip " + cls,
			textContent: text,
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
	const bar = el("div", { className: "orow an-commit" });
	bar.append(
		addBtn("primary an-add", "Add as new line", () => one()),
		addBtn("an-add-foot", "Add as footnote", () => one({ tag: "foot" })),
		addBtn("an-add-all", "Add all", () =>
			commitAll(scratch).added
				? null
				: "Nothing added: every line is empty or already in the notebook.",
		),
	);
	panel.append(bar, msg);

	return panel;
}
