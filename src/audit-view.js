// src/audit-view.js
// The repertoire audit's panel in the report, and its chip in the toolbar.
//
// The audit runs for minutes on a big workbook while the reader goes on
// working, so nothing here redraws the page: the panel and the chip are
// refilled in place as the audit reports (audit.js throttles that), the way
// the engine box follows the engine. The findings list is rebuilt only when
// the findings change, so a button in it keeps the focus while the
// progress bar moves.

import { el } from "./dom.js";
import { getCurrent, getRenderHooks } from "./state.js";
import { editorOrder, putNote, setMark } from "./line-editor.js";
import { formatScore, fullWorker, liteWorker } from "./engine.js";
import { storedFull } from "./engine-store.js";
import { GRADES, MAX_DEPTH, MIN_DEPTH, assessOf, auditPositions, auditReport, auditWorkers, maxAuditWorkers, sharedAudit } from "./audit.js";
import { loadPrefs, savePrefs } from "./prefs.js";
import { markSym } from "./nags.js";

// Session-only, like the table's open groups: whether the panel is shown,
// and how much of it.
const ui = { open: false, minor: false, all: false, ends: false };
const LIMIT = 50; // findings shown before "Show all"

let panel = null; // the panel on the page, refilled in place
let chip = null; // the toolbar's chip, likewise
let notice = null; // why a run could not start, until the next start
let fullUrl = null; // the stored full engine's blob: URL, made once per page
let drawn = { done: -1, at: 0 }; // what the table's evals were last drawn from
const restored = new WeakSet(); // workbooks whose kept evals have been read

// "12.Nf3" or "12...Nf6"
const moveText = (ply, san) => (ply % 2 === 0 ? `${ply / 2 + 1}.${san}` : `${(ply + 1) / 2}...${san}`);
const n = (x) => x.toLocaleString("en-US");
const score = (s, mated) => (s == null ? "…" : mated ? "#" : formatScore(s));

function minutes(ms) {
	if (ms == null) return "";
	const m = Math.round(ms / 60000);
	return m < 1 ? "under a minute left" : `about ${m} min left`;
}

const report = (audit) =>
	auditReport(
		getCurrent().lines,
		audit.evals,
		audit.state.depth,
		editorOrder(getCurrent().lines),
		loadPrefs().auditSide,
	);

// A run for a workbook since closed is of no use to the one open now.
function forThisWorkbook(audit) {
	if (audit.state.status === "running" && audit.state.source !== getCurrent()) audit.stop();
}

// The full engine runs from the copy the engine box downloaded (engine-store.js);
// with none on this device, the run does not start and the panel says where
// to get it.
async function start(audit) {
	const p = loadPrefs();
	let factory = liteWorker;
	notice = null;
	if (p.auditFlavor === "full") {
		const blob = fullUrl ? true : await storedFull();
		if (!blob) {
			notice = "The full engine is not on this device yet. Download it from the engine box (Full) on the analysis board, or pick Lite.";
			return paint(audit);
		}
		fullUrl ??= URL.createObjectURL(blob);
		factory = fullWorker(fullUrl);
	}
	audit.start(auditPositions(getCurrent().lines), {
		depth: p.auditDepth,
		engines: auditWorkers(p.auditEngines),
		flavor: p.auditFlavor,
		factory,
		source: getCurrent(),
	});
}

// The toolbar's way in, which shows how far a run has got.
export function auditChip(audit = sharedAudit()) {
	chip = el("button", {
		className: "chip audit-toggle",
		title: "Search every position of the workbook with the engine, in the background",
		onclick: () => {
			ui.open = !ui.open;
			// opening it with nothing found yet picks up an earlier visit's
			if (ui.open && !audit.evals.size) audit.restore(auditPositions(getCurrent().lines));
			paint(audit);
			// on a phone the report stacks, and the panel sits below the table
			if (ui.open) panel?.scrollIntoView?.({ block: "start", behavior: "smooth" });
		},
	});
	listen(audit);
	paintChip(audit);
	return chip;
}

function paintChip(audit, r = null) {
	if (!chip) return;
	const running = audit.state.status === "running";
	let text = "Audit";
	if (running) {
		r ??= report(audit);
		text = `Audit ${Math.floor((100 * r.done) / Math.max(1, r.total))}%`;
	}
	chip.textContent = text;
	chip.classList.toggle("on", ui.open);
	chip.classList.toggle("busy", running);
	chip.setAttribute("aria-expanded", String(ui.open));
}

