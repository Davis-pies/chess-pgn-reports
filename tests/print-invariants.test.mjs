import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { installDom, loadState } from "./helpers.mjs";
import { grid } from "../src/table.js";
import { appendPrintTables } from "../src/print.js";

// Properties the printed report must hold for ANY notebook, checked over one
// deliberately awkward one.
//
// The scenario tests beside this file pin particular fixtures to particular
// cells, which is what you want for "does this feature work". They are the
// wrong shape for the faults that actually reached the user: a move deleted
// somewhere in a 200-line report, a run resuming past a move so it appeared to
// leave a different line, a table vanishing when a notebook had no sidelines.
// Those are properties of the whole output, and none of them is visible in a
// five-line fixture.

// Branches leaving the mainline at three different moves, the first of them a
// group of sixteen with its own nested structure -- wide enough to be packed
// across several tables, so the paging is exercised too.
const KID = [
  "Nf3", "Be2", "f3", "Bd3", "h3", "Be3", "g3", "Nge2",
  "Bg5", "Bd2", "f4", "Qd2", "a3", "Rb1", "Qc2", "b4",
];
const SLAV = ["Nf3", "e3", "cxd5", "Bg5", "Qb3"];
const AWKWARD =
  "1. d4 d5 " +
  KID.map((m) => `(1... Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. ${m})`).join(" ") +
  " 2. c4 e6 " +
  SLAV.map((m) => `(2... c6 3. ${m})`).join(" ") +
  " 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O *";

function report(pgn) {
  const s = loadState(pgn);
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  return { state: s, box };
}

// Every table's cell text, as ply -> the set of things printed on that row.
// Row 0 is the header, so row i + 1 is ply i.
function rowsByPly(box) {
  const out = [];
  for (const table of box.querySelectorAll("table.tbl")) {
    const per = new Map();
    [...table.querySelectorAll("tr")].slice(1).forEach((tr, ply) => {
      const texts = new Set(
        [...tr.children].map((c) => c.textContent).filter(Boolean),
      );
      per.set(ply, texts);
    });
    out.push(per);
  }
  return out;
}

// Marked cells, grouped into the contiguous stretches that make up one run.
// A row can carry several runs -- two groups can fork at the same ply in
// different parts of the table -- so this must not treat a row as one run.
function runsIn(box) {
  const runs = [];
  for (const table of box.querySelectorAll("table.tbl"))
    for (const tr of table.querySelectorAll("tr")) {
      const idx = [...tr.children]
        .map((td, i) => (td.classList.contains("grp-rule") ? i : -1))
        .filter((i) => i >= 0);
      let k = 0;
      while (k < idx.length) {
        let j = k;
        while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
        runs.push(idx.slice(k, j + 1).map((i) => tr.children[i]));
        k = j + 1;
      }
    }
  return runs;
}

test("no move is ever missing from the printed report", () => {
  const off = installDom();
  const { state, box } = report(AWKWARD);
  const byPly = rowsByPly(box);

  // A line's early moves are elided against whichever column states them, so
  // the move belongs to the ROW rather than to the line's own column -- but it
  // has to be on that row, in some table, or the reader cannot read the line.
  for (const line of state.lines)
    for (const m of line.moves)
      assert.ok(
        byPly.some((t) => t.get(m.ply)?.has(m.san)),
        `${m.san} at ply ${m.ply} is printed nowhere`,
      );
  off();
});

test("a group mark never stands where a move should be", () => {
  const off = installDom();
  const { box } = report(AWKWARD);
  const marked = [...box.querySelectorAll("td.grp-rule")];
  assert.ok(marked.length >= 20, `only ${marked.length} marked cells`);
  // a marked cell is rendered empty, so one carrying text means the mark took
  // a move's place and the move is gone from the report
  for (const td of marked)
    assert.strictEqual(td.textContent, "", "a mark stands on a move");
  off();
});

test("every run is unbroken and ends in its corner", () => {
  const off = installDom();
  const { box } = report(AWKWARD);
  const runs = runsIn(box);
  // the fixture draws 6 runs over 26 covered cells across 2 tables -- asserted
  // so that a change gutting the marks fails here rather than passing vacuously
  assert.ok(runs.length >= 5, `only ${runs.length} runs: are any being drawn?`);
  for (const cells of runs) {
    // A run that stopped short and resumed past an obstacle reads as a run
    // leaving THAT line -- the very ambiguity the marks exist to remove. Each
    // stretch must therefore be a whole run, which is to say it ends in the
    // corner that closes one.
    assert.ok(
      cells[cells.length - 1].querySelector(".gm-end"),
      "a run stops without closing, so it was broken around something",
    );
    // and nothing but the mark span lives in a covered cell
    for (const td of cells)
      assert.strictEqual(
        [...td.children].filter((c) => !c.classList.contains("gm")).length,
        0,
      );
  }
  off();
});

