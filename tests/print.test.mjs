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
  assert.deepStrictEqual(col(2), ["", "c5", "Nf3", "Nc6", "Bb5"]);
  // The sibling still starts after the shared run. Its cell on the fork's own
  // row is the group rule, which carries no text -- the rule is the statement.
  assert.deepStrictEqual(col(3), ["", "", "", "", "a4"]);
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
  const rules = [...box.querySelectorAll("td.grp-rule")];
  assert.strictEqual(rules.length, 1, "one group, one covered cell");
  // it sits on the row whose cell to its left holds the last shared move
  const row = rules[0].parentElement;
  assert.strictEqual(rules[0].previousElementSibling.textContent, "Nc6");
  assert.strictEqual(
    rows.indexOf(row),
    4,
    "on Nc6's row, not floating above the header",
  );
  // it keeps its own cell -- no colspan swallowing the columns it covers
  assert.strictEqual(rules[0].colSpan, 1);
  assert.strictEqual(rules[0].textContent, "", "and states nothing but itself");
  // the rightmost covered cell closes the rule off
  assert.ok(rules[0].classList.contains("grp-rule-end"));
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
  const ends = box.querySelectorAll("td.grp-rule-end").length;
  assert.strictEqual(ends, 2, "the outer group and the one inside it");
  // Every mark is a junction on its own group's row -- a tee or a corner --
  // never a stroke running down the table. Two groups, two rows carrying them.
  const rows = [...box.querySelectorAll("table.tbl tr")];
  const marked = rows.filter((tr) => tr.querySelector("td.grp-rule"));
  assert.strictEqual(marked.length, 2, "one row of marks per group");
  assert.strictEqual(
    box.querySelectorAll("td.grp-edge").length,
    0,
    "nothing runs down the table beside a column",
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
    const stem = [...t.querySelectorAll("td")].filter(
      (c) => c.textContent === "Bg7",
    );
    assert.strictEqual(stem.length, 1, `table ${i} states the stem exactly once`);
  });
  off();
});

// The same rule where the spill is a single line: alone on its table it has no
// group above it to have said the moves, so it goes back to spelling its whole
// divergence out rather than eliding against a column that isn't there.
test("a line alone on a later print table keeps its whole divergence", () => {
  const off = installDom();
  // Without group columns a line costs exactly one column, so the cap is
  // reached by lines alone: 13 fill the first table, the 14th spills.
  const box = printTables(kid(14));
  const tables = [...box.querySelectorAll("table.tbl")];
  const last = tables[tables.length - 1];
  const rows = [...last.querySelectorAll("tr")];
  const cols = rows[0].querySelectorAll("th").length;
  assert.strictEqual(cols, 3, "ply label + mainline + the one spilled line");
  const own = rows
    .slice(1)
    .map((tr) => tr.children[2].textContent)
    .filter((t) => t && t !== "\u2026");
  assert.deepStrictEqual(own, ["Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Qd2"]);
  off();
});

// showSplitTrie is off by default, so this narrow path — one table, no packing —
// is the one most reports take. It groups too; the cascade is a property of the
// printed table, not of the splitting.
test("a report that fits one table cascades without the trie split", () => {
  const off = installDom();
  const st = loadState(
    "1. e4 c5 2. Nf3 d6 3. d4 (3. Bb5+ Bd7 4. Bxd7+ Qxd7)" +
      " (3. Bb5+ Bd7 4. Bxd7+ Nxd7) 3... cxd4 *",
  );
  getCurrent().showSplitTrie = false;
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
  getCurrent().showSplitTrie = false;
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
  assert.strictEqual(marked.length, 2, "the outer group and the nested one");

  // the outer group's row: it has two children, one of which owns two columns,
  // so its run covers ONE cell -- the column where that child begins
  const outer = marked[0];
  const cells = [...outer.children];
  const covered = cells.filter((c) => c.classList.contains("grp-rule"));
  assert.strictEqual(covered.length, 1, "one cell: the last child's own column");
  assert.ok(covered[0].classList.contains("grp-rule-end"), "and it is the corner");
  assert.ok(covered[0].classList.contains("grp-tee"), "with a tick into it");
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
  const outer = [...box.querySelectorAll("table.tbl tr")].filter((tr) =>
    tr.querySelector("td.grp-rule"),
  )[0];
  const covered = [...outer.children].filter((c) =>
    c.classList.contains("grp-rule"),
  );
  const tees = covered.filter((c) => c.classList.contains("grp-tee"));
  assert.ok(covered.length > tees.length, "the run crosses more than it marks");
  assert.strictEqual(tees.length, 1, "one child begins in this run's span");
  off();
});
