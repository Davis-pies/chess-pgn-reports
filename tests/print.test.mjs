import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { appendPrintTables, stemLength } from "../src/print.js";
import { grid } from "../src/table.js";
import { assignLineNames } from "../src/line-editor.js";
import { openTablePaths, setTraced } from "../src/state.js";

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
  // the mainline is 16 plies; the first table runs it out to its last move,
  // even though its own branches are only a couple of moves deep. Its first
  // move, which every line shares, is the stem above the table.
  assert.strictEqual(rows(tables[0]), 15, "first table spans the mainline");
  const last = [...tables[0].querySelectorAll("tr")].at(-1);
  assert.strictEqual(last.dataset.ply, "15", "down to its last move");
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
// Print groups its lines, but it is not showing the reader's table: whatever
// they left folded on screen, the report opens every group, because there is
// nothing to click on paper. The shading, stubs and fold controls stay off.
test("the printed table opens every group whatever the preview has folded", () => {
  const off = installDom();
  openTablePaths.add("1:c5");
  openTablePaths.add("1:c5/2:Nf3");
  const box = printTables(
    "1. e4 e5 (1... c5 2. Nf3 Nc6 3. Bb5) (1... c5 2. Nf3 Nc6 3. a4) 2. Nf3",
  );
  // A group's shared moves keep the muted italic the editor gives them — that
  // is typography, and it says the same thing on paper. What stays off is the
  // interactive chrome: block shading, the ▸/▾ cue, the fold handler, and the
  // "N lines" stub a shut group shows in its place.
  assert.strictEqual(
    box.querySelectorAll(".grp, .clickable, .collapse-cue, .var-head.collapsed")
      .length,
    0,
    "no group shading, stubs or fold controls in print",
  );
  const rows = [...box.querySelectorAll("table.tbl tr")];
  const col = (i) => rows.slice(1).map((tr) => tr.children[i].textContent);
  // The group has no column of its own on paper: its FIRST line states the
  // moves they share and runs straight on into its own.
  // (1.e4, which every line shares, is the stem above the table.)
  assert.deepStrictEqual(col(2), ["c5", "Nf3", "Nc6", "Bb5"]);
  // The sibling still starts after the shared run. Its cell on the fork's own
  // row is the group rule, which carries no text -- the rule is the statement.
  assert.deepStrictEqual(col(3), ["", "", "", "a4"]);
  openTablePaths.clear();
  off();
});

// What replaces the group column: a rule on the row of the last shared move,
// reaching from just right of that move over every column continuing from it.
// Without it a line's ancestry was unreadable -- every cell above its first
// move is a bare ellipsis, so a reader could not tell which of two moves on
// that row it followed.
test("a group draws a rule from its last shared move across its continuations", () => {
  const off = installDom();
  const box = printTables(
    "1. e4 e5 (1... c5 2. Nf3 Nc6 3. Bb5) (1... c5 2. Nf3 Nc6 3. a4) 2. Nf3",
  );
  const rows = [...box.querySelectorAll("table.tbl tr")];
  // Two runs: the mainline's own branch, and the group inside it. This test is
  // about the group, which is the one leaving Nc6.
  const rules = [...box.querySelectorAll("td.grp-rule")].filter(
    (td) => td.previousElementSibling.textContent === "Nc6",
  );
  assert.strictEqual(rules.length, 1, "one group, one covered cell");
  const row = rules[0].parentElement;
  assert.strictEqual(
    rows.indexOf(row),
    3,
    "on Nc6's row, not floating above the header",
  );
  // it keeps its own cell -- no colspan swallowing the columns it covers
  assert.strictEqual(rules[0].colSpan, 1);
  assert.strictEqual(rules[0].textContent, "", "and states nothing but itself");
  // the rightmost covered cell closes the rule off
  assert.ok(rules[0].querySelector(".gm-end"), "the run turns the corner");
  off();
});

test("groups nested inside a group draw their own shorter rules", () => {
  const off = installDom();
  // 1...c5 2.Nf3 is shared by all three; Nc6 by the first two
  const box = printTables(
    "1. e4 e5 (1... c5 2. Nf3 Nc6 3. Bb5) (1... c5 2. Nf3 Nc6 3. a4)" +
      " (1... c5 2. Nf3 d6 3. d4) 2. Nf3",
  );
  // The outer group forks after Nf3 and covers two columns; the one nested
  // inside it forks after Nc6 and covers one. Each covered cell is its own td,
  // so the counts are cells, not colspans.
  const byRow = new Map();
  [...box.querySelectorAll("td.grp-rule")].forEach((td) => {
    const k = [...td.parentElement.children].find((c) => c.textContent)
      .textContent;
    byRow.set(k, (byRow.get(k) || 0) + 1);
  });
  const ends = box.querySelectorAll("td.grp-rule .gm-end").length;
  // The group and its inner. The mainline's own branch leaves after 1.e4,
  // which is the stem above the table, so it has no row to draw a rule on:
  // the stem already says every column carries on from it.
  assert.strictEqual(ends, 2, "the group and its inner");
  // Every mark is a junction on its own group's row -- a tee or a corner --
  // never a stroke running down the table. Two groups, two rows carrying them.
  const rows = [...box.querySelectorAll("table.tbl tr")];
  const marked = rows.filter((tr) => tr.querySelector("td.grp-rule"));
  assert.strictEqual(marked.length, 2, "the two groups");
  assert.strictEqual(
    box.querySelectorAll("td.grp-edge").length,
    0,
    "nothing runs down the table beside a column",
  );
  // A positioned <td> breaks border-collapse rendering in the print engine and
  // the walls come out missing, so every mark hangs off a span inside the cell.
  assert.strictEqual(
    box.querySelectorAll("td.grp-rule > *:not(span.gm)").length,
    0,
    "a covered cell carries nothing but its mark span",
  );
  off();
});

