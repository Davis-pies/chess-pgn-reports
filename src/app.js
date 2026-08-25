// Browser glue: import PGN, tag each line, render the table, persist notebook.
import { parsePgn, fenMap } from "./pgn.js";
import { collectLines, buildTrie } from "./tree.js";
import { grid } from "./table.js";
import { renderCards } from "./render.js";
import {
  saveNotebook,
  listNotebooks,
  loadNotebook,
  deleteNotebook,
  keyFor,
} from "./store.js";
import { el } from "./dom.js";
import {
  getCurrent,
  setCurrent,
  openPaths,
  openTablePaths,
  openHiddenPaths,
  closedNotePaths,
  setSharedInfo,
  setRenderHooks,
} from "./state.js";
import { allNotes } from "./notes.js";
import {
  visibleLines,
  hiddenLines,
  hideAll,
  showAll,
} from "./visibility.js";
import { appendPrintTables } from "./print.js";
import {
  renderTrieTable,
  collectKeys,
  renderTrieNode,
} from "./trie-view.js";
import { lineEditor } from "./line-editor.js";
import { exportBar } from "./export.js";
import { notesPanel } from "./notes-view.js";

// Canonical reset for `current`. Every "start over" path (New/Import, Load &
// Tag, opening a saved notebook, a failed open) rebuilt this object from an
// ad-hoc literal, and the fields drifted apart between them — most notably
// sideWidth being dropped from the openNotebook success path, which silently
// reset the user's dragged panel width back to the 420px default. Building
// every reset from this shared base plus explicit overrides keeps every site
// carrying the same fields by construction.
function freshState(overrides = {}) {
  return {
    id: null,
    name: "",
    pgn: "",
    lines: [],
    orientation: "horizontal",
    showBoards: false,
    preview: "table",
    boardSize: 300,
    cardFont: 100,
    showFinalBoard: true,
    showFirstDivBoard: false,
    showFootNames: false, // footnote entries lead with their line's name
    sideWidth: 420, // px; the drag-resized table panel width
    sel: null, // { l: line, ply } — the move the symbol row targets (null = line-end)
    ...overrides,
  };
}

setCurrent(freshState());
// Reset the shared UI-open state too. In production this module body runs
// exactly once per page load, so these sets are already empty here and this
// is a no-op; it only matters for the test suite, which re-imports app.js
// (with a cache-busting query string) to get fresh state per test -- since
// openPaths/openTablePaths now live in the state.js singleton rather than as
// module-local `const`s of app.js, they'd otherwise carry leftover entries
// from a previous test's app.js instance into this one.
openPaths.clear();
openTablePaths.clear();
closedNotePaths.clear();
// Point the extracted view modules' callbacks at *this* app.js instance --
// see the comment on setRenderHooks() in state.js for why this indirection
// (rather than a static `import ... from "./app.js"`) is necessary.
setRenderHooks({ renderApp, rerenderTable, rerenderMarkup, lineEditor });
let sideDragging = false; // dragging the table-panel resize handle

// Rebuild-only-the-panel refs: expanding/collapsing a trie group must not
// re-render the whole app (that resets the side-panel scroll and other view
// state), so these two panels rebuild in place instead.
let tableBox = null; // the .pv-table container
let markupBox = null; // the .markup container
export function rerenderTable() {
  if (!tableBox || !hasNotebook()) return;
  const g = grid(getCurrent().lines);
  tableBox.replaceChildren();
  tableBox.appendChild(el("h3", { textContent: "Table" }));
  renderTrieTable(tableBox, g, getCurrent().orientation);
}
// A <details> toggle queued by a previous render can fire after the app has
// gone back to the import panel (the element is detached by then, but the
// event still dispatches). Rebuilding the markup panel at that point would
// read lines off a notebook that is no longer loaded, so both rerender entry
// points bail unless one is.
function hasNotebook() {
  const c = getCurrent();
  return !!(c && c.lines && c.lines.length);
}
export function rerenderMarkup() {
  if (!markupBox || !hasNotebook()) return;
  const nb = markupPanel();
  markupBox.replaceChildren(...nb.children);
}