export function auditPanel(audit = sharedAudit()) {
	panel = el("section", { className: "audit" });
	panel.setAttribute("aria-label", "Repertoire audit");
	listen(audit);
	// the table shows evals from the first render, so what an earlier visit
	// found is read in without waiting for the panel to be opened
	if (loadPrefs().auditInTable && !restored.has(getCurrent())) {
		restored.add(getCurrent());
		if (!audit.evals.size) audit.restore(auditPositions(getCurrent().lines));
	}
	// the workbook was redrawn, perhaps with lines added: a run takes them on
	if (audit.state.status === "running") audit.add(auditPositions(getCurrent().lines));
	paintPanel(audit);
	return panel;
}

function listen(audit) {
	audit.onUpdate = () => paint(audit);
	// the report is at the depth the next run will search, until one runs
	if (audit.state.status !== "running") {
		audit.state.depth = loadPrefs().auditDepth;
		audit.setFlavor(loadPrefs().auditFlavor);
	}
}

// One report a paint, shared by the chip and the panel: on a big workbook it
// is tens of milliseconds.
function paint(audit) {
	forThisWorkbook(audit);
	const inTable = loadPrefs().auditInTable;
	const r = audit.state.status === "running" || (ui.open && panel) || inTable ? report(audit) : null;
	paintChip(audit, r);
	paintPanel(audit, r);
	if (inTable) paintTable(audit, r);
}

// The table's evals follow the audit, but redrawing the table takes longer
// than a progress bar and closes a menu open on it: while a run goes on, at
// most every five seconds, and once more when it stops.
const TABLE_EVERY = 5000;
function paintTable(audit, r) {
	if (r.done === drawn.done) return;
	const t = Date.now();
	if (audit.state.status === "running" && t - drawn.at < TABLE_EVERY) return;
	drawn = { done: r.done, at: t };
	getRenderHooks().rerenderTable?.();
}