// The bug this whole change is about: two lines sharing a run of moves BELOW
// their divergence from the mainline each spelled that run out in full, so the
// reader read "Bb5+ Bd7 Bxd7+" three times across the page instead of once.
test("the printed table states a group's shared moves once", () => {
  const off = installDom();
  const box = printTables(
    "1. e4 c5 2. Nf3 d6 3. d4 (3. Bb5+ Bd7 4. Bxd7+ Qxd7 5. O-O Nc6)" +
      " (3. Bb5+ Bd7 4. Bxd7+ Nxd7 5. c4 Ngf6) (3. Bb5+ Nd7 4. d4 cxd4)" +
      " 3... cxd4 4. Nxd4 Nf6 *",
  );
  const cells = [...box.querySelectorAll("table.tbl td")].map(
    (c) => c.textContent,
  );
  const times = (san) => cells.filter((t) => t === san).length;
  assert.strictEqual(times("Bb5+"), 1, "the move all three lines share");
  assert.strictEqual(times("Bxd7+"), 1, "the move the first two share");
  // the moves that genuinely differ are still each line's own
  assert.strictEqual(times("Qxd7"), 1);
  assert.strictEqual(times("Nxd7"), 1);
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

// The context menu is a screen affordance too: appendPrintTables passes
// renderTable no trace object, and the menu wiring rides on the same argument.
test("no context-menu handlers reach the printed report", () => {
  const off = installDom();
  openTablePaths.add("1:c5");
  const box = printTables("1. e4 e5 (1... c5 2. Nf3 d6 3. d4 (3. Bb5+)) 2. Nf3");
  assert.strictEqual(box.querySelectorAll(".tmenu-open").length, 0);
  assert.strictEqual(
    [...box.querySelectorAll("td")].filter((c) => c.oncontextmenu).length,
    0,
  );
  openTablePaths.clear();
  off();
});

// A King's Indian stem (1... Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6) shared by many
// lines that fork at White's 5th. "Bg7" is in the stem and nowhere in the
// mainline, so counting it counts the stem.
const KID_FIFTHS = [
  "Nf3", "f3", "Be2", "f4", "h3", "g3", "Bd3", "Bg5",
  "Nge2", "a3", "b3", "h4", "Rb1", "Qd2", "Bd2", "Be3",
];
function kid(n) {
  return (
    "1. d4 d5 " +
    KID_FIFTHS.slice(0, n)
      .map((m) => `(1... Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. ${m})`)
      .join(" ") +
    " 2. c4 e6 3. Nc3 *"
  );
}

// The pagination half of the same problem. A group wide enough to spill onto a
// second table must say its shared moves AGAIN there: a reader holding page two
// cannot see a column on page one, so an elided line would leave them with a
// row of "…" and nowhere to look it up.
test("a group split across print tables restates its shared moves", () => {
  const off = installDom();
  const box = printTables(kid(16));
  const tables = [...box.querySelectorAll("table.tbl")];
  assert.ok(tables.length > 1, "the fixture packs into several tables");
  tables.forEach((t, i) => {
    // in a cell of the table, or in the stem written above it
    const cells = [...t.querySelectorAll("td")].filter((c) => c.textContent === "Bg7");
    const above = t.previousElementSibling;
    const inStem = above?.classList.contains("print-stem") && /\bBg7\b/.test(above.textContent);
    assert.strictEqual(cells.length + (inStem ? 1 : 0), 1, `table ${i} states the stem exactly once`);
  });
  off();
});

// The same rule where the spill is a single line: alone on its table it has no
// group above it to have said the moves, so it goes back to spelling its whole
// divergence out rather than eliding against a column that isn't there.
test("a line packed apart from its group keeps its whole divergence", () => {
  const off = installDom();
  // 14 lines of one group: 13 fill a table of their own, headed by the moves
  // they share, and the one left over goes beside the mainline -- where no
  // group column has stated its moves, so it spells them out itself
  const box = printTables(kid(14));
  const tables = [...box.querySelectorAll("table.tbl")];
  const first = tables[0];
  const rows = [...first.querySelectorAll("tr")];
  assert.strictEqual(rows[0].querySelectorAll("th").length, 3, "ply label + mainline + the one line");
  const own = rows
    .slice(1)
    .map((tr) => tr.children[2].textContent)
    .filter((t) => t && t !== "\u2026");
  assert.deepStrictEqual(own, ["Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3"]);
  off();
});

// ---- packing for paper

// Twelve lines that run together for sixteen moves, and one that leaves at
// move two: filled left to right, the stray line joined the twelve and cut
// their stem back to move two, so the table printed thirty rows of mostly
// blank column.
test("a stray line gets a table of its own rather than costing another its stem", () => {
  const off = installDom();
  // the mainline, twelve lines off it at White's 11th, and one stray at 2...g6
  const run = "3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 Qc7 6. Be3 a6 7. Qf3 Nf6 8. O-O-O Ne5 9. Qg3 b5 10. f4 Neg4";
  const tails = ["Bg1", "Bd2", "Nb3", "Qe1", "Qf3", "Qf2", "Qh3", "Qh4", "Rd2", "Re1", "Kb1", "a3"];
  const twelve = tails.map((m) => `(2... e6 ${run} 11. ${m})`).join(" ");
  const box = printTables(`1. e4 c5 2. Nf3 d6 ${twelve} (2... g6 3. d4) 3. d4 *`);
  const tables = [...box.querySelectorAll("table.tbl")];
  const stems = tables.map((t) => (t.previousElementSibling?.classList.contains("print-stem") ? t.previousElementSibling.textContent : ""));
  const deep = stems.findIndex((st) => /10\. f4\s+Neg4/.test(st));
  assert.ok(deep !== -1, `the twelve are headed by their shared run (stems: ${stems.join(" | ")})`);
  const rows = (t) => t.querySelectorAll("tr").length - 1;
  assert.ok(rows(tables[deep]) <= 2, `and take a row or two, not thirty (got ${rows(tables[deep])})`);
  const all = [...box.querySelectorAll("table.tbl td")].map((c) => c.textContent);
  assert.ok(all.includes("g6"), "the stray line is still printed");
  off();
});

test("lines that cost nothing apart are not split into many tiny tables", () => {
  const off = installDom();
  // twelve one-move replies: one table holds them all, as before
  const box = printTables(`1. e4 e5 ${"c5 e6 c6 d5 d6 Nf6 g6 b6 a6 Nc6 f5 h6".split(" ").map((m) => `(1... ${m})`).join(" ")} 2. Nf3 *`);
  assert.strictEqual(box.querySelectorAll("table.tbl").length, 1);
  off();
});

test("packing a large report stays quick", () => {
  const off = installDom();
  const replies = "c5 e6 c6 d5 d6 Nf6 g6 b6 a6 Nc6 f5 h6 a5 b5 Na6 Nh6 g5 h5".split(" ");
  const seconds = "Nf3 Nc3 d4 c3 Bc4 f4 g3 b3 a3 Be2".split(" ");
  const lines = replies.flatMap((r) => seconds.map((w) => `(1... ${r} 2. ${w})`)).join(" ");
  const t0 = Date.now();
  const box = printTables(`1. e4 e5 ${lines} 2. Nf3 *`);
  const ms = Date.now() - t0;
  assert.ok(box.querySelectorAll("table.tbl").length > 5);
  assert.ok(ms < 5000, `180 lines packed in ${ms} ms`);
  off();
});

// A report narrow enough for one table: the commonest case, and the one the
// packer produces without splitting anything. It groups like any other.
test("a report that fits one table cascades without the trie split", () => {
  const off = installDom();
  const st = loadState(
    "1. e4 c5 2. Nf3 d6 3. d4 (3. Bb5+ Bd7 4. Bxd7+ Qxd7)" +
      " (3. Bb5+ Bd7 4. Bxd7+ Nxd7) 3... cxd4 *",
  );
  const box = document.createElement("div");
  appendPrintTables(box, grid(st.lines));
  assert.strictEqual(
    box.querySelectorAll("table.tbl").length,
    1,
    "the fixture fits a single table",
  );
  const cells = [...box.querySelectorAll("td")].map((c) => c.textContent);
  assert.strictEqual(cells.filter((t) => t === "Bxd7+").length, 1);
  off();
});

// The "N lines" count on a group's header is a fold affordance — it says how
// much is behind the stub. Nothing folds on paper, so the printed report keeps
// the shared-move column and drops the label, the same way it drops the ▸/▾
// cue and the shading.
test("a group's column carries no line count in print", () => {
  const off = installDom();
  const box = printTables(kid(16));
  const heads = [...box.querySelectorAll("table.tbl tr:first-child th")].map(
    (h) => h.textContent.trim(),
  );
  assert.ok(heads.includes("Mainline"), "the reference column is still named");
  assert.deepStrictEqual(
    heads.filter((h) => /^\d+ lines?$/.test(h)),
    [],
    `no "N lines" headers in print (got ${JSON.stringify(heads)})`,
  );
  off();
});

// "Sideline" on every column but one says nothing the reader cannot see: they
// are all sidelines. The name the reader gave the line is what a header is
// worth on paper, so it takes the tag's place — and a line with no name gets a
// blank header rather than a label repeated down the row.
test("a printed line's header carries its name, not the Sideline tag", () => {
  const off = installDom();
  const st = loadState(
    "1. e4 c5 2. Nf3 (2. Nc3 Nc6) (2. d4 cxd4) (2. c3 d5) 2... d6 *",
  );
  st.lines[1].name = "Closed Sicilian";
  const box = document.createElement("div");
  appendPrintTables(box, grid(st.lines));
  const heads = [...box.querySelectorAll("table.tbl tr:first-child th")].map(
    (h) => h.textContent.trim(),
  );
  assert.ok(heads.includes("Mainline"), "the reference column keeps its name");
  assert.ok(heads.includes("Closed Sicilian"), "a named line is named");
  assert.deepStrictEqual(
    heads.filter((h) => h === "Sideline"),
    [],
    `no Sideline tags in print (got ${JSON.stringify(heads)})`,
  );
  off();
});

// A group gets one connector per CHILD, and stops at the last of them -- not
// at the last column, which belongs to that child's own descendants. `tree`
// draws a directory one connector however much is nested inside it.
test("a group's run stops at its last child, not at its last column", () => {
  const off = installDom();
  // 1...c5 2.Nf3 forks into Nc6 (one line) and d6 (a group of two)
  const box = printTables(
    "1. e4 e5 (1... c5 2. Nf3 Nc6 3. Bb5) (1... c5 2. Nf3 d6 3. d4)" +
      " (1... c5 2. Nf3 d6 3. Bb5+) 2. Nf3",
  );
  const rows = [...box.querySelectorAll("table.tbl tr")];
  const marked = rows.filter((tr) => tr.querySelector("td.grp-rule"));
  assert.strictEqual(
    marked.length,
    2,
    "the group off the stem, and the one nested in that",
  );

  // The group leaving Nf3: it has two children, one of which owns two columns,
  // so its run covers ONE cell -- the column where that child begins.
  const outer = marked.find(
    (tr) => tr.children[1].textContent === "Nf3",
  );
  const cells = [...outer.children];
  const covered = cells.filter((c) => c.classList.contains("grp-rule"));
  assert.strictEqual(covered.length, 1, "one cell: the last child's own column");
  assert.ok(covered[0].querySelector(".gm-end"), "and it is the corner");
  assert.ok(covered[0].querySelector(".gm-tee"), "with a tick into it");
  assert.ok(
    cells.indexOf(covered[0]) < cells.length - 1,
    "it stops short of the table's last column",
  );
  off();
});

test("every column a run crosses without a child starting there gets no tick", () => {
  const off = installDom();
  // Nc6 owns two columns, so the run to the d6 child crosses one of them
  const box = printTables(
    "1. e4 e5 (1... c5 2. Nf3 Nc6 3. Bb5) (1... c5 2. Nf3 Nc6 3. a4)" +
      " (1... c5 2. Nf3 d6 3. d4) 2. Nf3",
  );
  const outer = [...box.querySelectorAll("table.tbl tr")].find(
    (tr) =>
      tr.querySelector("td.grp-rule") && tr.children[1].textContent === "Nf3",
  );
  const covered = [...outer.children].filter((c) =>
    c.classList.contains("grp-rule"),
  );
  const tees = covered.filter((c) => c.querySelector(".gm-tee"));
  assert.ok(covered.length > tees.length, "the run crosses more than it marks");
  assert.strictEqual(tees.length, 1, "one child begins in this run's span");
  off();
});

// The mainline is the root of the tree, so its own branches hang off it the
// same way every other group's do -- without this the top of the table was a
// set of columns with nothing saying what they left.
test("a top-level branch is connected to the mainline it leaves", () => {
  const off = installDom();
  // 1.d4 leaves at the very first move, so there is no stem to state 1.e4 and
  // the run from the mainline is still drawn
  const box = printTables("1. e4 (1. d4) e5 (1... c5 2. Nf3 Nc6) 2. Nf3");
  const rows = [...box.querySelectorAll("table.tbl tr")];
  const marked = rows.filter((tr) => tr.querySelector("td.grp-rule"));
  assert.strictEqual(marked.length, 1, "one run, from the mainline");
  // 1...c5 replaces the mainline's e5 at ply 1, so the run sits on ply 0's row
  assert.strictEqual(rows.indexOf(marked[0]), 1, "on 1.e4's row");
  assert.strictEqual(
    marked[0].children[1].textContent,
    "e4",
    "the run leaves the mainline's last shared move",
  );
  assert.ok(marked[0].querySelector(".gm-tee"), "with a tick into the branch");
  off();
});

test("branches leaving the mainline at different moves get their own runs", () => {
  const off = installDom();
  // 1.d4 keeps the stem empty, so the run leaving 1.e4 is drawn too
  const box = printTables(
    "1. e4 (1. d4) e5 (1... c5) 2. Nf3 Nc6 (2... Nf6) 3. Bb5",
  );
  const rows = [...box.querySelectorAll("table.tbl tr")];
  const marked = rows
    .map((tr, i) => (tr.querySelector("td.grp-rule") ? i : -1))
    .filter((i) => i >= 0);
  assert.strictEqual(marked.length, 2, "one run per departure point");
  const at = marked.map((i) => rows[i].children[1].textContent);
  assert.deepStrictEqual(at, ["e4", "Nf3"], "each on the move it leaves");
  off();
});

// A run reaches its child across whatever columns lie between, and those
// belong to branches that left earlier -- which may well have a move of their
// own on that row. The run must never be drawn over one: a covered cell is
// rendered empty, so crossing a move deleted it from the report.
test("a run never covers a cell that has a move of its own", () => {
  const off = installDom();
  // c5 leaves at move 1 and is still going at move 3; Bc4 leaves at move 3,
  // so its connector has to cross the c5 branch's column on that row
  const box = printTables(
    "1. e4 e5 (1... c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 Nf6)" +
      " 2. Nf3 Nc6 3. Bb5 (3. Bc4) 3... a6",
  );
  const rows = [...box.querySelectorAll("table.tbl tr")];
  for (const tr of rows)
    for (const td of [...tr.children])
      if (td.classList.contains("grp-rule"))
        assert.strictEqual(
          td.textContent,
          "",
          "a marked cell had text, so a move was overwritten",
        );

  // and every branch keeps every move it had. The c5 branch is the FURTHER
  // column: branches are ordered by how late they leave the mainline.
  const cols = rows
    .slice(1)
    .map((tr) => [...tr.children].map((c) => c.textContent));
  const branch = cols.map((r) => r[3]).filter((t) => t);
  assert.deepStrictEqual(branch, ["c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "Nf6"]);
  off();
});

// Breaking a run around a move is not enough: the run resumes on the far side
// and reads as though it left THAT line. The columns are ordered so the case
// cannot arise -- branches that leave the mainline latest sit nearest it, so a
// run only ever crosses branches that leave later, which are blank on its row.
test("branches are ordered so a run never has to cross a move", () => {
  const off = installDom();
  const box = printTables(
    "1. e4 e5 (1... c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 Nf6)" +
      " 2. Nf3 Nc6 3. Bb5 (3. Bc4) 3... a6",
  );
  const rows = [...box.querySelectorAll("table.tbl tr")];
  const col = (i) => rows.slice(1).map((tr) => tr.children[i].textContent);
  // Bc4 leaves at move 3, c5 at move 1, so Bc4 is the nearer column
  assert.deepStrictEqual(col(2).filter(Boolean), ["Bc4"]);
  assert.deepStrictEqual(
    col(3).filter(Boolean),
    ["c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "Nf6"],
  );

  // every run is unbroken: its covered cells are one contiguous stretch
  for (const tr of rows) {
    const marked = [...tr.children]
      .map((td, i) => (td.classList.contains("grp-rule") ? i : -1))
      .filter((i) => i >= 0);
    if (!marked.length) continue;
    assert.strictEqual(
      marked[marked.length - 1] - marked[0] + 1,
      marked.length,
      `a run broke around something on row ${rows.indexOf(tr)}`,
    );
  }
  off();
});

// The whole report is ordered before it is cut into pages. Sorting only within
// a page would leave the report reading one way down a page and another across
// them, and could strand a branch on a later page than the layout wants it.
test("pages are cut from the ordered report, not from PGN order", () => {
  const off = installDom();
  // 14 early-leaving branches fill the first page; the LAST thing the PGN
  // writes is a branch leaving at move 3, which the layout wants first of all
  const early = KID_FIFTHS.slice(0, 14)
    .map((m) => `(1... Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. ${m})`)
    .join(" ");
  const box = printTables(`1. d4 d5 ${early} 2. c4 e6 (2... c6) 3. Nc3 *`);
  const tables = [...box.querySelectorAll("table.tbl")];
  assert.ok(tables.length > 1, "the fixture really does need several pages");
  const firstPage = [...tables[0].querySelectorAll("tr")]
    .map((tr) => [...tr.children].map((c) => c.textContent))
    .flat();
  assert.ok(
    firstPage.includes("c6"),
    "the latest-leaving branch is on the first page, though written last",
  );
  off();
});

// ---------------------------------------------------------------------------
// Annotations reaching the TABLE, as opposed to the notes block below it. The
// editor writes a shared move's note and symbol onto every line through that
// position, so several columns hold the same annotation on the same ply -- and
// only the column that actually states the move should show it. That used to
// be the group's own column, which the column builder gathered them onto;
// with no group column in print it is the group's first line.
// ---------------------------------------------------------------------------

const SHARED = "1. e4 e5 (1... c5 2. Nf3 Nc6 3. Bb5) (1... c5 2. Nf3 Nc6 3. a4) 2. Nf3";

// Notes are set directly: inside a variation a {comment} swallows the moves
// after it, so a PGN-built fixture would not have the shape under test.
function annotateShared(s, ply, { text, mark }) {
  s.lines
    .filter((l) => !l.isMain && l.moves.some((m) => m.ply === ply))
    .forEach((l) => {
      if (text) l.comments = [{ ply, text }];
      if (mark) l.marks = { ...(l.marks || {}), [ply]: mark };
    });
}

test("a shared move's note marker prints once, beside the move itself", () => {
  const off = installDom();
  const s = loadState(SHARED);
  annotateShared(s, 3, { text: "the main tabiya" });
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));

  const marks = [...box.querySelectorAll("table.tbl td sup")];
  assert.strictEqual(marks.length, 1, "one marker, not one per line sharing it");
  // and it sits in the cell holding the move it annotates
  assert.match(marks[0].parentElement.textContent, /^Nc6/, "on the Nc6 cell");
  off();
});

test("a shared move's symbol prints once, beside the move itself", () => {
  const off = installDom();
  const s = loadState(SHARED);
  annotateShared(s, 3, { mark: "$1" });
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));

  const syms = [...box.querySelectorAll("table.tbl td .mv-mark")];
  assert.strictEqual(syms.length, 1, "one symbol, not one per line sharing it");
  assert.strictEqual(syms[0].textContent, "!");
  assert.match(syms[0].parentElement.textContent, /^Nc6/);
  off();
});

test("an annotation on a line's own move prints on that line's column", () => {
  const off = installDom();
  const s = loadState(SHARED);
  // ply 4 is Bb5 / a4 -- each line's own move, shared with nobody
  const line = s.lines.find((l) => l.moves.some((m) => m.san === "a4"));
  line.comments = [{ ply: 4, text: "a sideline of its own" }];
  line.marks = { 4: "$1" };
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));

  const sup = [...box.querySelectorAll("table.tbl td sup")];
  assert.strictEqual(sup.length, 1);
  assert.match(sup[0].parentElement.textContent, /^a4/, "on the a4 cell");
  const sym = [...box.querySelectorAll("table.tbl td .mv-mark")];
  assert.strictEqual(sym.length, 1);
  assert.match(sym[0].parentElement.textContent, /^a4/);
  off();
});

