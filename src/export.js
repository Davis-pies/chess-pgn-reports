import { grid } from "./table.js";
import {
  fullmoveLabel,
  cardMovesText,
  appendFootnote,
  footnoteText,
} from "./render.js";
import { el, renderInline } from "./dom.js";
import { getCurrent, getRenderHooks } from "./state.js";
import { allNotes } from "./notes.js";

// Explicit move reference for a note, e.g. "7.Nbd2" / "7...Nbd7" (number + SAN).
// A variation-owned note (inVar) is looked up among non-main lines, since a
// variation's first move shares a ply with the mainline move it replaces (e.g.
// the variation's cxd6 and the mainline Kf6 both at ply 71).
export function moveRef(ply, owner) {
  // use the owning line's move if given (a variation note at a colliding ply
  // should reference the variation's move, not the mainline's)
  const pool = owner ? [owner] : getCurrent().lines.filter((l) => l.isMain);
  for (const l of pool) {
    const m = l.moves.find((x) => x.ply === ply);
    if (m) return fullmoveLabel(m.ply) + m.san;
  }
  return fullmoveLabel(ply);
}

// "→ <directly preceding move>" so a branched line's divergence point is clear.
export function branchContext(l) {
  if (l.isMain) return "";
  const mainL =
    getCurrent().lines.find((x) => x.isMain) || getCurrent().lines[0];
  let d = 0;
  const mv = l.moves;
  while (
    d < mv.length &&
    d < mainL.moves.length &&
    mv[d].san === mainL.moves[d].san
  )
    d++;
  if (!d) return "";
  const m = mv[d - 1];
  return (
    "→ " + (m.ply % 2 === 0 ? Math.floor(m.ply / 2) + 1 + ". " : "") + m.san
  );
}

// The read-only reference list that prints and exports. Notes are numbered
// (PGN {comments}); a Footnote-tagged line derives an entry in the same
// sequence, anchored on the mainline move it replaces.
export function notesFootnotesPanel() {
  const box = el("div", { className: "notes" });
  const notes = allNotes();
  box.appendChild(el("h3", { textContent: "Notes" }));
  notes.forEach((note) => {
    const row = el("div", { className: "nt" });
    row.appendChild(el("sup", { textContent: "[" + note.n + "]" }));
    const span = document.createElement("span");
    if (note.foot) {
      appendFootnote(span, note.foot);
    } else {
      span.appendChild(
        document.createTextNode(moveRef(note.ply, note.owner) + " — "),
      );
      renderInline(span, note.text);
    }
    row.appendChild(span);
    box.appendChild(row);
  });
  return box;
}

// card text size bounds, as a percentage of the default
const FONT_MIN = 60;
const FONT_MAX = 200;

export function exportBar() {
  const bar = el("div", { className: "export" });
  const printBtn = el("button", {
    className: "chip",
    textContent: "Print / Save as PDF",
  });
  printBtn.onclick = () => window.print();
  const pgn = el("button", { className: "chip", textContent: "Export PGN" });
  pgn.onclick = () =>
    download(slug() + ".pgn", getCurrent().pgn, "application/x-chess-pgn");
  const md = el("button", {
    className: "chip",
    textContent: "Export Markdown",
  });
  md.onclick = () => download(slug() + ".md", buildMarkdown(), "text/markdown");
  const copy = el("button", { className: "chip", textContent: "Copy report" });
  copy.onclick = async () => {
    const text = buildMarkdown();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    copy.textContent = "Copied ✓";
    setTimeout(() => (copy.textContent = "Copy report"), 1500);
  };
  // print/PDF options: which diagrams appear in the Lines (print) cards, and
  // whether the table splits by trie. Each option is checkbox-first; they're
  // grouped by target with a clear gap between groups. These sit ABOVE the
  // action buttons: they configure what the buttons produce, so reading order
  // should be choose-then-act.
  const pOpts = el("div", { className: "printopts" });
  const group = (title, checks) => {
    const g = el("div", { className: "optgroup" });
    g.appendChild(el("span", { className: "optgroup-h", textContent: title }));
    checks.forEach(([label, key, def]) => {
      const lab = el("label", { className: "opt" }, [
        el("input", {
          type: "checkbox",
          checked: getCurrent()[key] == null ? def : getCurrent()[key],
        }),
        " " + label,
      ]);
      lab.querySelector("input").onchange = (e) => {
        getCurrent()[key] = e.target.checked;
        getRenderHooks().renderApp();
      };
      g.appendChild(lab);
    });
    return g;
  };
  const cards = group("Cards", [
    ["include in print", "printCards", true],
    ["final-position image", "showFinalBoard", true],
    ["latest-divergence image", "showFirstDivBoard", false],
  ]);
  // Card text size, as a percentage of the default. Cards only: the table's
  // columns are sized by their content, so scaling its text would move the
  // print pagination as well.
  const sel = el("input", {
    className: "optsel",
    type: "number",
    min: String(FONT_MIN),
    max: String(FONT_MAX),
    step: "5",
    value: String(getCurrent().cardFont || 100),
  });
  // on change, not on input: every commit re-renders the whole app, so reacting
  // per keystroke would tear the field out from under the cursor mid-number.
  sel.onchange = () => {
    const raw = String(sel.value).trim();
    const n = Math.round(Number(raw));
    // a blank or non-numeric field falls back to the default. Note Number("")
    // is 0, which is finite — so the emptiness check has to come first, or a
    // cleared field would clamp to the minimum instead of resetting.
    getCurrent().cardFont =
      raw === "" || !Number.isFinite(n)
        ? 100
        : Math.min(FONT_MAX, Math.max(FONT_MIN, n));
    getRenderHooks().renderApp();
  };
  cards.appendChild(
    el("label", { className: "opt" }, ["text size ", sel, " %"]),
  );
  pOpts.append(
    cards,
    group("Table", [
      ["include in print", "printTables", true],
      ["split table by trie", "showSplitTrie", false],
    ]),
  );
  bar.appendChild(pOpts);
  bar.append(printBtn, pgn, md, copy);
  return bar;
}

function slug() {
  return (getCurrent().name || "opening-table")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

// Editable, portable Markdown of the finished table — paste into Docs/Word.
export function buildMarkdown() {
  const g = grid(getCurrent().lines);
  const L = [];
  if (getCurrent().name) L.push("# " + getCurrent().name, "");
  L.push("## Lines", "");
  for (const v of g.vars) {
    const lead =
      v.tag === "mainline" ? "**Mainline**" : "- " + v.label.toUpperCase();
    const moves = cardMovesText(v);
    L.push(
      `${lead}${v.name ? " (" + v.name + ")" : ""}${v.eval ? " " + v.eval : ""}: ${moves}`,
    );
  }
  const notes = allNotes();
  if (notes.length) {
    L.push("", "## Notes", "");
    notes.forEach((note) =>
      L.push(
        note.foot
          ? `${note.n}. ${footnoteText(note.foot)}`
          : `${note.n}. ${moveRef(note.ply, note.owner)} — ${note.text}`,
      ),
    );
  }
  return L.join("\n") + "\n";
}