test("no annotation is printed twice on one row", () => {
  const off = installDom();
  const s = loadState(AWKWARD);
  // annotate a move several lines share, the way the editor does: onto every
  // line through that position. Only the column stating the move should show
  // it, so the same note must not come out once per line carrying it.
  s.lines
    .filter((l) => !l.isMain && l.moves.some((m) => m.ply === 5))
    .forEach((l) => {
      l.comments = [{ ply: 5, text: "shared" }];
      l.marks = { ...(l.marks || {}), 5: "$1" };
    });
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));

  for (const table of box.querySelectorAll("table.tbl"))
    for (const tr of table.querySelectorAll("tr")) {
      const notes = tr.querySelectorAll("td sup").length;
      const syms = tr.querySelectorAll("td .mv-mark").length;
      assert.ok(notes <= 1, `${notes} note markers on one row`);
      assert.ok(syms <= 1, `${syms} symbols on one row`);
      // and neither may sit in a cell that states no move -- an annotation
      // belongs to the move, and such a cell has none
      for (const td of tr.querySelectorAll("td")) {
        const first = td.childNodes[0];
        if (first && first.nodeType === 3 && first.textContent.trim()) continue;
        assert.strictEqual(td.querySelector(".mv-mark"), null);
        assert.strictEqual(td.querySelector("sup"), null);
      }
    }
  off();
});

test("a notebook with no sidelines still prints its table and notes", () => {
  const off = installDom();
  const { box } = report("1. e4 e5 2. Nf3 Nc6 3. Bb5 *");
  assert.strictEqual(
    box.querySelectorAll("table.tbl").length,
    1,
    "the mainline is a report on its own",
  );
  assert.ok(box.querySelector(".print-notes"), "and its notes block is emitted");
  off();
});

test("every line reaches some printed table", () => {
  const off = installDom();
  const { state, box } = report(AWKWARD);
  const tables = box.querySelectorAll("table.tbl").length;
  assert.ok(tables > 1, "the fixture really is packed across several tables");
  // the columns across every table, less one mainline reference column each
  const cols = [...box.querySelectorAll("table.tbl")].reduce(
    (n, t) => n + t.querySelectorAll("tr")[0].children.length - 2,
    0,
  );
  assert.strictEqual(
    cols,
    state.lines.filter((l) => !l.isMain).length,
    "every line has exactly one column, across all the tables",
  );
  off();
});

// ---------------------------------------------------------------------------
// Two of the faults that reached the user were invisible to jsdom, which has
// no layout or print engine: a positioned <td> silently dropping the table's
// borders, and marks drawn as backgrounds silently vanishing from the printed
// page. Neither can be caught by rendering. They CAN be caught by reading the
// stylesheet, which is what these do -- crude, but they are exactly the two
// mistakes that were made, and both were made twice.
// ---------------------------------------------------------------------------

const CSS = readFileSync(new URL("../style.css", import.meta.url), "utf8");

// The declarations of one selector, as written.
function block(selector) {
  const i = CSS.indexOf(selector + " {");
  assert.notStrictEqual(i, -1, `no rule for ${selector}`);
  return CSS.slice(i, CSS.indexOf("}", i));
}

// Every rule in the sheet, as [selector, declarations].
function rules() {
  return [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [
    m[1].trim(),
    m[2],
  ]);
}

test("no table cell is positioned, which would drop the table's borders", () => {
  // The print engine loses border-collapse rendering on a positioned cell --
  // the walls come out missing or uneven. The sticky reference columns hit
  // this already, which is why the print block forces them static; anchoring
  // the group marks to the <td> hit it a second time, and the walls went with
  // it. The marks hang off a span inside the cell instead.
  //
  // `.sticky-col` is the one allowed exception, and only because the print
  // block below cancels it.
  const offenders = rules().filter(
    ([sel, body]) =>
      /(^|[\s,>])(td|th)[.:#\s,]/.test(sel + " ") &&
      /position\s*:\s*(relative|absolute|sticky)/.test(body) &&
      !sel.includes("sticky-col"),
  );
  assert.deepStrictEqual(
    offenders.map(([sel]) => sel),
    [],
    "these rules position a table cell, which drops the table's borders in print",
  );
  // the exception is cancelled where it matters: inside the print block
  assert.match(
    CSS,
    /\.tbl \.sticky-col \{\s*position:\s*static;/,
    "the sticky columns must still be made static for print",
  );
});

test("the group marks are drawn with borders, so they survive printing", () => {
  // Browsers drop background colour when printing unless asked not to, so a
  // mark drawn as a background is simply not on the page.
  for (const sel of [".tbl .gm::before", ".tbl .gm-tee::after"]) {
    const rule = block(sel);
    assert.ok(/border-(top|left)\s*:/.test(rule), `${sel} draws no border`);
    assert.ok(
      !/background/.test(rule),
      `${sel} draws with a background, which does not print`,
    );
  }
});
