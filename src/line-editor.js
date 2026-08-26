import { fenAt } from "./pgn.js";
import { appendBoard, fullmoveLabel } from "./render.js";
import { el } from "./dom.js";
import { getCurrent, getSharedInfo, getRenderHooks } from "./state.js";
import { NAGS } from "./nags.js";
import { numberNotes } from "./notes.js";
import { branchContext } from "./export.js";
import { visibleLines, setHidden, isFocused } from "./visibility.js";
import { focusLines } from "./trie-view.js";

export function lineEditor(l, idx, showBoard = false) {
	const row = el("div", { className: "ledge" });
	const tag = l.tag || "";
	const btn = (t, txt) => {
		const b = el("button", {
			className: "chip tag " + t + (tag === t ? " on" : ""),
			textContent: txt,
		});
		b.onclick = () => {
			l.tag = l.tag === t ? null : t;
			getRenderHooks().renderApp();
		};
		return b;
	};
	const isMain = !!l.isMain;
	// name comes first, pre-populated
	if (!l.name) l.name = isMain ? "Mainline" : "Line " + idx;
	const name = el("input", { className: "ln", value: l.name });
	name.oninput = () => {
		l.name = name.value;
	};
	// reflect the (renamed) line in the table/cards once the field is blurred
	name.onchange = () => getRenderHooks().renderApp();
	const tags = el("div", { className: "tags" });
	if (isMain) {
		tags.appendChild(
			el("span", { className: "maintag", textContent: "Mainline" }),
		);
	} else {
		tags.append(btn("sideline", "Sideline"), btn("foot", "Footnote"));
		const promote = el("button", {
			className: "chip",
			textContent: "★ Make mainline",
		});
		promote.onclick = () => {
			promoteMainline(l);
		};
		tags.appendChild(promote);
		// Hide/Focus sit with the tag chips, and only on a non-mainline row --
		// the mainline is the table's reference row and is never hidable.
		const hide = el("button", {
			className: "chip hide" + (l.hidden ? " on" : ""),
			textContent: l.hidden ? "Hidden" : "Hide",
			title: l.hidden ? "bring this line back" : "hide this line",
		});
		hide.onclick = () => {
			setHidden([l], !l.hidden);
			getRenderHooks().renderApp();
		};
		// Labelled "Focus"; the class is still `solo`, after the visibility.js
		// primitive underneath. It lights up when this line is exactly what the
		// notebook is showing, so a focus is visible rather than guessed at.
		const focused = isFocused(getCurrent().lines, [l]);
		const soloBtn = el("button", {
			className: "chip solo" + (focused ? " on" : ""),
			textContent: "Focus",
			title: focused
				? "this line is what the notebook is showing"
				: "hide every other line",
		});
		soloBtn.onclick = () => focusLines([l]);
		tags.append(hide, soloBtn);
	}
	const head = el("div", { className: "ledge-head" });
	head.append(name, tags);
	row.appendChild(head);
	row.appendChild(moveStrip(l));
	// The symbol/comment panel appears once, on the line whose chip was
	// clicked -- sel.at, not sel.lines[0]. A shared move is annotated across
	// its whole group, but that group is built in notebook order by
	// computeShared() and knows nothing about the click, so anchoring to its
	// first line put the board and notes on a line the user never touched --
	// and, when that line was hidden, inside the collapsed hidden drawer,
	// where the selection appeared to do nothing at all.
	const sel = getCurrent().sel;
	const panelHere = !!(sel && sel.at === l);
	// movePanel draws the selected move's position, and that board REPLACES the
	// line's end-position board rather than sitting beside it — two boards for
	// one line reads as a rendering glitch. Only the panel's own line swaps: a
	// sibling sharing the selection still shows its end position.
	const editingBoard = panelHere && sel.ply != null;
	if (panelHere)
		row.appendChild(movePanel(l));
	const note = el("input", {
		className: "lno",
		placeholder: "note",
		value: (l.meta && l.meta.note) || "",
	});
	note.oninput = () => {
		l.meta = { ...(l.meta || {}), note: note.value };
	};
	note.onchange = () => getRenderHooks().renderApp();
	row.appendChild(note);
	// the line's end-position board, next to its line (inline boards toggle)
	if (showBoard && !editingBoard) {
		const bw = el("div", { className: "ledge-board" });
		appendBoard(bw, l.fen, getCurrent().boardSize || 220);
		row.appendChild(bw);
	}
	return row;
}

