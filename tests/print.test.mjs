import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { appendPrintTables } from "../src/print.js";
import { grid } from "../src/table.js";
import { getCurrent } from "../src/state.js";

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
