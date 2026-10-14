# Train mode

## Goal

Learn a workbook's openings in a sensible order and be quizzed on them: first
the names of the main variations and the moves that reach them, then deeper
sub-variations, then the book moves inside each one. What is learned comes
back to be re-checked, and nearly everything is configurable.

Davis asked for this to study the Sicilian, 2026-10-13.

## Named positions

- A workbook may carry `names`: position key -> `{ name, tags }`. The key is
  the FEN without the move counters, the same key the audit uses, so a
  transposition is one variation reached by several move orders and a name
  survives the PGN being edited or re-imported.
- Names are workbook content: saved, saved to file and shared with it.
- In a PGN a name lives in a comment on the move that reaches the position:
  `{[%name "Najdorf"] [%tags "...d6; Nc3 committed"]}`. Tags are separated by
  `;`. The parser reads these commands (it already strips `[%...]` from note
  text). PGN export does not write them (2026-10-13: exports stay plain PGN;
  the workbook is where names live). A name set in the app wins over the
  PGN's.
- Named in the app from the table's context menu (**Name this position...**),
  from Study (the same, on the board's position) and from Train's outline.
  An empty name removes it.

### Hierarchy

Derived, never stored. Walking every visible workbook line in reading order,
a named position's parent is the nearest named position before it on the
first line that reaches it; the root is a virtual node above everything.
Level = depth among named positions (the first named positions are level 1).
A position reached under a different parent on another line is listed under
its first parent with "also reached from ...", and its level is the
shallowest. Study shows the trail of names for the board's position
(Sicilian > Najdorf > English Attack).

A variation's **stretch** is the positions from its defining position along
each line through it, up to (not including) the next named position.

## Cards

Each named position gives cards; each card type can be switched off.

- **name** - the board shows the defining position; answer with its name.
  Multiple choice or
  typed (case and punctuation ignored, `/` separates accepted aliases, so
  "Kan/Paulsen" accepts either). Options: answer mode, number of choices,
  show the moves that led there, board orientation.
  **Choices** (Davis, 2026-10-14: make it difficult, ensure understanding;
  research, findings 3 and 6: discrimination between similar items, at the
  right difficulty). The wrong answers are ranked by how confusable they
  are: (1) siblings (same parent; the other roots at level 1), (2) variations
  sharing a tag with it, (3) the same level elsewhere, (4) the rest. Names
  the reader has met (any card of that variation asked) come before unmet
  ones within each rank; an unmet name is used only to fill. A card not yet
  learned takes at most one sibling and the rest from the farther ranks; a
  learned card takes the closest ranks first. Shuffled every time.
- **order** - given the name, play the moves from the start. A move is
  accepted while some workbook path still leads to the position; a move off
  all of them is wrong and the accepted moves are shown. Arriving lists the
  other move orders. Option: show the target position as a hint.
- **tags** (stored as `family`, so saved progress keeps its keys) - tick the tags the position carries, out of all the workbook's
  tags; exact set to score. Off by default. Options: show the name; pick-one
  mode restricted to one chosen group of tags.
- **book** - a run through the variation's stretch: the board plays the
  other side, the reader plays theirs, each of the reader's moves its own
  card (keyed by position). Any book move counts (option: the mainline's
  only). A wrong move shows the book moves and play continues along one.
  The workbook's note on the move is shown after answering. Option: which
  side the reader plays (White, Black, both).

Answers score right or wrong; there is no partial credit.

Name, order and tags cards carry the variation's **notes**: the workbook's
comments on the moves that reach it, each labelled with its move
("3...Nf6"). The result of every answer shows the note on the variation's
own move, as a book card's shows its move's note (research, finding 4:
explained feedback beats right/wrong). The rest are for the intro: all of
them at once were a wall of text (Davis, 2026-10-14).

- **intro** - not a question: the first time a session reaches a variation
  never asked, a "New: <name>" step plays its moves on the board one at a
  time (◀ ▶, arrow keys, or a click on a move), starting where its own moves
  begin after its parent's position, and shows only the notes on the move
  just played; **Learn it** (Study) and **Got it**. Unscored, never
  stored. Setting "Show a new variation first" (on). (Research, finding 5:
  an example before the test.)

## Progression

2026-10-14 (Davis): no boxes, no dates. "I don't want anything about mastery
to be time based"; mastery is "based on what we know about the user's
current knowledge level". The first version used Leitner boxes and review
intervals; unlocking waited for mastery, which took at least four days, and
the boxes were hard to follow.

- Every card carries one number, its **streak**: a right answer adds one,
  up to the master setting (it never counts past it).
- **Spacing is counted in questions, not time** (research, findings 1-2): a
  right answer on a learned card adds to its streak only when at least 10
  other questions have been answered since that card was last asked;
  sooner, it is still right but "too soon to count". Before a card is
  learned every right answer counts, so learning happens in one sitting;
  after that each step towards mastery is a separate re-check.
- **Not straight after the intro** (Davis, 2026-10-14: being asked right
  after being shown "feels like a free correct answer"). A variation's
  first question comes at least 3 other questions after its intro where
  the session has them to put in between. A right answer given sooner than
  that is "too soon to count": no streak, and like the spacing rule's, it is
  left out of the summary's score.
- A card is **learned** at a streak of "Right answers to learn" (default 3,
  as successive relearning recommends; it was 2 until 2026-10-14)
  and **mastered** at "Right answers to master" (default 5, never below the
  learn setting). Both read the current streak, so mastery says what the
  reader knows now.
- A miss takes "A miss takes away" right answers off the streak (default
  2, 1-5), never below 0, the same for every card (Davis, 2026-10-14: a miss
  should step progress back, "count against 2 correct (min of 0)"; earlier:
  "Missing something you've mastered shouldn't fully reset you"). With the
  defaults a mastered card (5) lands on learned (3). This replaced "a
  mastered card drops to the learn setting, any other starts again at 0",
  which wiped a nearly learned card for one slip. The streak is a net count,
  not "in a row": the settings say "Right answers to learn / to master".
  Nothing unlocked is locked again.
- A variation is learned (or mastered) when each of its enabled
  name/order/family cards is. Level-1 variations start unlocked; learning a
  variation unlocks its children and its book cards, and a variation once
  unlocked stays unlocked.
- A session is a **flow**, not a batch fixed at the start (Davis,
  2026-10-14: "if you set 30 questions, there's actual progression within the
  session"; with 0, "constantly unlock and be integrated"). From the unlocked
  cards in scope, not skipped:
  1. it opens with the cards started but not learned, least-recently asked
     first;
  2. new cards join whenever fewer than "Learning at once" (default 5, 1-20)
     cards in the session are started but not yet learned, one for each
     free place: name/order/tags cards first, shallowest level first, then
     book cards, in reading order (names and move orders, then deeper
     variations, then the book moves inside each one, as the Goal says). So
     as cards are learned, new ones take their place, including from the
     variations they unlocked;
  3. a mastered card joins every "Re-check every" questions (default 6, 0:
     never), the one asked longest ago that the spacing rule would count;
     learned-not-mastered cards from earlier sessions are in step 1's
     "started" only until learned, so they come back the same way.
  The session ends after "Questions per session" answers (default 20; 0: no
  limit), when nothing is left to ask, or with **End session**. The queue is
  **interleaved** as it grows (research, finding 6): no two cards of one
  variation back to back where another order avoids it, a variation's book
  cards kept together in move order as one run, each intro just before its
  variation's first card.
- In a session, a miss comes back three questions later, and so does a right
  answer on a card not yet learned, so a card can be learned in one sitting.
  (Mastery builds across the flow: once learned, a card is not repeated in
  the same session except as a re-check.)
- **The right difficulty** (research, findings 3 and 8): while two of the
  last five answers in a session were misses, cards never asked are held
  back: those still queued leave the session (with their intros), and no new
  cards join it until the misses scroll out of the last five.
- **Tricky questions** (research, finding 7): a card missed three times in a
  session is not asked again in it and is marked tricky (`tricky: true` on
  its record) until it is next learned. The summary lists this session's
  tricky cards with **Learn it** for their variations; the outline badges a
  variation with a tricky card.
- Manual, per variation: **Known** (its cards' streaks set to the master
  setting: mastered, which unlocks its children), **Skip** (left out of
  sessions), **Reset** (its cards forgotten). **Practice** drills one
  subtree now, every card in it whatever its state, locked or not; answers
  still count.

## Progress storage

One store per browser, not per workbook (Davis, 2026-10-14: progress was
lost every time he reloaded the PGN, because an unsaved workbook's progress
slot was cleared on every load). localStorage key `ott-train`: settings,
`asked` (how many answers have been recorded) and, per card (`<type>|<position
key>`), `{ streak, seen, skip, tricky }`, `seen` the value of `asked` when the
card was last answered: a count, not a time, used for the spacing rule and
to order the queue. Cards are keyed by position, so any workbook, saved or
not, a reloaded or edited PGN, or a file, finds the progress on every
position it still has. (The cost: two workbooks naming one position
differently share its name card's streak.) Saved after every answer, without
touching the workbook's own Save; deleting a workbook leaves it.

**Save to file** includes, as `train`, the store's records for the
workbook's own cards plus the settings; opening that file merges its records
into the store, keeping for each card the record with the higher streak
(skip and tricky from that record), and takes its settings only when the
store has none. PGN export and shared links do not carry it.

Migration: on first load, every older per-workbook key (`ott-train:<id>`,
`ott-train:unsaved`) is merged into `ott-train` the same way and removed.
Within a key, progress saved before `asked` existed (`seen` a timestamp) is
renumbered in the order of those timestamps; a first-version record
(`{ box, seen, skip }`) reads with streak 0. Merged keys' `seen` counts are
renumbered together in the order they had, and `asked` set to their number.

## Settings

Grouped, each with a tooltip saying what it does and its default:

- **Questions**: which types are asked (Name, Order, Book on; Tags off).
- **Name questions**: answer by choosing or typing; how many choices (2-8);
  show the moves that lead there.
- **Order questions**: show the target position as a hint.
- **Tags questions**: show the name; ask only within one group of tags.
- **Book questions**: the side you play (White, Black, both); accept any
  book move or only the mainline's.
- **Progress**: right answers to learn (1-10, default 3), to master
  (learn-20, default 5), a miss takes away (1-5, default 2).
- **Sessions**: show a new variation first (on), learning at once (1-20,
  default 5), re-check every N questions (0-50, default 6; 0: never),
  questions per session (default 20; 0: no limit). Saved settings with the
  old `newPerSession` / `reviews` keys drop them.

## The Train window

A window over the report like Study: **Train** in the toolbar, **Train from
here** in the table's context menu (Practice on the subtree at that
position). Three screens:

- **Outline** - **Start**, **Settings**, what is waiting ("N in progress ·
  M new · K mastered"; new = unlocked and never asked), a progress line (variations learned
  out of all, how many mastered, the deepest level open), then the
  named-position tree: level, a bar of progress towards mastery (the
  streaks, each capped at the master setting, over what mastering every card
  needs), learned/mastered/locked/skipped state, the manual actions,
  rename/retag, a "tricky" badge. Filters: subtree, tags. Every control has
  a tooltip.
- **Question** - "Question n of m", or "Question n" with no limit (intros
  not counted), **End session** (to the summary), the board (the
  analysis board's `boardRow`), the prompt, a status line (the card's level,
  its streak towards learned or mastered, and while its variation is not
  learned how many variations learning it unlocks; never the variation's
  name, which would give a name question away), the answer area; after
  answering, right/wrong ("Right, too soon to count" under the spacing
  rule), the right answer, the workbook's notes, what the answer unlocked,
  and **Next**. An intro shows instead its position, moves and notes with
  **Learn it** and **Got it**. Keys: Enter next, 1-9 pick a choice,
  Escape closes.
- **Summary** - score, counting only answers that counted ("Right n / m",
  then "k too soon to count" when there were any); the variations newly learned, newly mastered, newly
  unlocked, and those that slipped back from mastered; the tricky questions
  with **Learn it**; how many are still locked; **Keep going** (Enter: a new
  session with the same scope and filter, picking up where this one left
  off) and **Back to the outline**.

**The engine** (Davis, 2026-10-14: "nice to be able to see engine
evaluations and engine lines (if desired) while learning", but not while
being quizzed on moves). Study's engine box (`engine-view.js`: toggle, eval
bar, lines, arrows, the shared Stockfish) under Train's board, on the intro
(following its stepper), on name and tags questions before and after
answering, and on every result once answered. Never while an order or book
question waits for moves: the engine pauses as such a question comes up, and
when Train closes. Off until switched on (the toggle, or E); it is the one
shared engine, so it is on or off in Study and Train alike. The box shows its
evaluation in its head, beside the toggle; **Eval only** in its lines menu
(a viewer preference in `prefs.js`, the same on every board with an engine)
hides the lines and arrows and searches one line. (A Train setting "Engine
lines" did this first; Davis wanted it in the box's own menu, with the
evaluation no longer read off the first line.) Every
Train board keeps the eval bar's place beside it, shown or not, so the board
does not shift between questions. Clicking an engine line does nothing in
Train (in Study it plays the line).

On phones the board is pinned on top as in Study. With no named positions
the outline explains how to name one; book drilling still works, the whole
workbook treated as one unnamed variation.

## Modules

- `names.js` - position keys, the names map, hierarchy, stretches, reading
  names and tags out of PGN comments and writing them back.
- `train.js` - cards, answer checking, streaks, unlocking, sessions, manual
  overrides, progress load/save. No DOM.
- `train-view.js` - the window and its screens.

## Not in this version

- Cards for positions that are not named other than book moves.
- Syncing progress across devices other than through Save to file.
