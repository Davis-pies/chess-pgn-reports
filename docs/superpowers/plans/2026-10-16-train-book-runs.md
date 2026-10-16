# Plan: Train book runs

Spec: [2026-10-16-train-book-runs-design.md](../specs/2026-10-16-train-book-runs-design.md).

1. `train.js` deck: book cards per (position, move) with `san`, `moves` (all
   book moves there), `note`, and `lines` (the runs through it: `sans`,
   per-ply `notes`, `marks` of named positions). `under` per move. Drop
   `bookRule` and `checkBook`.
2. `train.js` scoring: factor the streak update out of `answer` (`score`);
   `credit` bumps book moves played whether asked or not, and can skip them
   (a run scores its own); `bookOpen` reads the order card; `byNewness`
   sorts by level only.
3. `train.js` runs: `startRun`, `runPlay`, `runShow`, `runOn` (pure state),
   `answerRun` (scores every move, the order card, credit, one result,
   queue clean-up and requeue).
4. `train-view.js`: the run screen (prompt, board, hint, notes, Show me / Go
   on, Enter), its result; the order miss's target board; settings without
   "Accept".
5. Tests in `tests/train.test.mjs` and `tests/train-view.test.mjs`; e2e
   untouched unless it breaks.
6. Docs: Train design's book bullet points here; user guide; `npm run
   check`, `npm run test:e2e`; merge to master.