// Promote a sideline/footnote line to be the mainline; demote the old one.
export function promoteMainline(l) {
	getCurrent().lines.forEach((x) => {
		if (x === l) {
			x.isMain = true;
			x.tag = undefined;
		} else if (x.isMain) {
			x.isMain = false;
			if (!x.tag) x.tag = "sideline";
		}
	});
	getRenderHooks().renderApp();
}

// Advantage/quality symbols offered in the line editor's evaluation picker,
// derived from the NAG table so the palette can never offer a symbol the PGN
// exporter has no code for. The leading "" is the clear entry.
//
// A symbol shared by a White/Black pair (zugzwang, initiative, ...) appears
// once: the palette annotates a move with a glyph, and which side it refers to
// is what the move itself already says.
export const EVAL_SYMBOLS = [
	"",
	...new Set(NAGS.filter((n) => n.sym).map((n) => n.sym)),
	"TN", // theoretical novelty; no standard code, exported as a comment
];

// A per-line row of tappable symbol buttons; clicking one sets (or clears)
// that line's evaluation, which then shows in the table and lines/card views.
// A tappable strip of a line's moves. Clicking a move selects it as the target
// for the symbol row; the current mark, if any, is shown on the chip.
export function moveStrip(l) {
	const mainL = getCurrent().lines.find((x) => x.isMain) || getCurrent().lines[0];
	const wrap = el("span", { className: "moves" });
	wrap.appendChild(
		el("span", {
			className: "symlabel",
			textContent: "Tap a move →",
		}),
	);
	let d = 0;
	const mv = l.moves;
	if (!l.isMain)
		while (
			d < mv.length &&
			d < mainL.moves.length &&
			mv[d].san === mainL.moves[d].san
		)
			d++;
	// indicate the directly preceding move (where this line diverges)
	if (!l.isMain) {
		const ctx = branchContext(l);
		if (ctx)
			wrap.appendChild(el("span", { className: "ctxchip", textContent: ctx }));
	}
	const owned = l.isMain ? mv : mv.slice(d);
	// markers for this line's moves: numbers for ordinary notes, letters for a
	// footnote's own sub-notes. byLine already has them keyed by ply, so this
	// replaces a per-move scan of the whole notes list.
	//
	// The `|| {}` is not the dead-fallback pattern removed elsewhere here:
	// moveStrip can be called with a line that is not in getCurrent().lines.
	const marksByPly =
		numberNotes(visibleLines(getCurrent().lines)).byLine.get(l) || {};
	owned.forEach((m) => {
		const num = m.ply % 2 === 0 ? Math.floor(m.ply / 2) + 1 + ". " : "";
		const mark = (l.marks || {})[m.ply];
		// this move's shared group: every line reaching the identical position
		const gid = getSharedInfo().byLine.get(l)?.get(m.ply);
		const group = gid ? getSharedInfo().idLines.get(gid) : [l];
		// a note lives on whichever lines carry it; shared notes sit on all of them
		const hasNote = group.some((x) =>
			(x.comments || []).some((c) => c.ply === m.ply),
		);
		// numbered note references for this move's chip (superscript numbers, no brackets)
		const noteNums = marksByPly[m.ply] || [];
		// Two levels of highlight: `on` is the move actually selected, here on
		// this line; `on-shared` is the same move on a sibling that the edit
		// will also reach. One highlight for both read as two selections.
		const inSel = inSelection(l, m.ply);
		const sel = inSel && isAnchor(l, m.ply);
		const b = el("button", {
			type: "button",
			className:
				"move-chip" +
				(sel ? " on" : inSel ? " on-shared" : "") +
				(hasNote ? " has-note" : ""),
			textContent: num + m.san + (mark ? " · " + mark : ""),
		});
		if (noteNums.length) {
			const sup = document.createElement("sup");
			sup.textContent = noteNums.join(",");
			b.appendChild(sup);
		}
		b.onclick = () => {
			// Annotating a shared move targets the whole identical group, but
			// the panel belongs to the line clicked. Clicking the same move on
			// a SIBLING therefore re-anchors the panel there rather than
			// toggling the selection off -- only a second click on the line
			// already holding the panel clears it.
			getCurrent().sel = isAnchor(l, m.ply)
				? null
				: { lines: group, ply: m.ply, at: l };
			getRenderHooks().renderApp();
		};
		wrap.appendChild(b);
	});
	return wrap;
}