test("a cell that states no move carries no symbol and no note marker", () => {
  const off = installDom();
  // the sideline diverges at move 3, so its cells for moves 1-2 state nothing;
  // the annotation sits at ply 3, which it shares with the mainline
  const s = loadState("1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4) 3. Bb5");
  s.lines.forEach((l) => {
    if (l.moves.some((m) => m.ply === 2)) {
      l.marks = { ...(l.marks || {}), 2: "$1" };
      l.comments = [{ ply: 2, text: "the knight comes out" }];
    }
  });
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));

  for (const td of box.querySelectorAll("table.tbl td")) {
    const move = td.childNodes[0];
    const states = move && move.nodeType === 3 && move.textContent.trim();
    if (states) continue;
    assert.strictEqual(
      td.querySelector(".mv-mark"),
      null,
      "a symbol floats in a cell with no move",
    );
    assert.strictEqual(
      td.querySelector("sup"),
      null,
      "a note marker floats in a cell with no move",
    );
  }
  off();
});

// The mainline's table is stemmed like any other: the moves every line shares
// are written once above it, as the mainline's, rather than run down its
// column beside empty ones until the lines split.
test("the mainline's table states its shared moves once, above it", () => {
  const off = installDom();
  const box = printTables("1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) (2... e6 3. d4) 3. d4 *");
  const stem = box.querySelector(".print-stem");
  assert.ok(stem, "a stem is printed");
  assert.match(stem.textContent, /^1\. e4\s+c5\s+2\. Nf3$/);
  const rows = box.querySelectorAll("table.tbl tr");
  assert.strictEqual(rows[1].dataset.ply, "3", "rows start where the lines split");
  // the mainline column carries on from the stem, to its last move
  assert.strictEqual(rows[1].children[1].textContent, "d6");
  assert.strictEqual([...rows].at(-1).dataset.ply, "4");
  off();
});

