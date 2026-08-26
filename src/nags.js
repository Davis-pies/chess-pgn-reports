// The one NAG (Numeric Annotation Glyph) table, read by the PGN exporter
// (symbol -> $code) and by the line editor's symbol palette (which entries to
// offer, and how to group them). Keeping both readers on one table is what
// stops the palette from offering a symbol the exporter cannot encode.
//
// Contents: every standard NAG from $1 to $139 that carries a typographic
// symbol, plus the four symbol-less move assessments ($8, $9, $11, $12) that
// the palette shows by label, plus $140 (with the idea) and $146 (novelty),
// which are ChessPad extensions in wide enough use to be worth keeping.
//
// `group` is the PGN spec's own classification: $1-$9 move assessments,
// $10-$135 positional assessments, $136-$139 time pressure.
// `common` marks the entries the palette shows without opening its drawer.
//
// Eight glyphs come in White/Black pairs sharing one symbol ($22/$23 zugzwang,
// both "⨀", and likewise ○ ⟳ ↑ → ⯹ ⇆ ⨁). The glyph is side-neutral in notation
// -- Informant writes the same mark for either player and leaves the side to
// the position -- so `neutral` carries the label the palette shows, and `side`
// says which half of the pair a code is.
//
// A MARK therefore stores the code, not the glyph: "$23", not "⨀". Storing the
// glyph threw the side away on import, and nagFor could then only guess the
// first (White) code back -- so an imported "$23 Black in zugzwang" exported as
// "$22 White in zugzwang", rewriting somebody else's analysis. See markSym /
// markNag below.
export const NAGS = [
	{ code: 1, sym: "!", label: "good move", group: "move", common: true },
	{ code: 2, sym: "?", label: "mistake", group: "move", common: true },
	{ code: 3, sym: "!!", label: "brilliant move", group: "move", common: true },
	{ code: 4, sym: "??", label: "blunder", group: "move", common: true },
	{ code: 5, sym: "!?", label: "interesting move", group: "move", common: true },
	{ code: 6, sym: "?!", label: "dubious move", group: "move", common: true },
	{ code: 7, sym: "□", label: "only move", group: "move", common: true },
	{ code: 8, sym: "", label: "singular move", group: "move" },
	{ code: 9, sym: "", label: "worst move", group: "move" },
	{ code: 10, sym: "=", label: "equal", group: "position", common: true },
	{ code: 11, sym: "", label: "equal chances, quiet", group: "position" },
	{ code: 12, sym: "", label: "equal chances, active", group: "position" },
	{ code: 13, sym: "∞", label: "unclear", group: "position", common: true },
	{ code: 14, sym: "⩲", label: "White slightly better", group: "position", common: true },
	{ code: 15, sym: "⩱", label: "Black slightly better", group: "position", common: true },
	{ code: 16, sym: "±", label: "White clearly better", group: "position", common: true },
	{ code: 17, sym: "∓", label: "Black clearly better", group: "position", common: true },
	{ code: 18, sym: "+−", label: "White winning", group: "position", common: true },
	{ code: 19, sym: "−+", label: "Black winning", group: "position", common: true },
	{ code: 22, sym: "⨀", label: "White in zugzwang", group: "position", neutral: "zugzwang", side: "w" },
	{ code: 23, sym: "⨀", label: "Black in zugzwang", group: "position", neutral: "zugzwang", side: "b" },
	{ code: 26, sym: "○", label: "White has space", group: "position", neutral: "space advantage", side: "w" },
	{ code: 27, sym: "○", label: "Black has space", group: "position", neutral: "space advantage", side: "b" },
	{ code: 32, sym: "⟳", label: "White ahead in development", group: "position", neutral: "lead in development", side: "w" },
	{ code: 33, sym: "⟳", label: "Black ahead in development", group: "position", neutral: "lead in development", side: "b" },
	{ code: 36, sym: "↑", label: "White has the initiative", group: "position", neutral: "the initiative", side: "w" },
	{ code: 37, sym: "↑", label: "Black has the initiative", group: "position", neutral: "the initiative", side: "b" },
	{ code: 40, sym: "→", label: "White has the attack", group: "position", neutral: "with an attack", side: "w" },
	{ code: 41, sym: "→", label: "Black has the attack", group: "position", neutral: "with an attack", side: "b" },
	{ code: 44, sym: "⯹", label: "White has compensation", group: "position", neutral: "compensation", side: "w" },
	{ code: 45, sym: "⯹", label: "Black has compensation", group: "position", neutral: "compensation", side: "b" },
	{ code: 132, sym: "⇆", label: "White has counterplay", group: "position", neutral: "counterplay", side: "w" },
	{ code: 133, sym: "⇆", label: "Black has counterplay", group: "position", neutral: "counterplay", side: "b" },
	{ code: 136, sym: "", label: "White in moderate time trouble", group: "time", neutral: "moderate time trouble", side: "w" },
	{ code: 137, sym: "", label: "Black in moderate time trouble", group: "time", neutral: "moderate time trouble", side: "b" },
	{ code: 138, sym: "⨁", label: "White in severe time trouble", group: "time", neutral: "severe time trouble", side: "w" },
	{ code: 139, sym: "⨁", label: "Black in severe time trouble", group: "time", neutral: "severe time trouble", side: "b" },
	{ code: 140, sym: "△", label: "with the idea", group: "position", common: true },
	{ code: 146, sym: "N", label: "novelty", group: "position", common: true },
];

