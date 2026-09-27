// src/settings-view.js
// The Settings menu: a small drop-down beside the theme button for what
// prefs.js remembers. It holds no state of its own; every control writes
// through prefs.js (or the caller's hooks, for what the app has to apply)
// and the menu is rebuilt with the rest of the toolbar.

import { el } from "./dom.js";
import { loadPrefs, savePrefs } from "./prefs.js";

// `theme` is the current theme; the hooks apply a change to the live page:
//   setTheme(t)     -- switch the page theme ("light" | "dark")
//   resetWidth()    -- put the table panel back to its default width
//   forget()        -- clear every remembered setting
export function settingsMenu({ theme, setTheme, resetWidth, forget }) {
	const p = loadPrefs();
	const det = el("details", { className: "settings" });
	det.appendChild(el("summary", { className: "chip", textContent: "Settings" }));
	const body = el("div", { className: "settings-body" });

	const choice = (label, options, value, onPick) => {
		const row = el("div", { className: "settings-row" }, [
			el("span", { className: "settings-label", textContent: label }),
		]);
		for (const [v, text] of options) {
			const b = el("button", {
				className: "chip mini" + (v === value ? " on" : ""),
				textContent: text,
			});
			b.dataset.value = v;
			b.onclick = () => onPick(v);
			row.appendChild(b);
		}
		return row;
	};

	body.appendChild(
		choice("Theme", [["light", "Light"], ["dark", "Dark"]], theme, (t) => setTheme(t)),
	);
	body.appendChild(
		choice(
			"New boards from",
			[["white", "White"], ["black", "Black"]],
			p.orientation,
			(o) => {
				savePrefs({ orientation: o });
				for (const b of det.querySelectorAll("[data-value=white],[data-value=black]"))
					b.classList.toggle("on", b.dataset.value === o);
			},
		),
	);

	// The checkbox sits beside its label rather than inside it, so it stays out
	// of the way of the toolbar's own `label input` checkboxes.
	const restore = el("input", { type: "checkbox", checked: p.restore, id: "pref-restore" });
	restore.onchange = () => savePrefs({ restore: restore.checked });
	body.appendChild(
		el("div", { className: "settings-row" }, [
			restore,
			el("label", { htmlFor: "pref-restore", textContent: "Reopen the last workbook on start" }),
		]),
	);

	body.appendChild(
		el("div", { className: "settings-row" }, [
			el("button", {
				className: "chip mini",
				textContent: "Reset panel width",
				onclick: () => {
					savePrefs({ sideWidth: null });
					resetWidth();
				},
			}),
			el("button", {
				className: "chip mini danger",
				textContent: "Forget settings",
				title: "Clear the theme, board side, panel width and last workbook. Saved workbooks are kept.",
				onclick: () => forget(),
			}),
		]),
	);
	det.appendChild(body);
	return det;
}