// A note on a move the stem took out of the table keeps its marker: on the
// stem, where the move is now printed, with its note listed under the table.
test("a note on a stem move is marked on the stem of the mainline's table", () => {
  const off = installDom();
  const box = printTables("1. e4 c5 2. Nf3 {develops} d6 (2... Nc6 3. d4) (2... e6 3. d4) 3. d4 *");
  const stem = box.querySelector(".print-stem");
  assert.strictEqual(stem.querySelector("sup")?.textContent, "1");
  assert.match(box.querySelector(".print-notes").textContent, /\[1\].*develops/);
  off();
});

function noMainTables(pgn, setup = () => {}) {
  const st = loadState(pgn);
  st.noMain = true;
  setup(st);
  const box = document.createElement("div");
  appendPrintTables(box, grid(st.lines));
  return box;
}

// The table refuses to break across pages, so on its own it jumped to the
// next page and left its stem at the foot of the one before. The two are one
// block, and the notes, which may run on, stay outside it.
test("a print table's stem goes to the next page with it", () => {
  const off = installDom();
  const box = noMainTables(
    "1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) (2... e6 3. d4) 3. d4 *",
  );
  const stem = box.querySelector(".print-stem");
  const block = stem.parentElement;
  assert.ok(block.classList.contains("print-block"));
  assert.strictEqual(block.querySelector("table.tbl"), stem.nextElementSibling);
  assert.ok(block.nextElementSibling.classList.contains("print-notes"), "notes follow the block, outside it");
  off();
});

