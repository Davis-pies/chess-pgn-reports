# User guide

A full walkthrough of the app, from importing a PGN to printing the report.
For a shorter overview see the [README](../README.md).

1. **Import** — paste PGN and press **Load & Tag**, or use **Load PGN file**
   / **Load Workbook file** to open one from disk. Parenthesized variations
   `(...)` are parsed into separate taggable lines; PGN `{...}` comments are
   captured as numbered **Notes**. Notes are numbered in reading order: down
   the first column of the table, then down the next, so the notes on a line
   come in sequence as you read it through. The table on screen lays its
   columns out as the printed report does, latest-leaving line first, so the
   numbers run left to right in both.
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
   **No mainline** in the View row drops the concept entirely: every line
   becomes a peer, with no reference column and no elided `…` prefix, and the
   first line is as tag-able, hide-able and footnote-able as any other. Lines
   are still shown grouped by the moves they share, splitting at each point of
   divergence — that structure just comes from the lines themselves rather than
   from a privileged trunk. The setting travels with the notebook, and ticking
   it doesn't forget which line you had promoted, so unticking restores the
   table you had. PGN export is the exception: a `.pgn` has no way to say "no
   mainline", so it keeps writing the first line as the trunk.
3. **Analyse** — **Analysis** in the toolbar opens an interactive board in a
   window over the report (close it with ✕, Esc or a click outside), or
   right-click any move (in the table or the line editor) and choose **Analyse
   from here** to open it at that position; **Analysis** in the toolbar opens
   it at the start. Every notebook line through the position comes onto the
   board, whole and with its notes — from the toolbar, the whole workbook.
   The list then **follows the cursor**: it shows the lines through the
   position on the board, so stepping into a branch leaves the lines that do
   not lead there out of view, and stepping back brings them in again. Lines
   explored on the board are kept the same way. **📌** pins a line in view
   wherever you go, and **show all … on the board** lists every line the
   board holds (click again for only the lines through here); both last until
   the board is closed. Where several lines are listed, each unselected one is
   a single row starting where it leaves the lines above it; the selected one
   is written out in full. The workbook's own lines through the position are
   listed under the board's, under a **Workbook lines** heading; clicking the
   heading folds that list away (▸) and back (▾), and the fold is remembered
   in this browser. The board — its lines, notes, position and
   selection — is saved with the workbook (**Save** and **Save to file**
   alike) and comes back when it is opened, so analysis in progress survives
   a reload. With no PGN at all, **Start from a
   board** on the import screen opens it on the opening position: the first
   line you add becomes the new notebook's mainline, so a repertoire can be
   built from nothing.
   - **Playing** — drag a piece or click it then its square (a finger works
     too). Legal squares are dotted, captures ringed; the last move and a king
     in check are highlighted; a promotion asks for the piece. The status line
     says whose move it is, and names checkmate, stalemate and the draws.
   - **Lines** — diverging from a position you have already visited keeps
     both continuations, so you can build up several lines in one sitting
     without losing the one you came from. Each line's moves repeated from a
     line above are drawn faintly; a line the notebook already holds is
     badged **in notebook**. Playing a move another line already plays from
     the same position follows that line instead of adding a copy of it.
     ↑/↓ reorder lines and **⤒** makes one the first (the trunk of the
     copied PGN), **✎** names one (the name goes into the notebook with it,
     and is saved with the workbook), ✕ deletes one, and **✂ Delete from
     here** cuts the selected line after the current move. **Clear lines**
     deletes the lines on view. **↶ Undo** steps back through deletes, cuts,
     clears, renames and moves to the top, saying which it will undo, and
     **↷ Redo** steps forward again. **⤺ / ⤻** jump to the previous or next
     move where the line being played meets another. The toolbar's
     **Analysis** reopens the board as you left it.
   - **Keys** — ← → step, Home/End jump, ↑ ↓ switch line at the same move,
     [ ] jump between branch points, Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) undo
     and redo, F flips, E toggles the engine, Space plays the engine's best
     move, P pins the line. **?** (or **? all keys** under the board) lists
     them all. **M** jumps to the move box under the board, where a move can be
     typed instead of played — SAN (`Nf3`, `exd5`, `O-O`, `e8=Q`) or from-to
     (`g1f3`) — and Enter plays it; **N** jumps to the note box.
   - **Accessibility** — the board is a labelled dialog that keeps Tab inside
     it and gives the focus back to what opened it when it closes; after a
     redraw the focus stays on the control you pressed, so Enter on ▶ steps
     again. Every move is read out as it is played ("12... knight f6. White to
     move"), the board describes its pieces to a screen reader, and the glyph
     buttons (◀ ▶ ↑ ↓ 📌 ✕) have names. Focus rings show for the keyboard
     only, and motion is turned off for anyone who asks for less.
   - **Notes** — the box under the lines holds a note on the move just
     played, which goes into the notebook with the line. For a move the
     notebook already has, **Save note to notebook** puts it straight in (on
     every notebook line through the move) without adding a line, and **Save
     all notes** does that for every note on view (it adds and replaces, never
     clears). When the notebook's note on the move differs from the board's,
     the board shows it, so a save never overwrites one you could not see.
   - **Copying and saving** — **Copy FEN** for the position, **Copy PGN** for
     every line on the board as one game with variations. **Save PGN** writes
     the same lines to a `.pgn` file, and **Save PNG** / **Save SVG** save a
     picture of the board as it stands (the right way up for how it is
     flipped).
   - **Engine** — **Engine off/on** runs Stockfish 19 *on your own device*,
     in a background worker: nothing is sent anywhere. Two builds:
     **Lite** (1.8 MB, bundled with the app, downloaded the first time you
     switch the engine on) and **Full** (99 MB, noticeably stronger).
     Choosing Full offers a one-time download, checked against a known
     SHA-256 before it is used, which is kept in the browser
     (IndexedDB) so later visits start it from disk; if the download is
     blocked, you can download the file the message names (`stockfish-19.wasm`
     in most browsers) yourself from the
     [Stockfish.js releases](https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.0)
     and load the file. **Remove download** frees the space again.
     The engine searches on several threads at once, one per CPU core you
     give it: pick the count in the **threads** menu beside the depth box
     (it starts at up to four, leaving a core for the page, and is
     remembered). More threads reach a given depth sooner but use more power.
     This needs the page to be *cross-origin isolated*, which the app sets up
     with a small service worker: on your very first visit the page reloads
     itself once to switch it on. In a browser that blocks service workers
     (some private windows) the engine runs on one thread and the menu is
     not shown. The multi-threaded Full engine is a different file from the
     single-threaded one, so a Full engine downloaded before this needs
     downloading once more. The engine
     shows an eval bar beside the board, the top lines (1–5) with scores from
     White's side right under the board, and arrows for their first moves. On
     a phone the lines are pinned with the board, so they stay on screen while
     the rest (the steppers included) scrolls; the board keeps its full width
     held upright, and held sideways it shrinks to make room for them (the
     engine's settings are then in the upright view). Click any move in a line
     to play the line up to it. Search depth is a number box (0 = no limit);
     **Go deeper** keeps searching a finished position, and **Note eval**
     writes the verdict into the current move's note.
     Evaluations are cached per position, so stepping back to a position shows
     its best result at once, and a search picks up from the depth already
     reached instead of starting over (the engine's own hash table is kept
     between positions too, so the re-search is fast).
   Nothing reaches the notebook until you press **+ Line** or **+ Footnote** on
   a line's row (a line the notebook has is badged **in notebook** instead), or
   **Add all lines on view**; a line goes in as a sideline you can then tag like
   any other, or as a footnote. Adding closes the window; if the line cannot be added
   (it has no moves, or the notebook already has it) the window stays open and
   says why.
   To correct a wrong move, analyse from the move before it, play the right one,
   add it, and hide the old line.
4. **Study** — **Study** in the toolbar opens the workbook on a board to
   read, not to edit: nothing in it can change the workbook. Right-click a
   move in the table and choose **Study from here** to open it at that
   position. Step with ← →, Home/End and the ⏮ ◀ ▶ ⏭ buttons as on the
   analysis board, and `[` `]` jump to where the line meets another. On a
   phone the board and its buttons stay pinned at the top while the notes
   scroll underneath; with the engine on, the board and the engine's lines
   are pinned and the buttons scroll with the notes (swipe the board to step).
   - **The line and its notes** — the line being read is written out with its
     symbols and the same `[n]` note numbers as the table and the Notes list.
     The note on the move just played is shown large above the moves, and
     every note along the line is listed below them, the current one marked
     and the ones still ahead greyed. Click a move or a note to go there. A
     footnote's entry offers **Read this footnote**, which follows the
     footnote's own line on the board, with its lettered notes.
   - **Switching lines** — the line's name sits above its note, between **◀**
     and **▶**, which step to the previous and next line of the workbook
     (↑ ↓ do the same, and they wrap round at the ends). The lines come in the
     order the line editor lists them, so Line 3 is the third after the
     mainline, and the count beside them ("3 of 8") numbers the lines after
     the mainline the same way. The drop-down beside them goes straight to any
     line; each is listed with the move where it goes its own way, and a line
     you renamed keeps its number in front of its name. If the new line passes through the position on the
     board, the board stays put; otherwise it goes to that line's own first
     move (to the mainline, to where you left it), so a switch lands on what
     makes the line different.
   - **Moves of your own** — play a move on the board (or type it) that the
     workbook does not have and you are off the book, on a line called **Your
     moves**. Nothing is saved; **↩ Back to the book** (or **B**) returns to
     where you left it.
   - **The engine** works as on the analysis board: **E** switches it on,
     Space plays its best move, and clicking a move in one of its lines plays
     the line up to there (off the book, unless the workbook has it).
5. **Render** — a table (plies down, lines across), or a linear
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
   that move, dropping a tick into each of its **direct** branches — one apiece,
   however many columns that branch's own sub-branches go on to take — and
   turning a corner at the last of them. Groups nested inside a group mark their own
   rows the same way, and the mainline is the root of that tree — its own
   branches leave it by the same connector, one run per move they leave at.
   Those branches are ordered by how late they leave, latest nearest the
   mainline, so a connector never has to cross a column that has a move on its
   row — everything between the mainline and a branch left later than it did,
   and is still blank there. A line's lead-in cells are left blank on paper — the rules say
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
   **Printed tables are headed by what their lines share, and cut to save
   paper.** Each printed table, the mainline's own included, writes the moves
   all of its columns share once, above it, and starts its rows where they
   split (as MCO does). When a
   table's lines all come off one branch — sharing moves with each other past
   where they leave the mainline — that branch is the heading instead, and the
   mainline column is left off that table, since below the heading it would
   show moves from a position those lines never reach. A line that is itself
   the shared base of the others on its table gives up its column to the
   heading (its notes still print). The first table keeps the mainline, as the
   reference for the whole opening, unless the mainline costs less on a table
   of its own; with **No mainline**, every table gets its own heading.
   Where the report is cut into tables is chosen to use as little paper as
   possible, rather than filling each table to its column limit: a stray line
   that would cut a table's heading back to move two, and leave it thirty rows
   of mostly empty column, gets a small table of its own instead.
   **The preview opens with a summary**: its title (the notebook's name, or
   the PGN's Opening and Variation when it has none), the PGN's ECO code and
   opening, the source game's players, event and year (only when both
   players are named), how many lines, footnote lines and notes follow and
   how deep they go, and a tally of the lines' verdicts — White better,
   equal, unclear, Black better — read from each line's end evaluation, or
   an assessment on its last move. It heads the preview and the Markdown
   export; it is not printed. **Game info…** in the toolbar edits that header —
   opening, variation, ECO, players, event, site, date, round — and the
   edits are saved with the workbook, laid over the PGN's own tags so they
   survive **Update PGN**. A blank field is left out of the report.
6. **Export** — **Export PGN** (editable chess notation for any chess app),
   **Export Markdown** (paste into Google Docs/Word), or **Print → Save as
   PDF** (always the linear card view). Saved workbooks (`localStorage`) are
   listed under **My saved workbooks** on the import screen to reopen/delete.
   Export PGN keeps the header: the players, event, date and tags like ECO
   and Opening go back out with the lines (Event is the notebook's name when
   it has one, unless Game info sets one).
7. **Save and reload as a file** — **Save to file** asks for a name (prefilled
   with the workbook's current one) and writes the whole workbook, PGN and all
   annotations together, to one `.json` you can back up, share or keep in
   version control; the import screen reopens one. It's the same format
   `localStorage` holds, so nothing is lost either way. A file opens with no
   `localStorage` id of its own — pressing **Save** files it as a new entry
   rather than overwriting one.
8. **Update the PGN under your annotations** — **Update PGN…** replaces the
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
9. **Settings** — the **Settings** menu beside the theme button, and what the
   app remembers in this browser between visits: the theme, which way up new
   analysis boards start (the way the last one was left, or White/Black picked
   here), the table panel's dragged width, whether the analysis board's
   workbook lines are folded, and the saved workbook you were on
   — reopened on the next visit with its board where you left it. **Reopen the
   last workbook on start** turns that off; **Forget settings** clears it all
   (saved workbooks are kept). A workbook never carries these: a file you send
   someone does not bring your panel width with it.
10. **Phones and tablets** — on a narrow screen the report stacks with the
   toolbar first, and the table scrolls sideways in its own box rather than
   widening the page. The analysis window becomes a full-screen sheet; in
   landscape the board is sized to the height so it and its step buttons fit.
   On a touch screen the controls grow to finger size, a sideways swipe on the
   board steps through the moves, and a long press on a table move opens its
   menu (the same one right-click opens on a desktop).
