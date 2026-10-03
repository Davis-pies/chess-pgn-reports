// Print/PDF horizontal table. The mainline is always shown as the reference
// column; the side lines are split into vertical slices of ~14 columns so the
// table wraps across pages instead of being cut off or scaled.
//
// The side lines are GROUPED, the way the editor's table groups them: lines
// sharing a run of moves below their divergence from the mainline state that
// run once, in a column of their own, and pick up from where it ends. Every
// group is open (nothing folds on paper) and every table is self-contained,
// so a slice never refers back to a column on the page before it.
import { renderTable, appendFootnote, buildCardMoves } from "./render.js";
import { el, renderInline } from "./dom.js";
import { getCurrent } from "./state.js";
import { allNotes } from "./notes.js";
import { moveRef } from "./export.js";
import { flatGroupedVars, orderedLeaves } from "./group-cols.js";

// The columns one printed table renders: the same grouping the editor's table
// builds, with every group open — there is nothing to click on paper, so a
// folded group would just withhold moves from the reader.
//
// Built from THAT TABLE's lines, not the notebook's: a group whose lines were
// split across a page boundary is re-derived on the far side from the lines
// that landed there, so it restates its shared moves instead of pointing back
// at a column on the previous page. A line that arrives alone has no group
// above it and spells its whole divergence out. Every table stands on its own.
function printVars(mainV, lines) {
  const { vars, spans } = flatGroupedVars(mainV, lines);
  return withSpans(
    vars.map((v) =>
      // A lead-in ellipsis marks a cell where the line has no move of its own.
      // On screen that is worth saying: it tells a reader scanning a column
      // that its moves start lower down. On paper it filled most of a wide
      // table with dots, and now that the group rules say where each column
      // picks up from, blank says it better.
      blankElisions(
    // "Sideline" on every column but one tells the reader nothing they cannot
    // see -- they are all sidelines. A header renders `name || label`, so
    // dropping the tag leaves the name the reader gave the line, and nothing
    // where they gave it none. The mainline keeps its label: it IS the column
    // the others are read against, and usually has no name of its own.
        v.tag === "mainline" ? v : { ...v, label: "" },
      ),
    ),
    spans,
  );
}

function blankElisions(v) {
  const cells = {};
  for (const [k, c] of Object.entries(v.cells))
    cells[k] = c.cls === "ellip" ? { ...c, text: "" } : c;
  return { ...v, cells };
}

// vars and their group rules travel together: every caller below passes the
// list straight into renderTable, and a rule separated from the columns it
// spans would point at the wrong ones.
function withSpans(vars, spans) {
  vars.spans = spans;
  return vars;
}

// Highest ply present in a subset of table vars — so a per-branch print table
// doesn't render empty rows down to the notebook's global max.
export function subMaxPly(vars) {
  let m = 0;
  for (const v of vars)
    for (const p of Object.keys(v.cells)) {
      const n = Number(p);
      if (n > m) m = n;
    }
  return m;
}

// How many leading plies every column of a printed table states identically:
// the stem MCO prints once above a table instead of down every column. Capped
// one short of the shortest column so no line is swallowed whole and left with
// nothing to say below it. A lone column is not a table of alternatives, so it
// has no stem.
export function stemLength(vars) {
  if (vars.length < 2) return 0;
  const shortest = Math.min(...vars.map((v) => v.moves.length));
  let n = 0;
  while (
    n < shortest - 1 &&
    vars.every((v) => v.moves[n].san === vars[0].moves[n].san)
  )
    n++;
  return n;
}