// Is `ply` on line `l` part of the current selection -- i.e. will an edit in
// the panel reach it? True on every line of a shared move's group.
function inSelection(l, ply) {
	const sel = getCurrent().sel;
	return !!(sel && sel.ply === ply && sel.lines && sel.lines.includes(l));
}

// Is `l` the line the selection is ANCHORED to -- the one whose chip was
// clicked, and so the one the panel opens under? Read live rather than closed
// over at render time, so a handler can never act on a stale selection.
function isAnchor(l, ply) {
	const sel = getCurrent().sel;
	return !!(sel && sel.ply === ply && sel.at === l);
}

// Symbol row. Applies to the selected move (a per-move mark) or, when no move
// is selected, to the line-end evaluation.
// Revealed when a move (or line-end) is selected on a line: symbol buttons and
// a per-move comment editor. Collapses via the done button.
export function movePanel(l) {
	const box = el("div", { className: "movepanel" });
	const selPly = getCurrent().sel.ply;
	const atEnd = selPly == null;
	const lines = getCurrent().sel.lines || [l];
	const cur = atEnd
		? (l.meta && l.meta.eval) || ""
		: (l.marks || {})[selPly] || "";
	const mm = atEnd ? null : l.moves.find((x) => x.ply === selPly);
	const label = atEnd ? "line-end" : fullmoveLabel(selPly) + (mm ? mm.san : "");
	box.appendChild(
		el("div", {
			className: "symlabel",
			textContent:
				"@ " +
				label +
				(lines.length > 1 ? " · " + lines.length + " shared" : "") +
				":",
		}),
	);
	// a static board of the selected move's position
	if (!atEnd) {
		const board = el("div", { className: "mp-board" });
		appendBoard(board, fenAt(l.moves, selPly), getCurrent().boardSize || 220);
		box.appendChild(board);
	}
	const apply = (sym) => {
		if (atEnd) {
			lines.forEach((x) => {
				x.meta = { ...(x.meta || {}), eval: cur === sym ? "" : sym };
			});
		} else {
			lines.forEach((x) => {
				x.marks = x.marks || {};
				// an empty symbol is the clear button: always a delete, never an
				// empty-string mark that would linger in the saved notebook
				if (!sym || cur === sym) delete x.marks[selPly];
				else x.marks[selPly] = sym;
				if (!Object.keys(x.marks).length) x.marks = undefined;
			});
		}
	};
	const srow = el("span", { className: "sympick" });
	const symButton = (sym, title) => {
		const b = el("button", {
			type: "button",
			className: "chip mini" + (cur === sym ? " on" : ""),
			textContent: sym,
			title: title || sym,
		});
		b.onclick = () => {
			apply(sym);
			getRenderHooks().renderApp();
		};
		return b;
	};
	// The table is large enough that showing every glyph at once would bury the
	// handful in constant use, so the common ones stay on the visible row and
	// the rest live in a drawer, grouped the way the PGN spec groups them.
	const common = NAGS.filter((n) => n.common && n.sym);
	const commonSyms = new Set(common.map((n) => n.sym));
	common.forEach((n) => srow.appendChild(symButton(n.sym, n.label)));
	srow.appendChild(symButton("TN", "theoretical novelty"));
	const clear = el("button", {
		type: "button",
		className: "chip mini danger",
		textContent: "✕",
		title: "clear",
	});
	clear.onclick = () => {
		apply("");
		getRenderHooks().renderApp();
	};
	srow.appendChild(clear);
	box.appendChild(srow);

	const more = el("details", { className: "symmore" });
	more.appendChild(el("summary", { textContent: "More symbols" }));
	const GROUPS = [
		["move", "Move assessment"],
		["position", "Position"],
		["time", "Time pressure"],
	];
	GROUPS.forEach(([g, title]) => {
		const seen = new Set();
		// a paired glyph (White's and Black's share one symbol) appears once
		const picks = NAGS.filter(
			(n) =>
				n.group === g &&
				n.sym &&
				!commonSyms.has(n.sym) &&
				!seen.has(n.sym) &&
				seen.add(n.sym),
		);
		if (!picks.length) return;
		more.appendChild(
			el("span", { className: "symgroup-h", textContent: title }),
		);
		const row = el("span", { className: "sympick" });
		picks.forEach((n) => row.appendChild(symButton(n.sym, n.label)));
		more.appendChild(row);
	});
	box.appendChild(more);
	if (!atEnd) box.appendChild(commentEditor(selPly, lines));
	const done = el("button", {
		type: "button",
		className: "chip mini",
		textContent: "done",
	});
	done.onclick = () => {
		getCurrent().sel = null;
		getRenderHooks().renderApp();
	};
	box.appendChild(done);
	return box;
}

