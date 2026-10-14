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
  Multiple choice (choices from the same level first, then other names) or
  typed (case and punctuation ignored, `/` separates accepted aliases, so
  "Kan/Paulsen" accepts either). Options: answer mode, number of choices,
  show the moves that led there, board orientation.
- **order** - given the name, play the moves from the start. A move is
  accepted while some workbook path still leads to the position; a move off
  all of them is wrong and the accepted moves are shown. Arriving lists the
  other move orders. Option: show the target position as a hint.
- **family** - tick the tags the position carries, out of all the workbook's
  tags; exact set to score. Off by default. Options: show the name; pick-one
  mode restricted to one chosen group of tags.
- **book** - a run through the variation's stretch: the board plays the
  other side, the reader plays theirs, each of the reader's moves its own
  card (keyed by position). Any book move counts (option: the mainline's
  only). A wrong move shows the book moves and play continues along one.
  The workbook's note on the move is shown after answering. Option: which
  side the reader plays (White, Black, both).

Answers score right or wrong; there is no partial credit.

## Progression

2026-10-14 (Davis): no boxes, no dates. "I don't want anything about mastery
to be time based"; mastery is "based on what we know about the user's
current knowledge level". The first version used Leitner boxes and review
intervals; unlocking waited for mastery, which took at least four days, and
the boxes were hard to follow.

- Every card carries one number, its **streak**: a right answer adds one,
  up to the master setting (it never counts past it).
- A card is **learned** at a streak of "Right in a row to learn" (default 2)
  and **mastered** at "Right in a row to master" (default 5, never below the
  learn setting). Both read the current streak, so mastery says what the
  reader knows now.
- A miss takes a card down one stage, not back to the start (Davis: "We
  also don't want it to be frustrating. Missing something you've mastered
  shouldn't fully reset you"): a mastered card drops to learned (its streak
  to the learn setting, so with the defaults three right answers master it
  again); a card not yet mastered starts again at 0, as it was not known
  yet. Nothing unlocked is locked again.
- A variation is learned (or mastered) when each of its enabled
  name/order/family cards is. Level-1 variations start unlocked; learning a
  variation unlocks its children and its book cards, and a variation once
  unlocked stays unlocked.
- A session, from the unlocked cards (in scope, not skipped), in this order:
  1. cards started but not mastered, least-recently asked first;
  2. up to "New questions per session" cards never asked (default 5),
     shallowest level first, in reading order;
  3. up to "Re-checks per session" mastered cards (default 3), the ones
     asked longest ago first.
  It stops after "Questions per session" (default 20; 0: no limit) or when
  nothing is left. Order matters only for what the limit cuts: the queue is
  asked in that order.
- In a session, a miss comes back three questions later, and so does a right
  answer on a card not yet learned, so a card can be learned in one sitting.
  (Mastery builds across sessions: once learned, a card is not repeated in
  the same session.) When an answer unlocks variations, their new cards join
  the session straight away, within the new-question and length limits, so a
  first session goes deeper than level 1.
- Manual, per variation: **Known** (its cards' streaks set to the master
  setting: mastered, which unlocks its children), **Skip** (left out of
  sessions), **Reset** (its cards forgotten). **Practice** drills one
  subtree now, every card in it whatever its state, locked or not; answers
  still count.

## Progress storage

Per workbook in localStorage under `ott-train:<workbook id>`: settings plus,
per card (`<type>|<position key>`), `{ streak, seen, skip }`, `seen` the time
it was last asked (used only to order the queue). A record from the first
version (`{ box, seen, skip }`) reads with streak 0. Saved after every
answer, without touching the workbook's own Save. **Save to file** includes
it as `train`; opening that file restores it. PGN export and shared links do
not carry it. A workbook never saved has no id; its progress lives under
`ott-train:unsaved` until it is saved, then moves to its id.

## Settings

Grouped, each with a tooltip saying what it does and its default:

- **Questions**: which types are asked (Name, Order, Book on; Family off).
- **Name questions**: answer by choosing or typing; how many choices (2-8);
  show the moves that lead there.
- **Order questions**: show the target position as a hint.
- **Family questions**: show the name; ask only within one group of tags.
- **Book questions**: the side you play (White, Black, both); accept any
  book move or only the mainline's.
- **Progress**: right in a row to learn (1-10), to master (learn-20).
- **Sessions**: new questions per session (0-50), re-checks per session
  (0-20), questions per session (0: no limit).

## The Train window

A window over the report like Study: **Train** in the toolbar, **Train from
here** in the table's context menu (Practice on the subtree at that
position). Three screens:

- **Outline** - **Start**, **Settings**, what a session would hold ("N in
  progress · M new · K to re-check"), a progress line (variations learned
  out of all, how many mastered, the deepest level open), then the
  named-position tree: level, a bar of progress towards mastery (the
  streaks, each capped at the master setting, over what mastering every card
  needs), learned/mastered/locked/skipped state, the manual actions,
  rename/retag. Filters: subtree, tags. Every control has a tooltip.
- **Question** - the board (the analysis board's `boardRow`), the prompt,
  a status line (the card's level and its streak towards learned or
  mastered; never the variation's name, which would give a name
  question away), the answer area; after answering, right/wrong, the right
  answer, the workbook's note, what the answer unlocked, and **Next**. Keys: Enter next, 1-9 pick a choice,
  Escape closes.
- **Summary** - score; the variations newly learned, newly mastered, newly
  unlocked, and those that slipped back from mastered; how many are still
  locked.

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
