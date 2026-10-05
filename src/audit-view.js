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
import { editorOrder } from "./line-editor.js";
import { formatScore } from "./engine.js";
import { GRADES, MAX_DEPTH, MIN_DEPTH, auditPositions, auditReport, auditWorkers, maxAuditWorkers, sharedAudit } from "./audit.js";
import { loadPrefs, savePrefs } from "./prefs.js";

// Session-only, like the table's open groups: whether the panel is shown,
// and how much of it.
const ui = { open: false, minor: false, all: false, ends: false };
const LIMIT = 50; // findings shown before "Show all"

let panel = null; // the panel on the page, refilled in place
let chip = null; // the toolbar's chip, likewise

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
	auditReport(getCurrent().lines, audit.evals, audit.state.depth, editorOrder(getCurrent().lines));

// A run for a workbook since closed is of no use to the one open now.
function forThisWorkbook(audit) {
	if (audit.state.status === "running" && audit.state.source !== getCurrent()) audit.stop();
}

function start(audit) {
	const p = loadPrefs();
	audit.start(auditPositions(getCurrent().lines), {
		depth: p.auditDepth,
		engines: auditWorkers(p.auditEngines),
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
	// the workbook was redrawn, perhaps with lines added: a run takes them on
	if (audit.state.status === "running") audit.add(auditPositions(getCurrent().lines));
	paintPanel(audit);
	return panel;
}

function listen(audit) {
	audit.onUpdate = () => paint(audit);
	// the report is at the depth the next run will search, until one runs
	if (audit.state.status !== "running") audit.state.depth = loadPrefs().auditDepth;
}

// One report a paint, shared by the chip and the panel: on a big workbook it
// is tens of milliseconds.
function paint(audit) {
	forThisWorkbook(audit);
	const r = audit.state.status === "running" || (ui.open && panel) ? report(audit) : null;
	paintChip(audit, r);
	paintPanel(audit, r);
}

function paintPanel(audit, r = null) {
	if (!panel) return;
	panel.hidden = !ui.open;
	if (!ui.open) return;
	const st = audit.state;
	r ??= report(audit);
	const running = st.status === "running";
	const left = r.total - r.done;

	let status;
	if (running) {
		status = `Searching: ${n(r.done)} of ${n(r.total)} positions, depth ${st.depth}, ${audit.workers} ${audit.workers === 1 ? "engine" : "engines"}`;
		const eta = minutes(audit.remaining());
		if (eta) status += `, ${eta}`;
	} else if (st.status === "error") status = `The engine stopped: ${st.error}`;
	else if (!r.done)
		status = `Searches each of the workbook's ${n(r.total)} positions once, in the background. Keep working while it runs.`;
	else if (!left) status = `All ${n(r.total)} positions searched at depth ${st.depth}.`;
	else status = `${n(r.done)} of ${n(r.total)} positions searched at depth ${st.depth}.`;

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
		el("span", { className: "audit-ctl" }, [el("label", { className: "audit-depth-label" }, ["Depth ", depth]), engines, go]),
	]);
	// the controls are rebuilt only when what they offer changes, so one in
	// use is not pulled from under the pointer as the bar moves
	const sig = `${st.status}|${r.done > 0}|${left > 0}|${st.depth}|${using}`;
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
	if (rows.length) {
		const ol = el("ol", { className: "audit-list" });
		rows.forEach((f) => ol.appendChild(findingRow(f)));
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

function findingRow(f) {
	const move = moveText(f.ply, f.san);
	const li = el("li", { className: "audit-row g-" + f.grade.id }, [
		el("span", { className: "audit-sym", title: f.grade.label, textContent: f.grade.sym }),
		el("span", { className: "audit-move", textContent: move }),
		el("span", { className: "audit-evals" }, `${formatScore(f.before)} → ${formatScore(f.after)}`),
		el("span", { className: "audit-best" }, `best ${moveText(f.ply, f.best)}`),
		el("span", { className: "audit-lines", title: f.lines.map((l) => l.name).join(", ") }, lineNames(f.lines)),
		studyBtn(f.moves, `Study the position before ${move}`),
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
		if (box.open === ui.ends) return;
		ui.ends = box.open;
		paint(audit);
	};
	if (!ui.ends) return box;
	const ol = el("ol", { className: "audit-list" });
	for (const e of r.ends) {
		const m = e.line.moves;
		const last = m[m.length - 1];
		ol.appendChild(
			el("li", { className: "audit-row" }, [
				el("span", { className: "audit-lines", textContent: e.line.name }),
				el("span", { className: "audit-move", textContent: last ? moveText(last.ply, last.san) : "" }),
				el("span", { className: "audit-evals", textContent: score(e.score, e.mated) }),
				studyBtn(m, `Study the end of ${e.line.name}`),
			]),
		);
	}
	box.appendChild(ol);
	return box;
}
