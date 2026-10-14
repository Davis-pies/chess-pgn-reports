# Train: the research-backed changes

Spec: `docs/superpowers/specs/2026-10-13-train-mode-design.md` (Cards,
Progression, Progress storage, Settings, The Train window), as amended for
`docs/superpowers/specs/2026-10-14-train-learning-research.md` ("Changes to
Train", 1-7). Davis agreed all seven (2026-10-14). Builds on
`2026-10-14-train-learning.md` (streaks), already done.

Branch `train-mode`. Tabs in `src/train*.js`, `tests/train*.test.mjs`; two
spaces in `e2e/`, `style.css`.

---

### Task 4: `src/train.js`

**Files:** `src/train.js`, `tests/train.test.mjs`

1. **Notes on cards.** `buildDeck(tree, lines, settings)`: each name /
   order / family card gets `notes`: an array of `{ move, text }` for the
   workbook comments on the moves from the parent's defining position (start
   at level 1) to the variation's own, taken from the first line whose moves
   begin with `v.orders[0]`; `move` labelled with `fullmoveLabel(ply) + san`
   (import it from `render.js`; do not write another). Book cards keep their
   `notes` object.
2. **Intro cards.** `buildDeck` also adds, per named variation, `{ id:
   "intro|<key>", type: "intro", key, vkey, level, notes }` (same notes)
   when `settings.introNew` (new setting, boolean, default true). Intro
   cards are never stored in progress, never count for learned/mastered/
   unlocking (`ownCards` must exclude them: it is "not book" today), never
   in practice sessions.
3. **Answer counter and spacing.** Progress gains `asked` (int ≥ 0).
   `emptyProgress()` has `asked: 0`. `answer` increments `progress.asked`
   and stores `seen = progress.asked` (drop the `now` parameter everywhere:
   `answer`, `markKnown`, callers in `train-view.js`, tests). A right
   answer on a card that was learned before this answer adds to its streak
   only if `progress.asked - rec.seen > SPACING` (const `SPACING = 10`,
   with a comment pointing at the research note), measured before this
   answer's increment; otherwise the streak stays and the result has
   `tooSoon: true`. Misses are unaffected. `loadProgress`: keep `asked` when
   an int ≥ 0; when absent, renumber the records' `seen` 1..n in the order
   of their old `seen` values (timestamps) and set `asked = n`. Keep
   `tricky` (boolean).
4. **New-card order.** In `newSession`'s fresh cards and in deepening,
   sort by (book last, then level, then deck order) — the sorts are stable
   so deck order needs no key.
5. **Interleaving.** One function used for the opening queue and for each
   deepening append (interleave only the appended part with the tail of
   the queue it follows): blocks are single non-book cards, and each
   variation's book cards as one run in deck order; place blocks in
   priority order but never one right after a block of the same `vkey` when
   a later block of another `vkey` can go there instead. Then put each
   intro (when its variation has no records yet and an intro card exists in
   the deck) immediately before its variation's first card in the queue.
   Requeues (misses, not-yet-learned) go at `i + 3`, moved further on while
   the card at that spot has the same `vkey`, up to the end.
6. **Intro answers.** `answer` on an intro card: `session.i++`, push
   nothing to results, store nothing, return `{ id, intro: true }`.
   `sessionSummary`'s score ignores intros (there are none in results).
7. **Difficulty.** After each answer (not practice): if two of the last
   five results are misses, remove from the queue after `session.i` every
   card with no progress record, and their intros, give them back to
   `newLeft` (they were counted), and skip deepening for this answer.
8. **Tricky.** Count this card's misses in `session.results`; at three,
   do not requeue it, set `tricky: true` on its record and add its id to
   `session.tricky` (a Set created by `newSession`). When a card becomes
   learned (streak reaches `learnStreak`), clear `tricky`. `sessionSummary`
   adds `tricky`: `[{ id, vkey, name }]` for `session.tricky` (name of the
   variation, or "Book" for vkey ""). Export `isTricky(vkey, deck,
   progress)` (any card of the variation tricky) for the outline.
9. **Unlock goal.** Export `unlocksIfLearned(vkey, tree, deck, progress,
   settings)`: how many of the variation's children (and `also`-children,
   i.e. variations listing it in `also`) are not unlocked now.

Tests: each numbered rule, plus loading old progress (timestamps → counter),
the spacing threshold exactly at 10/11, intros placed and skipped in
practice / when off, interleaving keeps book runs together and never puts
two same-variation cards together when avoidable, the difficulty hold-back,
tricky after the third miss and cleared on learning, new-card order (book
last). Update existing tests for the dropped `now` parameters.

Commit: "Space, explain, interleave and pace Train's questions"

### Task 5: `src/train-view.js`

**Files:** `src/train-view.js`, `style.css`, `tests/train-view.test.mjs`,
`src/app.js` only if a call signature changed

1. **Intro screen**: when the current card is an intro: progress line as
   for questions, prompt `New: <name>`, the board at the variation's
   position (BOARD, reader's orientation), `p.tr-moves` with
   `node.orders[0]` joined, the notes as `p.tr-note` (`<move> <text>`,
   text through `renderInline`), chips **Learn it** (`learn(v)`) and
   **Got it** (`tr-next`, calls `answer` then next; Enter does the same).
   No status line.
2. "Question n of m" counts only non-intro cards (n = non-intro cards
   before and including the current one).
3. **Notes in every result**: after the detail lines, `card.notes` for
   name/order/family (array) and book (object, as today), each a
   `p.tr-note`. Remove the "New to you? Learn it" chip and the `fresh`
   bookkeeping.
4. **Result wording**: `tooSoon` → heading "Right" plus `p.tr-soon` "Too
   soon to count towards mastery: it counts when other questions come in
   between." (title explains the spacing rule).
5. **Status line**: when the card's variation is not learned and
   `unlocksIfLearned(...) > 0`, append ` · learn it to unlock N
   variation(s)`.
6. **Summary**: "Tricky: A (name), B (order)…" with one **Learn it** chip
   per distinct variation (book: none), title "Missed three times: study it
   before drilling it again".
7. **Outline**: `span.tr-badge` "tricky" (title "A question here was
   missed three times: Learn it before drilling it again") when
   `isTricky`.
8. **Settings**: "Show a new variation first" checkbox in Sessions, with
   tooltip and default like the others.
9. CSS: `.tr-soon` muted like `.tr-progress`; `.tr-intro` nothing special
   beyond what `.tr-question` gives (reuse its classes where possible).

Tests: intro screen content and Got it/Enter advancing without scoring;
question numbering skips intros; notes in name/order results; too-soon
wording; status unlock goal (and absent once learned / with no children);
summary tricky list and Learn it; outline tricky badge; the new setting.

Commit: "Show new variations first and explain every Train answer"

### Task 6: Docs, e2e, floors

**Files:** `docs/user-guide.md`, `e2e/train.spec.mjs`, `package.json`

1. User guide, Train section: the intro step, notes after every answer,
   spacing in questions ("too soon to count"), interleaving, the hold-back
   when struggling, tricky questions, the unlock goal in the status line,
   the new setting.
2. e2e: keep all passing (the existing tests may now meet an intro first:
   click Got it where needed, or switch the setting off in that test). Add
   one: a fresh workbook with names shows "New: …" first, Got it, then the
   question.
3. Coverage floors in `package.json`: raise to just under the current
   figures (CLAUDE.md: raise the floors when coverage improves), rounding
   down to whole numbers.

Commit: "Document Train's research-backed changes and raise coverage floors"

### Verification (main session)

`npm run check`, `npm run test:e2e`; review against the spec and the
research note; try it on the dev server.
