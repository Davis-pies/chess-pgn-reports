// The table's context menu: right-click a move to act on it and on its line.
//
// Every action here is the editor's action. The symbol picker and the note
// editor are the EXACT components the editor panel builds (symbolRow and
// commentEditor, both from line-editor.js), and the line controls call the same
// primitives its chips do. Nothing about a notebook can be changed from here in
// a way it could not be changed there -- there is one implementation, and this
// is a second way to reach it.
//
// Left-click is left alone: it traces, which is the gesture a reader uses while
// reading and should stay instant. This hangs off `contextmenu`, which is also
// what the keyboard Menu key and Shift+F10 fire, so the menu is reachable
// without a mouse on cells that the trace work already made focusable.

import { el } from "./dom.js";
import { getCurrent, getSharedInfo, getRenderHooks } from "./state.js";
import { symbolRow, commentEditor, promoteMainline } from "./line-editor.js";
import { setHidden, solo, isFocused } from "./visibility.js";
import { fullmoveLabel } from "./render.js";

// One menu in the document at a time. Held module-level rather than passed
// around because "the menu that is open" is a property of the page, not of any
// one table: opening a second must close the first however it was opened.
let openMenu = null;
let lastFocus = null;

export function closeTableMenu() {
	if (!openMenu) return;
	openMenu.remove();
	openMenu = null;
	document.removeEventListener("keydown", onKey, true);
	document.removeEventListener("mousedown", onOutside, true);
	// Back to the cell the reader came from, so a keyboard user is not dropped
	// at the top of the document.
	if (lastFocus && lastFocus.isConnected) lastFocus.focus();
	lastFocus = null;
}

function onKey(e) {
	if (e.key === "Escape") {
		e.stopPropagation();
		closeTableMenu();
	}
}

function onOutside(e) {
	if (openMenu && !openMenu.contains(e.target)) closeTableMenu();
}

// An action item: does the thing, then closes and re-renders. Every caller
// mutates lines, so the re-render is unconditional rather than per-item.
function item(label, run, { danger = false, on = false } = {}) {
	const b = el("button", {
		type: "button",
		className: "tmenu-item" + (danger ? " danger" : "") + (on ? " on" : ""),
		textContent: label,
	});
	b.onclick = () => {
		run();
		closeTableMenu();
		getRenderHooks().renderApp();
	};
	return b;
}

function section(title) {
	return el("div", { className: "tmenu-sec", textContent: title });
}

// Hide / Focus / Move to footnote over a set of lines. The section header above
// these says what "these" are — a line's name, or "N lines" for a group — so
// the items themselves stay bare verbs.
//
// The mainline is excluded by the callers, not here: setHidden and solo already
// refuse it, but an item that silently does nothing is worse than one that is
// not offered.
function lineActions(box, lines) {
	const allFoot = lines.every((l) => l.tag === "foot");
	box.appendChild(
		item(
			allFoot ? "Move out of footnotes" : "Move to footnote",
			() => lines.forEach((l) => (l.tag = allFoot ? "sideline" : "foot")),
			{ on: allFoot },
		),
	);
	const focused = isFocused(getCurrent().lines, lines);
	box.appendChild(
		item(
			focused ? "Stop focusing" : "Focus",
			() =>
				focused
					? setHidden(getCurrent().lines, false)
					: solo(getCurrent().lines, lines),
			{ on: focused },
		),
	);
	const allHidden = lines.every((l) => l.hidden);
	box.appendChild(
		item(allHidden ? "Unhide" : "Hide", () =>
			setHidden(lines, !allHidden),
		),
	);
}

// The move half: the symbol picker and note editor for one ply, over the shared
// group that ply belongs to — so annotating here annotates every line reaching
// the same position, exactly as it does in the editor.
function moveSection(box, line, ply) {
	const gid = getSharedInfo().byLine?.get(line)?.get(ply);
	const group = (gid && getSharedInfo().idLines.get(gid)) || [line];
	const m = line.moves.find((x) => x.ply === ply);
	box.appendChild(
		section(
			"@ " +
				fullmoveLabel(ply) +
				(m ? m.san : "") +
				(group.length > 1 ? " · " + group.length + " shared" : ""),
		),
	);
	const cur = (line.marks || {})[ply] || "";
	box.append(symbolRow(ply, group, cur), commentEditor(ply, group));
}

// Build and show the menu at the cursor.
export function openTableMenu({ x, y, target, from }) {
	closeTableMenu();
	lastFocus = from || null;
	const box = el("div", { className: "tmenu" });
	box.setAttribute("role", "menu");
	buildInto(box, target);
	document.body.appendChild(box);
	place(box, x, y);
	openMenu = box;
	// The menu hangs off document.body, OUTSIDE the app's view root. So the
	// renderApp() that every edit in here triggers rebuilds the table and the
	// editor panel underneath it and leaves the menu showing the state it was
	// opened with -- a symbol picked from here stayed unlit, a note added
	// stayed missing. movePanel gets this for free by living inside the root.
	//
	// Rebuilt in place, on the same element, so the menu does not jump or lose
	// its listeners. Only for BUTTONS inside the borrowed editor components:
	// the note field writes on `input` and rebuilding under a keystroke would
	// steal focus, and the line actions close the menu rather than updating it.
	box.addEventListener("click", (e) => {
		const b = e.target.closest && e.target.closest("button");
		if (!b || !b.closest(".sympick, .cedit")) return;
		if (openMenu !== box || !box.isConnected) return;
		refresh(box, target);
	});
	document.addEventListener("keydown", onKey, true);
	document.addEventListener("mousedown", onOutside, true);
	const first = box.querySelector("button, input");
	if (first) first.focus();
	return box;
}

// Rebuild the menu's contents against current state, keeping the scroll
// position so a rebuild does not jump the reader back to the top.
function refresh(box, target) {
	const top = box.scrollTop;
	buildInto(box, target);
	box.scrollTop = top;
}

// `target` is either { line, ply } for a line column's move cell, or { lines }
// for a group column's — a group is not one line, so it gets the group actions
// and no per-move section: the moves in its column belong to all of its lines.
function buildInto(box, target) {
	box.replaceChildren();
	if (target.lines) {
		box.appendChild(section(target.lines.length + " lines"));
		lineActions(box, target.lines);
	} else {
		const { line, ply } = target;
		if (ply != null) moveSection(box, line, ply);
		box.appendChild(section(line.name || "this line"));
		// The mainline is the table's reference row: lineEditor offers it none
		// of these either, and setHidden/solo refuse it at the primitive.
		if (line.isMain) {
			box.appendChild(
				el("div", {
					className: "tmenu-note",
					textContent: "the mainline is the table's reference row",
				}),
			);
		} else {
			box.appendChild(
				item("★ Make mainline", () => promoteMainline(line)),
			);
			lineActions(box, [line]);
		}
	}
}

// At the cursor, nudged back inside the viewport so a right-click near an edge
// does not open off-screen. jsdom reports every box as 0x0, so the fallbacks
// keep this a no-op there rather than a NaN.
function place(box, x, y) {
	box.style.position = "fixed";
	box.style.left = x + "px";
	box.style.top = y + "px";
	const r = box.getBoundingClientRect ? box.getBoundingClientRect() : null;
	const vw = window.innerWidth || 0;
	const vh = window.innerHeight || 0;
	if (!r || !vw || !vh) return;
	if (r.width && x + r.width > vw) box.style.left = Math.max(0, vw - r.width) + "px";
	if (r.height && y + r.height > vh) box.style.top = Math.max(0, vh - r.height) + "px";
}
