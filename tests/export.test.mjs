import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { renderInline } from "../src/dom.js";
import {
  buildMarkdown,
  notesPanel,
  moveRef,
  branchContext,
  exportBar,
} from "../src/export.js";

test("buildMarkdown emits a title, the mainline, and tagged variations", () => {
  const off = installDom();
  loadState("1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6", {
    name: "My Book",
    tags: { 1: "sideline" },
  });
  const md = buildMarkdown();
  assert.match(md, /^# My Book\n/);
  assert.match(md, /## Lines/);
  assert.match(md, /\*\*Mainline\*\*: .*e4.*e5.*Nf3.*Nc6/);
  assert.match(md, /- SIDELINE: .*c5/);
  assert.ok(md.endsWith("\n"), "ends with a trailing newline");
  off();
});

test("buildMarkdown omits the title heading when the workbook is unnamed", () => {
  const off = installDom();
  loadState("1. e4 e5 2. Nf3", { name: "" });
  assert.ok(!buildMarkdown().startsWith("#  "), "no empty title heading");
  assert.match(buildMarkdown(), /^## Lines/);
  off();
});

test("buildMarkdown renders a footnote as a numbered note, not a Footnotes section", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6", {
    name: "Book",
    tags: { 1: "foot" },
  });
  s.lines[1].name = "Sicilian";
  s.lines[1].meta.note = "sharp";
  s.lines[1].meta.eval = "=";
  const md = buildMarkdown();
  assert.ok(!md.includes("## Footnotes"), "no Footnotes section");
  assert.match(md, /## Notes/);
  // name, the tail moves from the divergence, eval, then the note
  assert.match(md, /1\. Sicilian: 1\.\.\.c5 2\.Nf3 Nc6 = — sharp/);
  off();
});

test("buildMarkdown numbers notes and references the owning move", () => {
  const off = installDom();
  loadState("1. e4 {solid} e5 2. Nf3 {develops} Nc6", { name: "Book" });
  const md = buildMarkdown();
  assert.match(md, /## Notes/);
  assert.match(md, /^1\. 1\.e4 — solid$/m);
  assert.match(md, /^2\. 2\.Nf3 — develops$/m);
  off();
});

test("buildMarkdown carries move marks into the exported move text", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 2. Nf3", { name: "Book" });
  s.lines[0].marks[0] = "!";
  assert.match(buildMarkdown(), /e4 !/);
  off();
});

test("moveRef falls back to the bare move number for an unknown ply", () => {
  const off = installDom();
  loadState("1. e4 e5", { name: "Book" });
  // ply 0 is a real mainline move, so it resolves to number + SAN
  assert.strictEqual(moveRef(0), "1.e4");
  // ply 99 is past the end of every line -> label only, no SAN
  assert.strictEqual(moveRef(99), "50...");
  off();
});

test("moveRef prefers the owning line's move at a colliding ply", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6", {
    name: "Book",
  });
  // ply 1 is e5 on the mainline and c5 in the variation
  assert.strictEqual(moveRef(1), "1...e5");
  assert.strictEqual(moveRef(1, s.lines[1]), "1...c5");
  off();
});

test("branchContext is empty for the mainline and names the divergence point otherwise", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6", {
    name: "Book",
  });
  assert.strictEqual(branchContext(s.lines[0]), "");
  // the variation shares only 1. e4, so the preceding move is e4
  assert.strictEqual(branchContext(s.lines[1]), "→ 1. e4");
  off();
});

test("branchContext is empty when a line diverges at the very first move", () => {
  const off = installDom();
  const s = loadState("1. e4 (1. d4 d5) e5 2. Nf3", { name: "Book" });
  const variation = s.lines.find((l) => !l.isMain);
  assert.strictEqual(branchContext(variation), "");
  off();
});

test("renderInline renders bold, italic and code without using innerHTML", () => {
  const off = installDom();
  const span = document.createElement("span");
  renderInline(span, "plain **bold** and *em* and `code` end");
  assert.strictEqual(span.querySelector("strong").textContent, "bold");
  assert.strictEqual(span.querySelector("em").textContent, "em");
  assert.strictEqual(span.querySelector("code").textContent, "code");
  assert.match(span.textContent, /^plain bold and em and code end$/);
  off();
});

test("renderInline escapes markup instead of injecting it", () => {
  const off = installDom();
  const span = document.createElement("span");
  renderInline(span, "<img src=x onerror=alert(1)>");
  assert.strictEqual(span.querySelectorAll("img").length, 0);
  assert.match(span.textContent, /<img src=x/);
  off();
});

test("renderInline turns newlines into <br> elements", () => {
  const off = installDom();
  const span = document.createElement("span");
  renderInline(span, "one\ntwo\nthree");
  assert.strictEqual(span.querySelectorAll("br").length, 2);
  off();
});