// identical-move tracking: a shared move (same position reached + same SAN)
// is annotated once and applied to every line carrying it
const fenCache = new WeakMap(); // line -> Map(ply -> fen)
function fenAtLine(l, ply) {
  let m = fenCache.get(l);
  if (!m) fenCache.set(l, (m = fenMap(l.moves)));
  return m.get(ply);
}
function computeShared() {
  const byLine = new Map();
  const idLines = new Map();
  const byFenSan = new Map();
  let next = 0;
  getCurrent().lines.forEach((l) => {
    const per = new Map();
    l.moves.forEach((m) => {
      const k = fenAtLine(l, m.ply) + "\u0000" + m.san;
      let id = byFenSan.get(k);
      if (!id) {
        id = "s" + ++next;
        byFenSan.set(k, id);
        idLines.set(id, []);
      }
      per.set(m.ply, id);
      const arr = idLines.get(id);
      if (!arr.includes(l)) arr.push(l);
    });
    byLine.set(l, per);
  });
  setSharedInfo({ byLine, idLines });
}

// For each line, the deepest prefix shared with any OTHER line — i.e. the
// index of this line's first move that no other line matches (its "latest
// divergence" / first moment of true uniqueness).
const uniqInfo = new Map(); // moves-array -> first-unique-move index
function computeUnique() {
  uniqInfo.clear();
  const lines = getCurrent().lines;
  for (const l of lines) {
    let best = 0;
    const a = l.moves;
    for (const y of lines) {
      if (y === l) continue;
      const b = y.moves;
      let i = 0;
      while (i < a.length && i < b.length && a[i].san === b[i].san) i++;
      if (i > best) best = i;
    }
    uniqInfo.set(a, best);
  }
}

const $ = (id) => document.getElementById(id);

// Full-viewport loading feedback. Painted via double-rAF before the slow
// synchronous parse+render runs, then removed. No fake progress: after the
// fenMap fix most loads flash it sub-frame.
const paintFrame = () =>
  new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r())),
  );
async function withLoading(fn) {
  const ov = el("div", { id: "loading", className: "loading-overlay" });
  ov.appendChild(el("div", { className: "spinner" }));
  ov.appendChild(el("span", { textContent: "Loading…" }));
  document.body.appendChild(ov);
  await paintFrame();
  try {
    fn();
  } finally {
    ov.remove();
  }
}

const THEME_KEY = "ott-theme";
function currentTheme() {
  return (document.documentElement.dataset.theme || "light") === "dark"
    ? "dark"
    : "light";
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {}
}
// card text size as a percentage; falls back to 100 for workbooks saved before
// the setting existed.
function cardFont() {
  return getCurrent().cardFont || 100;
}

function themeBtn() {
  const target = currentTheme() === "light" ? "dark" : "light";
  const b = el("button", {
    className: "chip",
    textContent: target === "dark" ? "Dark theme" : "Light theme",
  });
  b.onclick = () => {
    applyTheme(target);
    renderApp();
  };
  return b;
}

function renderApp() {
  const v = $("view");
  computeShared(); // which lines carry each move (identical position + SAN)
  computeUnique(); // each line's first move unique to it among all lines
  v.replaceChildren();
  v.appendChild(viewRoot());
}