function paintPanel(audit, r = null) {
	if (!panel) return;
	panel.hidden = !ui.open;
	if (!ui.open) return;
	const st = audit.state;
	r ??= report(audit);
	const running = st.status === "running";
	const left = r.total - r.done;

	const full = st.flavor === "full" ? " with the full engine" : "";
	let status;
	if (running) {
		const kind = st.flavor === "full" ? "full " : "";
		status = `Searching: ${n(r.done)} of ${n(r.total)} positions, depth ${st.depth}, ${audit.workers} ${kind}${audit.workers === 1 ? "engine" : "engines"}`;
		const eta = minutes(audit.remaining());
		if (eta) status += `, ${eta}`;
	} else if (notice) status = notice;
	else if (st.status === "error") status = `The engine stopped: ${st.error}`;
	else if (!r.done)
		status = `Searches each of the workbook's ${n(r.total)} positions once, in the background. Keep working while it runs.`;
	else if (!left) status = `All ${n(r.total)} positions searched at depth ${st.depth}${full}.`;
	else status = `${n(r.done)} of ${n(r.total)} positions searched at depth ${st.depth}${full}.`;

	// Any depth, typed: what is enough depends on the openings and on how
	// long the reader will wait (about four times as long per two plies).
	const depth = el("input", {
		className: "audit-depth",
		type: "number",
		min: String(MIN_DEPTH),
		max: String(MAX_DEPTH),
		step: "1",
		value: String(loadPrefs().auditDepth),
		title: `How deep each position is searched (${MIN_DEPTH}-${MAX_DEPTH})`,
	});
	depth.setAttribute("aria-label", "Search depth");
	depth.onchange = () => {
		const d = Math.round(+depth.value);
		if (!(d >= MIN_DEPTH && d <= MAX_DEPTH)) {
			depth.value = String(loadPrefs().auditDepth);
			return;
		}
		// The same depth again is nothing. Redrawing the controls takes the
		// box out of the page, which blurs it, which fires "change" a second
		// time from inside that redraw.
		if (d === loadPrefs().auditDepth) return;
		savePrefs({ auditDepth: d });
		// what is found is by depth: the report starts over at the new one
		audit.state.depth = d;
		if (running) start(audit);
		else paint(audit);
	};
	// How many engines search at once; each takes one core. A change takes
	// effect on the next start, or at once by restarting a run.
	const engines = el("select", { className: "audit-engines", title: "How many engines search at once (one core each)" });
	engines.setAttribute("aria-label", "Engines");
	const using = auditWorkers(loadPrefs().auditEngines);
	for (let i = 1; i <= maxAuditWorkers(); i++) {
		engines.appendChild(el("option", { value: String(i), textContent: `${i} ${i === 1 ? "engine" : "engines"}`, selected: i === using }));
	}
	engines.onchange = () => {
		savePrefs({ auditEngines: +engines.value });
		if (running) start(audit);
	};
	// Whose moves are judged. The opponent's slips are theirs: only the
	// reader's side is graded, and every position is still searched, since
	// the opponent's moves lead to the reader's.
	const side = pick("audit-side", "Whose moves are judged", [["both", "Both sides"], ["white", "I play White"], ["black", "I play Black"]], loadPrefs().auditSide, (v) => {
		savePrefs({ auditSide: v });
		paint(audit);
	});
	// Which build searches. Lite is quick; full is stronger and slower, and
	// each engine is its own ~100 MB copy in memory.
	const flavor = pick("audit-flavor", "Which engine searches", [["lite", "Lite"], ["full", "Full"]], loadPrefs().auditFlavor, (v) => {
		savePrefs({ auditFlavor: v });
		notice = null;
		const was = running;
		audit.setFlavor(v);
		if (was) start(audit);
		else paint(audit);
	});
	// nothing left to search at this depth: no button, the depth picker is
	// the way to look again
	const go = running
		? el("button", { className: "chip audit-run", textContent: "Stop", onclick: () => audit.stop() })
		: left
			? el("button", {
					className: "chip primary audit-run",
					textContent: r.done ? `Continue (${n(left)} left)` : "Run audit",
					onclick: () => start(audit),
				})
			: "";
	const close = el("button", {
		className: "chip mini audit-close",
		textContent: "✕",
		title: "Hide the audit (a run goes on)",
		onclick: () => {
			ui.open = false;
			paint(audit);
		},
	});
	close.setAttribute("aria-label", "Hide the audit");

	let head = panel.querySelector(".audit-head");
	const fresh = el("div", { className: "audit-head" }, [
		el("h3", { textContent: "Repertoire audit" }),
		close,
		el("span", { className: "audit-ctl" }, [
			side,
			flavor,
			el("label", { className: "audit-depth-label" }, ["Depth ", depth]),
			engines,
			go,
		]),
	]);
	// the controls are rebuilt only when what they offer changes, so one in
	// use is not pulled from under the pointer as the bar moves
	const p = loadPrefs();
	const sig = `${st.status}|${r.done > 0}|${left > 0}|${st.depth}|${using}|${p.auditSide}|${st.flavor}`;
	if (!head || head.dataset.sig !== sig) {
		fresh.dataset.sig = sig;
		if (head) head.replaceWith(fresh);
		else panel.appendChild(fresh);
		head = fresh;
	}
	let line = panel.querySelector(".audit-status");
	if (!line) {
		line = el("p", { className: "audit-status" });
		line.setAttribute("role", "status");
		head.after(line);
	}
	line.textContent = status;
	let bar = panel.querySelector(".an-progress");
	if (!bar) {
		bar = el("div", { className: "an-progress audit-bar" }, [el("div")]);
		line.after(bar);
	}
	bar.hidden = !r.done && !running;
	bar.firstChild.style.width = `${((100 * r.done) / Math.max(1, r.total)).toFixed(1)}%`;

	// The list is rebuilt only when what it shows changes -- a new finding, a
	// line end now known -- not for every position searched.
	const sig2 = [
		ui.minor,
		ui.all,
		ui.ends && r.ends.filter((e) => e.score).length,
		st.depth,
		st.flavor,
		r.done > 0,
		r.findings.map((f) => f.key + f.lines.length).join(","),
	].join("|");
	const body = panel.querySelector(".audit-body");
	if (body && body.dataset.sig === sig2) return;
	const next = findingsBody(audit, r);
	next.dataset.sig = sig2;
	if (body) body.replaceWith(next);
	else panel.appendChild(next);
}

function findingsBody(audit, r) {
	const body = el("div", { className: "audit-body" });
	if (!r.done) return body;
	const count = (g) => r.findings.filter((f) => f.grade === g).length;
	const tally = GRADES.map((g) => [g, count(g)]);
	body.appendChild(
		el(
			"p",
			{ className: "audit-sum" },
			r.findings.length
				? tally
						.filter(([, c]) => c)
						.map(([g, c], i) =>
							el("span", { className: "audit-tally g-" + g.id }, (i ? " · " : "") + `${c} ${c === 1 ? g.label.toLowerCase() : g.plural}`),
						)
				: "No move loses ground so far.",
		),
	);
	const list = ui.minor ? r.findings : r.findings.filter((f) => f.grade.id !== "inaccuracy");
	const rows = ui.all ? list : list.slice(0, LIMIT);
	body.appendChild(
		el("div", { className: "audit-acts" }, [
			inTableChip(audit),
			list.length ? bulk(`Add symbols (${n(list.length)})`, "Mark each move listed with its symbol, where it has none of yours", () => list.forEach((f) => markFinding(f, true))) : "",
			list.length ? bulk(`Add notes (${n(list.length)})`, "Note the engine's verdict on each move listed", () => list.forEach((f) => noteFinding(f, audit))) : "",
		]),
	);
	if (rows.length) {
		const ol = el("ol", { className: "audit-list" });
		rows.forEach((f) => ol.appendChild(findingRow(f, audit)));
		body.appendChild(ol);
	}
	const more = el("div", { className: "audit-more" });
	const minor = count(GRADES[2]);
	if (minor)
		more.appendChild(
			toggle(ui.minor ? "Hide inaccuracies" : `Show inaccuracies (${minor})`, () => (ui.minor = !ui.minor), audit),
		);
	if (list.length > LIMIT && !ui.all) more.appendChild(toggle(`Show all ${n(list.length)}`, () => (ui.all = true), audit));
	if (more.childNodes.length) body.appendChild(more);
	body.appendChild(endsList(audit, r));
	return body;
}

