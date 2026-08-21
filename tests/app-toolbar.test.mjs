import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers.mjs";

const PGN = "1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6";

// One app instance for the whole file (see bootApp's note on why this must
// not be re-imported per test); each test resets back to the import panel.
const app = await bootApp();

test("orientation toggle switches the table between horizontal and vertical", async () => {
  app.reset();
  await app.loadPgn(PGN);
  // horizontal is the default and is marked active
  assert.match(app.button("Horizontal").className, /\bon\b/);
  app.button("Vertical").click();
  assert.match(app.button("Vertical").className, /\bon\b/);
  assert.ok(!/\bon\b/.test(app.button("Horizontal").className));
  app.button("Horizontal").click();
  assert.match(app.button("Horizontal").className, /\bon\b/);
});

test("view toggle switches between the table and the printable line cards", async () => {
  app.reset();
  await app.loadPgn(PGN);
  assert.ok(app.view().querySelector("table.tbl"), "table preview by default");
  app.button("Lines (print)").click();
  assert.match(app.button("Lines (print)").className, /\bon\b/);
  assert.ok(app.view().querySelector(".cards"), "card preview rendered");
  app.button("Table").click();
  assert.ok(app.view().querySelector("table.tbl"), "back to the table");
});

test("board size buttons resize the rendered diagrams", async () => {
  app.reset();
  await app.loadPgn(PGN);
  app.view().querySelector('label input[type="checkbox"]').click();
  const sizeOf = () => {
    const svg = app.view().querySelector(".ledge-board svg");
    return svg && svg.getAttribute("width");
  };
  app.button("400").click();
  assert.strictEqual(sizeOf(), "400");
  assert.match(app.button("400").className, /\bon\b/);
  app.button("220").click();
  assert.strictEqual(sizeOf(), "220");
});

test("the board-diagrams checkbox shows and hides inline boards", async () => {
  app.reset();
  await app.loadPgn(PGN);
  const box = () =>
    [...app.view().querySelectorAll("label")].find((l) =>
      l.textContent.includes("Board diagrams"),
    ).firstElementChild ||
    app.view().querySelector('label input[type="checkbox"]');
  assert.strictEqual(app.view().querySelector(".ledge-board"), null);
  box().click();
  assert.ok(app.view().querySelector(".ledge-board"), "boards appear");
  box().click();
  assert.strictEqual(
    app.view().querySelector(".ledge-board"),
    null,
    "and hide again",
  );
});

test("the theme button toggles the document theme and persists it", async () => {
  app.reset();
  await app.loadPgn(PGN);
  const root = app.dom.window.document.documentElement;
  const themeBtn = () =>
    [...app.view().querySelectorAll("button")].find((b) =>
      /theme$/.test(b.textContent),
    );
  const first = themeBtn().textContent;
  themeBtn().click();
  assert.ok(["dark", "light"].includes(root.dataset.theme));
  assert.strictEqual(
    app.dom.window.localStorage.getItem("ott-theme"),
    root.dataset.theme,
    "theme persisted to localStorage",
  );
  // the button now offers the opposite theme
  assert.notStrictEqual(themeBtn().textContent, first);
});

test("Grouped/Flat toggles the line-editor grouping", async () => {
  app.reset();
  await app.loadPgn(PGN);
  assert.match(app.button("Grouped").className, /\bon\b/);
  app.button("Flat").click();
  assert.match(app.button("Flat").className, /\bon\b/);
  // flat mode lists every line as a plain editor, with no trie groups
  assert.strictEqual(app.view().querySelector(".markup details"), null);
  app.button("Grouped").click();
  assert.match(app.button("Grouped").className, /\bon\b/);
});

test("Expand all / Collapse all opens and closes every editor group", async () => {
  app.reset();
  // several lines sharing a divergence prefix, so the trie has real forks
  await app.loadPgn(
    "1. e4 e5 (1... c5 2. Nf3 d6) (1... c5 2. Nf3 Nc6) (1... c5 2. Nc3 Nc6) 2. Nf3 Nc6",
  );
  const groups = () => [...app.view().querySelectorAll(".markup details")];
  assert.ok(groups().length, "trie groups present");
  // the table preview has its own Expand all, so scope to the editor panel
  const markupBtn = (txt) =>
    [...app.view().querySelectorAll(".markup button")].find(
      (b) => b.textContent === txt,
    );
  markupBtn("Expand all").click();
  assert.ok(
    groups().every((d) => d.open),
    "every group open",
  );
  markupBtn("Collapse all").click();
  assert.ok(
    groups().every((d) => !d.open),
    "every group closed",
  );
});

