# Train: book questions as line runs

Davis, 2026-10-16: book questions "came in late when I had been replaying
many whole lines"; "there are also multiple book moves at any point and we
only have to input one of our known options"; "the progress is too slow".
They should "progress from replaying entire lines", and a wrong move order
should show the position it was meant to reach.

Replaces the **book** card of the [Train design](2026-10-13-train-mode-design.md).

> **Superseded in part, 2026-10-19.** The runs were a misreading. Davis: "the
> book moves should take progression from when you play a line which would
> require you to know that book move"; "we already had the line playback
> thing" (the order question). A run made a book question replay everything
> its line held, all at once, to the line's end. Kept: a card per (position,
> move), order questions crediting every book move they play, book moves
> opening with the order question and joining by level, and the target
> position on a wrong order. Changed: a book question is one position and
> one move again. The asked move is right; another book move there counts
> for its own card and the question waits for the asked one; anything else
> is a miss. A book move an order answer has just played and learned leaves
> the session's queue. The **A book question is a run** and **Which line**
> sections below no longer apply.

## What was wrong

- New book cards sorted behind every name/order card in the workbook, and
  opened only once their whole variation was learned.
- One card per position, right with any book move there: the familiar
  branch was played every time, the others never.
- Every position was its own question needing 3 right answers.
- Order questions credited only book cards already asked, so replaying a
  line taught nothing about its book moves.

## Design

- **Progress per book move.** A card per (position, move) the reader plays,
  from the first named position on (`book|<position key>|<san>`). Older
  per-position records (`book|<position key>`) are no longer read; they were
  days old (Davis agreed to drop them).
- **Every move played counts.** An order question credits the book move of
  every move it plays (spacing rule as before, no longer only once asked):
  "the move playback for a named position should also contribute to the
  book move progress".
- **A book question is a run**: a whole workbook line from move 1. The board
  plays the other side.
  - Up to the line's last open named position (its order question learned)
    the run is that position's order question, scored as it, crediting the
    order questions above it as now. A line that goes on into a variation
    not yet open stops there.
  - Each of the reader's moves is scored for its book move.
  - When the named position has several move orders, any of them is right
    and the run follows the one played. (It first named this line's order
    in the prompt, which gave the moves away: Davis, 2026-10-19.)
  - At a position with several book moves, any of them is right. Playing
    one this line does not take credits it and asks for this line's move
    ("Book, but this line goes another way"). After this line's move, the
    run pauses on "N more book moves here": play them for credit, or **Go
    on** (Enter). Finding them all is allowed, never required.
  - Where the line's move is not learned yet, the prompt says so ("this line
    takes one you haven't learned yet"): steering, not enforcement.
  - A move outside the book, or **Show me**, is a miss for this line's
    move: red and green arrows, where the move leads, the right move's note;
    **Go on** plays it and the run carries on to the line's end.
  - The run is one question in the session (one answer in `asked`, so the
    spacing rule counts runs, not moves) and right only with no miss.
- **Which line.** Sessions queue book moves as other cards. When one comes
  up, the run takes the line through it with the most book moves not yet
  learned. Every book move a run scores leaves the queue; the asked card,
  if not learned, and every missed one are queued again.
- **Earlier.** A variation's book moves open once its order question is
  learned (not the whole variation), and new cards sort by level only, so
  a variation's runs come before the next level's questions.
- **Wrong order shows the target.** A miss in an order question or in a
  run's order part shows the target position at half size.
- **Settings.** "Accept: any book move / the mainline's only" is removed.

Not done: a "book moves learned" count in the outline; one run walking every
branch (a Najdorf run would be endless).
