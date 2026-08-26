# Chess Opening Theory Table Builder

**[Open the app →](https://davis-pies.github.io/chess-pgn-reports/)**

Turn a chess PGN into a printable **opening theory table** in the style of
ECO / MCO / Nunn's Chess Openings. This is a static site (no backend, no
accounts). Your notebooks are saved in your own browser's `localStorage`.

## What it does

1. **Import** — paste PGN or drop a `.pgn` file. Parenthesized variations
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
3. **Render** — a table in **vertical** or **horizontal** layout, or a linear
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
   **Right-clicking** a move opens a menu for it: the symbol picker and note
   editor for that move, then Make mainline, Move to footnote, Focus and Hide
   for its line — the same controls as the editor panel, running the same code,
   so an edit made either way is the same edit. Right-clicking a group's own
   column offers those line actions over every line under it. Line headers carry
   a **⋮** for the same menu without a move, and right-clicking any header — a
   line's or a group's — opens the same thing. Right-click never folds. The
   table's own controls row carries **Hide all** / **Show all** beside Expand
   all / Collapse all. A trace is a
   reading aid: it isn't saved with the notebook, and a group folding over the
   traced line simply stops showing it rather than going stale. The printed
   report is unaffected by any of this — it shows every line's full divergence,
   ungrouped, with no shading, folds or trace.
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
   glyph on one row. Typing a note and pressing **Enter** saves it, in the
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
| `src/render.js` | grid -> DOM table (vertical/horizontal) + SVG board diagrams from FEN |
| `src/notes-view.js` | the on-screen Notes list, grouped into collapsible `<details>` |
| `src/store.js` | `localStorage` notebook persistence |
| `src/app.js` | browser glue: import, tag buttons, orientation toggle, print |

A variation's first move is an **alternative at the same ply** as the move it
replaces (standard PGN `(1... e5)` semantics).

## License

The project's own source is released under the [MIT](LICENSE) license.

The chess piece graphics in `assets/pieces.svg` are third-party work by
Wikimedia Commons user *Cburnett*, used under the BSD 3-clause license. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for the full text and
attribution.