function viewRoot() {
  const wrap = el("div", { className: "app" });
  if (!getCurrent().lines.length) {
    wrap.appendChild(importPanel());
    return wrap;
  }
  const top = el("div", { className: "toolbar" });
  top.appendChild(
    el("button", {
      onclick: () => {
        setCurrent(
          freshState({
            boardSize: getCurrent().boardSize,
            cardFont: getCurrent().cardFont,
            sideWidth: getCurrent().sideWidth,
          }),
        );
        renderApp();
      },
      className: "chip",
      textContent: "New / Import",
    }),
  );
  const name = el("input", {
    value: getCurrent().name,
    placeholder: "Notebook name",
    className: "name",
  });
  name.oninput = () => {
    getCurrent().name = name.value;
  };
  top.appendChild(name);
  const save = el("button", { className: "chip primary", textContent: "Save" });
  save.onclick = () => {
    if (!getCurrent().name) getCurrent().name = "Untitled";
    const ok = saveNotebook(
      getCurrent().id || (getCurrent().id = "n" + Date.now()),
      {
        name: getCurrent().name,
        pgn: getCurrent().pgn,
        lines: getCurrent().lines,
        view: {
          boardSize: getCurrent().boardSize,
          cardFont: getCurrent().cardFont,
          printCards: getCurrent().printCards,
          printTables: getCurrent().printTables,
          showBoards: getCurrent().showBoards,
          showFinalBoard: getCurrent().showFinalBoard,
          showFirstDivBoard: getCurrent().showFirstDivBoard,
          showFootNames: getCurrent().showFootNames,
        },
      },
    );
    if (ok) {
      save.textContent = "Saved ✓";
      setTimeout(() => (save.textContent = "Save"), 1200);
    } else {
      alert("Could not save: storage is full or unavailable.");
    }
  };
  top.appendChild(save);
  top.appendChild(themeBtn());
  const layout = el("div", { className: "app-layout" });
  const side = el("aside", { className: "side-panel" });
  const main = el("div", { className: "main-panel" });
  const g = grid(getCurrent().lines);

  // side: the preview (table, or print lines) with its own scroll, resizable
  const t = el("div", { className: "pv-table" });
  tableBox = t;
  t.appendChild(el("h3", { textContent: "Table" }));
  renderTrieTable(t, g, getCurrent().orientation);
  side.appendChild(t);
  const c = el("div", {
    className:
      "pv-cards" + (getCurrent().printCards === false ? " noprint" : ""),
  });
  c.appendChild(
    el("h3", { textContent: "Print view — one line, one position" }),
  );
  renderCards(c, g, {
    notes: allNotes(),
    boardSize: getCurrent().boardSize,
    showFinalBoard: getCurrent().showFinalBoard,
    showFirstDivBoard: getCurrent().showFirstDivBoard,
    uniq: uniqInfo,
  });
  side.appendChild(c);
  appendPrintTables(side, g); // print-only horizontal slices (hidden on screen)
  const handle = el("div", {
    className: "side-resize",
    title: "Drag to resize",
  });
  handle.onmousedown = (e) => {
    e.preventDefault();
    sideDragging = true;
  };
  side.appendChild(handle);
  layout.appendChild(side);

  // main (right): controls + management + reference sections
  main.appendChild(top);
  main.appendChild(orientationToggle());
  main.appendChild(notebookList());
  const mb = markupPanel();
  markupBox = mb; // module ref for in-place re-renders
  const notesBox = notesPanel();
  main.appendChild(mb);
  main.appendChild(notesBox);
  main.appendChild(exportBar());
  layout.appendChild(main);
  wrap.appendChild(layout);

  // `preview` flips the LEFT panel between the table and the print lines
  const useCards = getCurrent().preview === "cards";
  t.classList.toggle("hidden", useCards);
  c.classList.toggle("hidden", !useCards);
  // apply the (drag-resized) table panel width — one CSS var drives the side
  // width and the main/toolbar left margins so everything stays aligned
  document.documentElement.style.setProperty(
    "--side-w",
    (getCurrent().sideWidth || 420) + "px",
  );
  document.documentElement.style.setProperty(
    "--card-font",
    cardFont() / 100 + "rem",
  );
  return wrap;
}

