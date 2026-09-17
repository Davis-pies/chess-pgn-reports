// src/analysis-view.js
// Analysis mode's panel. It owns no state of its own: everything it draws
// comes from the scratch it is handed, and every control mutates that scratch
// and calls onChange, which is what rebuilds the panel. That keeps the view a
// pure function of the scratch, the same contract the report panels keep with
// current.lines.

import { el } from "./dom.js";
import { interactiveBoard } from "./board-input.js";
import { activeLine, back, fenOf, forward, goTo, play, removeLine, select } from "./analysis.js";
import { commitAll, commitLine } from "./analysis-commit.js";

// "1.e4 e5 2.Nf3". Deliberately not render.js's movesText: that one formats a
// notebook line's divergent tail against a mainline, which a scratch has no
// notion of.
export function numberedMoves(moves) {
	return moves
		.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m.san}` : m.san))
		.join(" ");
}

export function analysisPanel(scratch, onChange) {
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
					(i === scratch.active && j === scratch.at - 1 ? " at" : ""),
				textContent: j % 2 === 0 ? `${j / 2 + 1}.${m.san}` : m.san,
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

	// The commit bar. A message element rather than an alert(): adding a line
	// is a thing you do several times in a row, and a modal between each one
	// would be in the way.
	const msg = el("div", { className: "an-msg" });
	const bar = el("div", { className: "orow an-commit" });
	bar.append(
		el("button", {
			className: "chip primary an-add",
			textContent: "Add as new line",
			onclick: () => {
				const r = commitLine(activeLine(scratch));
				msg.textContent = r.ok ? `Added ${r.line.name}.` : r.reason;
				onChange();
			},
		}),
		el("button", {
			className: "chip an-add-all",
			textContent: "Add all",
			onclick: () => {
				const { added, skipped } = commitAll(scratch);
				msg.textContent =
					`Added ${added} line${added === 1 ? "" : "s"}` +
					(skipped ? `, skipped ${skipped} already in the notebook.` : ".");
				onChange();
			},
		}),
	);
	panel.append(bar, msg);

	return panel;
}
