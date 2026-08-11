# Chess Opening Theory Table Builder

Turn a chess PGN into a printable **opening theory table** in the style of
ECO / MCO / Nunn's Chess Openings. This is a static site (no backend, no
accounts). Your notebooks are saved in your own browser's `localStorage`.

## What it does

1. **Import** — paste PGN or drop a `.pgn` file. Parenthesized variations
   `(...)` are parsed into separate taggable lines.
2. **Tag** — for each line (mainline first, then each variation) mark it
   **Main** / **Minor** / **Footnote**, and optionally add a name, an
   evaluation symbol (`=`, `±`, `∞`, ...), and a note.
3. **Render** — a table in either **vertical** (variations as rows, with `…`
   for shared prefix) or **horizontal** (variations as columns) layout. Toggle
   inline SVG board diagrams.
4. **Export** — **Print → Save as PDF**; the print stylesheet keeps only the
   table (and diagrams) so the PDF is clean. Lists named notebooks to reopen,
   edit, and delete.

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
