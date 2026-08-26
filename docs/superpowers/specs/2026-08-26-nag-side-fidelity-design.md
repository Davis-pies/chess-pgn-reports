# NAG Side Fidelity — Design

**Goal:** Stop the app flipping White/Black on the eight annotation symbols
whose glyph does not encode a side, and let a reader choose the side when
setting one.

---

## 1. The bug

Importing a PGN and exporting it back changes what it says. Audited over every
NAG in `nags.js` that carries a glyph:

```
NAGs with a glyph: 33 | round-trip WRONG: 8
  $23 (⨀ Black in zugzwang)             -> $22 (White in zugzwang)
  $27 (○ Black has space)               -> $26
  $33 (⟳ Black ahead in development)    -> $32
  $37 (↑ Black has the initiative)      -> $36
  $41 (→ Black has the attack)          -> $40
  $45 (⯹ Black has compensation)        -> $44
  $133 (⇆ Black has counterplay)        -> $132
  $139 (⨁ Black in severe time trouble) -> $138
```

The other 25 are exact. The split is clean: **every pair with its own glyph
already works; every pair sharing a glyph is broken.** `⩲/⩱`, `±/∓`, `+−/−+`
each carry the side in the glyph, so nothing is lost. The eight above are
side-neutral in notation — [Wikipedia's list][w] gives `⊙ ○ ↻ ↑ → ⯹ ⇄ ⊕` with
no side at all, exactly as Informant uses them.

[w]: https://en.wikipedia.org/wiki/Chess_annotation_symbols

## 2. Where it is lost

`marks[ply]` stores a **display glyph**, and the glyph cannot say which side.
The loss happens on the way IN, not out:

- `chainToMarks` in `tree.js:19` reads `$23`, calls `symFor(23)` → `"⨀"`, and
  stores that. The 23 is gone before anything else runs.
- `pgn-out.js:194` then calls `nagFor("⨀")`, which can only return the first
  code of the pair — `22`.

`nags.js` already documents this ("nagFor returns the FIRST (White) code"). It
was written as an accepted asymmetry of a symbol-keyed palette. It is not
acceptable for imported data: it rewrites an assertion about Black into one
about White, silently, in a file the user may pass on.

## 3. Marks carry the NAG, not the glyph

`marks[ply]` stays a string and becomes `"$23"` for anything with a NAG code.
Not a number, so the map stays homogeneous: `"TN"` has no code and stays
literal, and so does any legacy glyph.

- **Import** (`chainToMarks`) stores `"$" + code` — the first code in the move's
  NAG list that our table knows.
- **Export** (`pgn-out.js`) reads the code straight out of `"$n"`. No lookup, so
  nothing can be lost.
- **Palette** writes `"$" + code` for the button that was clicked.
- **Rendering** resolves through one function, so no renderer parses `$`.

### Legacy marks

A saved notebook holds bare glyphs. They are migrated on load, not left to rot
in two representations: `store.js` maps each glyph through `nagFor` to `"$n"`.
That migration is lossy for the eight in exactly the way the app already was —
it cannot recover a side the glyph never held — but it converges the data, and
every mark set from then on is exact. A glyph with no code (`"TN"`) is left
alone.

## 4. One resolver

`nags.js` gains:

```js
markSym(mark)   // "$23" -> "⨀";  "TN" -> "TN";  "" -> ""
markNag(mark)   // "$23" -> 23;   "TN" -> undefined;  "⨀" -> 22 (legacy)
```

Every renderer goes through `markSym`. The call sites are known:
`render.js` (×5: `markEl` twice, card and print move text ×3), `table.js`
(`cells[ply].mark`), `line-editor.js` (`moveStrip`), `export.js` via the grid,
`foot-nodes.js` (copies the raw mark, needs no change).

`markNag` has the legacy branch so an un-migrated mark — one that reached a
renderer before `store.js` touched it — still exports as it does today rather
than as a literal `"⨀"` comment.

## 5. Picking the side

The palette shows **both halves of the eight pairs**, adjacent, with a `w`/`b`
superscript on the button only:

```
… ⨀ʷ ⨀ᵇ  ○ʷ ○ᵇ  ⟳ʷ ⟳ᵇ  ↑ʷ ↑ᵇ  →ʷ →ᵇ  ⯹ʷ ⯹ᵇ  ⇆ʷ ⇆ᵇ  ⨁ʷ ⨁ᵇ  △ N TN ✕
```

35 buttons rather than 27 — about four rows where there were three. The badge is
a `<sup>` element, not a modifier-letter codepoint, so it cannot fall back to
tofu in a font that lacks one.

**The badge is on the button, never on the mark.** The table, the cards, the
printed report and the PGN all show the bare glyph, because that is the
notation. The side lives in the stored code, which is where PGN keeps it.

Labels stay side-specific ("Black has the initiative"), because now they are
true. The 25 unpaired symbols get one button each, unchanged.

`symbolRow`'s dedupe by glyph goes away — it is what collapsed each pair to its
White half in the first place. Dedupe is now by CODE, which changes nothing for
the 25 and is what surfaces the 8.

## 6. Testing

- **`tests/nags.test.mjs`** — `markSym`/`markNag` over `"$n"`, `"TN"`, a legacy
  glyph and `""`; every glyph-bearing NAG survives `markNag(markOf(code))`.
- **`tests/pgn-out.test.mjs`** — the audit above as a test: every one of the 33
  glyph NAGs round-trips to its own code, the eight included.
- **`tests/store.test.mjs`** — a notebook saved with legacy glyph marks loads
  as `"$n"`; `"TN"` is left alone.
- **`tests/line-editor.test.mjs`** — the palette offers both halves of a pair;
  clicking the Black half stores the Black code; the table renders the bare
  glyph for both.
- **`tests/table-menu.test.mjs`** — the menu's palette is the same one, so the
  side survives an edit made from the table.

## 7. Out of scope

- The glyph variants Wikipedia lists differently from `nags.js` (`⇄` vs `⇆`,
  `⊕` vs `⨁`, `↻` vs `⟳`). Both spellings are in use; with marks keyed by code
  the glyph becomes a rendering detail that can be changed later without
  touching stored data.
- Symbols we do not carry at all (`⌓` better move available, `∇` countering).
- Dropping NAGs for a free-form symbol set. Considered and rejected: NAG codes
  are what other software reads, and the round-trip fidelity being fixed here
  is the whole reason to keep them.
