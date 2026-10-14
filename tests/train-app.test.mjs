import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp, captureDownloads } from "./helpers.mjs";
import { getCurrent, getMode, getRenderHooks } from "../src/state.js";
import { emptyProgress, loadProgress, saveProgress } from "../src/train.js";

const app = await bootApp();
after(() => app.teardown());

const PGN = '1. e4 {[%name "Najdorf"]} e5 2. Nf3 Nc6 *';
const ls = () => app.dom.window.localStorage;

test("loading a PGN reads its named positions into the state", async () => {
  app.reset();
  await app.loadPgn(PGN);
  assert.strictEqual(Object.keys(getCurrent().names).length, 1);
  app.reset();
  await app.loadPgn("1. e4 e5 *");
  assert.deepStrictEqual(getCurrent().names, {});
});

test("Save stores the names, and moves unsaved Train progress to the new id", async () => {
  app.reset();
  await app.loadPgn(PGN);
  const p = emptyProgress();
  p.cards.x = { box: 2, seen: 5, skip: false };
  saveProgress(null, p);
  assert.ok(ls().getItem("ott-train:unsaved"));
  app.clickText("Save");
  const id = getCurrent().id;
  assert.strictEqual(Object.keys(JSON.parse(ls().getItem("ott:" + id)).names).length, 1);
  assert.strictEqual(ls().getItem("ott-train:unsaved"), null);
  assert.strictEqual(loadProgress(id).cards.x.box, 2);
  assert.ok(!("train" in JSON.parse(ls().getItem("ott:" + id))), "localStorage Save omits train");
});

test("Save to file carries Train progress and opening the file restores it", async () => {
  app.reset();
  await app.loadPgn(PGN);
  const p = emptyProgress();
  p.cards.y = { box: 3, seen: 9, skip: false };
  saveProgress(null, p);
  getCurrent().name = "Book";
  const cap = captureDownloads(app.dom.window.document);
  app.clickText("Save to file");
  cap.restore();
  const text = await cap.blobs[0].text();
  assert.strictEqual(JSON.parse(text).train.cards.y.box, 3);

  app.reset();
  const input = [...app.view().querySelectorAll("input[type=file]")].find((i) => /json/.test(i.accept));
  const file = new app.dom.window.File([text], "Book.json");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.onchange();
  await app.settle();
  assert.strictEqual(Object.keys(getCurrent().names).length, 1);
  assert.strictEqual(loadProgress(null).cards.y.box, 3);
});

const NAJ = '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 {[%name "Najdorf"]} 6. Be3 e5 *';
const trWin = () => app.view().querySelector(".tr-window");
const esc = (n) => n.dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

test("the toolbar's Train opens the window; Escape and the close button shut it", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  app.button("Train").click();
  assert.strictEqual(getMode(), "train");
  assert.ok(trWin());
  assert.strictEqual(trWin().querySelector("#tr-title").textContent, "Train");
  esc(trWin());
  assert.strictEqual(trWin(), null);
  assert.strictEqual(getMode(), "report");
  app.button("Train").click();
  trWin().querySelector(".an-close").click();
  assert.strictEqual(trWin(), null);
});

test("a full redraw keeps Train open", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  app.button("Train").click();
  getRenderHooks().renderApp();
  assert.ok(trWin());
});

test("Train from here scopes the outline to the last named position", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  const cell = [...app.view().querySelectorAll(".pv-table td")].find((c) => /Be3/.test(c.textContent));
  cell.dispatchEvent(new app.dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  [...app.dom.window.document.querySelectorAll("button")].find((b) => b.textContent === "Train from here").click();
  assert.ok(trWin());
  assert.match(trWin().textContent, /Najdorf/);
  assert.strictEqual(getMode(), "train");
});

test("acting in Train persists progress for a saved workbook", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  app.clickText("Save");
  const id = getCurrent().id;
  app.button("Train").click();
  trWin().querySelector(".tr-known").click();
  assert.ok(ls().getItem("ott-train:" + id));
});