test("a print table states its shared moves once, above it", () => {
  const off = installDom();
  const box = noMainTables(
    "1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) (2... e6 3. d4) 3. d4 *",
  );
  const stem = box.querySelector(".print-stem");
  assert.ok(stem, "a stem is printed");
  assert.strictEqual(stem.nextElementSibling.tagName, "TABLE");
  assert.match(stem.textContent, /1\. e4\s+c5\s+2\. Nf3/);
  const first = box.querySelectorAll("table.tbl tr")[1];
  assert.strictEqual(first.dataset.ply, "3", "rows start where the lines differ");
  off();
});

test("the stem never swallows a whole line", () => {
  const off = installDom();
  // the side line 2. Nc3 ends where the mainline carries on
  const box = printTables("1. e4 e5 2. Nf3 (2. Nc3) Nc6 *");
  const cells = [...box.querySelectorAll("table.tbl td")].map((c) => c.textContent);
  assert.ok(cells.includes("Nc3"), "the short line still states its move");
  off();
});

test("stemLength caps at one short of the shortest column", () => {
  const v = (s) => ({ moves: s.split(" ").map((san, ply) => ({ san, ply })) });
  assert.strictEqual(stemLength([v("e4 e5 Nf3")]), 0, "a lone column has no stem");
  assert.strictEqual(stemLength([v("e4 e5"), v("d4 d5")]), 0);
  assert.strictEqual(stemLength([v("e4 e5 Nf3"), v("e4 e5 Nf3 Nc6")]), 2);
  assert.strictEqual(stemLength([v("e4 c5 Nf3 d6"), v("e4 c5 Nf3 Nc6")]), 3);
});

test("a mainline alone prints no stem and starts at move one", () => {
  const off = installDom();
  const box = printTables("1. e4 e5 2. Nf3 *");
  assert.strictEqual(box.querySelector(".print-stem"), null);
  assert.strictEqual(box.querySelectorAll("table.tbl tr")[1].dataset.ply, "0");
  off();
});

test("a note on a stem move keeps its marker in the stem", () => {
  const off = installDom();
  const box = noMainTables("1. e4 c5 2. Nf3 d6 (2... Nc6) *", (s) =>
    s.lines.forEach((l) => (l.comments = [{ ply: 2, text: "develops" }])),
  );
  assert.ok(box.querySelector(".print-stem sup"), "the stem carries the marker");
  off();
});

test("the stem leaves the column headers as they were", () => {
  const off = installDom();
  const box = printTables("1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 *");
  const head = [...box.querySelectorAll("table.tbl tr")[0].children].map(
    (th) => th.textContent,
  );
  assert.deepStrictEqual(head, ["ply", "Mainline", ""]);
  off();
});