// Edit/add notes attached to an (identical) move; `lines` is the shared
// group, so every line carrying the position gets the same note.
export function commentEditor(ply, lines) {
	const wrap = el("div", { className: "cedit" });
	// the distinct notes at this ply across the group (deduped by text)
	const snapshot = () => {
		const out = [];
		const seen = new Set();
		lines.forEach((l) =>
			(l.comments || []).forEach((c) => {
				if (c.ply !== ply || seen.has(c.text)) return;
				seen.add(c.text);
				out.push(c.text);
			}),
		);
		return out;
	};
	// write the same set of notes onto every line in the group
	const writeAll = (texts) => {
		lines.forEach((l) => {
			l.comments = (l.comments || []).filter((c) => c.ply !== ply);
		});
		texts.forEach((t) => {
			if (!t.trim()) return;
			lines.forEach((l) => {
				l.comments = l.comments || [];
				l.comments.push({ ply, text: t.trim() });
			});
		});
	};
	const texts = snapshot(); // live row order; edits update this array
	texts.forEach((_, i) => {
		const row = el("div", { className: "nt" });
		const inp = el("input", { className: "lno", value: texts[i] });
		inp.oninput = () => {
			texts[i] = inp.value;
			writeAll(texts);
		};
		const del = el("button", {
			type: "button",
			className: "chip mini danger",
			textContent: "✕",
		});
		del.onclick = () => {
			texts.splice(i, 1);
			writeAll(texts);
			getRenderHooks().renderApp();
		};
		row.append(inp, del);
		wrap.appendChild(row);
	});
	const addInp = el("input", {
		className: "lno",
		placeholder: texts.length ? "add another note…" : "note at this move…",
	});
	const add = el("button", {
		type: "button",
		className: "chip",
		textContent: "Add note",
	});
	add.onclick = () => {
		if (addInp.value.trim()) {
			texts.push(addInp.value.trim());
			writeAll(texts);
			addInp.value = "";
			getRenderHooks().renderApp();
		}
	};
	wrap.append(addInp, add);
	return wrap;
}
