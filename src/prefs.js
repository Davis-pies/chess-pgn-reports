// src/prefs.js
// What the app remembers about the viewer between visits, apart from the
// workbooks themselves: the theme, which way up new analysis boards start,
// the table panel's width, whether the board's workbook lines are folded, the
// engine's thread count, and the workbook and board position they were on
// when they left. Browser-local and never part of a workbook: a file you send
// someone should not carry your panel width.
//
// Everything is read defensively. Storage can be blocked, full, or hold a
// value from an older build or a hand edit, so each field is checked on read
// and falls back to its default rather than trusting what is there.

const KEY = "ott-prefs";
// The theme predates this module and keeps its own key, so a theme chosen on
// an older build is still the theme after an upgrade.
const THEME_KEY = "ott-theme";

const SIDE_MIN = 280;
const SIDE_MAX = 1600;

const DEFAULTS = Object.freeze({
	// "white" or "black": which side is at the bottom of a new analysis board
	orientation: "white",
	// px; null means "the app's own default"
	sideWidth: null,
	// reopen the last workbook, and its board, on the next visit
	restore: true,
	// { id, mode, board } -- the workbook open when the page was left
	last: null,
	// the analysis board's list of workbook lines folded to its heading
	wbCollapsed: false,
	// how many threads the engine searches with; null means "pick for this
	// machine" (engine.js startThreads), and a count is capped to its cores
	engineThreads: null,
	// how deep the repertoire audit searches each position (audit.js DEPTHS)
	auditDepth: 12,
});

const store = () => {
	try {
		return globalThis.localStorage || null;
	} catch {
		return null;
	}
};

function readRaw() {
	const s = store();
	if (!s) return {};
	try {
		const d = JSON.parse(s.getItem(KEY));
		return d && typeof d === "object" && !Array.isArray(d) ? d : {};
	} catch {
		return {};
	}
}

// A width worth restoring: a finite number, clamped to what the drag handle
// itself allows at its widest.
export function cleanWidth(w) {
	if (typeof w !== "number" || !Number.isFinite(w)) return null;
	return Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, w)));
}

function cleanLast(l) {
	if (!l || typeof l !== "object" || typeof l.id !== "string" || !l.id) return null;
	return {
		id: l.id,
		mode: l.mode === "analysis" ? "analysis" : "report",
		// the board is a packScratch() object; analysis.js's unpackScratch
		// replays it and trusts nothing, so it is carried as-is here
		board: l.board && typeof l.board === "object" ? l.board : null,
	};
}

// The stored preferences, every field present and valid.
export function loadPrefs() {
	const d = readRaw();
	return {
		orientation: d.orientation === "black" ? "black" : DEFAULTS.orientation,
		sideWidth: cleanWidth(d.sideWidth) ?? DEFAULTS.sideWidth,
		restore: typeof d.restore === "boolean" ? d.restore : DEFAULTS.restore,
		last: cleanLast(d.last) ?? DEFAULTS.last,
		wbCollapsed: typeof d.wbCollapsed === "boolean" ? d.wbCollapsed : DEFAULTS.wbCollapsed,
		engineThreads:
			Number.isInteger(d.engineThreads) && d.engineThreads >= 1 && d.engineThreads <= 256
				? d.engineThreads
				: DEFAULTS.engineThreads,
		auditDepth: [12, 14, 16].includes(d.auditDepth) ? d.auditDepth : DEFAULTS.auditDepth,
	};
}

// Merge `patch` into what is stored. Returns false when storage refused.
export function savePrefs(patch) {
	const s = store();
	if (!s) return false;
	const next = { ...loadPrefs(), ...patch };
	try {
		s.setItem(KEY, JSON.stringify(next));
		return true;
	} catch {
		return false;
	}
}

// Forget every preference, the theme included.
export function clearPrefs() {
	const s = store();
	if (!s) return;
	try {
		s.removeItem(KEY);
		s.removeItem(THEME_KEY);
	} catch {}
}

export function loadTheme() {
	const s = store();
	try {
		const t = s && s.getItem(THEME_KEY);
		return t === "dark" || t === "light" ? t : null;
	} catch {
		return null;
	}
}

export function saveTheme(t) {
	const s = store();
	if (!s) return;
	try {
		s.setItem(THEME_KEY, t === "dark" ? "dark" : "light");
	} catch {}
}

// ---- the workbook the viewer was on
//
// Only a workbook saved in this browser can be reopened: one loaded from a
// PGN or a file and never saved has nothing to reopen from, so an id of null
// clears the record rather than pointing at the wrong workbook.

export function rememberWorkbook(id, { mode = "report", board = null } = {}) {
	return savePrefs({ last: id ? cleanLast({ id, mode, board }) : null });
}

// The workbook to reopen on start, or null: nothing recorded, restoring
// turned off, or the workbook since deleted (`exists` says which ids are
// still in the store).
export function workbookToRestore(exists) {
	const p = loadPrefs();
	if (!p.restore || !p.last) return null;
	return exists(p.last.id) ? p.last : null;
}
