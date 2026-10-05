# Repertoire Audit Implementation Plan

**Goal:** Search every unique position of the workbook with the engine in
the background and report the moves that lose ground.

**Spec:** `docs/superpowers/specs/2026-10-05-repertoire-audit-design.md`

## Files

| File | Change |
| --- | --- |
| `src/audit.js` | **New.** `auditPositions`, `overEval`, `shareOf`, `GRADES`/`gradeOf`, `auditReport`, `auditWorkers`, `createAudit` (worker pool over UCI), `sharedAudit`. |
| `src/audit-store.js` | **New.** `evalStore.load(keys)` / `save(entries)` over IndexedDB; failures fall back to searching again. |
| `src/audit-view.js` | **New.** `auditChip()` for the toolbar and `auditPanel()` for the report, refilled in place. |
| `src/app.js` | **Modify.** The chip after Study; the panel after the workbook list. |
| `src/prefs.js` | **Modify.** `auditDepth` (12, 14 or 16). |
| `style.css` | **Modify.** `.audit*` rules; hidden in print. |
| `tests/audit.test.mjs` | **New.** Positions, grading, report, the controller with a fake UCI worker, the store with fake-indexeddb. |
| `tests/audit-view.test.mjs` | **New.** The chip and panel in the app with a fake global `Worker`. |
| `e2e/engine.spec.mjs` | **Modify.** A real-engine run with the study used mid-run, and the evals kept across a page load. |

## Steps

- [x] Time Stockfish lite per position in Chromium at depths 10-14, one engine vs. threads vs. parallel engines.
- [x] `auditPositions` and the report, with line walks and best-move SAN cached.
- [x] The controller: pool, queue, handshake, stop, error, add, restore, time to go.
- [x] IndexedDB store.
- [x] Panel and chip, in-place repaint, no full re-render.
- [x] Unit, app and browser tests; coverage floors held.
- [x] User guide, README, architecture.
- [x] Usability pass: desktop and phone, light and dark.
