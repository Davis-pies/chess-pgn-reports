# Train: learning, in-session deepening and visible progress

Spec: `docs/superpowers/specs/2026-10-13-train-mode-design.md` (Progression,
Progress storage, The Train window; updated 2026-10-14).

Problem (Davis, 2026-10-14): after Start there was no way to see progress or
level, and nothing deeper than level 1 ever came up. Unlocking waited for
mastery (box 3), which a right answer reaches at best on day 4 (box 1 → due
in 1 day → box 2 → due in 3 days → box 3), and the question screen showed
only "Question n of m".

Branch: `train-mode` (not merged; Davis signs off locally). Files use tabs in
`src/train*.js` and `tests/train*.test.mjs`, two spaces in `e2e/` and
`style.css`. Run single tests with `node --test tests/train.test.mjs`.

---

### Task 1: Learning in `src/train.js` (logic, no DOM)

**Files:** `src/train.js`, `tests/train.test.mjs`

1. Setting `learnStreak`: `DEFAULT_SETTINGS.learnStreak = 2`, validated
   `isInt(x, 1, 10)` in `VALID`.
2. Card records gain `streak` (consecutive right answers). `loadProgress`
   keeps it when it is an integer ≥ 0, else 0 (old records have none).
   `markKnown`, `setBox` and `skip` keep or set records consistently
   (`markKnown` may leave `streak` alone: the mastery box counts as learned).
3. `export const isLearnedCard = (rec, settings) => !!rec && ((rec.streak ?? 0) >= settings.learnStreak || rec.box >= settings.masteryBox);`
   `export const isLearned = (vkey, deck, progress, settings) => ownCards(vkey, deck).every((c) => isLearnedCard(progress.cards[c.id], settings));`
   (A variation with no own cards is learned, as `masteredBy` treats it
   mastered today.)
4. Unlocking uses learned, not mastered: in `unlockedKeys` replace
   `masteredBy` with the learned test; `bookOpen` uses `isLearned`.
   `isMastered` stays (the outline's bar and "mastered" state use it).
5. `answer(session, progress, card, right, settings, now, ctx = null)`:
   - `streak`: right → `(rec.streak ?? 0) + 1`; wrong → 0. Box rule unchanged
     (right climbs once per session, wrong → box 1).
   - Requeue (splice at `session.i + 3`, as a miss already is) a miss, **and**
     a right answer whose card is still not learned afterwards.
   - When `ctx = { deck, tree }` is given and the session is not a practice
     session: compute `unlockedKeys` before and after the record update; the
     names of keys newly unlocked go on the pushed result as `unlocked`
     (always an array). Then **deepen**: append to the queue the cards that
     (a) have no progress record, (b) are not already in the queue, (c) are
     in the session's pool (the scope/keys-filtered cards `newSession`
     drew from), (d) pass the same unlocked + book-open test `newSession`
     uses, sorted by level then deck order, at most `session.newLeft` of them
     (decrement it), and only while the number of distinct cards in the queue
     is below `settings.sessionLength` (0: no limit).
6. `newSession` returns, besides `queue, i, results, unlockedBefore`:
   `practice` (bool), `pool` (the filtered `cards` array) and `newLeft`
   (`settings.newPerSession` minus the fresh cards it took; 0 for practice).
   Factor the unlocked/book-open test into one helper both use.
7. `sessionSummary` adds `locked`: the number of variations in the tree not
   in `unlockedKeys` after the session.

Tests (`tests/train.test.mjs`, reuse its PGN/tree/deck helpers):
- default `learnStreak` 2; normalizeSettings rejects 0 and 11.
- loadProgress keeps `streak`, defaults a missing one to 0.
- right, right on a new card: streak 1 then 2, box 1 (once a session), the
  card requeued after the first right and not after the second.
- a miss resets the streak.
- learning the level-1 variation's cards unlocks its children without
  reaching the mastery box; `isMastered` is still false.
