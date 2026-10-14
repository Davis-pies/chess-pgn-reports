# Train: harder choices, no free answers after an intro

Spec: `docs/superpowers/specs/2026-10-13-train-mode-design.md` — Cards
(name: **Choices**), Progression ("Not straight after the intro", learn
default 3), The Train window (Summary score). Davis (2026-10-14): wants the
questions "difficult and ensure understanding"; distractors from other
lines; a question right after its intro "feels like a free correct answer".

Branch `train-mode`. Tabs in `src/train*.js`, `tests/train*.test.mjs`; two
spaces in `e2e/`.

---

### Task 13: `src/train.js`

**Files:** `src/train.js`, `tests/train.test.mjs`

1. `DEFAULT_SETTINGS.learnStreak = 3` (masterStreak stays 5). Saved
   settings keep their own value.
2. `nameChoices(card, tree, settings, rng, { progress, deck } = {})`:
   rank the other variations (distinct names, not the answer's) by the
   spec's four ranks; within a rank, met before unmet (met: any card of
   that variation has a progress record), then a shuffle (rng). For a card
   not learned (`learnedCard(progress.cards[card.id], settings)` false):
   at most one from rank 1, then ranks 3, 4, 2, then any left; learned:
   ranks 1, 2, 3, 4. Unmet names only after every met one of any rank.
   Take `settings.choices - 1`, add the answer, shuffle. Without
   `progress`/`deck` (old callers) behave as "not learned, all unmet".
   Keep it one function; a variation's parent / tags / level are on the
   tree nodes.
3. **Intro spacing.** Where the queue places an intro and its variation's
   first card (opening queue and refill), put at least 3 other non-intro
   cards between them when the queue has them (move the variation's cards
   later, or the intro earlier, keeping the interleaving rules). Record on
   the session, when an intro is passed (`answer` on an intro), the number
   of questions answered so far for that variation key.
4. In `answer`, a right answer on a card whose variation's intro was
   passed this session fewer than 3 answered (non-intro) questions ago:
   no streak change, `seen` updated, result `tooSoon: true`. (The existing
   spacing rule for learned cards sets the same flag.) Misses unchanged.
5. `sessionSummary`: `right` and `wrong` count only results without
   `tooSoon`; add `soon` = how many were too soon.

Tests: learn default 3; choices ranking (siblings first for a learned card,
at most one sibling for a new one, met before unmet, shared-tag rank, the
answer always in, length = settings.choices, fallbacks with few names);
intro spacing in the opening queue and in refill (≥ 3 between when
possible; adjacent allowed only when nothing else is queued); a right
answer 0-2 questions after the intro is too soon (no streak), the 3rd
counts; the summary's score excludes too-soon answers and reports `soon`.
Update tests that assumed learnStreak 2 by setting it explicitly where the
test is about something else.

Commit: "Ask harder name choices, and not straight after showing a variation"

### Task 14: View, docs, e2e

**Files:** `src/train-view.js`, `tests/train-view.test.mjs`,
`docs/user-guide.md`, `e2e/train.spec.mjs`

1. Pass `{ progress, deck }` to `nameChoices`.
2. Result for a too-soon answer after an intro: "Right" plus `p.tr-soon`
   "Too soon to count: it was just shown. It counts once other questions
   come in between." (the spacing rule's message stays for learned cards;
   tell them apart by a result field from Task 13, e.g. `soon: "intro"` /
   `"spacing"`).
3. Summary: "Right n / m" from the counted answers, then "k too soon to
   count" when k > 0 (title: why).
4. Settings tooltip for "Right in a row to learn" shows the new default.
5. Guide: the choices (confusable first, harder once learned), the intro
   spacing and too-soon rule, the summary's score, learn default 3.
6. e2e: keep all passing (tests that rely on learning in 2 set the setting
   explicitly).

Commit: "Explain too-soon answers after an intro and score only what counts"

### Verification (main session)

`npm run check`, `npm run test:e2e` twice; play a session on the dev
server's fixture.