test("notesPanel lists notes and footnotes in one numbered sequence", () => {
  const off = installDom();
  const s = loadState("1. e4 {solid} e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6", {
    name: "Book",
    tags: { 1: "foot" },
  });
  s.lines[1].meta.note = "the **Sicilian**";
  const box = notesPanel();
  const heads = [...box.querySelectorAll("h3")].map((h) => h.textContent);
  assert.deepStrictEqual(heads, ["Notes"]);
  const sups = [...box.querySelectorAll("sup")].map((s) => s.textContent);
  assert.ok(sups.includes("[1]"), "note numbered [1]");
  assert.ok(sups.includes("[2]"), "footnote numbered [2]");
  // footnote note text goes through renderInline, so markdown becomes elements
  assert.strictEqual(box.querySelector("strong").textContent, "Sicilian");
  off();
});

test("notesPanel omits the Footnotes heading when nothing is tagged foot", () => {
  const off = installDom();
  loadState("1. e4 {solid} e5 2. Nf3", { name: "Book" });
  const heads = [...notesPanel().querySelectorAll("h3")].map(
    (h) => h.textContent,
  );
  assert.deepStrictEqual(heads, ["Notes"]);
  off();
});

test("exportBar wires the print button to window.print", () => {
  const off = installDom();
  loadState("1. e4 e5", { name: "Book" });
  let printed = 0;
  global.window.print = () => printed++;
  const bar = exportBar();
  const btn = [...bar.querySelectorAll("button")].find((b) =>
    b.textContent.startsWith("Print"),
  );
  btn.onclick();
  assert.strictEqual(printed, 1);
  off();
});

test("exportBar's print options toggle state and trigger a re-render", () => {
  const off = installDom();
  let renders = 0;
  const s = loadState("1. e4 e5", {
    name: "Book",
    renderHooks: { renderApp: () => renders++ },
  });
  const bar = exportBar();
  // checkboxes only — the group also holds the card text-size number input
  const boxes = [...bar.querySelectorAll('.printopts input[type="checkbox"]')];
  assert.strictEqual(boxes.length, 5, "three card options + two table options");
  // defaults: cards printed, final-position on, latest-divergence off;
  // table printed, split-trie off
  assert.deepStrictEqual(
    boxes.map((b) => b.checked),
    [true, true, false, true, false],
  );
  boxes[2].checked = true;
  boxes[2].onchange({ target: boxes[2] });
  assert.strictEqual(s.showFirstDivBoard, true);
  assert.strictEqual(renders, 1);
  off();
});

// The download path builds a Blob and clicks a synthetic <a>. Stubbing
// URL.createObjectURL is enough to observe filename, MIME type and payload
// without a real download.
function captureDownloads() {
  const seen = [];
  // download() calls the bare `URL` global, which resolves to Node's URL
  // here rather than the jsdom window's.
  const origUrl = { c: URL.createObjectURL, r: URL.revokeObjectURL };
  URL.createObjectURL = (blob) => {
    seen.push(blob);
    return "blob:stub";
  };
  URL.revokeObjectURL = () => {};
  const origCreate = document.createElement.bind(document);
  const anchors = [];
  document.createElement = (tag) => {
    const node = origCreate(tag);
    if (tag === "a") {
      node.click = () => {};
      anchors.push(node);
    }
    return node;
  };
  return {
    blobs: seen,
    anchors,
    restore: () => {
      document.createElement = origCreate;
      URL.createObjectURL = origUrl.c;
      URL.revokeObjectURL = origUrl.r;
    },
  };
}

test("exportBar's PGN export downloads the current state under a slugged filename", async () => {
  const off = installDom();
  const state = loadState("1. e4 e5", { name: "My Great Book!" });
  // an edit made after import: it has to reach the file, which is exactly what
  // exporting the raw source PGN used to lose
  state.lines[0].marks = { 0: "!" };
  const cap = captureDownloads();
  const bar = exportBar();
  [...bar.querySelectorAll("button")]
    .find((b) => b.textContent === "Export PGN")
    .onclick();
  assert.strictEqual(cap.anchors.length, 1);
  assert.strictEqual(cap.anchors[0].download, "My-Great-Book.pgn");
  assert.strictEqual(cap.blobs[0].type, "application/x-chess-pgn");
  const text = await cap.blobs[0].text();
  assert.match(text, /\[Event "My Great Book!"\]/);
  assert.match(text, /1\. e4 \$1 1\.\.\. e5 \*/);
  cap.restore();
  off();
});

test("exportBar's Copy PGN writes the export to the clipboard", async () => {
  const off = installDom();
  loadState("1. e4 e5", { name: "Book" });
  let written = "";
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async (t) => (written = t) },
    configurable: true,
  });
  const bar = exportBar();
  const btn = [...bar.querySelectorAll("button")].find(
    (b) => b.textContent === "Copy PGN",
  );
  await btn.onclick();
  assert.match(written, /1\. e4 e5 \*/);
  assert.strictEqual(btn.textContent, "Copied \u2713");
  off();
});

test("exportBar's Markdown export downloads the built report", async () => {
  const off = installDom();
  loadState("1. e4 e5", { name: "Book" });
  const cap = captureDownloads();
  const bar = exportBar();
  [...bar.querySelectorAll("button")]
    .find((b) => b.textContent === "Export Markdown")
    .onclick();
  assert.strictEqual(cap.anchors[0].download, "Book.md");
  assert.strictEqual(cap.blobs[0].type, "text/markdown");
  assert.strictEqual(await cap.blobs[0].text(), buildMarkdown());
  cap.restore();
  off();
});

