# Study view

## Goal

Read a workbook as a study: step through its lines on a board with the notes
written out clearly beside the moves, and run the engine, with none of the
workbook editing the analysis board carries.

## Shape

- A window over the report, opened from **Study** in the toolbar (at the start
  of the mainline) or **Study from here** in the table's context menu (after
  that move). Closed with ✕, Escape or the backdrop, like the analysis board.
- Its state (`study.js`) has the analysis scratch's shape (`lines`, `active`,
  `at`, `flipped`), built from the workbook's visible lines, each a copy of the
  moves with `src` pointing at the workbook line. Every stepping primitive in
  `analysis.js` works on it unchanged.
- It is rebuilt from the workbook on every open and never saved. The workbook
  cannot change while it is open, so the note numbering is computed once at
  open rather than on every step.
- The board, the eval bar, the nav row, the typed-move box, the help dialog and
  the engine box are the analysis board's own, moved into shared functions
  (`boardRow`, `navRow`, `moveBox`, `helpDialog` in `analysis-view.js`;
  `engineBox` in `engine-view.js`). The engine box no longer knows about the
  scratch: the caller says what playing an engine line does, and only the
  analysis board passes `noteEval`.

## Notes

The numbers are the table's: `numberNotes` over the visible lines, so a `[n]`
in the study is the `[n]` in the table, the Notes list and print (reading order
along each line).

- A numbered note is about a move, so it shows on every line that plays the
  same moves up to it (a note several lines carry is numbered once, against its
  first owner; a line that carries it too still shows it).
- A footnote's `[n]` shows on the move it is an alternative to, as in the table.
- On a footnote line itself, the heading says which footnote it is, and its
  lettered sub-notes come from its path down the footnote's tree.

The note on the move just played is shown large above the move list; every note
along the line is listed below, the current one marked and later ones greyed.

## Moves off the book

A move no workbook line plays from the position starts a line of the reader's
own (`off`), remembering the book line it left and where. It is marked as such
with a **Back to the book** button (key **B**). Nothing is written anywhere.

## Not in this version

- A repertoire drill (hide the next book move, ask the reader to find it) would
  build on this state.
- Remembering the study's position across visits.