function notebookList() {
  const items = listNotebooks();
  const box = el("div", { className: "notebooks" });
  const shown = items.filter((n) => n.id !== getCurrent().id);
  if (!shown.length) return box;
  box.appendChild(
    el("div", {
      className: "nb-head",
      textContent: "My saved workbooks — click to open, ✕ to delete",
    }),
  );
  shown.forEach((n) => {
    const b = el("button", {
      className: "chip",
      textContent: `Open: ${n.name || n.id}`,
    });
    b.onclick = () => openNotebook(n.id);
    const del = el("button", { className: "chip danger", textContent: "✕" });
    const cell = el("span", {}, [b, del]);
    del.onclick = () => {
      if (confirm(`Delete "${n.name}"?`)) {
        deleteNotebook(n.id);
        cell.remove();
      }
    };
    box.appendChild(cell);
  });
  return box;
}

function openNotebook(id) {
  withLoading(() => {
    const nb = loadNotebook(id);
    if (!nb) {
      alert("That workbook could not be read.");
      return;
    }
    try {
      const { nodes } = parsePgn(nb.pgn);
      if (!nodes.length) {
        alert("That workbook has no moves.");
        return;
      }
      const lines = collectLines(nodes);
      const view = nb.view || {};
      // re-apply tags
      lines.forEach((l) => {
        const k = keyFor(l.moves);
        const t = (nb.tags || []).find((x) => x.key === k);
        if (t) {
          l.name = t.name;
          l.meta = t.meta || {};
          l.marks = t.marks || {};
          l.comments = t.comments || [];
          // legacy notebooks used 'main'/'minor'; mainline is now structural
          l.tag = l.isMain ? undefined : t.tag === "foot" ? "foot" : "sideline";
          // notebooks saved before hidden existed have no field and load visible
          l.hidden = !l.isMain && !!t.hidden;
        }
      });
      // restore a user-promoted mainline, if any
      if (nb.main) {
        const target = lines.find((l) => keyFor(l.moves) === nb.main);
        if (target) {
          lines.forEach((x) => {
            x.isMain = x === target;
            if (x === target) x.tag = undefined;
          });
        }
      }
      setCurrent(
        freshState({
          id,
          name: nb.name,
          pgn: nb.pgn,
          lines,
          orientation: getCurrent().orientation,
          // a saved notebook carries its own board settings; fall back to the
          // session's for notebooks saved before `view` existed
          showBoards: view.showBoards ?? getCurrent().showBoards,
          boardSize: view.boardSize || getCurrent().boardSize,
          cardFont: view.cardFont || getCurrent().cardFont,
          printCards: view.printCards ?? getCurrent().printCards,
          printTables: view.printTables ?? getCurrent().printTables,
          showFinalBoard:
            (view.showFinalBoard ?? getCurrent().showFinalBoard) !== false,
          showFirstDivBoard: !!(
            view.showFirstDivBoard ?? getCurrent().showFirstDivBoard
          ),
          showFootNames: !!(view.showFootNames ?? getCurrent().showFootNames),
          sideWidth: getCurrent().sideWidth,
        }),
      );
    } catch (e) {
      setCurrent(
        freshState({
          boardSize: getCurrent().boardSize || 300,
          cardFont: getCurrent().cardFont,
          sideWidth: getCurrent().sideWidth,
        }),
      );
      alert("Could not open workbook: " + e.message);
    }
    openPaths.clear();
    closedNotePaths.clear();
    renderApp();
  });
}