test("one row per move stacks White's and Black's moves in a cell", () => {
  const off = installDom();
  const box = noMainTables("1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 cxd4 *", (s) => {
    s.printByMove = true;
  });
  const rows = [...box.querySelectorAll("table.tbl tr")].slice(1);
  // stem 1. e4 c5 2. Nf3 (plies 0-2); the rows cover plies 3..5, which are
  // moves 2 (Black half only) and 3
  assert.deepStrictEqual(
    rows.map((r) => r.children[0].textContent),
    ["2.", "3."],
  );
  const halves = (col) =>
    rows.map((r) =>
      [...r.children[col].querySelectorAll(".half")].map((h) => h.textContent),
    );
  // (with no mainline, the columns come in the order the report lays out)
  assert.deepStrictEqual(halves(1), [["", "d6"], ["d4", "cxd4"]]);
  assert.deepStrictEqual(halves(2), [["", "Nc6"], ["d4", ""]]);
  off();
});

test("rows stay per ply unless the option is on", () => {
  const off = installDom();
  const box = printTables("1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 cxd4 *");
  assert.strictEqual(box.querySelectorAll(".half").length, 0);
  off();
});

test("cell borders can be left off the printed table", () => {
  const off = installDom();
  const s = loadState("1. e4 c5 2. Nf3 (2. c3) *");
  let box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  assert.ok(!box.querySelector(".pv-htable.no-borders"), "on by default");
  s.printBorders = false;
  box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  assert.ok(box.querySelector(".pv-htable.no-borders"));
  off();
});

// Only White's rows carry a number, which left a table starting on Black's move
// (its stem ending on White's) with no number on its first row at all.
test("a table whose rows start on Black's move numbers its first row", () => {
  const off = installDom();
  const box = noMainTables("1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 *");
  const first = box.querySelectorAll("table.tbl tr")[1];
  assert.strictEqual(first.dataset.ply, "3");
  assert.strictEqual(first.children[0].textContent, "2...");
  off();
});

test("zebra stripes are an option on the printed table, off by default", () => {
  const off = installDom();
  const s = loadState("1. e4 c5 2. Nf3 (2. c3) *");
  let box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  assert.ok(!box.querySelector(".pv-htable.zebra"), "off by default");
  s.printZebra = true;
  box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  assert.ok(box.querySelector(".pv-htable.zebra"));
  off();
});

test("the printed table's row padding is set from the notebook", () => {
  const off = installDom();
  const s = loadState("1. e4 c5 2. Nf3 (2. c3) *");
  let box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  const pad = () =>
    box.querySelector(".pv-htable").style.getPropertyValue("--row-pad");
  assert.strictEqual(pad(), "0px", "no padding by default");
  s.printRowPad = 5;
  box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  assert.strictEqual(pad(), "5px");
  off();
});

test("branch lines can be left off the printed table without moving a column", () => {
  const off = installDom();
  const PGN =
    "1. e4 (1. d4) e5 (1... c5 2. Nf3 Nc6 3. Bb5) (1... c5 2. Nf3 d6 3. d4)" +
    " (1... c5 2. Nf3 d6 3. Bb5+) 2. Nf3 *";
  const s = loadState(PGN);
  const cols = (box) =>
    [...box.querySelectorAll("table.tbl tr")].map((tr) =>
      [...tr.children].map((c) => c.textContent),
    );
  let box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  assert.ok(box.querySelector("td.grp-rule"), "drawn by default");
  const withLines = cols(box);
  s.printBranchLines = false;
  box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  assert.strictEqual(box.querySelectorAll("td.grp-rule, .gm").length, 0);
  // the rules carry no text, so every row and column reads exactly as before
  assert.deepStrictEqual(cols(box), withLines, "same columns in the same order");
  off();
});

test("noMain: the printed report has no mainline column, and heads each table with its shared moves", () => {
  const undo = installDom();
  const st = loadState("1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 3. Bb5");
  st.noMain = true;
  const box = document.createElement("div");
  appendPrintTables(box, grid(st.lines));
  // the lines share nothing past move one, and a stem stops short of the
  // shortest line, so the only stem is 1. e4
  const stems = [...box.querySelectorAll(".print-stem")].map((n) => n.textContent.trim());
  assert.deepStrictEqual(stems, ["1. e4"]);
  assert.strictEqual(box.querySelectorAll(".main-col").length, 0);
  const heads = [...box.querySelectorAll(".var-head")].map((n) => n.textContent);
  assert.ok(!heads.includes("Mainline"), heads.join("|"));
  // every line still reaches paper
  const text = box.textContent;
  assert.ok(text.includes("Bb5"), text);
  assert.ok(text.includes("d6"), text);
  undo();
});

// ---- pages headed by their own branch

test("a later table whose lines share a branch is headed by it, without the mainline", () => {
  const off = installDom();
  const box = printTables(kid(16));
  const tables = [...box.querySelectorAll("table.tbl")];
  assert.ok(tables.length > 1);
  const later = tables[1];
  const stem = later.previousElementSibling;
  assert.ok(stem.classList.contains("print-stem"), "a stem above it");
  assert.match(stem.textContent, /1\. d4\s+Nf6\s+2\. c4\s+g6\s+3\. Nc3\s+Bg7\s+4\. e4\s+d6/);
  assert.strictEqual(later.querySelector(".main-col"), null, "no mainline column");
  const heads = [...later.querySelectorAll("tr")[0].children].map((th) => th.textContent);
  assert.ok(!heads.includes("Mainline"), heads.join("|"));
  assert.strictEqual(later.querySelectorAll("tr")[1].dataset.ply, "8", "rows start at White's 5th");
  off();
});

test("the first table keeps the mainline even when its lines share a branch", () => {
  const off = installDom();
  const box = printTables(kid(3));
  const first = box.querySelector("table.tbl");
  assert.ok(first.querySelector(".main-col"), "the mainline column is there");
  off();
});

const BASE = "1. d4 Nf6 2. c4 (2. c4 e6 3. Nc3) (2. c4 e6 3. Nf3) *";