test("an unnamed workbook falls back to a default export filename", () => {
  const off = installDom();
  loadState("1. e4 e5", { name: "" });
  const cap = captureDownloads();
  [...exportBar().querySelectorAll("button")]
    .find((b) => b.textContent === "Export PGN")
    .onclick();
  assert.strictEqual(cap.anchors[0].download, "opening-table.pgn");
  cap.restore();
  off();
});

test("Copy report writes the Markdown to the clipboard and confirms in the label", async () => {
  const off = installDom();
  loadState("1. e4 e5", { name: "Book" });
  let written = null;
  Object.defineProperty(global.navigator, "clipboard", {
    value: { writeText: async (t) => (written = t) },
    configurable: true,
  });
  const copy = [...exportBar().querySelectorAll("button")].find(
    (b) => b.textContent === "Copy report",
  );
  await copy.onclick();
  assert.strictEqual(written, buildMarkdown());
  assert.strictEqual(copy.textContent, "Copied ✓");
  off();
});

test("Copy report falls back to execCommand when the clipboard API is unavailable", async () => {
  const off = installDom();
  loadState("1. e4 e5", { name: "Book" });
  Object.defineProperty(global.navigator, "clipboard", {
    value: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
    configurable: true,
  });
  let copied = null;
  document.execCommand = (cmd) => {
    // the textarea holding the payload is in the document at this point
    copied = document.querySelector("textarea").value;
    return cmd === "copy";
  };
  const copy = [...exportBar().querySelectorAll("button")].find(
    (b) => b.textContent === "Copy report",
  );
  await copy.onclick();
  assert.strictEqual(copied, buildMarkdown());
  assert.strictEqual(copy.textContent, "Copied ✓");
  // the scratch textarea is removed again
  assert.strictEqual(document.querySelector("textarea"), null);
  off();
});

test("the notes panel renders footnotes as numbered notes with no separate section", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 {develops}", {
    tags: { 1: "foot" },
  });
  s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
  const box = notesPanel();
  const headings = [...box.querySelectorAll("h3")].map((h) => h.textContent);
  assert.deepStrictEqual(headings, ["Notes"], "no Footnotes heading");
  const rows = [...box.querySelectorAll(".nt")];
  assert.strictEqual(rows.length, 2, "the footnote and the mainline note");
  const marks = rows.map((r) => r.querySelector("sup").textContent);
  assert.deepStrictEqual(marks, ["[1]", "[2]"], "one numbered sequence");
  // numberNotes numbers by line-traversal order (the mainline's own comments
  // before a tagged line's turn), so which entry lands first isn't fixed by
  // ply — just confirm the footnote shows up as one of the numbered rows.
  assert.ok(
    rows.some((r) => /Sicilian/.test(r.textContent)),
    "the footnote renders inline as a numbered note",
  );
  off();
});

test("Markdown emits footnotes as notes with no Footnotes section", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", {
    tags: { 1: "foot" },
  });
  s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
  const md = buildMarkdown();
  assert.ok(!md.includes("## Footnotes"), "no Footnotes section");
  assert.match(md, /## Notes/);
  assert.match(md, /1\. Sicilian: /, "the footnote is note 1");
  off();
});

test("the notes panel nests a footnote's own notes under it", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
    tags: { 1: "foot" },
  });
  s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
  const box = notesPanel();
  const rows = [...box.querySelectorAll(".nt")];
  assert.strictEqual(rows.length, 1, "one top-level row: the footnote");
  const subs = [...box.querySelectorAll(".subnote")];
  assert.strictEqual(subs.length, 1, "its own note is nested, not top-level");
  assert.strictEqual(subs[0].querySelector("sup").textContent, "[a]");
  off();
});

test("Markdown indents a footnote's own notes under it", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
    tags: { 1: "foot" },
  });
  s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
  const md = buildMarkdown();
  const lines = md.split("\n");
  const i = lines.findIndex((l) => /^1\. Sicilian: /.test(l));
  assert.ok(i > -1, "the footnote is note 1");
  assert.strictEqual(
    lines[i + 1],
    "   a. knight move",
    "its own note follows, indented",
  );
  off();
});

test("Markdown lists a group's members under one numbered note", () => {
  const off = installDom();
  loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
    tags: { 1: "foot", 2: "foot" },
  });
  const md = buildMarkdown();
  const notes = md.slice(md.indexOf("## Notes"));
  assert.match(notes, /^1\. 1\.\.\.c5$/m);
  assert.match(notes, /^ {3}a\. 2\.Nf3$/m);
  assert.match(notes, /^ {3}b\. 2\.Nc3$/m);
  assert.strictEqual(notes.match(/^\d+\. /gm).length, 1, "one numbered note");
  off();
});

test("the screen notes panel renders a group's members", () => {
  const off = installDom();
  loadState("1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3", {
    tags: { 1: "foot", 2: "foot" },
  });
  assert.strictEqual(notesPanel().querySelectorAll(".fnode").length, 2);
  off();
});