// A labelled drop-down of [value, text] pairs.
function pick(cls, label, options, current, set) {
	const sel = el("select", { className: cls, title: label });
	sel.setAttribute("aria-label", label);
	for (const [v, t] of options) sel.appendChild(el("option", { value: v, textContent: t, selected: v === current }));
	sel.onchange = () => set(sel.value);
	return sel;
}

const toggle = (text, act, audit) =>
	el("button", {
		className: "chip mini",
		textContent: text,
		onclick: () => {
			act();
			paint(audit);
		},
	});

// The lines a finding is on, by name, in the table's column order.
function lineNames(lines) {
	const names = lines.map((l) => l.name);
	return names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
}

const studyBtn = (moves, label) => {
	const b = el("button", {
		className: "chip mini audit-study",
		textContent: "Study",
		onclick: () => getRenderHooks().openStudy(moves),
	});
	b.setAttribute("aria-label", label);
	return b;
};

// The audit's verdicts into the workbook, where its notes, its table and its
// PGN carry them: the symbol a finding's grade or a line end's eval suggests,
// and a note of what the engine saw. Both go through the line editor's own
// setMark and putNote, as a symbol or a note made by hand does. A note from
// the engine replaces an earlier one on the same move rather than stacking.
const isEngineNote = (t) => t.startsWith("Stockfish");
const engine = (audit) => (audit.state.flavor === "full" ? "Stockfish (full)" : "Stockfish");

const findingNote = (f, i, audit) =>
	`${engine(audit)}: ${formatScore(f.before)} → ${formatScore(f.after)} (depth ${audit.state.depth}), best ${moveText(f.plies[i], f.best)}`;
const endNote = (e, audit) => `${engine(audit)}: ${score(e.score, e.mated)} (depth ${audit.state.depth})`;
const hasNote = (l, ply, text) => (l.comments || []).some((c) => c.ply === ply && c.text === text);
const dropNote = (l, ply, text) => {
	l.comments = (l.comments || []).filter((c) => c.ply !== ply || c.text !== text);
};

const findingMarked = (f) => f.lines.every((l, i) => markSym((l.marks || {})[f.plies[i]]) === f.grade.sym);
// `keep`: a move the reader has marked already keeps their symbol
function markFinding(f, keep = false) {
	f.lines.forEach((l, i) => {
		if (!keep || !(l.marks || {})[f.plies[i]]) setMark([l], f.plies[i], f.grade.sym);
	});
}
const findingNoted = (f, audit) => f.lines.every((l, i) => hasNote(l, f.plies[i], findingNote(f, i, audit)));
const noteFinding = (f, audit) =>
	f.lines.forEach((l, i) => putNote([l], f.plies[i], findingNote(f, i, audit), isEngineNote));

const lastPly = (e) => e.line.moves[e.line.moves.length - 1]?.ply;
function markEnd(e, keep = false) {
	if (!keep || !e.line.meta?.eval) setMark([e.line], null, assessOf(e.score, e.mated));
}
const noteEnd = (e, audit) => putNote([e.line], lastPly(e), endNote(e, audit), isEngineNote);

// A button that writes into the workbook, which is then drawn again.
function bulk(text, title, act) {
	return el("button", {
		className: "chip mini audit-bulk",
		textContent: text,
		title,
		onclick: () => {
			act();
			getRenderHooks().renderApp();
		},
	});
}

// A suggestion's button, lit once the workbook has it; pressed again it
// takes it back off, as the symbol palette does.
function suggest(cls, text, label, on, add, remove) {
	const b = el("button", {
		className: `chip mini ${cls}${on ? " on" : ""}`,
		textContent: text,
		title: label,
		onclick: () => {
			if (on) remove();
			else add();
			getRenderHooks().renderApp();
		},
	});
	b.setAttribute("aria-label", label);
	b.setAttribute("aria-pressed", String(on));
	return b;
}

