# Chess Opening Theory Table Builder

**[Open the app →](https://davis-pies.github.io/chess-pgn-reports/)**

Turn a chess PGN into a printable **opening theory table** in the style of
ECO / MCO / Nunn's Chess Openings. This is a static site (no backend, no
accounts). Your notebooks are saved in your own browser's `localStorage`.

## What it does

1. **Import** — paste PGN and press **Load & Tag**, or use **Load PGN file**
   / **Load Workbook file** to open one from disk. Parenthesized variations
   `(...)` are parsed into separate taggable lines; PGN `{...}` comments are
   captured as numbered **Notes**.
2. **Tag** — the mainline is the reference row. For each other line choose
   **Sideline** or **Footnote** (optionally add a name, evaluation symbol, and a
   note), or use **★ Make mainline** to promote a sideline to the mainline.
   A Footnote line is pulled out of the table; it renders as a numbered entry
   in the **Notes** list instead, anchored by an `[n]` marker on the mainline
   move it replaces, with its own notes nested under it as lettered sub-notes.
   A whole **group** of lines can be one footnote: each group header in the
   editor carries its own **Footnote** chip, and tagging every line under a
   group turns it into a single note — one `[n]` on the parent at the move the
   group replaces, the moves they share stated once, and their branches listed
   inside it. The chip dims when only some of the group's lines are tagged.
3. **Render** — a table (plies down, lines across), or a linear
   **card** view (each table row with a board diagram of its end position) for
   print — footnotes don't get their own card, since they're not a table row.
   Boards use the open-source **cburnett** piece set (white + black) with
   coordinates and spacing, fixed colors so they read on both light and dark
   themes (toggle in the toolbar). Sidelines show only their divergent tail. In the table a multi-line branch
   shows as one collapsed column of the moves its lines share; opening it
   reveals its immediate children — lines and further branches — one level at a
   time, the way the editor's grouped view nests. An open group keeps a column
   of its own showing the shared moves, and clicking it folds that one level;
   its block is shaded so what the fold will take is visible before the click,
   and the lines inside it start where the group's shared moves left off rather
   than repeating them. A note on one of those shared moves is marked on the
   group's own column, which is where the move is shown — open or shut.
   Clicking any move in the table **traces** its line: every cell that makes up
   that line lights up — its opening moves in the Mainline column, the shared
   moves in whatever group columns enclose it, and its own tail — and the rest
   of the table drops back. Clicking a move in a group's own column traces that
   group's stem, the path down to the moves it shares, whether the group is open
   or shut; folding stays on the ▸/▾ header, so clicking a move never reshapes
   the table. Click it again, or **Clear trace**, to stop.
   **Right-clicking** a move opens a menu for it: a board of the position after
   it, the symbol picker and note editor for that move, then Make mainline, Move to footnote, Focus and Hide
   for its line — the same controls as the editor panel, running the same code,
   so an edit made either way is the same edit. Right-clicking a group's own
   column offers the same for its shared move — an edit there reaches every line
   under the group, which is what annotating a shared move has always done — plus
   those line actions over all of them. Line headers carry
   a **⋮** for the same menu without a move, and right-clicking any header — a
   line's or a group's — opens the same thing. Right-click never folds. The
   table's own controls row carries **Hide all** / **Show all** beside Expand
   all / Collapse all. A trace is a
   reading aid: it isn't saved with the notebook, and a group folding over the
   traced line simply stops showing it rather than going stale. The printed
   report groups its lines the same way, so a run of moves two lines share is
   stated once and each picks up where it ends — but it has no column for those
   shared moves. On paper a group's **first line** states the run itself and
   carries straight on into its own moves, and the row of the last shared
   move is marked the way `tree` draws a directory: a run reaching right from
   that move, dropping a tick into each column that continues from it — a tee
   for each, a corner for the last. Groups nested inside a group mark their own
   rows the same way. A line's lead-in cells are left blank on paper — the rules say
   where each column picks up from, so a column of dots said nothing. Without that rule a line's ancestry was unreadable
   — every cell above a line's first move is a bare ellipsis, so a line
   starting on move 7 gave no way to tell which of the two moves on that row it
   followed. Every group is open, since nothing folds on paper, and the
   shading, fold controls, "N lines" counts and trace stay on screen. Column headers carry the name you gave a line, if you gave
   it one, rather than the Sideline tag — every column but the mainline is a
   sideline, so the tag said nothing the reader could not see. Where the table is too wide for a page it is sliced across several,
   and each slice stands on its own: a group spilling onto the next page
   restates its shared moves there, and a line arriving alone spells its whole
   divergence out, so the reader never has to turn back a page to find out how a
   line began.
   Comment moves carry numbered `[n]` markers on the owning line only; a
   footnote's own notes become lettered sub-notes (a, b, c …) under its entry,
   restarting at `a` for each footnote and marked inside its move text — unless
   the note is shared with a non-footnote line, in which case it stays a global
   numbered note the footnote references by its `[n]`. A group footnote nests
   its branches inside the note, indented a level at a time, with labels
   alternating by depth — `[n]`, then letters, then numbers, and so on — and a
   node's own notes taking the first labels before its branches continue the
   sequence. Lines get an
   **evaluation/quality symbol** picker (=, ±, ∓, +=, =+, ∞, !, ?, …), every
   glyph on one row. Eight glyphs (⊙ ○ ⟳ ↑ → ⯹ ⇄ ⊕) are shared by a White and a
   Black NAG, so the picker offers one button and takes the side from the move
   you set it on; a symbol read from an imported PGN keeps whichever side that
   file recorded. Typing a note and pressing **Enter** saves it, in the
   editor and in the table's context menu alike. The
   **Notes** section is editable — add a note at any move, or edit/delete
   existing ones. On screen the Notes list folds: a group footnote and a
   footnote's own notes collapse to a one-line header saying how much is
   nested beneath, with **Expand all** / **Collapse all** beside the heading.
   Everything starts expanded, and the folding is not saved with the notebook.
