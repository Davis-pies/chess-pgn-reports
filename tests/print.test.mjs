import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { appendPrintTables } from "../src/print.js";
import { grid } from "../src/table.js";
import { getCurrent, openTablePaths, setTraced } from "../src/state.js";

// A long mainline plus enough shallow sidelines to force packForPrint to emit
// more than one table (each diverges at ply 1, so each becomes its own chunk).
const ALTS = "c5 e6 c6 d5 d6 Nf6 g6 b6 a6 Nc6 f5 h6 a5 b5"
  .split(" ")
  .map((m) => `(1... ${m})`)
  .join(" ");
const MAIN =
  "2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O";

function printTables(pgn) {
  const s = loadState(pgn);
  getCurrent().showSplitTrie = true;
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  return box;
}

test("the first print table runs the mainline out to its full length", () => {
  const off = installDom();
  const box = printTables(`1. e4 e5 ${ALTS} ${MAIN}`);
  const tables = [...box.querySelectorAll("table.tbl")];
  assert.ok(tables.length > 1, "the fixture packs into several tables");
  const rows = (t) => t.querySelectorAll("tr").length - 1; // minus the header
  // the mainline is 16 plies; the first table shows all of it even though its
  // own branches are only a couple of moves deep
  assert.strictEqual(rows(tables[0]), 16, "first table spans the mainline");
  // later tables still stop at the deepest line they actually cover
  assert.ok(
    rows(tables[1]) < 16,
    `later tables stay truncated (got ${rows(tables[1])})`,
  );
  off();
});

test("the mainline's notes print under the first table only", () => {
  const off = installDom();
  const st = loadState(`1. e4 e5 ${ALTS} ${MAIN}`);
  getCurrent().showSplitTrie = true;
  // The editor shares a note by writing it onto every line in an equal-position
  // group, so the mainline's note also lives on sidelines. Reproduce that here:
  // raw PGN comments never end up on more than one line.
  const note = { ply: 0, text: "mainline note" };
  st.lines.forEach((l) => {
    l.comments = [note];
  });
  const box = document.createElement("div");
  appendPrintTables(box, grid(st.lines));
  assert.ok(
    box.querySelectorAll("table.tbl").length > 1,
    "the fixture packs into several tables",
  );
  const withNote = [...box.querySelectorAll(".print-notes")].filter((b) =>
    b.textContent.includes("mainline note"),
  );
  assert.strictEqual(
    withNote.length,
    1,
    "the mainline note is not repeated under a later table",
  );
  off();
});

test("every table is followed by a notes block, empty when it has no notes", () => {
  const off = installDom();
  const box = printTables(`1. e4 e5 ${ALTS} ${MAIN}`);
  const tables = box.querySelectorAll("table.tbl");
  const blocks = box.querySelectorAll(".print-notes");
  // the blocks carry the gap between tables, so there must be one per table
  assert.strictEqual(blocks.length, tables.length);
  assert.ok(
    [...blocks].some((b) => b.classList.contains("empty")),
    "a table without notes still gets a block, marked empty",
  );
  [...blocks]
    .filter((b) => b.classList.contains("empty"))
    .forEach((b) => assert.strictEqual(b.childNodes.length, 0));
  off();
});

test("a footnote prints in the notes block under the first table", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6", {
    tags: { 1: "foot" },
  });
  s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
  s.showFootNames = true; // footnote names are off by default
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  const blocks = [...box.querySelectorAll(".print-notes")];
  assert.ok(blocks.length, "a notes block is emitted");
  assert.match(blocks[0].textContent, /Sicilian/, "the footnote prints");
  assert.strictEqual(
    blocks[0].querySelector(".nt sup").textContent,
    "[1]",
    "numbered, not lettered",
  );
  off();
});

test("a footnote's own notes print nested under it", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3 Nc6 {knight move}) 2. Nf3 Nc6", {
    tags: { 1: "foot" },
  });
  s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
  s.showFootNames = true; // footnote names are off by default
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  const block = box.querySelector(".print-notes");
  assert.match(block.textContent, /Sicilian/);
  const subs = [...block.querySelectorAll(".subnote")];
  assert.strictEqual(subs.length, 1);
  assert.strictEqual(subs[0].querySelector("sup").textContent, "[a]");
  off();
});

test("the print notes block renders a group's nested members", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
    tags: { 1: "foot", 2: "foot" },
  });
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  const rows = box.querySelectorAll(".print-notes .fnode");
  assert.strictEqual(rows.length, 2, "both members appear under one note");
  assert.strictEqual(
    box.querySelectorAll(".print-notes > .nt > sup").length,
    1,
    "one [n] marker for the whole group",
  );
  off();
});

// The screen preview folds branches into group columns, tints the block a fold
// would take, and elides the moves that block's header already shows. None of
// that is allowed to reach the printed report: appendPrintTables builds from
// grid() straight, so every line prints its full divergence from the mainline.
test("the printed table is untouched by the preview's grouping", () => {
  const off = installDom();
  openTablePaths.add("1:c5");
  openTablePaths.add("1:c5/2:Nf3");
  const box = printTables(
    "1. e4 e5 (1... c5 2. Nf3 Nc6 3. Bb5) (1... c5 2. Nf3 Nc6 3. a4) 2. Nf3",
  );
  assert.strictEqual(
    box.querySelectorAll(".grp, .collapsed, .clickable").length,
    0,
    "no group shading, stubs or fold controls in print",
  );
  const rows = [...box.querySelectorAll("table.tbl tr")];
  const col = (i) => rows.slice(1).map((tr) => tr.children[i].textContent);
  assert.deepStrictEqual(
    col(2),
    ["\u2026", "c5", "Nf3", "Nc6", "Bb5"],
    "print keeps each line's whole divergence",
  );
  assert.deepStrictEqual(col(3), ["\u2026", "c5", "Nf3", "Nc6", "a4"]);
  openTablePaths.clear();
  off();
});

// Tracing is a screen affordance. appendPrintTables builds from grid() and
// passes renderTable no trace object, so a trace left on when the reader hits
// Print cannot dim the report or leave click handlers in the printed DOM.
test("a trace does not reach the printed report", () => {
  const off = installDom();
  setTraced("e4 c5 Nf3 d6 d4");
  openTablePaths.add("1:c5");
  const box = printTables("1. e4 e5 (1... c5 2. Nf3 d6 3. d4 (3. Bb5+)) 2. Nf3");
  assert.strictEqual(box.querySelectorAll(".traced, .faded").length, 0);
  assert.strictEqual(box.querySelectorAll(".traceable").length, 0);
  setTraced(null);
  openTablePaths.clear();
  off();
});
