// Print/PDF horizontal table. The mainline is always shown as the reference
// column; the side lines are split into vertical slices of ~16 columns so the
// table wraps across pages instead of being cut off or scaled.
import { renderTable, appendFootnote } from "./render.js";
import { el, renderInline } from "./dom.js";
import { getCurrent } from "./state.js";
import { allNotes } from "./notes.js";
import { buildTrie, leavesOf } from "./trie-view.js";
import { moveRef } from "./export.js";

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
  if (!split && others.length <= size) {
    renderTable(wrap, g, "horizontal");
    renderTableNotes(wrap, g.vars, true);
  } else {
    // pack branches into tables of up to `size` lines: tiny branches share
    // a table, and an oversized fork is cut at its own sub-forks — every
    // table spans only the deepest line it actually covers (the mainline
    // reference column stops there too). Each table's notes render under
    // it; the mainline's notes only under the first table.
    packForPrint(buildTrie(others, mainV), size).forEach((lines, i) => {
      // Later tables stop at the deepest line they actually cover. The FIRST
      // table is the reader's reference for the whole opening, so it runs the
      // mainline out to its full length even when its own branches are short.
      const maxPly = i === 0 ? subMaxPly([mainV, ...lines]) : subMaxPly(lines);
      renderTable(
        wrap,
        { ...g, vars: [mainV, ...lines], maxPly },
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
    const span = document.createElement("span");
    if (n.foot) {
      appendFootnote(span, n.foot);
    } else {
      span.appendChild(document.createTextNode(moveRef(n.ply, n.owner) + " — "));
      renderInline(span, n.text);
    }
    row.appendChild(span);
    box.appendChild(row);
  });
}

// Greedily pack trie branches into print-table line groups, targeting FULL
// tables. Coherent chunks (a fork's lines, kept together while they fit the
// cap) fill each table to the cap; only the final table may be sparse. A fork
// bigger than the cap is split at its own sub-forks first.
function packForPrint(trie, size) {
  const chunks = [];
  const collect = (node) => {
    const lines = leavesOf(node);
    if (lines.length <= size) {
      chunks.push(lines);
      return;
    }
    // too big for one table: split at the real sub-forks
    if (node.leaf) chunks.push([node.leaf]);
    node.children.forEach((c) => collect(c));
  };
  trie.children.forEach((c) => collect(c));
  // fill every table to the cap, splitting a chunk at the boundary so no
  // table is left sparse except the last one
  const tables = [];
  let cur = [];
  for (const chunk of chunks) {
    if (cur.length + chunk.length <= size) {
      cur.push(...chunk);
    } else {
      const take = size - cur.length;
      cur.push(...chunk.slice(0, take));
      tables.push(cur);
      cur = chunk.slice(take);
    }
  }
  if (cur.length) tables.push(cur);
  return tables;
}
