// Print/PDF horizontal table. The mainline is always shown as the reference
// column; the side lines are split into vertical slices of ~14 columns so the
// table wraps across pages instead of being cut off or scaled.
//
// The side lines are GROUPED, the way the editor's table groups them: lines
// sharing a run of moves below their divergence from the mainline state that
// run once, in a column of their own, and pick up from where it ends. Every
// group is open (nothing folds on paper) and every table is self-contained,
// so a slice never refers back to a column on the page before it.
import { renderTable, appendFootnote } from "./render.js";
import { el, renderInline } from "./dom.js";
import { getCurrent } from "./state.js";
import { allNotes } from "./notes.js";
import { buildTrie, leavesOf } from "./tree.js";
import { moveRef } from "./export.js";
import { groupedVars } from "./group-cols.js";

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
  return groupedVars(mainV, lines, { isOpen: () => true });
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

export function appendPrintTables(box, g) {
  // the whole horizontal-table section can be left out of the printed report
  const wrap = el("div", {
    className:
      "pv-htable" + (getCurrent().printTables === false ? " noprint" : ""),
  });
  const mainV = g.vars[0]; // mainline sorts first
  const others = g.vars.slice(1);
  const size = 13; // mainline + 13 = 14 data columns per table (fits a page)
  if (!mainV) {
    box.appendChild(wrap);
    return;
  }
  const split = getCurrent().showSplitTrie === true;
  if (!split && printWidth(mainV, others) <= size) {
    renderTable(wrap, { ...g, vars: printVars(mainV, others) }, "horizontal");
    // Notes are collected off the LINES, not the columns: a group column is
    // synthesised and matches no line, and its shared moves' notes are already
    // gathered onto it by the column builder.
    renderTableNotes(wrap, g.vars, true);
  } else {
    // pack branches into tables of up to `size` COLUMNS: tiny branches share
    // a table, and an oversized fork spills into the next one — every table
    // spans only the deepest line it actually covers (the mainline reference
    // column stops there too). Each table's notes render under it; the
    // mainline's notes only under the first table.
    packForPrint(mainV, others, size).forEach((lines, i) => {
      // Later tables stop at the deepest line they actually cover. The FIRST
      // table is the reader's reference for the whole opening, so it runs the
      // mainline out to its full length even when its own branches are short.
      const maxPly = i === 0 ? subMaxPly([mainV, ...lines]) : subMaxPly(lines);
      renderTable(
        wrap,
        { ...g, vars: printVars(mainV, lines), maxPly },
        "horizontal",
      );
      renderTableNotes(wrap, [mainV, ...lines], i === 0);
    });
  }
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
  for (const l of leavesOf(buildTrie(lines, mainV))) {
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
