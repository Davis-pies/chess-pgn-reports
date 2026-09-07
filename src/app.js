// Browser glue: import PGN, tag each line, render the table, persist notebook.
import { parsePgn, fenMap } from "./pgn.js";
import { collectLines, buildTrie, forkKeys } from "./tree.js";
import { grid } from "./table.js";
import { renderCards, movesText } from "./render.js";
import {
  saveNotebook,
  listNotebooks,
  loadNotebook,
  deleteNotebook,
  toNotebook,
  applyNotebook,
  parseWorkbook,
} from "./store.js";
import { mergeAnnotations } from "./merge.js";
import { buildPgn } from "./pgn-out.js";
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
  setTraced,
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
import { exportBar, download, slug } from "./export.js";
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
    showBoards: false,
    preview: "table",
    boardSize: 300,
    cardFont: 100,
    showFinalBoard: true,
    showFirstDivBoard: false,
    showFootNames: false, // footnote entries lead with their line's name
    sideWidth: 420, // px; the drag-resized table panel width
    sel: null, // { lines: shared group, ply, at: line the panel opens on }
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
setTraced(null);
closedNotePaths.clear();
// Point the extracted view modules' callbacks at *this* app.js instance --
// see the comment on setRenderHooks() in state.js for why this indirection
// (rather than a static `import ... from "./app.js"`) is necessary.
setRenderHooks({
  renderApp,
  rerenderTable,
  rerenderMarkup,
  rerenderNotes,
  lineEditor,
});
let sideDragging = false; // dragging the table-panel resize handle

