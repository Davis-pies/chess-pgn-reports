# Repertoire audit

## Goal

An engine sweep of every line in the workbook that runs in the background
while the app stays in use, with progress and findings showing as they come.

## Is it practical on a big workbook?

Lines share their opening moves, so the work is counted in unique positions.
The synthetic 800-line workbook `npm run bench` uses (30 plies past each
branch point) has 36,156 moves but 15,682 unique positions; 200 lines, 4,006;
50 lines, 1,016.

Stockfish 19 lite in Chromium, on a 4-core cloud machine (slower per core
than a typical laptop), 120 positions sampled from the 800-line workbook:

| Depth | 1 engine, per position | 1 engine, 3 threads | 3 single-threaded engines |
| ----- | ---------------------- | ------------------- | ------------------------- |
| 10    | 16 ms                  |                     |                           |
| 12    | 41 ms                  | 59 ms               | 16 ms                     |
| 14    | 133 ms                 |                     | 52-60 ms                  |

End to end in the app at depth 12 with three engines: 200 lines in 72 s,
800 lines in 269 s, with the longest main-thread task under 300 ms (the
start) and the study opened and stepped mid-run.

## Design

- **Unique positions.** `auditPositions` walks every line once, keys each
  position by its FEN without the move counters (so transpositions merge),
  and orders them by the ply they are first reached: the shared trunk is
  searched first and findings fill in from the top of the tree.
- **Its own engines.** A pool of single-threaded lite workers, apart from the
  board's engine: N independent positions on N engines beat one engine on N
  threads by 3.5x, they need no cross-origin isolation, and the board's
  engine stays free. The viewer picks how many, up to one per logical core
  (`maxAuditWorkers`); it starts at one per core but one, at most four
  (`auditWorkers`), since each is its own copy of Stockfish in memory. Kept
  in `prefs.js` as `auditEngines`. Each gets a 16 MB hash. The pool is
  started for a run and shut when it ends.
- **Lite or full.** Lite by default. Full is offered (`auditFlavor`) and runs
  from the copy `engine-store.js` keeps; each full engine is its own ~100 MB,
  so the panel's status says which build runs. Their evals are kept apart
  (store keys `full|<position>`; lite keeps the bare position).
- **Your side.** `auditSide` is white, black or both. Only that side's moves
  are graded; the opponent's slips are theirs, not a flaw in the
  repertoire. Every position is still searched, since the opponent's moves
  lead to the reader's.
- **Fixed depth.** Every position to the same depth, any from 1 to 40 typed
  by the viewer (16 to start; Davis found 12-14 too shallow), kept in
  `prefs.js` as `auditDepth`, so one move's eval can be set against the next
  and a result can be reused. One engine took 644 ms a position at depth 16
  on the machine above.
- **Judging a move.** From the evals of the positions before and after it,
  as the mover's share of the win chances (`whiteShare`, the lichess curve).
  A drop of 0.05 / 0.10 / 0.15 is an inaccuracy / mistake / blunder (lichess's
  0.1 / 0.2 / 0.3 on a -1..1 scale). A move that is the engine's own best is
  never a finding. Null moves are not judged; a mated or stalemated position
  is judged without the engine.
- **One finding per move.** A move several lines share is reported once,
  naming every line through it in the table's column order.
- **Kept by position.** Evals go to IndexedDB (`audit-store.js`) keyed by
  position; a deeper eval replaces a shallower one. A reload, another
  workbook, or a re-run after an edit searches only what is new.
- **The report is derived.** `auditReport(lines, evals, depth, order)` is a
  pure function of the workbook as it stands, so it never shows a line the
  workbook no longer has. Line walks and the engine's move as SAN are cached
  so it costs ~35 ms on 800 lines.

## UI

- **Toolbar chip** "Audit", showing "Audit 42%" while a run goes on. It
  shows and hides the panel.
- **Panel** at the top of the report's right-hand column: the status line
  (positions done of total, depth, a time to go from the pace so far), a
  progress bar, a Depth box, an engines menu, Run audit / Stop / Continue (n left), and ✕ (hides the
  panel; a run goes on).
- **Findings**, worst first then by line and ply: symbol, move, eval before
  → after, the engine's move, the lines, and **Study** at the position the
  move was played from. Inaccuracies and anything past 50 rows are behind a
  button. Under them, folded, **Where each line ends** with each line's final
  eval.
- Nothing redraws the page: the chip and panel refill in place on the
  audit's updates (at most one a second), and the findings list is rebuilt
  only when the findings change.
- A run started for a workbook since closed is stopped; lines added while it
  runs join it.

## Into the workbook

Added after the first review (Davis: see the eval at every move, and an easy
way to keep evals as notes and the suggested symbols).

- **Evals in the table**, a remembered preference (prefs.js `auditInTable`):
  the eval of the position after each move, White's side, under the move in
  the screen table. The table is redrawn from the audit at most every five
  seconds during a run and once when it stops; a redraw is slower than the
  progress bar and closes a menu open on the table.
- **Per finding**: its grade's symbol and a Note, each a toggle. **Per line
  end**: the assessment its eval suggests (= under 0.35, ⩲/⩱ under 0.9,
  ±/∓ under 2, +−/−+ beyond or on mate) and a Note on the last move.
- **Bulk**: Add symbols / Add notes for every listed finding, Add
  assessments / Add notes for every line end. Bulk symbols never overwrite
  a symbol or assessment the reader set.
- Notes read "Stockfish: before → after (depth d), best m" ("Stockfish
  (full)" for the full build). A note starting "Stockfish" on the same move
  is replaced, so a second run's verdict does not stack on the first.
- Writes go through line-editor.js `setMark` and `putNote`, the symbol
  palette's own path. A finding names its move's ply on each line
  (`plies`), since a transposition reaches the same move at another ply.
- Notes go on findings and line ends only, not on every move: a note per
  move would bury the reader's own notes in the Notes list.
