# Chess Opening Theory Table Builder

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
   Footnotes are pulled out of the table into the prose **Footnotes** section.
3. **Render** — a table in **vertical** or **horizontal** layout, or a linear
   **card** view (each line with a board diagram of its end position) for print.
   Boards are self-contained SVG, fixed colors so they stay visible on both
   light and dark themes; a theme toggle is in the toolbar. Comment moves carry
   numbered `[n]` markers (appearing only on the line that owns them).
4. **Export** — **Export PGN** (editable chess notation for any chess app),
   **Export Markdown** (paste into Google Docs/Word), or **Print → Save as
   PDF** (always the linear card view). Saved workbooks (`localStorage`) are
   listed under **My saved workbooks** on the import screen to reopen/delete.

## Run locally

```bash
npm install        # dev-only: jsdom for tests, chess.js for parsing
python3 -m http.server  # serve the folder (ES modules need http, not file://)
# open http://localhost:8000
```

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
| `src/store.js` | `localStorage` notebook persistence |
| `src/app.js` | browser glue: import, tag buttons, orientation toggle, print |

A variation's first move is an **alternative at the same ply** as the move it
replaces (standard PGN `(1... e5)` semantics).