test("a line every other line continues gives its column to the stem", () => {
  const off = installDom();
  const st = loadState(BASE);
  st.noMain = true;
  st.lines[0].comments = [{ ply: 2, text: "the Indian set-up" }];
  const box = document.createElement("div");
  appendPrintTables(box, grid(st.lines));
  const stem = box.querySelector(".print-stem");
  assert.match(stem.textContent, /1\. d4\s+Nf6\s+2\. c4\d*\s+e6/);
  assert.ok(stem.querySelector("sup"), "the base line's note marker rides in the stem");
  const t = box.querySelector("table.tbl");
  assert.strictEqual(t.querySelectorAll("tr")[0].children.length, 3, "ply + the two continuations");
  const cells = [...t.querySelectorAll("td")].map((c) => c.textContent);
  assert.ok(cells.includes("Nc3") && cells.includes("Nf3"));
  assert.match(box.querySelector(".print-notes").textContent, /the Indian set-up/, "its note still prints");
  off();
});

test("a base line is absorbed on a later page with the mainline shown too", () => {
  const off = installDom();
  // 13 replies to 1.e4 fill the first page; the 1.d4 lines leave the mainline
  // earliest, so they are packed last, onto a page of their own
  const alts = "c5 d5 f5 g6 b6 e6 c6 d6 Nc6 a6 h6 a5 Nf6"
    .split(" ")
    .map((m) => `(1... ${m})`)
    .join(" ");
  const box = printTables(
    `1. e4 (1. d4 Nf6 2. c4) (1. d4 Nf6 2. c4 e6 3. Nc3) (1. d4 Nf6 2. c4 e6 3. Nf3) 1... e5 ${alts} 2. Nf3 *`,
  );
  const tables = [...box.querySelectorAll("table.tbl")];
  const last = tables[tables.length - 1];
  const stem = last.previousElementSibling;
  assert.ok(stem?.classList.contains("print-stem"), "the Indian page has a stem");
  assert.match(stem.textContent, /2\. c4\s+e6/);
  assert.strictEqual(last.querySelector(".main-col"), null);
  assert.strictEqual(last.querySelectorAll("tr")[0].children.length, 3);
  off();
});

test("a page whose lines share nothing beyond the mainline keeps it", () => {
  const off = installDom();
  // two lines leaving the mainline at different moves: nothing to head a page with
  const box = printTables(`1. e4 e5 ${ALTS} (1... e6 2. d4) ${MAIN}`);
  box.querySelectorAll("table.tbl").forEach((t, i) => {
    if (i === 0) return;
    const lines = t.querySelectorAll("tr")[0].children.length - 2;
    if (lines > 1) assert.ok(t.querySelector(".main-col"), `table ${i} keeps its mainline`);
  });
  off();
});

test("the packing is worked out again when the lines change", () => {
  const off = installDom();
  const run = "3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 Qc7 6. Be3 a6 7. Qf3 Nf6 8. O-O-O Ne5 9. Qg3 b5 10. f4 Neg4";
  const tails = ["Bg1", "Bd2", "Nb3", "Qe1", "Qf3", "Qf2", "Qh3", "Qh4", "Rd2", "Re1", "Kb1", "a3"];
  const twelve = tails.map((m) => `(2... e6 ${run} 11. ${m})`).join(" ");
  const s = loadState(`1. e4 c5 2. Nf3 d6 ${twelve} 3. d4 *`);
  const count = () => {
    const box = document.createElement("div");
    appendPrintTables(box, grid(s.lines));
    return box.querySelectorAll("table.tbl").length;
  };
  const before = count();
  assert.strictEqual(count(), before, "the same lines, the same tables");
  // a line added: the old cut must not be reused
  const extra = loadState(`1. e4 c5 2. Nf3 d6 ${twelve} (2... g6 3. d4) (2... Nc6 3. d4) 3. d4 *`);
  s.lines = extra.lines;
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  const cells = [...box.querySelectorAll("table.tbl td")].map((c) => c.textContent);
  assert.ok(cells.includes("g6") && cells.includes("Nc6"), "the new lines are printed");
  off();
});

// ---- odds and ends

// Twelve lines running together for sixteen moves, beside the mainline, and
// two strays that leave at move two: the cut sets the strays apart, and they
// are gathered at the end under their own caption rather than left as scraps.
function withStrays(strays) {
  const run = "3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 Qc7 6. Be3 a6 7. Qf3 Nf6 8. O-O-O Ne5 9. Qg3 b5 10. f4 Neg4";
  const tails = ["Bg1", "Bd2", "Nb3", "Qe1", "Qf3", "Qf2", "Qh3", "Qh4", "Rd2", "Re1", "Kb1", "a3"];
  const twelve = tails.map((m) => `(2... e6 ${run} 11. ${m})`).join(" ");
  return `1. e4 c5 2. Nf3 d6 ${twelve} ${strays} 3. d4 *`;
}
const tablesOf = (box) =>
  [...box.querySelectorAll("table.tbl")].map((t) => {
    const p = t.previousElementSibling;
    const stem = p?.classList.contains("print-stem") ? p.textContent : "";
    return {
      cols: t.querySelectorAll("tr")[0].children.length - 1,
      cells: [...t.querySelectorAll("td")].map((c) => c.textContent),
      stem,
    };
  });

test("small tables are gathered into an odds-and-ends table at the end", () => {
  const off = installDom();
  const st = loadState(withStrays("(2... g6) (2... Nc6 3. d4 cxd4 4. Nxd4 g6 5. c4)"));
  st.noMain = true;
  const box = document.createElement("div");
  appendPrintTables(box, grid(st.lines));
  const ts = tablesOf(box);
  const last = ts[ts.length - 1];
  assert.ok(last.cells.includes("g6") && last.cells.includes("c4"), "both strays, together, at the end");
  // none of the other tables is a scrap
  for (const t of ts.slice(0, -1)) assert.ok(t.cols >= 4, `a ${t.cols}-column table was left`);
  // the twelve keep their stem
  assert.ok(ts.some((t) => /10\. f4\s+Neg4/.test(t.stem)));
  off();
});

test("with nothing small, there is no odds-and-ends table", () => {
  const off = installDom();
  const box = printTables(`1. e4 e5 ${"c5 e6 c6 d5 d6 Nf6 g6 b6 a6 Nc6 f5 h6".split(" ").map((m) => `(1... ${m})`).join(" ")} 2. Nf3 *`);
  assert.strictEqual(box.querySelectorAll("table.tbl").length, 1, "one table, nothing gathered");
  off();
});

test("odds and ends keep the report's column order, so their line numbers ascend", () => {
  const off = installDom();
  // the long stray is written first in the PGN, so it is the earlier line:
  // shorter or not, the one-move stub comes after it (shortest first, the
  // headers read Line 15, Line 1, Line 14)
  const st = loadState(withStrays("(2... Nc6 3. d4 cxd4 4. Nxd4 g6 5. c4) (2... g6)"));
  st.noMain = true;
  assignLineNames();
  const box = document.createElement("div");
  appendPrintTables(box, grid(st.lines));
  const table = [...box.querySelectorAll("table.tbl")].pop();
  const nums = [...table.querySelectorAll("tr")[0].children].slice(1).map((th) => Number(th.textContent.replace(/\D/g, "")));
  assert.deepStrictEqual(nums, [1, 14, 15]);
  off();
});

