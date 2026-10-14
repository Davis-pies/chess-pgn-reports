# Train: streaks instead of boxes, visible progress, settings with tooltips

Spec: `docs/superpowers/specs/2026-10-13-train-mode-design.md` (Progression,
Progress storage, Settings, The Train window; rewritten 2026-10-14).

Problem (Davis, 2026-10-14): after Start there was no way to see progress or
level, and nothing deeper than level 1 came up for days: unlocking waited for
mastery (box 3), a right answer climbed one box a session, and boxes waited
1 and 3 days. He wants nothing about mastery to be time-based, finds boxes
unintuitive, and wants mastery to reflect what he knows now. Boxes, review
intervals and due dates go; each card keeps one number, its streak.

Branch: `train-mode` (not merged; Davis signs off locally). Tabs in
`src/train*.js` and `tests/train*.test.mjs`; two spaces in `e2e/` and
`style.css`. Single test file: `node --test tests/train.test.mjs`.

---

### Task 1: Streaks in `src/train.js` (logic, no DOM)

**Files:** `src/train.js`, `tests/train.test.mjs`

1. Settings. `DEFAULT_SETTINGS` loses `masteryBox` and `intervals`, gains
   `learnStreak: 2` (int 1-10), `masterStreak: 5` (int 1-20), `reviews: 3`
   (int 0-20); `newPerSession` defaults to 5 and validates int 0-50;
   `choices` validates 2-8 (the field's own range). `normalizeSettings`
   also raises `masterStreak` to `learnStreak` when it is lower. Old keys in
   saved settings are simply dropped (normalizeSettings already only copies
   known keys).
2. Records are `{ streak, seen, skip }`. `loadProgress` reads `streak` when
   an int ≥ 0, else 0 (a first-version record `{ box, seen, skip }` reads
   with streak 0), keeps `seen` (number) and `skip`.
3. `export const learnedCard = (rec, s) => (rec?.streak ?? 0) >= s.learnStreak;`
   `export const masteredCard = (rec, s) => (rec?.streak ?? 0) >= s.masterStreak;`
   `isLearned(vkey, deck, progress, s)` / `isMastered(...)`: every own
   (name/order/family) card is. Unlocking (`unlockedKeys`, `bookOpen`) uses
   learned. A variation with records stays unlocked (as today).
4. Delete `DAY`'s scheduling use, `dueAt`, `isDue`, `setBox`, `MAX_BOX` and
   anything else only boxes used (`DAY` itself goes too if nothing else
   imports it; knip will tell you). Update importers (`train-view.js`) just
   enough to keep compiling; Task 2 does the view properly.
5. `newSession(deck, tree, progress, settings, { now, scope, practice, keys })`:
   - pool = deck cards in scope/keys, not skipped.
   - practice: every pool card (any state, locked or not), capped by
     `sessionLength`; `newLeft` 0.
   - otherwise, from the unlocked + book-open pool (one helper shared with
     deepening): (1) started (has a record) and not mastered, by `seen`
     ascending; (2) never asked, by level then deck order, at most
     `newPerSession`; (3) mastered, by `seen` ascending, at most `reviews`.
     Concatenate, cap at `sessionLength` (0: none).
   - return `{ queue, i: 0, results: [], unlockedBefore, practice, pool, newLeft }`,
     `newLeft` = `newPerSession` − new cards taken.
6. `answer(session, progress, card, right, settings, now, ctx = null)`:
   - streak: right → +1, capped at `masterStreak`; wrong on a mastered
     card → `learnStreak` (down one stage), wrong otherwise → 0 (spec: "a
     miss takes a card down one stage"); `seen = now`; `skip` kept.
   - `wasLearned`/`wasMastered` before, the same after, on the result:
     `{ id, right, from, to }` where from/to are the streaks.
   - requeue at `session.i + 3` (clamped) a miss, and a right answer whose
     card is still not learned.
   - with `ctx = { deck, tree }` and not practice: `unlockedKeys` before and
     after; the newly unlocked names on the result as `unlocked` (always an
     array). Then deepen: append pool cards that have no record, are not in
     the queue, pass the unlocked + book-open helper, by level then deck
     order, at most `session.newLeft` (decrement), and only while distinct
     cards in the queue < `sessionLength` (0: no limit).
7. `sessionSummary(session, tree, deck, progress, settings)` returns
   `{ right, wrong, learned, mastered, slipped, unlocked, locked }`:
   variation names newly learned / newly mastered / mastered before the
   session but not now (compare each variation's state before the session —
   record it in `newSession` as `session.before = { learned: Set, mastered: Set }`
   — with after), `unlocked` names, `locked` the count of tree variations
   not unlocked now. No `now`, no next-due.
8. `markKnown`: each own card's streak set to `masterStreak` (record created
   if missing, `seen` = now, skip false). `skip`, `resetVar` unchanged in
   spirit (no box fields).

Tests (`tests/train.test.mjs`, rewrite the box/schedule tests for the new
rules, keep the rest): settings defaults and ranges, `masterStreak` raised to
`learnStreak`; loadProgress of a new record and of a first-version
`{ box, seen, skip }` record; streak up (capped at master) and down (a
mastered card to the learn setting, any other to 0); learned at 2, mastered
at 5, a miss on a mastered card leaves it learned; unlocking on learned (not mastered); session order and
limits (in-progress by seen, new by level, re-checks by seen, `reviews`
limit, length cap); requeue until learned and not after; deepening (cards
appended, `unlocked` names, `newLeft` limit, length cap, never in practice);
practice includes locked cards; summary learned/mastered/slipped/unlocked/
locked; markKnown masters and unlocks.

Commit: "Track Train progress as streaks: learned, mastered, no schedule"

### Task 2: The window in `src/train-view.js`

**Files:** `src/train-view.js`, `style.css`, `tests/train-view.test.mjs`

1. `finish` passes `{ deck: live, tree }` to `answer`; `ui.answered` keeps
   the result's `unlocked`.
2. Question screen, `p.tr-status` after the prompt: `Level N · S of K right
   to learn` (K = learnStreak), then `Level N · learned · S of M right to
   master`, then `Level N · mastered`; S the record's streak (after the
   answer once answered). Book cards with `vkey === ""` omit `Level N · `.
   Never the variation's name. Tooltip: "Answer it right K times in a row to
   learn it (unlocking what's below), M times to master it. A miss on a
   mastered question drops it back to learned; any other miss starts the
   count again."
3. Result box: `p.tr-unlocked` "Unlocked: A, B" when non-empty.
4. Outline head: Start (disabled, "Nothing to train", when the queue is
   empty), Settings, `span.tr-count` "N in progress · M new · K to re-check"
   (from the would-be queue), the tag filter; then `p.tr-overview`
   "Learned L of V variations · M mastered · open to level D" (whole tree; D
   the deepest unlocked level). Rows: drop the `Box…` select and the due
   count; the bar is progress towards mastery (sum of min(streak,
   masterStreak) over own cards ÷ (own cards × masterStreak)), title "S of T
   questions mastered"; `span.tr-state` "mastered" / "learned" after the
   level; locked/skipped badges stay. Known's title: "Count its questions as
   mastered (unlocks what's below)". Empty-queue hint: "Nothing to train
   here yet: Practice drills a variation anyway, Known unlocks what's below
   it."
5. Every outline/question/summary control and status has a `title` tooltip
   explaining it (existing chips already have one; check the rest: Start,
   tag filter, level badge "Level N: how deep this is among named
   positions", bar, state, badges, count, overview).
6. Settings screen: `fieldset.tr-group` sections with legends, in the
   spec's order (Questions; Name questions; Order questions; Family
   questions; Book questions; Progress; Sessions). Labels: "Name", "Order",
   "Family", "Book" under Questions; "Answer by" (choose/type), "Choices",
   "Show the moves"; "Show the target position"; "Show the name", "Ask
   within one group" (the tag group checkboxes, legend "Tags in the
   group"); "You play" (white/black/both), "Accept" (any book move / the
   mainline's only); "Right in a row to learn", "Right in a row to master";
   "New questions per session", "Re-checks per session", "Questions per
   session (0: no limit)". Each field's label gets a `title` with what it
   does and its default (from `DEFAULT_SETTINGS`, e.g. "… Default 2."). The
   old box/interval fields are gone. Done stays.
7. Summary: "Right R / T"; then, when non-empty, "Learned: …", "Mastered:
   …", "Back to learned: …" (`slipped`; title: "Mastered before, missed this
   time: answer it right again to re-master it"),
   "Unlocked: …", "Still locked: N variations"; Back to the outline. No
   "Next review", no moved up/down.
8. CSS: `.tr-status`, `.tr-overview` like `.tr-progress`; `.tr-state` like
   `.tr-level`; `.tr-unlocked` coloured `var(--main)`; `.tr-group` a plain
   fieldset (border `var(--line)`, small radius, padding .5rem .7rem, legend
   muted and small) inside `.tr-settings`. Remove rules only boxes used.

Tests (`tests/train-view.test.mjs`): rewrite box/due assertions; status
text through learn → learned → mastered; a name card's status has no name;
"Unlocked:" after an unlocking answer; outline count/overview/state/bar
title; no `.tr-box`; settings groups and a tooltip on every field; the new
settings save and clamp (masterStreak below learnStreak is raised); summary
lists; the existing whole-session and per-type tests still pass.

Commit: "Show Train progress and explain its settings"

### Task 3: Saved format, docs, e2e

**Files:** `tests/fixtures/workbooks/2026-10-14-train.json`,
`tests/old-workbooks.test.mjs`, `docs/user-guide.md`, `e2e/train.spec.mjs`

1. The Train branch added `names` and `train` to saved workbooks without a
   fixture. Make one with this build, the way the header comment of
   `tests/old-workbooks.test.mjs` describes for the others: the same
   annotated PGN as `2026-10-05-audit.json`, two positions named, Train
   progress with streaks, written through `toNotebook` as the app does. Add
   it to `FIXTURES` and the comment list ("2026-10-14-train  this build:
   named positions in `names`, Train progress (streaks) in `train`");
   `checkFormat` checks the names come back and the progress lands in
   `ott-train:<id>` with its streaks. Every shared expectation must hold.
2. `docs/user-guide.md`, the Train section (around lines 183-240): replace
   the boxes/schedule text with streaks (learned, mastered, a miss takes a
   mastered question back to learned and starts any other again), what a session holds, cards coming back until learned, unlocked
   variations joining the session, where progress shows (status line,
   outline count and overview, summary), the settings groups. Keep the rest.
   README's Train bullet: adjust if it mentions spaced review.
3. `e2e/train.spec.mjs`: keep both tests passing (update selectors/labels
   only where Task 2 renamed them). Add one: `1. e4 e5 {[%name "Open"]} 2.
   Nf3 Nc6 {[%name "Open Knight"]} *` with only Name questions and "Right in
   a row to learn" 1: Start, answer right, the result shows "Unlocked: Open
   Knight", Next asks the Open Knight card in the same session, and the
   status line reads "Level 2 · …".

Commit: "Document Train streaks and keep its saved progress readable"

### Verification (main session)

`npm run check` and `npm run test:e2e` green; review against the spec; try
it on the dev server.
