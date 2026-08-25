// localStorage persistence of named notebooks. Each notebook stores the raw
// PGN plus per-line annotations keyed by the line's move string, so a notebook
// can be reopened and re-parsed/re-tagged.

const PREFIX = "ott:";

export function keyFor(moves) {
  return moves.map((m) => m.san).join(" ");
}

// Returns true on success, false if the write failed (e.g. QuotaExceededError
// on a full store, or SecurityError when storage is blocked/disabled) so the
// caller can surface the failure instead of silently losing the notebook.
export function saveNotebook(id, { name, pgn, lines, view }) {
  const mainLine = lines.find((l) => l.isMain) || lines[0];
  try {
    localStorage.setItem(
      PREFIX + id,
      JSON.stringify({
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
      }),
    );
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
    return JSON.parse(localStorage.getItem(PREFIX + id));
  } catch {
    return null;
  }
}

export function deleteNotebook(id) {
  localStorage.removeItem(PREFIX + id);
}