// A table whose lines all come off one branch -- they share moves with each
// other beyond anything they share with the mainline -- is headed by that
// branch instead: the shared run is written once above it, the rows start
// where its lines split, and the mainline column goes, because below the stem
// it would be showing moves from a position these lines never reach. It is
// the same thing the mainline stem does, applied to whatever a page's lines
// have in common.
//
// A line that IS that shared base -- every other line on the page carries on
// from its last move -- has nothing left to say below the stem, so it gives
// up its column and the stem runs to its end. Its notes still print under the
// table.
//
// Not the first table while there is a mainline: that table is the reader's
// reference for the whole opening, and the only place the mainline is
// printed. With no mainline there is no such table, and every page gets its
// own stem.
//
// Returns { stem, cols } -- the stem as a printable var (full moves from move
// one, with the marks and note markers of the columns that carried them) and
// the lines that keep a column -- or null.
function offshoot(mainV, lines, index) {
  if (!mainV.synthetic && index === 0) return null;
  const base = baseLine(lines);
  const cols = base ? lines.filter((l) => l !== base) : lines;
  const side = Math.max(base ? base.moves.length : 0, stemLength(cols));
  const withMain = mainV.synthetic ? 0 : stemLength([mainV, ...lines]);
  if (side <= withMain) return null;
  // the continuations can share more than the base line has moves
  const moves = cols[0].moves.slice(0, side);
  // A move the page's lines share with the mainline was the mainline's cell,
  // so its marker lives on the mainline var; the rest are the lines' own, the
  // base line's first (a note on its last move is on it alone).
  const mainShared = mainV.synthetic ? 0 : divergenceOf(mainV, cols[0]);
  const pick = (key) => {
    const out = {};
    for (const m of moves) {
      const from = m.ply < mainShared ? [mainV] : [base, cols[0]].filter(Boolean);
      const v = from.map((x) => x[key] && x[key][m.ply]).find((x) => x !== undefined);
      if (v !== undefined) out[m.ply] = v;
    }
    return out;
  };
  // Note markers are gathered from every line on the table, not just the one
  // the moves were read off: a note on a stem move belongs to whichever line
  // owns that node, and the stem is the only place the move is printed on
  // this table. Except the moves the table shares with the mainline: those are
  // the mainline's, annotated once, in the mainline's table -- a note on one
  // is copied onto every line through it, and marking it again on every later
  // table that happens to pass through that move is noise.
  const noteByPly = {};
  for (const m of moves) {
    if (m.ply < mainShared) continue;
    const refs = new Set();
    for (const v of lines)
      ((v.noteByPly && v.noteByPly[m.ply]) || []).forEach((n) => refs.add(n));
    if (refs.size) noteByPly[m.ply] = [...refs].sort((a, b) => a - b);
  }
  return {
    stem: { tag: "mainline", moves, marks: pick("marks"), noteByPly },
    cols,
  };
}

// The line on a page that every other line on it continues: a strict prefix
// of all the rest. Only with at least one line continuing it, or it is not a
// base of anything.
function baseLine(lines) {
  if (lines.length < 2) return null;
  return (
    lines.find((b) =>
      lines.every(
        (l) =>
          l === b ||
          (l.moves.length > b.moves.length && divergenceOf(b, l) === b.moves.length),
      ),
    ) || null
  );
}

const divergenceOf = (a, b) => {
  let n = 0;
  while (n < a.moves.length && n < b.moves.length && a.moves[n].san === b.moves[n].san) n++;
  return n;
};

// The reference an offshoot table's columns are grouped against: its stem, as
// the same kind of empty, never-rendered reference the no-mainline view uses.
const stemRef = (moves) => ({
  line: null,
  tag: "mainline",
  label: "",
  name: "",
  moves,
  marks: {},
  cells: {},
  noteByPly: {},
  d: 0,
  synthetic: true,
});

export function appendPrintTables(box, g) {
  fillPrintTables(printTablesBox(box), g);
}

// The section on its own, empty, for a caller that fills it later: the app
// builds the tables only when the page is printed (see app.js), as nothing
// on screen shows them.
export function printTablesBox(box) {
  // the whole horizontal-table section can be left out of the printed report
  const wrap = el("div", {
    className:
      "pv-htable" +
      (getCurrent().printTables === false ? " noprint" : "") +
      (getCurrent().printBorders === false ? " no-borders" : "") +
      (getCurrent().printZebra === true ? " zebra" : ""),
  });
  wrap.style.setProperty("--row-pad", (getCurrent().printRowPad || 0) + "px");
  box.appendChild(wrap);
  return wrap;
}