function orientationToggle() {
  const bar = el("div", { className: "orow" });
  bar.appendChild(el("span", { textContent: "Layout: " }));
  const h = el("button", {
    className:
      "chip" + (getCurrent().orientation === "horizontal" ? " on" : ""),
    textContent: "Horizontal",
  });
  h.onclick = () => {
    getCurrent().orientation = "horizontal";
    renderApp();
  };
  const v = el("button", {
    className: "chip" + (getCurrent().orientation === "vertical" ? " on" : ""),
    textContent: "Vertical",
  });
  v.onclick = () => {
    getCurrent().orientation = "vertical";
    renderApp();
  };
  bar.append(h, v);
  bar.appendChild(el("span", { textContent: "  View: " }));
  const tb = el("button", {
    className: "chip" + (getCurrent().preview === "table" ? " on" : ""),
    textContent: "Table",
  });
  tb.onclick = () => {
    getCurrent().preview = "table";
    renderApp();
  };
  const cb = el("button", {
    className: "chip" + (getCurrent().preview === "cards" ? " on" : ""),
    textContent: "Lines (print)",
  });
  cb.onclick = () => {
    getCurrent().preview = "cards";
    renderApp();
  };
  bar.append(tb, cb);
  bar.appendChild(el("span", { textContent: " Board: " }));
  [220, 300, 400].forEach((s) => {
    const sb = el("button", {
      className: "chip" + (getCurrent().boardSize === s ? " on" : ""),
      textContent: String(s),
    });
    sb.onclick = () => {
      getCurrent().boardSize = s;
      renderApp();
    };
    bar.appendChild(sb);
  });
  const b = el("label", {}, [
    "Board diagrams ",
    el("input", { type: "checkbox", checked: getCurrent().showBoards }),
  ]);
  b.querySelector("input").onchange = (e) => {
    getCurrent().showBoards = e.target.checked;
    renderApp();
  };
  bar.appendChild(b);
  return bar;
}

function markupPanel() {
  const box = el("div", { className: "markup" });
  // view toggle: grouped (divergence trie) vs flat list
  const main =
    getCurrent().lines.find((l) => l.isMain) || getCurrent().lines[0];
  const row = el("div", { className: "orow" });
  const grouped = el("button", {
    className: "chip" + (getCurrent().groupView !== "flat" ? " on" : ""),
    textContent: "Grouped",
    onclick: () => {
      getCurrent().groupView = "trie";
      rerenderMarkup();
    },
  });
  const flat = el("button", {
    className: "chip" + (getCurrent().groupView === "flat" ? " on" : ""),
    textContent: "Flat",
    onclick: () => {
      getCurrent().groupView = "flat";
      rerenderMarkup();
    },
  });
  row.append("View: ", grouped, flat);
  if (getCurrent().groupView !== "flat") {
    const all = el("button", {
      className: "chip mini",
      textContent: "Expand all",
      onclick: () => {
        const trie = buildTrie(visibleLines(getCurrent().lines), main);
        openPaths.clear();
        trie.children.forEach((c) => collectKeys(c, openPaths));
        renderApp();
      },
    });
    const none = el("button", {
      className: "chip mini",
      textContent: "Collapse all",
      onclick: () => {
        openPaths.clear();
        renderApp();
      },
    });
    row.append(all, none);
  }
  // bulk hide/show, in both views: the mainline is never affected
  const hideEvery = el("button", {
    className: "chip mini",
    textContent: "Hide all",
    onclick: () => {
      hideAll(getCurrent().lines);
      renderApp();
    },
  });
  const showEvery = el("button", {
    className: "chip mini",
    textContent: "Show all",
    onclick: () => {
      showAll(getCurrent().lines);
      renderApp();
    },
  });
  row.append(" Lines: ", hideEvery, showEvery);
  box.appendChild(row);
  box.appendChild(
    el("h3", {
      textContent:
        "The mainline is the reference row. Promote a sideline to make it the mainline; tag the rest Sideline or Footnote.",
    }),
  );
  // mainline first, then the side lines grouped as a trie of shared divergence
  box.appendChild(lineEditor(main, 0, getCurrent().showBoards));
  const counter = { n: 1 };
  // hidden lines leave BOTH editor views and live in the drawer below
  const shown = visibleLines(getCurrent().lines);
  const trie = buildTrie(shown, main);
  // flat view renders every non-main line in order; grouped uses the trie
  if (getCurrent().groupView === "flat") {
    shown.forEach((l) => {
      if (!l.isMain)
        box.appendChild(lineEditor(l, counter.n++, getCurrent().showBoards));
    });
  } else {
    trie.children.forEach((c) => renderTrieNode(box, c, counter, "", true));
  }
  const hid = hiddenLines(getCurrent().lines);
  if (hid.length) box.appendChild(hiddenDrawer(hid, main, counter));
  return box;
}

