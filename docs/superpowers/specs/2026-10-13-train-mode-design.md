# Train mode

## Goal

Learn a workbook's openings in a sensible order and be quizzed on them: first
the names of the main variations and the moves that reach them, then deeper
sub-variations, then the book moves inside each one. What is learned comes
back for review on a spaced schedule, and nearly everything is configurable.

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

- Level-1 variations start unlocked. A variation is **mastered** when each
  of its enabled name/order/family cards is in the mastery box (default 3)
  or above. Mastering a variation unlocks its children and its book cards.
- Leitner boxes 0-5. Intervals (editable): box 0 again this session, then 1,
  3, 7, 16, 35 days. Right moves a card up one box, wrong sends it to box 1.
- A session takes due cards first (most overdue first), then up to N new
  cards from the unlocked set (default 10), and stops after M questions
  (default 20, or unlimited) or when nothing is left. A miss comes back later
  in the same session.
- Manual, per variation: **Mark known** (its cards to the mastery box,
  unlocking its children), **Skip** (left out of sessions), **Reset**, **Set
  box**. **Practice this** drills one subtree now, ignoring the schedule;
  results still count.

## Progress storage

Per workbook in localStorage under `ott-train:<workbook id>`: settings plus,
per card (`<type>|<position key>`), `{ box, seen, skip }`. Saved after every
answer, without touching the workbook's own Save. **Save to file** includes
it as `train`; opening that file restores it. PGN export and shared links do
not carry it. A workbook never saved has no id; its progress lives under
`ott-train:unsaved` until it is saved, then moves to its id.

## The Train window

A window over the report like Study: **Train** in the toolbar, **Train from
here** in the table's context menu (Practice on the subtree at that
position). Three screens:

- **Outline** - the named-position tree: level, a mastery bar, cards due,
  locked/skipped state, the manual actions, rename/retag. Filters: subtree,
  tags, card types. **Start** (scheduled session) and settings.
- **Question** - the board (the analysis board's `boardRow`), the prompt,
  the answer area; after answering, right/wrong, the right answer, the
  workbook's note and **Next**. Keys: Enter next, 1-9 pick a choice,
  Escape closes.
- **Summary** - score, cards up/down, newly unlocked variations, when the
  next review is due.

On phones the board is pinned on top as in Study. With no named positions
the outline explains how to name one; book drilling still works, the whole
workbook treated as one unnamed variation.

## Modules

- `names.js` - position keys, the names map, hierarchy, stretches, reading
  names and tags out of PGN comments and writing them back.
- `train.js` - cards, answer checking, Leitner scheduling, unlocking, manual
  overrides, sessions, progress load/save. No DOM.
- `train-view.js` - the window and its screens.

## Not in this version

- Cards for positions that are not named other than book moves.
- Syncing progress across devices other than through Save to file.