export function fillPrintTables(wrap, g) {
  const mainV = g.vars[0]; // mainline sorts first
  const others = g.vars.slice(1);
  const size = 13; // mainline + 13 = 14 data columns per table (fits a page)
  if (!mainV) return;
  // pack branches into tables of up to `size` COLUMNS: tiny branches share
  // a table, and an oversized fork spills into the next one — every table
  // spans only the deepest line it actually covers (the mainline reference
  // column stops there too). Each table's notes render under it; the
  // mainline's notes only under the first table.
  // A report with no side lines packs into nothing, but it still has a
  // mainline to print and notes to print under it -- so it gets one table of
  // its own rather than no table at all.
  const packs = packForPrint(mainV, others, size);
  (packs.length ? packs : [[]]).forEach((lines, i) => {
    const { off, pv, stem, maxPly } = tableShape(mainV, lines, i);
    if (stem) {
      const s = el("div", { className: "print-stem" });
      // the stem's moves, marks and note markers: every column states these
      // moves, and the rows that carried the markers are gone
      buildCardMoves(s, off ? off.stem : { ...referenceFor(mainV, i), moves: mainV.moves.slice(0, stem) });
      wrap.appendChild(s);
    }
    renderTable(wrap, {
      ...g,
      noMain: g.noMain || !!off,
      vars: pv,
      // "branch lines" off: the rules go, and the cells they covered were
      // blank already, so nothing else on the page moves
      spans: getCurrent().printBranchLines === false ? [] : pv.spans,
      maxPly,
      fromPly: stem,
      byMove: getCurrent().printByMove === true,
    });
    renderTableNotes(wrap, lines, { mainV, showMain: i === 0 && !off });
  });
}

// The numbered notes belonging to a table's var (matched back to its source
// line by move-array identity). Numbers match the superscripts in the cells.
// Footnote-derived entries have no comment behind them, so they are collected
// by owner: they belong to the line their anchor marker sits on.
function notesForVar(v) {
  const line = getCurrent().lines.find((l) => l.moves === v.moves);
  if (!line) return [];
  const all = allNotes();
  const out = [];
  const seen = new Set();
  const take = (n) => {
    if (!n || seen.has(n.n)) return;
    seen.add(n.n);
    out.push(n);
  };
  all.forEach((n) => {
    if (n.foot && n.owner === line) take(n);
  });
  (line.comments || []).forEach((c) => {
    take(all.find((x) => x.ply === c.ply && x.text === c.text));
  });
  return out;
}

// A table's notes rendered beneath it in the print report. `showMain` includes
// the mainline's notes (first table only — the mainline column repeats in
// every packed table).
function renderTableNotes(wrap, lines, { mainV, showMain }) {
  const rows = [];
  // Notes are shared: the editor writes one note onto every line in an
  // equal-position group, and identical PGN comment text at the same ply
  // collapses to a single note in allNotes(). So dedupe ACROSS lines here --
  // notesForVar only dedupes within one line. Every table lists the notes it
  // marks, so it stands on its own, like the rest of the printed report.
  //
  // The mainline's notes are listed under the mainline's table and nowhere
  // else. Skipping the mainline var is not enough to keep them off later
  // tables: a note written on the mainline is copied onto every line in its
  // equal-position group, so a sideline in a later table carries it too and
  // would reprint it. Suppress the mainline's notes by number instead -- on
  // every later table, including one headed by its own stem, which has no
  // mainline column at all.
  const mainOnly = new Set();
  const main = mainV && !mainV.synthetic ? mainV : null;
  if (main && !showMain) notesForVar(main).forEach((n) => mainOnly.add(n.n));
  const vars = showMain && main ? [main, ...lines] : lines;
  const seen = new Set();
  vars.forEach((v) => {
    notesForVar(v).forEach((n) => {
      if (seen.has(n.n) || mainOnly.has(n.n)) return;
      seen.add(n.n);
      rows.push(n);
    });
  });
  // In note-number order, not the order the columns were walked in: the
  // numbers are how the reader finds a note from its marker.
  rows.sort((a, b) => a.n - b.n);
  // Always emitted, even with nothing in it: this block carries the gap to the
  // next table, so every table gets the same separation without the spacing
  // having to depend on whether notes happen to exist.
  const box = el("div", {
    className: "print-notes" + (rows.length ? "" : " empty"),
  });
  wrap.appendChild(box);
  if (!rows.length) return;
  box.appendChild(
    el("div", { className: "print-notes-h", textContent: "Notes" }),
  );
  rows.forEach((n) => {
    const row = el("div", { className: "nt" });
    row.appendChild(el("sup", { textContent: "[" + n.n + "]" }));
    // A footnote owns the whole row (see notesPanel in export.js).
    if (n.foot) {
      appendFootnote(row, n.foot);
    } else {
      const span = document.createElement("span");
      span.appendChild(document.createTextNode(moveRef(n.ply, n.owner) + " — "));
      renderInline(span, n.text);
      row.appendChild(span);
    }
    box.appendChild(row);
  });
}

