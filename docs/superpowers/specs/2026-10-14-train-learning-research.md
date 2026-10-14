# Train: what learning research says, and what it changes

Davis asked (2026-10-14) for research on what makes learning tools effective,
applied to Train as respecified that day: streaks instead of boxes, learned
and mastered from answers alone, a miss on a mastered card dropping it one
stage, no dates. These are the findings that bear on it and the changes they
suggest. Sources at the end; where only a secondary summary was reachable it
says so.

## Findings

1. **Testing and spacing are the two strongest techniques.** Dunlosky et
   al.'s review rated only practice testing (retrieval) and distributed
   practice "high utility"; interleaving "moderate", with later work arguing
   higher. Train is retrieval practice already; spacing is where it is weak.
2. **Spaced sessions beat repetition in one sitting (successive
   relearning).** Practise each item to a criterion in a first session
   (misses come back later in that session; an item drops out once it hits
   the criterion), then relearn it in a few later sessions, one correct
   recall each. Recalling an item once in each of several sessions retains
   far more than recalling it the same number of times in one session.
   About three relearning sessions give most of the benefit; the size of the
   first-session criterion matters less once relearning happens (Vaughn and
   Rawson recommend three correct recalls first). Very short gaps are no
   better than massing. (Secondary summaries; the primary papers were not
   reachable.)
3. **Retrieval helps only at the right difficulty.** Too high or too low a
   success rate does little; a model result puts the fastest learning near
   85% right (Wilson et al. 2019, two-choice tasks: a guide, not a law).
4. **Explained feedback beats right/wrong.** A meta-analysis of
   computer-based feedback (40 studies) found effect sizes of 0.05 for
   right/wrong alone, 0.32 for the correct answer, 0.49 for an explanation.
5. **Novices learn better from a worked example first.** Studying an example
   before being tested beats solving cold; the benefit fades as knowledge
   grows (expertise reversal), so the examples should fade too.
6. **Interleaving.** Mixing topics instead of blocking them improves
   discrimination between similar items, which is exactly the problem with
   sibling opening variations.
7. **Leeches.** Items missed again and again are not fixed by more of the
   same; Anki's advice is to change how they are presented or understand
   them first.
8. **Competence and visible progress.** Self-determination theory: progress
   tracking supports motivation only when goals are clear and achievable and
   feedback is informative. Daily-streak mechanics drive engagement, not
   learning, and Duolingo reports that bingeing predicts dropping out.
9. **Chess trainers.** Chessable's MoveTrainer interleaves short commentary
   with quizzes and repeats the sequence at the end; its critics say rote
   memorising without the why does not carry over to play. Other trainers
   (Chessbook, Chessstack) vary the opponent's replies.

## Changes to Train

In order of expected value; each is small against the respecified design.

1. **Spacing counted in questions, not time** (2). A right answer on a
   learned card moves it towards mastery only if at least 10 other
   questions have been answered since that card was last asked; otherwise
   it counts as right but does not add to the streak. `seen` becomes the
   number of the answer that last asked the card (a counter in the progress,
   not a clock), which also orders "least recently asked". This keeps
   mastery about answers (Davis's rule), and stops mastering a card in
   back-to-back sessions. Combined with "once learned, not repeated in the
   same session", mastery takes three separate re-checks after learning:
   the relearning pattern.
2. **See a new variation before being quizzed on it** (5, 9). The first
   time a session reaches a variation, an unscored "New: <name>" step shows
   the board at its position, the moves that reach it and the workbook's
   notes on them, with **Learn it** (Study) and **Got it**. Setting "Show a
   new variation first" (on). It replaces the "New to you? Learn it" chip
   that appeared only after the first answer.
3. **Explain every answer** (4, 9). The result shows the workbook's notes
   for what was asked: for name/order/family questions, the notes on the
   moves that reach the variation (as book questions already show the
   move's note). Shown after every answer, first thing after a miss.
4. **Interleave the session** (6). Spread a variation's cards apart in the
   queue: never two cards of one variation back to back (a name question
   straight after its order question gives it away). A book run stays in
   move order.
5. **Keep it at the right difficulty** (3, 8). New questions, and those
   unlocked mid-session, join only while the session goes well: none while
   two of the last five answers were misses. Defaults stay small (5 new a
   session).
6. **Tricky questions** (7). A question missed three times in a session is
   not asked again in it; the summary lists it as tricky with **Learn it**,
   and the outline marks its variation. No endless requeueing.
7. **Progress as goals** (8). The status line says what learning a
   variation opens ("learn it to unlock 3 variations"), and the outline's
   overview stays the single progress summary. No daily streaks or points.

Not adopted: time-based schedulers (FSRS, Leitner): Davis ruled out time.
Varying the opponent's replies in book runs: worth doing, but separate.

## Sources

- Dunlosky et al. 2013 and later commentary: https://firth.substack.com/p/jonathan-firth-s-memory-metacognition-updates-15-dunlosky-et-al-s-list-of-strategies-1347143, https://openlearning.mit.edu/mit-faculty/research-based-learning-findings/spaced-and-interleaved-practice, https://cognitiveresearchjournal.springeropen.com/articles/10.1186/s41235-017-0087-y
- Successive relearning: https://journals.sagepub.com/doi/full/10.1177/09637214221100484, https://archive.memory-key.com/node/2463, https://psychologicalscience.org/?p=193451, https://www.retrievalpractice.org/archive/2018/successive-relearning
- 85% rule: https://pmc.ncbi.nlm.nih.gov/articles/PMC6831579
- Feedback meta-analysis: https://acuresearchbank.acu.edu.au/item/86y84/effects-of-feedback-in-a-computer-based-learning-environment-on-students-learning-outcomes-a-meta-analysis
- Worked examples, expertise reversal: https://en.wikipedia.org/wiki/Worked-example_effect
- Desirable difficulties: https://www.psychologicalscience.org/observer/desirable-difficulties
- Leeches: https://docs.ankiweb.net/manual/leeches
- Motivation: https://selfdeterminationtheory.org/wp-content/uploads/2022/10/2022_JenoEdgelandsalGrytnes_AQualitative.pdf, https://blog.duolingo.com/how-duolingo-streak-builds-habit
- Chess trainers: https://notes.andymatuschak.org/zDr94hP6bG3jJYrdYy8B5hx, https://juntaikeda.substack.com/p/3-lifetime-repertoires-the-10-pitfalls, https://alternativeto.net/software/chessstack/about/