test("New / Import returns to the import panel and keeps the display settings", async () => {
  app.reset();
  await app.loadPgn(PGN);
  app.button("400").click();
  assert.strictEqual(app.view().querySelector("textarea.pgnin"), null);
  app.clickText("New / Import");
  assert.ok(app.view().querySelector("textarea.pgnin"), "import panel is back");
  // reload and confirm the board size survived the reset
  await app.loadPgn(PGN);
  assert.match(app.button("400").className, /\bon\b/);
});

test("the notebook name field feeds the Save button's default", async () => {
  app.reset();
  await app.loadPgn(PGN);
  const name = app.view().querySelector("input.name");
  name.value = "My Book";
  name.dispatchEvent(new app.dom.window.Event("input"));
  const save = app.button("Save");
  save.click();
  assert.strictEqual(save.textContent, "Saved ✓");
  const saved = Object.keys(app.dom.window.localStorage).filter((k) =>
    k.startsWith("ott:"),
  );
  assert.ok(saved.length, "a notebook was written to storage");
});

test("saving without a name falls back to Untitled", async () => {
  app.reset();
  await app.loadPgn(PGN);
  app.button("Save").click();
  // Save does not re-render, so the fallback shows up in what was stored
  const key = Object.keys(app.dom.window.localStorage).find((k) =>
    k.startsWith("ott:"),
  );
  assert.strictEqual(
    JSON.parse(app.dom.window.localStorage.getItem(key)).name,
    "Untitled",
  );
});

test("opening an unreadable saved notebook reports it instead of failing silently", async () => {
  app.reset();
  await app.loadPgn(PGN);
  app.button("Save").click();
  app.clickText("New / Import");
  // corrupt the stored record behind the listed row
  const key = Object.keys(app.dom.window.localStorage).find((k) =>
    k.startsWith("ott:"),
  );
  app.dom.window.localStorage.setItem(key, "{not json");
  app.clickText("Open");
  await app.settle();
  assert.strictEqual(app.alerts.length, 1);
  assert.match(app.alerts[0], /could not be read/i);
  assert.ok(
    app.view().querySelector("textarea.pgnin"),
    "stays on the import panel",
  );
});

test("opening a saved notebook with no moves reports it", async () => {
  app.reset();
  await app.loadPgn(PGN);
  app.button("Save").click();
  app.clickText("New / Import");
  const key = Object.keys(app.dom.window.localStorage).find((k) =>
    k.startsWith("ott:"),
  );
  const rec = JSON.parse(app.dom.window.localStorage.getItem(key));
  rec.pgn = "*";
  app.dom.window.localStorage.setItem(key, JSON.stringify(rec));
  app.clickText("Open");
  await app.settle();
  assert.strictEqual(app.alerts.length, 1);
  assert.match(app.alerts[0], /no moves/i);
});

test("an unparseable PGN is reported rather than rendering an empty table", async () => {
  app.reset();
  app.view().querySelector("textarea.pgnin").value = "1. e4 e5 (1... c5";
  app.clickText("Load");
  await app.settle();
  assert.strictEqual(app.alerts.length, 1);
  assert.ok(
    app.view().querySelector("textarea.pgnin"),
    "stays on the import panel",
  );
});

after(() => app.teardown());

test("the card text size dropdown drives the --card-font variable", async () => {
  app.reset();
  await app.loadPgn(PGN);
  const font = () =>
    app.dom.window.document.documentElement.style.getPropertyValue(
      "--card-font",
    );
  const sel = () => app.view().querySelector(".optsel");
  // 100% is the default and is the selected option
  assert.strictEqual(sel().value, "100");
  assert.strictEqual(font(), "1rem");
  sel().value = "130";
  sel().onchange();
  assert.strictEqual(font(), "1.3rem");
  assert.strictEqual(sel().value, "130", "selection survives the re-render");
  sel().value = "85";
  sel().onchange();
  assert.strictEqual(font(), "0.85rem");
});

test("include-in-print toggles mark the card and table sections noprint", async () => {
  app.reset();
  await app.loadPgn(PGN);
  const cards = () => app.view().querySelector(".pv-cards");
  const tables = () => app.view().querySelector(".pv-htable");
  // both sections print by default
  assert.ok(!cards().classList.contains("noprint"));
  assert.ok(!tables().classList.contains("noprint"));

  const opt = (group) =>
    [...app.view().querySelectorAll(".optgroup")]
      .find((g) => g.textContent.startsWith(group))
      .querySelector("label.opt input");
  opt("Cards").click();
  assert.ok(cards().classList.contains("noprint"), "cards excluded");
  assert.ok(!tables().classList.contains("noprint"), "table still included");
  opt("Table").click();
  assert.ok(tables().classList.contains("noprint"), "table excluded");
});
