// The workbook format, and its two homes: `localStorage` and a `.json` file.
//
// A workbook stores the raw PGN plus per-line annotations keyed by the line's
// move string, so it can be reopened and re-parsed/re-tagged. Serialisation
// used to live here while the matching de-serialisation was hand-inlined in
// app.js's openNotebook; with the same format now also written to and read
// from files, both directions live here so there is one definition of it.

import { migrateMarks } from "./nags.js";

const PREFIX = "ott:";

// Stamped into exported files so a `.json` dropped on the import panel can be
// told apart from any other JSON, and so a file written by a later build can
// be refused with an explanation rather than silently half-read. Bump VERSION
// only for a change older builds could not read correctly.
const FORMAT = "ott-workbook";
const VERSION = 1;

function keyFor(moves) {
  return moves.map((m) => m.san).join(" ");
}

// The workbook object: what gets JSON-stringified into localStorage or a file.
export function toNotebook({ name, pgn, lines, view }) {
  const mainLine = lines.find((l) => l.isMain) || lines[0];
  return {
    format: FORMAT,
    version: VERSION,
    name,
    pgn,
    main: mainLine ? keyFor(mainLine.moves) : "",
    // Print-affecting layout settings travel with the notebook. Without
    // them the board size was session state that reset to the default on
    // reload, so the same workbook printed at a different board size
    // depending on what had been clicked since the page last loaded.
    view: view || {},
    tags: lines.map((l) => ({
      key: keyFor(l.moves),
      tag: l.tag || "sideline",
      name: l.name || "",
      meta: l.meta || {},
      marks: l.marks || {},
      comments: l.comments || [],
      hidden: !!l.hidden,
    })),
  };
}

// Workbooks saved before marks carried NAG codes hold bare glyphs. Convert
// them on the way in so the app has one representation rather than two
// forever. Lossy for the eight glyphs a White/Black pair shares, in exactly
// the way the app already was -- the side was never in the glyph to recover
// -- but every mark set from here on is exact.
function migrate(d) {
  if (d && Array.isArray(d.tags))
    d.tags = d.tags.map((t) => ({ ...t, marks: migrateMarks(t.marks) }));
  return d;
}

/**
 * Re-apply a workbook's annotations to lines freshly parsed from its PGN.
 * Mutates `lines` and returns them.
 */
export function applyNotebook(nb, lines) {
  const tags = nb.tags || [];
  const applied = new Map();
  lines.forEach((l) => {
    const t = tags.find((x) => x.key === keyFor(l.moves));
    if (!t) return;
    applied.set(l, t);
    l.name = t.name;
    l.meta = t.meta || {};
    l.marks = t.marks || {};
    l.comments = t.comments || [];
  });
  // Restore a user-promoted mainline, if any.
  if (nb.main) {
    const target = lines.find((l) => keyFor(l.moves) === nb.main);
    if (target) lines.forEach((x) => (x.isMain = x === target));
  }
  // The mainline is structural: it carries no tag and is never hidden. Settled
  // AFTER the promotion above, so a line promoted on the way in is normalised
  // as the mainline it now is rather than as the sideline it was saved as.
  applied.forEach((t, l) => {
    // legacy notebooks used 'main'/'minor'; mainline is now structural
    l.tag = l.isMain ? undefined : t.tag === "foot" ? "foot" : "sideline";
    // notebooks saved before hidden existed have no field and load visible
    l.hidden = !l.isMain && !!t.hidden;
  });
  return lines;
}

/**
 * A workbook read from a file. Throws with a message fit to show the user --
 * unlike loadNotebook, which returns null, because a file the user chose by
 * hand deserves to say what was wrong with it.
 */
export function parseWorkbook(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error("that file could not be read as JSON.");
  }
  if (!d || typeof d.pgn !== "string" || !Array.isArray(d.tags))
    throw new Error("that file is not a workbook.");
  if (typeof d.version === "number" && d.version > VERSION)
    throw new Error(
      `that file was written by a newer version of this app (format ${d.version}).`,
    );
  return migrate(d);
}

// Returns true on success, false if the write failed (e.g. QuotaExceededError
// on a full store, or SecurityError when storage is blocked/disabled) so the
// caller can surface the failure instead of silently losing the notebook.
export function saveNotebook(id, state) {
  try {
    localStorage.setItem(PREFIX + id, JSON.stringify(toNotebook(state)));
    return true;
  } catch {
    return false;
  }
}

export function listNotebooks() {
  return Object.keys(localStorage)
    .filter((k) => k.startsWith(PREFIX))
    .map((k) => {
      let d;
      try {
        d = JSON.parse(localStorage.getItem(k));
      } catch {
        d = null;
      }
      return { id: k.slice(PREFIX.length), name: d ? d.name : "" };
    });
}

export function loadNotebook(id) {
  try {
    return migrate(JSON.parse(localStorage.getItem(PREFIX + id)));
  } catch {
    return null;
  }
}

export function deleteNotebook(id) {
  localStorage.removeItem(PREFIX + id);
}