// The hidden lines, in their own collapsed drawer at the foot of the editor.
// They keep their trie grouping so a whole group can be brought back in one
// click, and they continue the main list's name counter so an auto-assigned
// "Line N" cannot collide across the two lists.
function hiddenDrawer(hid, main, counter) {
  const det = el("details", { className: "hidden-drawer" });
  det.open = !!getCurrent().hiddenOpen;
  det.addEventListener("toggle", () => {
    // no rerender here: only the drawer's own open state changed, and
    // rebuilding would re-fire this toggle (see the guard in renderTrieNode)
    getCurrent().hiddenOpen = det.open;
  });
  det.appendChild(
    el("summary", {
      className: "hd-head",
      textContent: `Hidden (${hid.length})`,
    }),
  );
  const body = el("div", { className: "hidden-body" });
  body.appendChild(
    el("button", {
      className: "chip mini",
      textContent: "Show all",
      onclick: () => {
        showAll(hid);
        renderApp();
      },
    }),
  );
  const trie = buildTrie(hid, main);
  // a hidden line that is a strict PREFIX of the mainline lands on the trie
  // root rather than on a child; render it too, or it would be unreachable
  if (trie.leaf)
    body.appendChild(
      lineEditor(trie.leaf, counter.n++, getCurrent().showBoards),
    );
  // openHiddenPaths, not openPaths: the drawer's trie can produce the SAME
  // node.key as the editor's, and one shared Set would open both at once
  trie.children.forEach((c) =>
    renderTrieNode(body, c, counter, "", true, openHiddenPaths),
  );
  det.appendChild(body);
  return det;
}

function importPanel() {
  const box = el("div", { className: "panel" });
  box.appendChild(
    el("h2", { textContent: "Chess Opening Theory Table Builder" }),
  );
  box.appendChild(themeBtn());
  box.appendChild(notebookList());
  const ta = el("textarea", {
    className: "pgnin",
    rows: 10,
    placeholder: "1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4) 3. Bb5",
  });
  const file = el("input", {
    type: "file",
    accept: ".pgn,text/plain",
    className: "filein",
  });
  file.onchange = () => {
    const f = file.files[0];
    if (f)
      f.text().then((t) => {
        ta.value = t;
      });
  };
  const go = el("button", {
    className: "chip primary",
    textContent: "Load & Tag",
  });
  go.onclick = () => {
    withLoading(() => {
      try {
        const { nodes } = parsePgn(ta.value);
        if (!nodes.length) {
          alert("No moves found in PGN");
          return;
        }
        openPaths.clear();
        closedNotePaths.clear();
        setCurrent(
          freshState({
            id: getCurrent().id,
            pgn: ta.value,
            lines: collectLines(nodes),
            boardSize: getCurrent().boardSize,
            cardFont: getCurrent().cardFont,
            sideWidth: getCurrent().sideWidth,
          }),
        );
        renderApp();
      } catch (e) {
        alert("Could not read PGN: " + e.message);
      }
    });
  };
  box.append(ta, el("div", { className: "importbar" }, [file, go]));
  return box;
}

document.addEventListener("DOMContentLoaded", () => {
  if (!document.getElementById("view")) return;
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {}
  if (saved) document.documentElement.dataset.theme = saved;
  renderApp();
  // drag-resize for the table panel (updates main margin to match)
  document.addEventListener("mousemove", (e) => {
    if (!sideDragging) return;
    const w = Math.max(280, Math.min(window.innerWidth * 0.7, e.clientX));
    getCurrent().sideWidth = w;
    document.documentElement.style.setProperty("--side-w", w + "px");
  });
  document.addEventListener("mouseup", () => {
    sideDragging = false;
  });
  // inject the cburnett piece sprite so board <use href="#wK"> works & prints,
  // then re-render once it's in the DOM
  fetch("assets/pieces.svg")
    .then(async (r) => {
      if (!r.ok) return;
      const doc = new DOMParser().parseFromString(
        await r.text(),
        "image/svg+xml",
      );
      document.body.appendChild(doc.documentElement);
      renderApp();
    })
    .catch(() => {});
});