// Everything about one printed table that depends only on its lines and
// whether it is the first: its columns, its stem, and the rows it will take.
// One definition for the renderer and the packer, so the packer's idea of
// what a table costs is the table that is printed.
//
// Later tables stop at the deepest line they actually cover. The FIRST table
// is the reader's reference for the whole opening, so it runs the mainline
// out to its full length even when its own branches are short. An offshoot
// table is read against its own stem, not the mainline: the stem is its
// reference, stated above it, and the lines are grouped from where they
// leave it.
function tableShape(mainV, lines, index) {
  const { off, stem, maxPly, rows } = tableRows(mainV, lines, index);
  const pv = off ? printVars(stemRef(off.stem.moves), off.cols) : printVars(referenceFor(mainV, index), lines);
  // columns beside the mainline reference, where there is one
  const width = pv.length - (off || mainV.synthetic ? 0 : 1);
  return { off, pv, stem, maxPly, width, rows };
}

// The mainline as a later table's reference column: its moves and symbols,
// but not its note markers. Its notes are listed under the mainline's own
// table, and a note on a mainline move is copied onto every line through that
// move -- so marking it again in every later table that repeats the mainline
// is a marker pointing at a note that table does not list.
const quiet = new WeakMap();
function referenceFor(mainV, index) {
  if (index === 0 || mainV.synthetic) return mainV;
  if (!quiet.has(mainV)) quiet.set(mainV, { ...mainV, noteByPly: {} });
  return quiet.get(mainV);
}

// The part of a table's shape that does not need its columns built: cheap
// enough for the packer to price every candidate table with.
function tableRows(mainV, lines, index) {
  const maxPly = index === 0 ? subMaxPly([mainV, ...lines]) : subMaxPly(lines);
  const off = offshoot(mainV, lines, index);
  // The table carrying the mainline gets a stem too. It once stated the
  // mainline whole, from move one, but the moves every line shares then ran
  // down the mainline's column beside empty ones, often for most of a page,
  // before the table reached the move where anything happens. Written once
  // above the table, they still read as the mainline (the stem is its moves,
  // with its symbols and note markers), and its column picks up from there.
  const stem = off ? off.stem.moves.length : stemLength([mainV, ...lines]);
  return { off, stem, maxPly, rows: Math.max(maxPly - stem + 1, 0) };
}

// What a table costs on paper beyond its rows: its header row, the stem above
// it and the gap its notes block leaves before the next one.
const TABLE_OVERHEAD = 3;

// A table narrower than this is small: see combineSmall.
const MIN_COLS = 4;

// Cut the lines into print tables, in the order the report lays them out (a
// fork's lines adjacent), using as little paper as possible.
//
// Tables stack down the page, so what a report costs is the rows its tables
// take, not how full each one is. Filling each table to the column cap, as
// this once did, let one stray line cost a page: a table of twelve lines
// that all run sixteen moves together, plus one that leaves at move two,
// loses its stem to that one line and prints thirty rows of mostly blank
// column. So this chooses where to cut by what the cuts cost: the rows each
// table takes below its stem, plus a few for the table itself so a report is
// not shredded into many tiny tables to save a row. Columns still cap a
// table, measured by the same builder that renders it.
//
// A dynamic programme over the ordered lines: the cheapest way to print the
// first j lines is the cheapest way to print the first i, plus one table of
// lines i..j. A table's width only grows as lines are added to it, so the
// search back from j stops at the first i that no longer fits.
// The cut depends only on the lines' moves (and which is the mainline), not
// on anything else a redraw changes -- and the report redraws the print tables
// on every edit, hidden on screen. So the last cut is kept, as which lines
// each table holds, and reused while the moves are the same.
let lastCut = { key: null, cut: null };

