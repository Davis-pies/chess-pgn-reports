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
  return {
    stem: { tag: "mainline", moves, marks: pick("marks"), noteByPly: pick("noteByPly") },
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
  // the whole horizontal-table section can be left out of the printed report
  const wrap = el("div", {
    className:
      "pv-htable" +
      (getCurrent().printTables === false ? " noprint" : "") +
      (getCurrent().printBorders === false ? " no-borders" : "") +
      (getCurrent().printZebra === true ? " zebra" : ""),
  });
  wrap.style.setProperty("--row-pad", (getCurrent().printRowPad || 0) + "px");
  const mainV = g.vars[0]; // mainline sorts first
  const others = g.vars.slice(1);
  const size = 13; // mainline + 13 = 14 data columns per table (fits a page)
  if (!mainV) {
    box.appendChild(wrap);
    return;
  }
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
    // Later tables stop at the deepest line they actually cover. The FIRST
    // table is the reader's reference for the whole opening, so it runs the
    // mainline out to its full length even when its own branches are short.
    const maxPly = i === 0 ? subMaxPly([mainV, ...lines]) : subMaxPly(lines);
    const off = offshoot(mainV, lines, i);
    // An offshoot table is read against its own stem, not the mainline: the
    // stem is its reference, stated above it, and the lines are grouped from
    // where they leave it.
    const pv = off ? printVars(stemRef(off.stem.moves), off.cols) : printVars(mainV, lines);
    const stem = off ? off.stem.moves.length : stemLength([mainV, ...lines]);
    if (stem) {
      const s = el("div", { className: "print-stem" });
      // the stem's moves, marks and note markers: every column states these
      // moves, and the rows that carried the markers are gone
      buildCardMoves(s, off ? off.stem : { ...mainV, moves: mainV.moves.slice(0, stem) });
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
    renderTableNotes(wrap, off ? lines : [mainV, ...lines], i === 0 && !off);
  });
  box.appendChild(wrap);
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
function renderTableNotes(wrap, vars, showMain) {
  const rows = [];
  // Notes are shared: the editor writes one note onto every line in an
  // equal-position group, and identical PGN comment text at the same ply
  // collapses to a single note in allNotes(). So dedupe ACROSS lines here —
  // notesForVar only dedupes within one line.
  const seen = new Set();
  // Skipping the mainline var is not enough to keep its notes off later
  // tables: a note written on the mainline is copied onto every line in its
  // equal-position group, so a sideline in a later table carries it too and
  // would reprint it. Suppress the mainline's notes by number instead.
  const mainOnly = new Set();
  if (!showMain) {
    const mainV = vars.find((v) => v.tag === "mainline");
    if (mainV) notesForVar(mainV).forEach((n) => mainOnly.add(n.n));
  }
  vars.forEach((v) => {
    if (v.tag === "mainline" && !showMain) return;
    notesForVar(v).forEach((n) => {
      if (seen.has(n.n) || mainOnly.has(n.n)) return;
      seen.add(n.n);
      rows.push(n);
    });
  });
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

// How wide a table of these lines comes out, in columns beside the mainline.
// NOT the line count: a group costs a column of its own for the moves its
// lines share, so a table of eight lines can be eleven columns wide.
function printWidth(mainV, lines) {
  return printVars(mainV, lines).length - 1; // less the mainline reference
}

// Greedily pack lines into print tables, targeting FULL tables: walk them in
// trie order, which keeps a fork's lines adjacent, and start a new table as
// soon as the next line would push this one past the cap. Only the last table
// is sparse.
//
// The cap is measured in COLUMNS, not lines. Counting lines was right while
// every line was a column of its own; now that a group takes a column too, a
// line-counted table of 13 could render 20 columns wide and run off the page.
// The measurement is the same builder that renders the table, so the two
// cannot disagree about what fits.
function packForPrint(mainV, lines, size) {
  const tables = [];
  let cur = [];
  // In the order the report lays the branches out, not the order the PGN
  // wrote them: pages are cut from this sequence, so packing in a different
  // order would put a branch on page three that the layout wants beside the
  // mainline on page one.
  for (const l of orderedLeaves(mainV, lines)) {
    // a lone line is one column: it always fits, and this keeps a table from
    // being closed empty
    if (!cur.length) {
      cur = [l];
      continue;
    }
    const next = [...cur, l];
    if (printWidth(mainV, next) <= size) cur = next;
    else {
      tables.push(cur);
      cur = [l];
    }
  }
  if (cur.length) tables.push(cur);
  return tables;
}