4. **Export** — **Export PGN** (editable chess notation for any chess app),
   **Export Markdown** (paste into Google Docs/Word), or **Print → Save as
   PDF** (always the linear card view). Saved workbooks (`localStorage`) are
   listed under **My saved workbooks** on the import screen to reopen/delete.
5. **Save and reload as a file** — **Save to file** asks for a name (prefilled
   with the workbook's current one) and writes the whole workbook, PGN and all
   annotations together, to one `.json` you can back up, share or keep in
   version control; the import screen reopens one. It's the same format
   `localStorage` holds, so nothing is lost either way. A file opens with no
   `localStorage` id of its own — pressing **Save** files it as a new entry
   rather than overwriting one.
6. **Update the PGN under your annotations** — **Update PGN…** replaces the
   moves without throwing the markup away. Notes and symbols are re-attached by
   **move path**, so a note on a move several lines share reaches all of them,
   however the new PGN re-cuts the lines around it; a line's own name, tag,
   evaluation and hidden flag go to the line sharing the longest prefix with
   it, so analysis pushed four moves deeper keeps everything it had. It
   **previews first**: how many lines were unchanged, extended, cut short,
   added or removed, and — spelled out, since this part cannot be undone —
   every annotated line and every note the new PGN leaves no home for. Apply
   or cancel. Applying keeps the workbook's name, id and view settings; only
   the moves change.
   **Keep lines the new PGN drops** makes the update purely additive: a line
   the new file no longer plays is carried over whole, with its annotations, so
   nothing can be lost. The pasted text then no longer describes the line set,
   so the workbook's stored PGN is rebuilt from its lines (the same way Export
   PGN builds one) rather than being the file that was pasted.

## Run locally

```bash
npm install    # dev-only: jsdom for tests, chess.js for parsing
npm run dev    # http://127.0.0.1:8000, reloads the page when you save
```

`npm run dev` is `tools/dev-server.mjs`: a dependency-free static server that
injects a live-reload snippet into HTML **responses** — `index.html` on disk
stays exactly what GitHub Pages serves. It watches `src/`, `assets/`,
`index.html` and `style.css`. Pass a port if 8000 is taken: `npm run dev -- 8080`.

It deliberately does not bundle. `index.html` resolves `chess.js` through an
importmap pointing at esm.sh, and a bundling dev server would rewrite that bare
specifier to a `node_modules` path instead — so development would load a
different chess.js from the deployed site. Any plain static server works too
(`python3 -m http.server`), just without the reload.

Tests:

```bash
npm test
```

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Repo → **Settings → Pages**.
3. Under **Build and deployment**, Source: **Deploy from a branch**.
4. Branch: `main`, folder: `/ (root)`. Save.
5. Your site appears at `https://<user>.github.io/<repo>/` within a minute.

Because it's fully client-side, the same URL works on your phone's browser.

## Architecture

| File | Responsibility |
| ------ | ---------------- |
| `src/pgn.js` | tokenize + recursively parse PGN movetext -> variation tree (uses `chess.js` for SAN legality + FEN) |
| `src/tree.js` | flatten the tree into root-to-leaf "lines" (mainline + each variation) |
| `src/table.js` | tagged lines -> a ply-keyed cell grid shared by both layouts |
| `src/group-cols.js` | grid -> grouped columns (a branch's shared moves in a column of their own), shared by the editor's table and the printed one |
| `src/render.js` | grid -> DOM table (vertical/horizontal) + SVG board diagrams from FEN |
| `src/notes-view.js` | the on-screen Notes list, grouped into collapsible `<details>` |
| `src/store.js` | the workbook format: `localStorage` and `.json` file persistence, and re-applying a saved workbook's annotations to freshly parsed lines |
| `src/merge.js` | re-homing a workbook's annotations onto a NEW PGN — move-path matching for notes/symbols, longest-prefix matching for line attributes, plus the report of what could not be carried |
| `src/app.js` | browser glue: import, tag buttons, orientation toggle, print |

A variation's first move is an **alternative at the same ply** as the move it
replaces (standard PGN `(1... e5)` semantics).

## License

The project's own source is released under the [MIT](LICENSE) license.

The chess piece graphics in `assets/pieces.svg` are third-party work by
Wikimedia Commons user *Cburnett*, used under the BSD 3-clause license. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for the full text and
attribution.