function packForPrint(mainV, lines, size) {
  const order = orderedLeaves(mainV, lines);
  const key = [
    size,
    mainV.synthetic ? "" : mainV.moves.map((m) => m.san).join(" "),
    ...order.map((l) => l.moves.map((m) => m.san).join(" ")),
  ].join("|");
  if (lastCut.key === key) return rebuild(order, lastCut.cut);
  const tables = combineSmall(mainV, packFresh(mainV, order, size), size);
  lastCut = { key, cut: tables.map((t) => t.map((l) => order.indexOf(l))) };
  return tables;
}

// A kept cut, as tables of this render's lines.
function rebuild(order, cut) {
  return cut.map((at) => at.map((k) => order[k]));
}

// The cut above is by paper alone, and paper alone is happy to leave a line
// or two on a table of their own: a table a column or two wide, which reads
// as a scrap on the page. So, once the cut is made, the small tables leave
// their places and their lines are packed together, in report order, into an
// "odds and ends" table (or as many as they need) at the end of the report.
// The first table stays where it is, small or not, when it carries the
// mainline.
function combineSmall(mainV, tables, size) {
  const width = (lines, i) => tableShape(mainV, lines, i).width;
  const keep = [];
  const odds = [];
  tables.forEach((t, i) => {
    // the first table stays only when it carries the mainline
    if ((i > 0 || mainV.synthetic) && width(t, i) < MIN_COLS) odds.push(...t);
    else keep.push(t);
  });
  if (!odds.length) return tables;
  // Shortest first: a table is as tall as its longest line, so lines of a
  // length share a table rather than a one-move stub waiting down the column
  // of a forty-move line. Split evenly across as few tables as the column cap
  // allows, so the last is not a lone scrap of its own.
  odds.sort((a, b) => a.moves.length - b.moves.length);
  const per = Math.ceil(odds.length / Math.ceil(odds.length / size));
  let cur = [];
  const close = () => {
    keep.push(cur);
    cur = [];
  };
  for (const l of odds) {
    if (cur.length && (cur.length >= per || width([...cur, l], 1) > size)) close();
    cur.push(l);
  }
  close();
  return keep;
}

function packFresh(mainV, order, size) {
  const withMain = cutForPaper(mainV, order, size, 0);
  // The first table keeps the mainline, so lines packed beside it can never
  // be headed by a run of their own. Sometimes the mainline is cheaper on a
  // table of its own and every other table headed by what its lines share;
  // price that too, and take whichever costs less. (With no mainline there is
  // no such table to give it.)
  if (mainV.synthetic || !order.length) return withMain.tables;
  const alone = tableRows(mainV, [], 0).rows + TABLE_OVERHEAD;
  const apart = cutForPaper(mainV, order, size, 1);
  return alone + apart.cost < withMain.cost ? [[], ...apart.tables] : withMain.tables;
}

// The cheapest cut of `order` into tables, the first of them numbered
// `firstIndex` (0: it carries the mainline).
//
// Pricing a table is cheap (tableRows); knowing whether it fits means
// building its columns, which is not. A table only gets wider as lines are
// added to it, so the first line a table ending at j can start from only
// moves forward as j does: `lo` walks along with j, and the columns are built
// about once per line rather than once per candidate table.
function cutForPaper(mainV, order, size, firstIndex) {
  const n = order.length;
  const best = [0];
  const from = [0];
  const index = (i) => (i === 0 ? firstIndex : 1);
  const fits = (i, j) => j - i === 1 || tableShape(mainV, order.slice(i, j), index(i)).width <= size;
  let lo = 0;
  for (let j = 1; j <= n; j++) {
    while (!fits(lo, j)) lo++;
    best[j] = Infinity;
    for (let i = j - 1; i >= lo; i--) {
      const cost = best[i] + tableRows(mainV, order.slice(i, j), index(i)).rows + TABLE_OVERHEAD;
      // on a tie, the fuller table: fewer tables for the same paper
      if (cost <= best[j]) {
        best[j] = cost;
        from[j] = i;
      }
    }
  }
  const tables = [];
  for (let j = n; j > 0; j = from[j]) tables.unshift(order.slice(from[j], j));
  return { tables, cost: best[n] };
}