- in-session deepening: a session whose answers learn "...d6 Sicilians"
  gets Najdorf/Scheveningen cards appended, the result carries their names in
  `unlocked`, `newLeft` limits how many, a practice session never appends.
- `sessionSummary(...).locked` counts the still-locked variations.
- existing tests that assumed mastery gates unlocking: update them to the new
  rule only where the spec changed; do not loosen anything else.

Commit: "Unlock a Train variation once it is learned, within one session"

### Task 2: Progress on screen in `src/train-view.js`

**Files:** `src/train-view.js`, `style.css`, `tests/train-view.test.mjs`

1. `finish` passes `{ deck: live, tree }` to `answer`, and keeps the result's
   `unlocked` on `ui.answered`.
2. Question screen: a `p.tr-status` after the prompt:
   `Level N · S of K right to learn` while not learned (S the card's streak,
   K `learnStreak`), `Level N · learned`, or `Level N · mastered` (box ≥
   masteryBox). Book cards with no variation (`vkey === ""`) omit
   "Level N · ". Never the variation's name (it would give away a name
   question). While answered it reflects the record after the answer.
3. After answering, when `unlocked` is non-empty: `p.tr-unlocked`
   "Unlocked: A, B" in the result box.
4. "Question n of m" keeps working as the queue grows (it already reads
   `queue.length`).
5. Outline: `p.tr-overview` under the head row:
   `Learned L of V variations · M mastered · open to level D`, where V counts
   the tree's variations (within the outline's scope/tag filter is not
   needed: whole tree), D the deepest level among unlocked variations. Each
   row gets `span.tr-state` "learned" or "mastered" (mastered wins) after
   the level. Known's title becomes "Count its cards as learned and
   mastered".
6. Summary: "Still locked: N" (`p`), only when N > 0.
7. Settings: `num("learnStreak", "Right in a row to learn (unlocks what's below)", s.learnStreak, …, 1, 10)` just before "Mastered from box"; relabel
   that one "Mastered from box (long-term)".
8. CSS: `.tr-status`, `.tr-overview` like `.tr-progress` (small, muted);
   `.tr-state` like `.tr-level`; `.tr-unlocked` in `var(--main)`.

Tests (`tests/train-view.test.mjs`): status text before and after answers
(streak counts up, then "learned"); a name card's status has no name; the
"Unlocked:" line appears when an answer unlocks; the outline overview line
and states; summary "Still locked"; the new setting persists through
`normalizeSettings` and saves.

Commit: "Show Train progress: level, streak, unlocks and an overview"

### Task 3: Saved-format fixture, docs, e2e

**Files:** `tests/fixtures/workbooks/2026-10-14-train.json`,
`tests/old-workbooks.test.mjs`, `docs/user-guide.md`, `e2e/train.spec.mjs`

1. The Train branch added `names` and `train` to saved workbooks without a
   fixture. Write one with this build: take
   `tests/fixtures/workbooks/2026-10-05-audit.json`'s PGN, name two positions
   on it and give it Train progress with `streak` values, then save it through
   `toNotebook` exactly as the app does (see how the header comment of
   `tests/old-workbooks.test.mjs` says the others were made). Add it to
   `FIXTURES` and the comment list ("2026-10-14-train  this build: named
   positions in `names`, Train progress with streaks in `train`"), and check
   in `checkFormat` that the names come back and that the progress lands in
   `ott-train:<id>` with its streaks. Every existing expectation must still
   hold for it.
2. `docs/user-guide.md`'s Train section: learned vs mastered, the new
   setting, cards coming back in the session until learned, unlocked
   variations joining the session, where to see progress (status line,
   overview, summary).
3. `e2e/train.spec.mjs`: one test on `NAMED` with only Name questions and
   "Right in a row to learn" 1: answer the first card right, see
   `.tr-status` say learned and the result list nothing unlocked (no
   children in NAMED) — or extend NAMED with a child so "Unlocked:" shows.

Commit: "Document Train learning and keep its saved progress readable"

### Verification (main session)

`npm run check` and `npm run test:e2e` green; review the diff against the
spec; try it on the dev server.