const win = () => app.dom.window;
const toImport = () => app.button("New / Import").click(); // unlike reset(), keeps localStorage
const reopen = async () => {
  toImport();
  app.clickText("Open: ");
  await app.settle();
};

test("a name removed from a PGN-borne position stays removed after Save and reopen", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  getCurrent().names = {};
  app.clickText("Save");
  assert.deepStrictEqual(JSON.parse(ls().getItem("ott:" + getCurrent().id)).names, {});
  await reopen();
  assert.deepStrictEqual(getCurrent().names, {});
});

test("a workbook saved before names existed reads them from its PGN", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  app.clickText("Save");
  const k = "ott:" + getCurrent().id;
  const nb = JSON.parse(ls().getItem(k));
  delete nb.names;
  ls().setItem(k, JSON.stringify(nb));
  await reopen();
  assert.strictEqual(Object.keys(getCurrent().names).length, 1);
});

test("Update PGN adds the names the new PGN brings and keeps the current ones", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  const [k] = Object.keys(getCurrent().names);
  getCurrent().names[k].name = "Mine";
  app.clickText("Update PGN");
  const dlg = win().document.getElementById("updpgn");
  const ta = dlg.querySelector("textarea");
  ta.value = '1. e4 {[%name "King pawn"]} c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 {[%name "Najdorf again"]} 6. Be3 e5 *';
  ta.dispatchEvent(new (win().Event)("input"));
  await new Promise((r) => setTimeout(r, 400));
  [...dlg.querySelectorAll("button")].find((b) => b.textContent.includes("Apply")).click();
  await app.settle();
  const names = Object.values(getCurrent().names).map((n) => n.name).sort();
  assert.deepStrictEqual(names, ["King pawn", "Mine"]);
});

test("the outline keeps its scroll position after an action", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  app.button("Train").click();
  trWin().scrollTop = 120;
  trWin().querySelector(".tr-known").click();
  assert.strictEqual(trWin().scrollTop, 120);
});

test("Rename in the outline renames through the table's prompts and rebuilds the tree", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  app.button("Train").click();
  app.answerPrompt("Sicilian Najdorf");
  trWin().querySelector(".tr-rename").click();
  assert.strictEqual(trWin().querySelector(".tr-name").textContent, "Sicilian Najdorf");
  assert.strictEqual(Object.values(getCurrent().names)[0].name, "Sicilian Najdorf");
  assert.strictEqual(getMode(), "train");
});

test("unsaved Train progress is not inherited by the next workbook", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  const p = emptyProgress();
  p.cards.z = { box: 4, seen: 1, skip: false };
  saveProgress(null, p);
  toImport();
  await app.loadPgn(NAJ);
  assert.deepStrictEqual(loadProgress(null).cards, {});
  saveProgress(null, p);
  const nb = { format: "ott-workbook", version: 1, name: "", pgn: NAJ, tags: [] };
  app.reset();
  const input = [...app.view().querySelectorAll("input[type=file]")].find((i) => /json/.test(i.accept));
  Object.defineProperty(input, "files", { value: [new (win().File)([JSON.stringify(nb)], "x.json")], configurable: true });
  input.onchange();
  await app.settle();
  assert.deepStrictEqual(loadProgress(null).cards, {}, "a file without progress clears it");
});

test("deleting a saved workbook deletes its Train progress", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  app.clickText("Save");
  const id = getCurrent().id;
  app.button("Train").click();
  trWin().querySelector(".tr-known").click();
  assert.ok(ls().getItem("ott-train:" + id));
  esc(trWin());
  toImport();
  [...app.view().querySelectorAll(".notebooks button")].find((b) => b.textContent === "✕").click();
  assert.strictEqual(ls().getItem("ott-train:" + id), null);
});

test("Train from a position no visible line reaches opens on the whole workbook", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  const { openTrain } = await import("../src/app.js");
  const names = getCurrent().names;
  names["rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq -"] = { name: "Queen pawn", tags: [] };
  openTrain([{ san: "d4" }]);
  assert.ok(!trWin().querySelector(".tr-whole"), "no scope");
});
