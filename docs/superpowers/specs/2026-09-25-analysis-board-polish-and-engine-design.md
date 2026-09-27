# Analysis board polish, empty-notebook start, and local engine — design

Status: implemented 2026-09-25. Covers sub-projects **C** (empty-notebook
start) and **D** (engine eval) from the analysis-board design, plus a
usability pass over **A**.

## Usability pass on the board (A)

What made the first version hard to use, and what replaced it:

| Problem | Change |
|---|---|
| No sign of the last move or a check | `positionOf(s)` returns last move, checked king, side to move and game-over reason; the board highlights them and a status line names them |
| Legal targets shown only as a colour change | dots on empty targets, rings on captures |
| Mouse only | touch drag and tap-tap on the same `down`/`up` logic; `touch-action: none` on the board |
| No way to cut a line short | **✂ Delete from here** (`truncate`); a cut line that becomes a prefix of another is merged into it |
| Deletes were final | one-level **Undo** (`checkpoint`/`undo`) for delete, cut and New board |
| Flat list repeated shared moves | moves a line shares with a line above are drawn faintly (`sharedPrefix`) |
| No order to lines | ↑/↓ reorder (`moveLine`); the first line is the trunk of the copied PGN |
| Add refused with no warning | lines the notebook holds are badged *in notebook* (`inNotebook`) |
| Reopening the board wiped it | the toolbar reopens the same scratch; *Analyse from here* selects or adds a line in it (`seedLine`) |
| No way out of the app with a position | **Copy FEN**, **Copy PGN** (`scratchPgn`, via `buildPgn`) |
| Narrow 400px window | two columns (board / everything else), stacking under 760px; the board SVG scales |
| Few keys | Home/End, ↑/↓ between lines at the same move, F flip, E engine, Space best move |

## Empty-notebook start (C)

The import screen offers **Start from a board**. `viewRoot` draws the
overlay over the import panel too. `commitLine` into an empty notebook makes
the line the mainline (`isMain`, named "Mainline", no tag) — exactly the shape
`collectLines` gives an imported PGN's first line — and regenerates the PGN,
so the notebook that opens is an ordinary one.

## Engine (D)

**Choice.** Stockfish 19 *lite, single-threaded* WebAssembly build from the
`stockfish` npm package, vendored under `vendor/stockfish/` (21 KB JS +
1.8 MB wasm; first shipped as Stockfish 18 at 7.3 MB). Single-threaded because multi-threaded WASM needs
cross-origin-isolation headers that GitHub Pages cannot send. Vendored rather
than loaded from a CDN because a Worker must be same-origin and the build
locates its `.wasm` next to its own script. Loaded only when the engine is
first switched on. GPL-3.0, run as a separate program over UCI; noted in
`THIRD-PARTY-NOTICES.md`.

**`src/engine.js`.** Pure helpers (`parseInfo`, `uciToSan`, `whiteScore`,
`formatScore`, `whiteShare`, `numberedFrom`) and a controller
`createEngine(makeWorker, opts)`:

- One search at a time. A new position sends `stop` and waits for that
  search's `bestmove` before `position`/`go` for the next, so a stopped
  search's trailing output is never attributed to the new position.
- Scores are converted to White's side; PVs to SAN. Lines at a new depth
  replace the list; bound (aspiration) scores are ignored.
- **Cache.** Every result is kept per FEN (LRU, 2000 entries). Returning to a
  position shows the cached lines at once; the new search's output is held
  back until it passes the cached depth; a position already searched to the
  target depth is not searched again. Stockfish's hash table (64 MB) is kept
  across searches (no `ucinewgame`), so re-searching through known depths is
  fast. Changing the number of lines clears the cache (a different result).
- Depth setting (16–30 or unlimited), **Go deeper** (one unlimited search of
  the current position), pause on window close, error reporting.

**View.** The panel is rebuilt on every scratch change, but engine output is
not a scratch change: the panel installs `engine.onUpdate`, which repaints
the engine box, eval bar and arrows in place. That keeps typing a note and
dragging a piece undisturbed by a running search.

## Full-strength build

Stockfish 19's full single-threaded build (same program, full-size network)
is a 99 MB `.wasm` — too big for the repository (GitHub warns past 50 MB and
refuses 100 MB) and for a page load. Only its 21 KB loader is vendored.

- `engine-store.js` downloads the `.wasm` on request from unpkg, falling back
  to jsDelivr, streaming for a progress bar and checking the `\0asm` magic
  before storing it in IndexedDB. A user-picked file is accepted the same way,
  for networks that block both mirrors.
- The loader reads its `.wasm` URL from its own hash, so the stored blob is
  handed over as a `blob:` URL and later visits make no network request.
- `engine-flavor.js` owns the lite/full choice, the download box's state and
  a `localStorage` preference; `engine.swap(factory)` ends the old worker,
  clears the eval cache (different engine, different results) and picks up
  the position on the new one.

Verified in headless Chromium (mirror requests redirected to a local copy,
since the dev container cannot reach the CDNs): one download, then after a
reload the full engine started from IndexedDB with no fetch. The full build
reached depth 18 from the start position in 0.4 s on ~113k nodes. Whether
unpkg/jsDelivr serve a 99 MB file from a 160 MB package is unverified here;
the manual-file path covers the case that they do not.

## Testing

Engine controller tested against a fake UCI worker (handshake, sequencing,
cache hits/resume/eviction, depth and line changes, errors, throttling). The
real engine was checked in headless Chromium: depth ~19 in 3 s at ~850k
nodes/s on the dev container.
