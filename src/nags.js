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
// Several positional glyphs come in White/Black pairs sharing one symbol (e.g.
// $22/$23 zugzwang, both "⨀"). Going code -> symbol is exact; going symbol ->
// code cannot distinguish the pair, so nagFor returns the FIRST (White) code
// of the pair. The editor's palette is symbol-based, so that asymmetry is what
// the UI can express; a paired code read from an imported file still renders
// as the right glyph.
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
	{ code: 22, sym: "⨀", label: "White in zugzwang", group: "position" },
	{ code: 23, sym: "⨀", label: "Black in zugzwang", group: "position" },
	{ code: 26, sym: "○", label: "White has space", group: "position" },
	{ code: 27, sym: "○", label: "Black has space", group: "position" },
	{ code: 32, sym: "⟳", label: "White ahead in development", group: "position" },
	{ code: 33, sym: "⟳", label: "Black ahead in development", group: "position" },
	{ code: 36, sym: "↑", label: "White has the initiative", group: "position" },
	{ code: 37, sym: "↑", label: "Black has the initiative", group: "position" },
	{ code: 40, sym: "→", label: "White has the attack", group: "position" },
	{ code: 41, sym: "→", label: "Black has the attack", group: "position" },
	{ code: 44, sym: "⯹", label: "White has compensation", group: "position" },
	{ code: 45, sym: "⯹", label: "Black has compensation", group: "position" },
	{ code: 132, sym: "⇆", label: "White has counterplay", group: "position" },
	{ code: 133, sym: "⇆", label: "Black has counterplay", group: "position" },
	{ code: 136, sym: "", label: "White in moderate time trouble", group: "time" },
	{ code: 137, sym: "", label: "Black in moderate time trouble", group: "time" },
	{ code: 138, sym: "⨁", label: "White in severe time trouble", group: "time" },
	{ code: 139, sym: "⨁", label: "Black in severe time trouble", group: "time" },
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

// Symbol -> NAG code, or undefined when the symbol has no standard code (the
// caller then falls back to writing the symbol into a {comment}).
export function nagFor(sym) {
	if (!sym) return undefined;
	return BY_SYM.get(ALIASES[sym] || sym);
}

// NAG code -> symbol, or "" for a code we know but that has no glyph, or
// undefined for a code outside the table.
export function symFor(code) {
	return BY_CODE.get(code);
}
