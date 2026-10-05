import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { bootApp, captureDownloads } from "./helpers.mjs";
import { getCurrent, getScratch } from "../src/state.js";
import { isMainLine } from "../src/tree.js";
import { sharedAudit } from "../src/audit.js";

// Workbooks as older builds saved them. Each file in fixtures/workbooks was
// written by that build's own toNotebook (its src/ taken from git at the
// commit that changed the format, fed the same annotated PGN), so these are
// the bytes a user of that build has on disk, not a guess at them:
//
//   2026-09-07-view      019da98, the oldest build in history: format stamp
//                        and print settings in `view`, no analysis board
//   2026-09-26-analysis  91625b5, the analysis board added, with its since
//                        dropped `root` filter
//   2026-09-27-header    22fe5b0, Game info edits in `header`, and the since
//                        dropped `view.printSummary`
//   2026-10-03-current   a354b13, analysis lines with names
//   2026-10-05-audit     this build, the audit's evals in `audit`
//
// legacy-glyphs predates the history the repository keeps, so it was
// rebuilt from what store.js and nags.js say such workbooks held: no format
// stamp, no `view`, no `hidden`, marks as bare glyphs (including the "+="
// alias), and lines tagged "main"/"minor".
//
// Every fixture holds the same annotations, so one set of expectations checks
// them all; the format-specific parts are checked per file below.
const FIXTURES = [
  "legacy-glyphs",
  "2026-09-07-view",
  "2026-09-26-analysis",
  "2026-09-27-header",
  "2026-10-03-current",
  "2026-10-05-audit",
];
const read = (name) =>
  fs.readFileSync(
    new URL(`./fixtures/workbooks/${name}.json`, import.meta.url),
    "utf8",
  );

const app = await bootApp();

const key = (l) => l.moves.map((m) => m.san).join(" ");
const find = (k) => getCurrent().lines.find((l) => key(l) === k);

// The way a user reopens a workbook saved in this browser: the entry sits in
// localStorage and they click it in the import panel's list.
async function openFromStorage(name, text) {
  app.reset();
  // the list is built when the import panel renders, so leave it and come
  // back to pick up the entry written after reset() cleared the store
  await app.loadPgn("1. d4");
  app.dom.window.localStorage.setItem("ott:old", text);
  app.clickText("New / Import");
  app.clickText("Open: ");
  await app.settle();
  assert.deepStrictEqual(app.alerts, [], `${name} opens without an error`);
}

// The way a user opens a workbook they saved to a file.
async function openFromFile(name, text) {
  app.reset();
  const input = app.view().querySelector("input.wbin");
  const file = new app.dom.window.File([text], `${name}.json`);
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.onchange();
  await app.settle();
  assert.deepStrictEqual(app.alerts, [], `${name} opens without an error`);
}

// What every fixture holds, whatever build wrote it.
function checkAnnotations(name) {
  const c = getCurrent();
  assert.strictEqual(c.lines.length, 4, `${name}: every line of the PGN`);

  const petroff = find("e4 e5 Nf3 Nf6 Nxe5 d6");
  assert.ok(isMainLine(petroff), `${name}: the promoted mainline stays main`);
  assert.strictEqual(
    petroff.tag,
    undefined,
    `${name}: the mainline has no tag`,
  );
  assert.strictEqual(petroff.name, "Petroff");
  assert.deepStrictEqual(petroff.marks, { 4: "$1" });
  assert.deepStrictEqual(petroff.comments, [{ ply: 5, text: "the main idea" }]);

  const ruy = find("e4 e5 Nf3 Nc6 Bb5 a6 Ba4");
  assert.ok(!isMainLine(ruy), `${name}: the PGN's own mainline is demoted`);
  assert.strictEqual(ruy.tag, "sideline", `${name}: "minor" reads as sideline`);
  assert.strictEqual(ruy.name, "Ruy Lopez");
  assert.deepStrictEqual(ruy.meta, { eval: "=" });
  assert.deepStrictEqual(ruy.marks, { 4: "$1", 5: "$6" });
  assert.deepStrictEqual(ruy.comments, [{ ply: 4, text: "Spanish torture" }]);
  assert.strictEqual(ruy.hidden, false);

  const berlin = find("e4 e5 Nf3 Nc6 Bb5 Nf6 O-O");
  assert.strictEqual(berlin.tag, "foot");
  assert.strictEqual(berlin.name, "Berlin");
  assert.strictEqual(berlin.marks[5], "$14", `${name}: "+=" reads as ⩲`);

  const philidor = find("e4 e5 Nf3 d6 d4");
  assert.strictEqual(philidor.name, "Philidor");
  assert.strictEqual(philidor.tag, "sideline");
}