test("a redraw keeps the odds-and-ends table", () => {
  const off = installDom();
  const st = loadState(withStrays("(2... g6) (2... Nc6 3. d4 cxd4 4. Nxd4 g6 5. c4)"));
  st.noMain = true;
  const draw = () => {
    const box = document.createElement("div");
    appendPrintTables(box, grid(st.lines));
    return tablesOf(box).map((t) => t.cols + ":" + t.cells.join(",")).join(" | ");
  };
  assert.strictEqual(draw(), draw(), "the kept cut draws the same tables");
  off();
});

// A comment belongs to the line that owns its node, which is often a sibling
// that starts lower down than the column printing the move -- on paper a
// group's shared run is written out in its FIRST line's column. The marker
// has to follow the move to that column, or the note is numbered under the
// table and referenced from nowhere in it.
test("a note on a group's shared move is marked where the move is printed", () => {
  const off = installDom();
  // the comment is on 4...g6 (a comment goes with the move after it), owned by
  // the variation's own line, which runs on to 5.Bg5; the sub-variation 5.Be2
  // is laid out first, so its column carries the shared run on paper
  const box = noMainTables(
    "1. e4 c5 2. Nf3 d6 3. d4 cxd4 (3... Nf6 4. Nc3 {the point} 4... g6 5. Bg5 (5. Be2)) 4. Nxd4 *",
  );
  const cell = [...box.querySelectorAll("table.tbl td")].find((td) => td.textContent.startsWith("g6"));
  assert.ok(cell, "4...g6 is printed in a cell");
  assert.ok(cell.querySelector("sup"), "and carries its note's marker");
  assert.match(box.querySelector(".print-notes").textContent, /the point/);
  off();
});

test("a note on a stem move owned by any line on the table is marked in the stem", () => {
  const off = installDom();
  // two lines on the table (the 1.d4 line hidden), the note owned by the
  // second: 2...Nc6 is in the stem, and so must its marker be
  const box = noMainTables("1. d4 (1. e4 e5 2. Nf3 {the point} 2... Nc6 3. Bb5 (3. Bc4)) 1... d5 *", (s) => {
    s.lines[0].hidden = true;
  });
  const stem = box.querySelector(".print-stem");
  assert.match(stem.textContent, /2\. Nf3\s+Nc6/);
  assert.ok(stem.querySelector("sup"), "the stem carries the second line's marker");
  off();
});

// A note on a mainline move is written onto every line through that move, so
// a later table that repeats the move -- in its mainline column, in a stem
// taken off the mainline, or in the stem of a branch that follows the
// mainline for a while -- used to mark it again and list it again. It is the
// mainline's note: marked and listed under the mainline's table only.
function mainlineNoteReport(pgn, ply) {
  const st = loadState(pgn);
  const main = st.lines.find((l) => l.isMain);
  const key = main.moves.slice(0, ply + 1).map((m) => m.san).join(" ");
  st.lines.forEach((l) => {
    if (l.moves.slice(0, ply + 1).map((m) => m.san).join(" ") === key)
      l.comments = [...(l.comments || []), { ply, text: "Test Note" }];
  });
  const box = document.createElement("div");
  appendPrintTables(box, grid(st.lines));
  return [...box.querySelectorAll("table.tbl")].map((t) => {
    const stem = t.previousElementSibling?.classList.contains("print-stem") ? t.previousElementSibling : null;
    return {
      listed: /Test Note/.test(t.parentElement.nextElementSibling.textContent),
      marked: !!(stem && stem.querySelector("sup")) || !!t.querySelector("td sup"),
    };
  });
}

test("a mainline note is not marked or listed in the mainline column of later tables", () => {
  const off = installDom();
  // replies that run a move further, so later tables reach 2.Nf3 in their
  // mainline column
  const alts = "c5 e6 c6 d5 d6 Nf6 g6 b6 a6 Nc6 f5 h6 a5 b5".split(" ").map((m) => `(1... ${m} 2. Nc3)`).join(" ");
  const ts = mainlineNoteReport(`1. e4 e5 ${alts} ${MAIN}`, 2); // on 2.Nf3
  assert.ok(ts.length > 1);
  assert.deepStrictEqual(ts[0], { listed: true, marked: true }, "the mainline's table has it");
  ts.slice(1).forEach((t, i) => assert.deepStrictEqual(t, { listed: false, marked: false }, `table ${i + 1}`));
  off();
});

test("a mainline note is not marked or listed in a later table's stem", () => {
  const off = installDom();
  // on 1.d4, which the King's Indian table's stem repeats
  const ts = mainlineNoteReport(kid(16), 0);
  assert.ok(ts.length > 1);
  assert.strictEqual(ts[0].listed, true);
  ts.slice(1).forEach((t, i) => assert.deepStrictEqual(t, { listed: false, marked: false }, `table ${i + 1}`));
  off();
});

test("with no mainline, every table that shows a noted move lists the note", () => {
  const off = installDom();
  const box = noMainTables(kid(16), (s) =>
    s.lines.forEach((l) => (l.comments = [{ ply: 0, text: "Test Note" }])),
  );
  const tables = [...box.querySelectorAll("table.tbl")];
  assert.ok(tables.length > 1);
  tables.forEach((t, i) => {
    const marked = !!t.previousElementSibling?.querySelector?.("sup") || !!t.querySelector("td sup");
    const listed = /Test Note/.test(t.parentElement.nextElementSibling.textContent);
    assert.strictEqual(listed, marked, `table ${i}: listed where marked, so it stands on its own`);
  });
  off();
});

test("a table's notes are listed in number order", () => {
  const off = installDom();
  // notes numbered in PGN order, but met in a different order walking the
  // columns: the mainline's late note, a sideline's early one
  const box = printTables(
    "1. e4 e5 2. Nf3 {two} 2... Nc6 (2... d6 {one-and-a-half} 3. d4) 3. Bb5 {three} (3. Bc4 {four} 3... Bc5) 3... a6 *",
  );
  const nums = [...box.querySelectorAll(".print-notes .nt sup")].map((s) => Number(s.textContent.replace(/\D/g, "")));
  assert.ok(nums.length >= 3, `notes printed (${nums})`);
  assert.deepStrictEqual(nums, [...nums].sort((a, b) => a - b));
  off();
});