// Under each move of the table, the eval after it.
function inTableChip(audit) {
	const on = loadPrefs().auditInTable;
	const b = el("button", {
		className: "chip mini audit-intable" + (on ? " on" : ""),
		textContent: "Evals in the table",
		title: "Show the audit's eval under each move of the table",
		onclick: () => {
			savePrefs({ auditInTable: !on });
			drawn = { done: -1, at: 0 };
			getRenderHooks().rerenderTable?.();
			paint(audit);
		},
	});
	b.setAttribute("aria-pressed", String(on));
	return b;
}

function findingRow(f, audit) {
	const move = moveText(f.ply, f.san);
	const li = el("li", { className: "audit-row g-" + f.grade.id }, [
		el("span", { className: "audit-sym", title: f.grade.label, textContent: f.grade.sym }),
		el("span", { className: "audit-move", textContent: move }),
		el("span", { className: "audit-evals" }, `${formatScore(f.before)} → ${formatScore(f.after)}`),
		el("span", { className: "audit-best" }, `best ${moveText(f.ply, f.best)}`),
		el("span", { className: "audit-lines", title: f.lines.map((l) => l.name).join(", ") }, lineNames(f.lines)),
		el("span", { className: "audit-do" }, [
		suggest("audit-mark", f.grade.sym, `Mark ${move} ${f.grade.sym}`, findingMarked(f), () => markFinding(f), () =>
			f.lines.forEach((l, i) => setMark([l], f.plies[i], "")),
		),
		suggest("audit-note", "Note", `Note the engine's verdict on ${move}`, findingNoted(f, audit), () => noteFinding(f, audit), () =>
			f.lines.forEach((l, i) => dropNote(l, f.plies[i], findingNote(f, i, audit))),
		),
		studyBtn(f.moves, `Study the position before ${move}`),
		]),
	]);
	li.querySelector(".audit-sym").setAttribute("aria-label", f.grade.label);
	return li;
}

// Where each line leaves you, in column order. Folded by default: on a big
// workbook it is a long list, so it is built only when opened.
function endsList(audit, r) {
	const box = el("details", { className: "audit-ends", open: ui.ends });
	box.appendChild(el("summary", { textContent: `Where each line ends (${n(r.ends.length)})` }));
	box.ontoggle = () => {
		// a box replaced since (the toggle event is queued) is not the reader's
		if (!box.isConnected || box.open === ui.ends) return;
		ui.ends = box.open;
		paint(audit);
	};
	if (!ui.ends) return box;
	// a line with no moves has no move to note, and one not yet searched no eval
	const known = r.ends.filter((e) => e.score && e.line.moves.length);
	if (known.length)
		box.appendChild(
			el("div", { className: "audit-acts" }, [
				bulk(`Add assessments (${n(known.length)})`, "Give each line end the assessment its eval suggests, where it has none of yours", () =>
					known.forEach((e) => markEnd(e, true)),
				),
				bulk(`Add notes (${n(known.length)})`, "Note the engine's eval on each line's last move", () => known.forEach((e) => noteEnd(e, audit))),
			]),
		);
	const ol = el("ol", { className: "audit-list" });
	for (const e of r.ends) {
		const m = e.line.moves;
		const last = m[m.length - 1];
		const ok = e.score && last;
		const sym = ok ? assessOf(e.score, e.mated) : "";
		const text = ok ? endNote(e, audit) : "";
		ol.appendChild(
			el("li", { className: "audit-row" }, [
				el("span", { className: "audit-lines", textContent: e.line.name }),
				el("span", { className: "audit-move", textContent: last ? moveText(last.ply, last.san) : "" }),
				el("span", { className: "audit-evals", textContent: score(e.score, e.mated) }),
				el("span", { className: "audit-do" }, [
				ok
					? suggest("audit-mark", sym, `Assess the end of ${e.line.name} ${sym}`, e.line.meta?.eval === sym, () => markEnd(e), () =>
							setMark([e.line], null, ""),
						)
					: "",
				ok
					? suggest("audit-note", "Note", `Note the engine's eval at the end of ${e.line.name}`, hasNote(e.line, last.ply, text), () => noteEnd(e, audit), () =>
							dropNote(e.line, last.ply, text),
						)
					: "",
				studyBtn(m, `Study the end of ${e.line.name}`),
				]),
			]),
		);
	}
	box.appendChild(ol);
	return box;
}