// Older palette spellings that mean an existing glyph. Kept so notebooks saved
// before the table existed still export their marks.
const ALIASES = { "+=": "⩲", "=+": "⩱" };

const BY_SYM = new Map();
const BY_CODE = new Map();
for (const n of NAGS) {
	BY_CODE.set(n.code, n.sym);
	if (n.sym && !BY_SYM.has(n.sym)) BY_SYM.set(n.sym, n.code);
}

// The White/Black halves of a shared glyph, by symbol.
const PAIRED = new Map();
for (const n of NAGS) {
	if (!n.sym || !n.side) continue;
	const p = PAIRED.get(n.sym) || {};
	p[n.side] = n.code;
	PAIRED.set(n.sym, p);
}

// Symbol -> NAG code, or undefined when the symbol has no standard code (the
// caller then falls back to writing the symbol into a {comment}).
//
// `ply` picks the half of a paired glyph: a mark set on a Black move takes the
// Black code. That is a GUESS -- "White has the attack" is an ordinary thing to
// write after Black's move -- but it only ever applies to a mark set in this
// app, where the glyph on screen names no side and so nothing on screen is
// wrong. A mark read from a PGN keeps its own code and never comes through
// here. Without a ply, the White half, which is what a bare glyph meant before
// marks carried codes.
export function nagFor(sym, ply) {
	if (!sym) return undefined;
	const key = ALIASES[sym] || sym;
	const pair = PAIRED.get(key);
	if (pair && ply != null && ply % 2 === 1) return pair.b;
	return BY_SYM.get(key);
}

// A stored mark: "$23" for anything with a NAG code, otherwise the string
// itself ("TN" has no code). Kept a string so the marks map stays homogeneous.
export function markOf(codeOrSym) {
	return typeof codeOrSym === "number" ? "$" + codeOrSym : codeOrSym;
}

const CODED = /^\$(\d+)$/;

// A stored mark -> the glyph to display. Every view goes through this, so no
// renderer has to know marks are coded. A legacy glyph (a notebook saved before
// marks carried codes, or "TN", which has no code) passes through unchanged.
export function markSym(mark) {
	if (!mark) return "";
	const m = CODED.exec(mark);
	if (!m) return mark;
	return BY_CODE.get(Number(m[1])) || "";
}

// A stored mark -> the NAG code to export, or undefined for a mark with no
// standard code. The legacy branch keeps an un-migrated glyph exporting as it
// always did rather than degrading to a {comment}.
export function markNag(mark, ply) {
	if (!mark) return undefined;
	const m = CODED.exec(mark);
	return m ? Number(m[1]) : nagFor(mark, ply);
}

// Convert a marks map that may hold bare glyphs into coded marks. Lossy for the
// eight paired glyphs in exactly the way the app already was -- it cannot
// recover a side the glyph never held -- but it converges the data, and every
// mark set afterwards is exact.
export function migrateMarks(marks) {
	const out = {};
	for (const [ply, mark] of Object.entries(marks || {})) {
		if (!mark) continue;
		out[ply] = CODED.test(mark) ? mark : markOf(nagFor(mark, Number(ply)) ?? mark);
	}
	return out;
}

// NAG code -> symbol, or "" for a code we know but that has no glyph, or
// undefined for a code outside the table.
export function symFor(code) {
	return BY_CODE.get(code);
}