// Rebuild-only-the-panel refs: expanding/collapsing a trie group must not
// re-render the whole app (that resets the side-panel scroll and other view
// state), so these two panels rebuild in place instead.
let tableBox = null; // the .pv-table container
let markupBox = null; // the .markup container
let notesBox = null; // the .notes container
export function rerenderTable() {
  if (!tableBox || !hasNotebook()) return;
  const g = grid(getCurrent().lines);
  tableBox.replaceChildren();
  tableBox.appendChild(el("h3", { textContent: "Table" }));
  renderTrieTable(tableBox, g);
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
// In place, like rerenderMarkup: rebuilding the whole app would reset the
// preview panel's scroll position, and folding a note has no effect outside
// this panel. `open` is copied across because Collapse all closes the section
// itself, which lives on the element rather than in its children.
export function rerenderNotes() {
  if (!notesBox || !hasNotebook()) return;
  const nb = notesPanel();
  notesBox.open = nb.open;
  notesBox.replaceChildren(...nb.children);
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

// What both stores persist: the PGN, the annotated lines, and the layout
// settings that change what a print looks like. Shared so a workbook written
// to a file and one written to localStorage can never carry different fields.
function workbookState() {
  const c = getCurrent();
  return {
    name: c.name,
    pgn: c.pgn,
    lines: c.lines,
    view: {
      boardSize: c.boardSize,
      cardFont: c.cardFont,
      printCards: c.printCards,
      printTables: c.printTables,
      showBoards: c.showBoards,
      showFinalBoard: c.showFinalBoard,
      showFirstDivBoard: c.showFirstDivBoard,
      showFootNames: c.showFootNames,
    },
  };
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
      workbookState(),
    );
    if (ok) {
      save.textContent = "Saved ✓";
      setTimeout(() => (save.textContent = "Save"), 1200);
    } else {
      alert("Could not save: storage is full or unavailable.");
    }
  };
  top.appendChild(save);
  // The same workbook, as a file rather than a localStorage entry: something to
  // back up, share, or keep in version control. Deliberately does NOT also save
  // to localStorage -- the two stores are the user's to choose between.
  const toFile = el("button", { className: "chip", textContent: "Save to file" });
  toFile.onclick = () => {
    // Ask for the name rather than defaulting to "Untitled": the filename is
    // how the user will find this workbook again on disk, and it is the one
    // moment they are certainly thinking about which workbook this is. The
    // current name is prefilled, so keeping it is a single Enter.
    const name = prompt("Name for this workbook (used as the filename):", getCurrent().name || "");
    // Cancel returns null; a blank or all-space name would slug to nothing, so
    // both back out and leave the workbook exactly as it was.
    if (name === null || !name.trim()) return;
    getCurrent().name = name.trim();
    download(
      slug() + ".json",
      JSON.stringify(toNotebook(workbookState()), null, 2),
      "application/json",
    );
    // the toolbar's name field shows the old value until it is rebuilt
    renderApp();
  };
  top.appendChild(toFile);
  top.appendChild(
    el("button", {
      className: "chip",
      textContent: "Update PGN…",
      onclick: () => openUpdateDialog(),
    }),
  );
  top.appendChild(themeBtn());
  const layout = el("div", { className: "app-layout" });
  const side = el("aside", { className: "side-panel" });
  const main = el("div", { className: "main-panel" });
  const g = grid(getCurrent().lines);

  // side: the preview (table, or print lines) with its own scroll, resizable
  const t = el("div", { className: "pv-table" });
  tableBox = t;
  t.appendChild(el("h3", { textContent: "Table" }));
  renderTrieTable(t, g);
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
  main.appendChild(viewControls());
  main.appendChild(notebookList());
  const mb = markupPanel();
  markupBox = mb; // module ref for in-place re-renders
  notesBox = notesPanel();
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

// Every "the notebook changed underneath you" path clears the same session-only
// view state: which trie groups are open, what is traced, which notes are
// folded. None of it survives a different set of lines.
function clearViewState() {
  openPaths.clear();
  openTablePaths.clear();
  setTraced(null);
  closedNotePaths.clear();
}

// Parse a workbook's PGN, re-apply its annotations, and make it the open
// notebook. Shared by the localStorage list and the "open a workbook file"
// input, which differ only in where the object came from and whether it has an
// id in this browser's store. Throws on an unusable PGN so each caller can
// word its own failure.
function installNotebook(nb, id) {
  const { nodes } = parsePgn(nb.pgn);
  if (!nodes.length) throw new Error("that workbook has no moves.");
  const lines = applyNotebook(nb, collectLines(nodes));
  const view = nb.view || {};
  setCurrent(
    freshState({
      id,
      name: nb.name || "",
      pgn: nb.pgn,
      lines,
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
}

function openNotebook(id) {
  withLoading(() => {
    const nb = loadNotebook(id);
    if (!nb) {
      alert("That workbook could not be read.");
      return;
    }
    try {
      installNotebook(nb, id);
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
    clearViewState();
    renderApp();
  });
}

// Import raw PGN and open it as a new workbook. Shared by the paste box's
// "Load & Tag" and the "Load PGN file" button, which differ only in where the
// text came from.
function loadPgnText(text) {
  withLoading(() => {
    try {
      const { nodes } = parsePgn(text);
      if (!nodes.length) {
        alert("No moves found in PGN");
        return;
      }
      clearViewState();
      setCurrent(
        freshState({
          id: getCurrent().id,
          pgn: text,
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
}

// A workbook opened from a `.json` file. It has no id in this browser's store
// until the user presses Save, so it opens with id null -- saving then files it
// as a new entry rather than silently overwriting one.
function openWorkbookFile(text) {
  withLoading(() => {
    try {
      installNotebook(parseWorkbook(text), null);
      clearViewState();
    } catch (e) {
      alert("Could not open that workbook: " + e.message);
      return;
    }
    renderApp();
  });
}

// The row above the editor: which preview the left panel shows, board size,
// and the inline-board toggle. It used to open with a Layout pair as well --
// the table transposed, plies across and lines down. One layout now: the table
// is a reference grid read DOWN the plies, every other part of the report is
// built for that shape, and the transposed form never earned the branch it
// cost in the renderer.
function viewControls() {
  const bar = el("div", { className: "orow" });
  bar.appendChild(el("span", { textContent: "View: " }));
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
    // forks come from every line, not just the visible ones: hiding a group's
    // siblings must not dissolve that group into the one child left standing
    const forks = forkKeys(getCurrent().lines, main);
    trie.children.forEach((c) =>
      renderTrieNode(box, c, counter, "", true, openPaths, forks),
    );
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
  const forks = forkKeys(getCurrent().lines, main);
  trie.children.forEach((c) =>
    renderTrieNode(body, c, counter, "", true, openHiddenPaths, forks),
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
  const go = el("button", {
    className: "chip primary",
    textContent: "Load & Tag",
    onclick: () => loadPgnText(ta.value),
  });
  box.append(ta, el("div", { className: "importbar" }, [go]));

  // Loading from a file. Two sources, so two buttons that say which is which,
  // stacked rather than side by side: they are alternatives, not a pair of
  // controls that work together, and a row read as one widget with a stray
  // label. The <input>s themselves are hidden -- a bare file input shows the
  // browser's own "No file chosen" text, which said nothing useful twice over.
  const pickPgn = el("input", {
    type: "file",
    accept: ".pgn,text/plain",
    className: "filein",
    hidden: true,
  });
  // Straight into the editor rather than filling the box above: the button
  // says Load, and a file the user picked by name needs no second confirmation.
  pickPgn.onchange = () => {
    const f = pickPgn.files[0];
    if (f) f.text().then(loadPgnText);
  };
  const pickWb = el("input", {
    type: "file",
    accept: ".json,application/json",
    className: "wbin",
    hidden: true,
  });
  pickWb.onchange = () => {
    const f = pickWb.files[0];
    if (f) f.text().then(openWorkbookFile);
  };
  const fileBtn = (cls, label, input) =>
    el("button", {
      className: "chip filebtn " + cls,
      textContent: label,
      onclick: () => input.click(),
    });
  box.append(
    el("div", { className: "filestack" }, [
      el("span", { className: "filestack-h", textContent: "or load from a file" }),
      fileBtn("loadpgn", "Load PGN file", pickPgn),
      fileBtn("loadwb", "Load Workbook file", pickWb),
      pickPgn,
      pickWb,
    ]),
  );
  return box;
}

// Replacing the PGN under an annotated workbook.
//
// Previews before it applies: an update can drop lines, and the annotations on
// a dropped line cannot survive -- lines exist only because the PGN has them.
// Seeing that cost before paying it is the whole point of the dialog, so the
// merged lines are computed on Preview and installed only on Apply.
function openUpdateDialog() {
  const prev = $("updpgn");
  if (prev) prev.remove();
  let pending = null; // { pgn, lines } from the last successful preview

  const ov = el("div", { id: "updpgn", className: "modal-overlay" });
  const box = el("div", { className: "modal" });
  box.appendChild(el("h3", { textContent: "Update PGN" }));
  box.appendChild(
    el("p", {
      className: "modal-sub",
      textContent:
        "Paste the new PGN. Annotations are carried over onto the lines it still plays.",
    }),
  );
  const ta = el("textarea", { className: "pgnin", rows: 8 });
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
  // Additive mode. Off by default: replacing the PGN is what the button says
  // it does, and silently keeping lines the new file deliberately cut would be
  // a surprise. On, nothing can be lost -- at the cost of the stored PGN no
  // longer being the file that was pasted (see the apply handler).
  const keep = el("input", { type: "checkbox", className: "keepdropped" });
  const keepRow = el("label", { className: "opt" }, [
    keep,
    " Additive only — keep lines the new PGN drops",
  ]);
  const report = el("div", { className: "mergerep" });
  const apply = el("button", {
    className: "chip primary",
    textContent: "Apply",
    disabled: true,
  });
  // No button: supplying a PGN is itself the request for a report, and there is
  // nothing else the dialog does, so the report is simply always there once
  // there is something to report.
  const runPreview = () => {
    pending = null;
    apply.disabled = true;
    try {
      const { nodes } = parsePgn(ta.value);
      if (!nodes.length) {
        report.replaceChildren(
          el("p", { className: "bad", textContent: "No moves found in PGN." }),
        );
        return;
      }
      const lines = collectLines(nodes);
      const r = mergeAnnotations(getCurrent().lines, lines, {
        keepDropped: keep.checked,
      });
      pending = { pgn: ta.value, lines, keepDropped: keep.checked };
      apply.disabled = false;
      report.replaceChildren(...reportNodes(r));
    } catch (e) {
      report.replaceChildren(
        el("p", {
          className: "bad",
          textContent: "Could not read PGN: " + e.message,
        }),
      );
    }
  };
  // Debounced, because a repertoire of a few hundred lines is a real parse and
  // this fires while the user is still typing or pasting.
  let timer = null;
  const schedulePreview = () => {
    clearTimeout(timer);
    if (!ta.value.trim()) return;
    timer = setTimeout(runPreview, 300);
  };
  // A report describes the text it was run on, and `pending` carries its own
  // copy -- so an edit must disarm Apply until the new text has been read,
  // or Apply would install a merge of text the user had already replaced.
  ta.oninput = () => {
    pending = null;
    apply.disabled = true;
    report.replaceChildren();
    schedulePreview();
  };
  // The report describes one mode; switching modes must re-describe it.
  keep.onchange = () => {
    if (ta.value.trim()) runPreview();
  };
  apply.onclick = () => {
    if (!pending) return;
    const { pgn, lines, keepDropped } = pending;
    clearTimeout(timer);
    ov.remove();
    withLoading(() => {
      // Everything but the moves survives: this is the same workbook, under a
      // newer PGN, so its id, name and view settings are left exactly as they
      // were and only `pgn`/`lines` are swapped.
      getCurrent().lines = lines;
      // In additive mode the pasted text no longer describes the line set --
      // it never mentioned the lines that were kept -- so the stored PGN is
      // rebuilt from the lines themselves, the same way Export PGN builds one.
      getCurrent().pgn = keepDropped ? buildPgn(getCurrent()) : pgn;
      getCurrent().sel = null;
      clearViewState();
      renderApp();
    });
  };
  // Assigning ta.value fires no `input` event, so the picker re-syncs the
  // button itself rather than relying on the handler above.
  file.onchange = () => {
    const f = file.files[0];
    if (f)
      f.text().then((t) => {
        ta.value = t;
        runPreview(); // a picked file arrives whole: report it at once
      });
  };
  const cancel = el("button", {
    className: "chip",
    textContent: "Cancel",
    onclick: () => {
      clearTimeout(timer);
      ov.remove();
    },
  });
  box.append(
    ta,
    keepRow,
    el("div", { className: "importbar" }, [file]),
    report,
    el("div", { className: "modal-actions" }, [cancel, apply]),
  );
  ov.appendChild(box);
  document.body.appendChild(ov);
  ta.focus();
}

// The merge report, as the dialog shows it: the counts first, then — spelled
// out, because this is the part that cannot be undone — what would be lost.
function reportNodes(r) {
  const out = [
    el("ul", { className: "mergecounts" }, [
      el("li", { textContent: `${r.exact} lines unchanged` }),
      el("li", { textContent: `${r.extended} lines extended (annotations kept)` }),
      el("li", { textContent: `${r.shortened} lines cut short (annotations kept)` }),
      el("li", { textContent: `${r.added} new lines` }),
      el("li", { textContent: `${r.removed} lines no longer present` }),
      ...(r.kept
        ? [
            el("li", {
              className: "good",
              textContent: `${r.kept} lines kept from the old PGN`,
            }),
          ]
        : []),
    ]),
  ];
  if (r.droppedLines.length) {
    out.push(
      el("p", {
        className: "bad",
        textContent: `${r.droppedLines.length} annotated line(s) would be lost:`,
      }),
    );
    out.push(
      el(
        "ul",
        { className: "mergelost" },
        r.droppedLines.map((d) =>
          el("li", {}, [
            el("strong", { textContent: d.name || "(unnamed)" }),
            el("span", {
              textContent:
                [d.tag === "foot" ? "footnote" : "", d.eval, d.note]
                  .filter(Boolean)
                  .map((x) => " " + x)
                  .join("") + " — " + movesText(d.moves),
            }),
          ]),
        ),
      ),
    );
  }
  if (r.droppedNotes.length) {
    out.push(
      el("p", {
        className: "bad",
        textContent: `${r.droppedNotes.length} note(s) sit on moves the new PGN no longer plays:`,
      }),
    );
    out.push(
      el(
        "ul",
        { className: "mergelost" },
        r.droppedNotes.map((d) =>
          el("li", {
            textContent:
              (d.comments.join(" / ") || d.mark || "") + " — " + movesText(d.moves),
          }),
        ),
      ),
    );
  }
  // The all-clear is only honest when nothing goes at all. Lines being removed
  // is itself a loss the user should see, even when none of them was annotated
  // -- saying "nothing would be lost" over 72 departing lines reads as a
  // promise about the lines, not about the notes on them.
  if (!r.droppedLines.length && !r.droppedNotes.length)
    out.push(
      r.removed
        ? el("p", {
            className: "warn",
            textContent: `${r.removed} line${r.removed === 1 ? "" : "s"} will be removed — none of them annotated, so no notes or symbols are lost.`,
          })
        : el("p", { className: "good", textContent: "Nothing would be lost." }),
    );
  return out;
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