// What each build added on top, checked against what that build wrote.
function checkFormat(name, nb) {
  const c = getCurrent();
  const philidor = find("e4 e5 Nf3 d6 d4");
  const berlin = find("e4 e5 Nf3 Nc6 Bb5 Nf6 O-O");

  if (name === "legacy-glyphs") {
    // no `hidden` yet: every line loads visible
    assert.strictEqual(philidor.hidden, false);
    // the paired glyph on a White move takes the White code
    assert.strictEqual(berlin.marks[4], "$40");
    // no `view`: the session's defaults, not stray values
    assert.strictEqual(c.boardSize, 300);
    assert.strictEqual(c.cardFont, 100);
    assert.strictEqual(c.noMain, false);
    assert.strictEqual(c.showFinalBoard, true);
  } else {
    assert.strictEqual(
      philidor.hidden,
      true,
      `${name}: a hidden line stays hidden`,
    );
    assert.deepStrictEqual(Object.keys(berlin.marks), ["5"]);
    // the print settings the workbook was saved with
    assert.strictEqual(c.boardSize, 240);
    assert.strictEqual(c.cardFont, 90);
    assert.strictEqual(c.printCards, false);
    assert.strictEqual(c.printTables, true);
    assert.strictEqual(c.printByMove, true);
    assert.strictEqual(c.printRowPad, 3);
    assert.strictEqual(c.showFinalBoard, false);
    assert.strictEqual(c.showFirstDivBoard, true);
    assert.strictEqual(c.showFootNames, true);
  }

  const s = getScratch();
  if (!nb.analysis) {
    assert.ok(!s || !s.lines.some((l) => l.moves.length), `${name}: no board`);
  } else {
    // the board as it was left: both lines, the cursor, the flip and the
    // note, with an older build's `root` ignored rather than tripped over
    assert.deepStrictEqual(s.lines.map(key), [
      "e4 e5 Nf3 Nc6 Bb5 a6 Ba4",
      "e4 c5 Nf3",
    ]);
    assert.strictEqual(s.active, 1);
    assert.strictEqual(s.at, 2);
    assert.strictEqual(s.flipped, true);
    assert.deepStrictEqual(s.lines[1].comments, [{ ply: 1, text: "Sicilian" }]);
    if (name >= "2026-10-03")
      assert.strictEqual(s.lines[0].name, "Spanish");
  }

  if (nb.audit) {
    // what the audit found comes back, per build, as the app's own evals
    const { lite, full } = sharedAudit().all;
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
    assert.strictEqual(Object.keys(nb.audit.lite).length, 15);
    for (const [k, [depth]] of Object.entries(nb.audit.lite))
      assert.strictEqual(lite.get(k).depth, depth, `${name}: ${k}`);
    assert.ok(Object.values(nb.audit.lite).some(([, s]) => s === "#4"));
    assert.deepStrictEqual(full.get(start), {
      depth: 24,
      score: { cp: 15 },
      best: "e2e4",
    });
  }

  if (nb.header) {
    assert.deepStrictEqual(c.header, {
      White: "Carlsen, Magnus",
      Date: "2026.09.27",
    });
  } else {
    assert.ok(!c.header, `${name}: no Game info edits`);
  }
}

for (const name of FIXTURES) {
  const text = read(name);
  const nb = JSON.parse(text);

  test(`a ${name} workbook opens from this browser's saved list`, async () => {
    await openFromStorage(name, text);
    assert.strictEqual(getCurrent().name, nb.name);
    assert.strictEqual(getCurrent().pgn, nb.pgn);
    checkAnnotations(name);
    checkFormat(name, nb);
  });

  test(`a ${name} workbook opens from a file`, async () => {
    await openFromFile(name, text);
    assert.strictEqual(getCurrent().name, nb.name);
    checkAnnotations(name);
    checkFormat(name, nb);
  });

  // Saving an old workbook writes it in today's format, and that copy opens
  // to the same workbook: nothing read on the way in is lost on the way out.
  test(`a ${name} workbook re-saves in the current format`, async () => {
    await openFromFile(name, text);
    const cap = captureDownloads(app.dom.window.document);
    app.clickText("Save to file");
    cap.restore();
    const again = JSON.parse(await cap.blobs[0].text());
    assert.strictEqual(again.format, "ott-workbook");
    assert.strictEqual(again.version, 1);
    assert.strictEqual(again.main, "e4 e5 Nf3 Nf6 Nxe5 d6");
    // the evals go out as they came in; a workbook from before the audit,
    // opened on a page that has audited nothing, carries none
    assert.deepStrictEqual(again.audit, nb.audit);
    await openFromFile(name, JSON.stringify(again));
    checkAnnotations(name);
    checkFormat(name, nb);
  });
}
