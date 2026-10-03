// src/engine-view.js
// The engine's corner of a board panel: its switch and options, the lines it
// is finding, the eval bar and the arrows on the board. Shared by the analysis
// board and the study view, which differ only in what playing an engine line
// does and in whether the evaluation can be written into a note.
//
// The engine's output arrives many times a second, so this box is not redrawn
// with the panel around it: `paint` refills it in place as the engine calls.

import { el } from "./dom.js";
import { drawArrows } from "./board-input.js";
import { formatScore, maxThreads, numberedFrom, whiteShare } from "./engine.js";
import { FULL } from "./engine-store.js";
import { savePrefs } from "./prefs.js";

// Where the eval bar stood, carried across redraws so a new position starts
// the bar from the last reading rather than from even.
let lastShare = 0.5; // viewBox units; CSS scales it to the column

// The engine's corner. Built once per panel; `paint` refills it from the
// engine's state and is what the engine calls as its output comes in.
export function engineBox(engine, pos, onChange, { board, bar, flavors, playLine, noteEval = null }) {
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
			s.setAttribute("aria-label", label);
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
		// Only a multi-threaded build has a count to pick, and only on a
		// machine with more than one core to give it.
		const max = maxThreads();
		if (engine.threads && max > 1) {
			const counts = Array.from({ length: max }, (_, i) => [i + 1, i ? `${i + 1} threads` : "1 thread"]);
			opts.append(
				pick("an-engine-threads", "Threads to search with", counts, engine.threads, (n) => {
					engine.setThreads(n);
					savePrefs({ engineThreads: n });
				}),
			);
		}
	}
	if (on && flavors) {
		const f = el("select", { className: "an-engine-flavor", title: "Which Stockfish 19 to run: Lite (1.8 MB) or Full (99 MB, stronger)" });
		f.setAttribute("aria-label", "Which Stockfish 19 to run");
		// Plain names, so the settings row fits a phone held upright with the
		// thread count in it; the download box gives the full engine's size
		// before anything is fetched.
		[["lite", "Lite"], ["full", "Full"]].forEach(([v, text]) => {
			f.appendChild(el("option", { value: v, textContent: text, selected: v === flavors.state.flavor }));
		});
		f.onchange = () => flavors.choose(f.value);
		opts.prepend(f);
	}
	// The box sits under the board, so it is kept short: the actions share the
	// head row with the toggle, and the settings go in a slim row after the
	// lines rather than a row of their own above them.
	const acts = el("span", { className: "orow an-engine-acts" });
	box.appendChild(el("div", { className: "an-engine-head" }, [toggle, info, acts]));
	if (flavors) box.appendChild(fullBox(flavors));
	const lines = el("div", { className: "an-pvs" });
	box.appendChild(lines);
	if (on) box.appendChild(opts);
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
			acts.replaceChildren();
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
		bar.setAttribute("aria-label", best ? `Evaluation ${formatScore(best.score)} from White's side` : "Evaluation");
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
								playLine(sans.slice(0, j + 1));
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
		acts.replaceChildren();
		if (!pos.over) {
			// The verdict into the note on the move just played, where the
			// notebook and its PGN will carry it. Only a caller that keeps
			// notes passes `noteEval`; the study view reads and writes nothing.
			if (noteEval) {
				acts.appendChild(
					el("button", {
						className: "chip mini an-note-eval",
						textContent: "Note eval",
						title: "Add the engine's evaluation to the note on this move",
						disabled: !best,
						onclick: () => {
							noteEval(
								`Stockfish: ${formatScore(best.score)} (depth ${best.depth}), ${numberedFrom(pos.fen, best.moves.slice(0, 4).map((m) => m.san)).join(" ")}`,
							);
							onChange();
						},
					}),
				);
			}
			deeper.style.visibility = best && st.status !== "searching" ? "" : "hidden";
			acts.appendChild(deeper);
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
					el("code", { textContent: FULL.file }),
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

