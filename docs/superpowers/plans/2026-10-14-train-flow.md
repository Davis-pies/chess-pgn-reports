# Train: sessions as a flow, Keep going, End session

Spec: `docs/superpowers/specs/2026-10-13-train-mode-design.md`, Progression
("A session is a flow"), Settings (Sessions), The Train window (Outline,
Question, Summary). Davis (2026-10-14): continue after a session; with no
limit things should "constantly unlock and be integrated"; and "if you set 30
questions, there's actual progression within the session".

Today `newSession` builds the queue up front (started + up to
`newPerSession` new + up to `reviews` re-checks) and `answer` deepens only
within the leftover new-card budget, so a long session stops bringing in
anything new after the first five. This replaces the batch with a flow.

Branch `train-mode`. Tabs in `src/train*.js`, `tests/train*.test.mjs`; two
spaces in `e2e/`, `style.css`. Keep the existing behaviours the spec still
names: intros, interleaving (book runs together), requeue at i+3 until
learned, spacing counted in questions, difficulty hold-back, tricky cards,
new-card order (name/order/tags by level, then book), practice sessions.

---

### Task 7: The flow in `src/train.js`

**Files:** `src/train.js`, `tests/train.test.mjs`

1. Settings: drop `newPerSession` and `reviews`; add `learning: 5` (int
   1-20, "Learning at once") and `recheckEvery: 6` (int 0-50, 0 never).
   `sessionLength` stays (default 20, 0 no limit). `normalizeSettings`
   already drops unknown keys.
2. `newSession(...)`: the pool and `before`/`unlockedBefore`/`tricky` as
   today. Practice unchanged (every pool card, capped by `sessionLength`,
   nothing joins). Otherwise the queue opens with the started-not-learned
   cards (by `seen`), interleaved, then `refill(session, ctx)` once. Store
   what refill needs on the session (`deck`, `tree` may come in as a new
   `ctx` argument of `newSession`, as `answer` takes it; or keep passing
   them to `refill` — your call, one way for both). Track `answered`
   (questions answered this session, intros excluded) and `sinceRecheck`.
3. `refill(session, progress, settings, ctx)` (exported if the view or tests
   need it, else internal), run at the end of `newSession` and after every
   `answer` (not practice):
   - stop if the session is over: `sessionLength > 0 && answered >=
     sessionLength` (then also cut the queue after `i`).
   - unless held back (two of the last five results misses): count
     `inFlight` = distinct cards in the queue from `i` on, plus the ones
     answered this session, that have a record and are not learned (a card
     just answered right and learned no longer counts). While `inFlight <
     learning`, append the next never-asked open card (same order and
     open-test as today's fresh cards and deepening; skip ones already in
     the queue), with its intro first when it is its variation's first,
     interleaved with the queue's tail; each one adds one to `inFlight`.
   - re-checks: when `recheckEvery > 0` and `sinceRecheck >=
     recheckEvery`, append the mastered open card asked longest ago that is
     not in the queue from `i` on and that the spacing rule would count
     (`asked - seen >= SPACING`); reset `sinceRecheck` (only if one was
     found). The opening queue also gets one re-check if any qualifies.
   - `unlocked` names on the answer's result stay as today.
   Remove `newLeft` and the old deepening code: refill replaces both.
4. `sessionSummary` unchanged in shape.
5. The session is "done" when `current(session)` is null after refill, or
   the length is reached. Export `sessionOver(session, settings)` if the
   view needs it for the counter.

Tests (rewrite the batch/deepening/newLeft ones for the flow, keep the
rest): settings defaults/ranges and old keys dropped; the opening queue is
started-not-learned plus up to `learning` new; learning a card brings the
next new card in (including one unlocked by it) while others are still in
flight; with `sessionLength` 30 a fresh workbook keeps getting new cards and
unlocks level 2 and level 3 within the session (use a PGN with three levels);
with 0 it runs until nothing is left; re-checks join every `recheckEvery`
answers and respect spacing; held back: no new cards join while two of the
last five are misses, and resume after; practice unchanged; intros still
precede new variations; no two same-variation cards adjacent when avoidable.

Commit: "Make a Train session a flow: new questions join as others are learned"

### Task 8: The window

**Files:** `src/train-view.js`, `style.css`, `tests/train-view.test.mjs`,
`src/app.js` only if a call changes

1. Progress line: `Question n of L` with a length limit, `Question n`
   without (n counts answered non-intro questions + 1 while unanswered).
2. **End session** chip (`tr-end`, title "Stop here and see the summary")
   on question and intro screens: shows the summary for what was answered.
3. Summary: **Keep going** chip (`tr-again`, title "Carry on where you left
   off: a new session with the same variations"), first, and Enter does it;
   it starts `newSession` with the same scope/tag filter (not practice
   unless this was practice: then it practises again). Back to the outline
   stays.
4. Outline count: "N in progress · M new · K mastered" (new = unlocked
   never-asked cards in scope; mastered = mastered cards in scope); Start
   disabled ("Nothing to train") only when the opening queue would be empty
   and nothing could join.
5. Settings, Sessions group: "Learning at once" (1-20) "How many new
   questions you work on at a time: when one is learned, the next joins,
   including from what it unlocked. Default 5."; "Re-check every"
   (0-50) "Bring back one mastered question every this many questions, to
   check it has stuck. 0: never. Default 6."; "Questions per session (0: no
   limit)" tooltip "The session ends after this many answers; with 0 it
   keeps going, unlocking as you learn, until you end it. Default 20.".
   Remove the old two fields.

Tests: counter with and without a limit; End session → summary with the
answers so far; Keep going (chip and Enter) → a new session continuing
(in-progress first, same scope); outline counts; the new settings with
tooltips/defaults; the existing whole-session and per-type tests adapted.

Commit: "Keep going after a Train session, or end it whenever"

### Task 9: Docs and e2e

**Files:** `docs/user-guide.md` (Train section), `e2e/train.spec.mjs`

1. Guide: sessions as a flow (learning at once, re-checks every N, length
   0 = until you end it), End session, Keep going; remove the per-session
   new/re-check limits.
2. e2e: keep all passing; add one: with "Questions per session" 0 and
   "Learning at once" 1 on `1. e4 e5 {[%name "Open"]} 2. Nf3 Nc6 {[%name
   "Open Knight"]} *` (intros off, only Name questions, learn at 1): answer
   right, the next question is the Open Knight one in the same session,
   counter reads "Question 2", End session shows the summary, Keep going
   starts again.

Commit: "Document Train's session flow"

### Verification (main session)

`npm run check`, `npm run test:e2e`; review against the spec; try it on
the dev server.
