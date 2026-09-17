# MCO-style print tables — design

A friend compared the printed report with the theory tables in *Modern Chess
Openings* (MCO). This round takes over three of MCO's conventions: shared moves
printed once above the table, an optional one-row-per-move layout, and an
option to drop the cell borders.

## Out of scope

- Column headers stay as they are: the mainline keeps its label, a named line
  shows its name, and an unnamed side line is blank. No column numbers.
- The mainline reference column is still repeated in every packed table.
- Packing, group rules and the notes under each table stay the same.
- Lettered notes `(a)` and dotted leaders. We may try these later.

## 1. Stem above each table

Every printed table gets a **stem**: the moves that every column in the table
shares, printed once as move text above the table. The table's rows start at
the first ply after the stem.

- **Length:** the longest common prefix of `moves` (compared by SAN) across the
  mainline and the table's lines, capped at `shortest line length − 1`. The cap
  means every column still states at least its last move. If a line is a
  prefix of another, the stem is not allowed to swallow all of it.
- **No stem:** a table with a single column (a mainline with no side lines)
  gets no stem, and neither does a table whose columns share nothing (length
  0). Either way no stem element is written and the rows start at ply 0, as
  they do now.
- **Rendering:** a `div.print-stem` placed right before the table. The text
  uses the same move formatting as the Lines cards (`buildCardMoves` in
  `render.js`, exported for this), run on the mainline's moves `0..stem−1`. The
  mainline's marks and note superscripts on those moves come along with it.
  Notes on stem moves are otherwise lost with the cells they used to sit in.
- **Rows:** `renderTable` takes an optional `grid.fromPly` (default 0). Rows
  run `fromPly..maxPly`. Group rules on a ply before `fromPly` are not drawn.
  Every column leaves at the stem or later, so the stem line itself already
  says what those rules said.
- **Page breaks:** the stem and the table must stay on one page. The stem gets
  `break-after: avoid`.

## 2. One row per move (option, off by default)

A print option, **one row per move** (`printByMove`, default `false`), passes
`grid.byMove` to `renderTable`.

- A row is a full move `n`, covering plies `2n` and `2n+1`. The row label is
  `fullmoveLabel(2n)` (`"5."`).
- Each cell holds two stacked halves, `div.half`, for White's ply and then
  Black's. Each half is built the way a `moveCell` is now, with the same note
  superscripts and marks. A group rule on a ply is drawn inside that ply's
  half, so a rule on White's move sits above Black's move in the same cell.
- The first row is `floor(fromPly / 2)`. If the stem ends after White's move,
  that row's White half is empty.
- The screen table never sets `byMove`, so trace and menu wiring only has to
  handle the per-ply rows it has today.

## 3. Cell borders (option, on by default)

A print option, **cell borders** (`printBorders`, default `true`). When it is
off, `.pv-htable` gets the class `no-borders`, and a `@media print` rule
removes the `th`/`td` borders and keeps a single rule under the header row.
Group rules are drawn by their own spans, so they are not affected.

## Options and persistence

Both options go in the "Table" group of the print options in `export.js`, next
to "include in print". Like `printTables`, both are saved in `workbookState()`
and restored in `app.js`.

## Testing (`tests/print.test.mjs`)

- **Stem:** a table whose lines share `1. e4 c5 2. Nf3` prints that stem, and
  its first row is the first ply where the lines differ.
- **Prefix cap:** a line that is a prefix of another still states its last
  move.
- **Mainline alone:** no `.print-stem` is written and the rows start at ply 0.
- **Stem notes:** a note on a stem move shows its superscript in the stem.
- **Headers:** the header text is the same as before the change.
- **One row per move:** half the rows (rounded up) and two `.half`s per data
  cell. A move is in the correct half.
- **Borders:** the `no-borders` class is present only when the option is off.
- **Existing tests:** tests that count rows are updated for the stem. The
  "first table runs the mainline out" test now counts `16 − stem` rows.
