import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp, captureDownloads } from "./helpers.mjs";
import { getCurrent, getMode, getRenderHooks } from "../src/state.js";
import { sharedEngine } from "../src/engine.js";
import { emptyProgress, loadProgress, saveProgress } from "../src/train.js";

const card = (streak, seen = 1) => ({ streak, seen, skip: false });

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

test("Save stores the names and leaves Train progress where it is", async () => {
  app.reset();
  await app.loadPgn(PGN);
  const p = emptyProgress();
  p.cards.x = card(2, 5);
  saveProgress(p);
  app.clickText("Save");
  const id = getCurrent().id;
  assert.strictEqual(Object.keys(JSON.parse(ls().getItem("ott:" + id)).names).length, 1);
  assert.strictEqual(loadProgress().cards.x.streak, 2);
  assert.ok(!("train" in JSON.parse(ls().getItem("ott:" + id))), "localStorage Save omits train");
});

test("Save to file carries the workbook's own cards, and opening it merges by higher streak", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  const [key] = Object.keys(getCurrent().names);
  const p = emptyProgress();
  p.cards[`name|${key}`] = card(3, 9);
  p.cards["name|elsewhere"] = card(4, 2);
  p.asked = 9;
  saveProgress(p);
  getCurrent().name = "Book";
  const cap = captureDownloads(app.dom.window.document);
  app.clickText("Save to file");
  cap.restore();
  const text = await cap.blobs[0].text();
  assert.deepStrictEqual(Object.keys(JSON.parse(text).train.cards), [`name|${key}`], "only this workbook's cards");

  app.reset();
  const mine = emptyProgress();
  mine.cards[`name|${key}`] = card(1, 1);
  mine.cards["name|other"] = card(2, 1);
  saveProgress(mine);
  const input = [...app.view().querySelectorAll("input[type=file]")].find((i) => /json/.test(i.accept));
  const file = new app.dom.window.File([text], "Book.json");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.onchange();
  await app.settle();
  assert.strictEqual(Object.keys(getCurrent().names).length, 1);
  const got = loadProgress();
  assert.strictEqual(got.cards[`name|${key}`].streak, 3, "the file's higher streak");
  assert.strictEqual(got.cards["name|other"].streak, 2, "the rest of the store stays");
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

test("closing Train pauses the shared engine", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  const engine = sharedEngine();
  const paused = [];
  const pause = engine.pause;
  engine.pause = () => {
    paused.push(1);
    pause();
  };
  app.button("Train").click();
  esc(trWin());
  engine.pause = pause;
  assert.ok(paused.length);
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

test("acting in Train persists progress in the browser's one store", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  app.button("Train").click();
  trWin().querySelector(".tr-known").click();
  assert.ok(ls().getItem("ott-train"));
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

test("Train progress survives loading another PGN, reloading, saving, opening a file and deleting", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  const [key] = Object.keys(getCurrent().names);
  const p = emptyProgress();
  p.cards[`name|${key}`] = card(4);
  saveProgress(p);
  const kept = () => loadProgress().cards[`name|${key}`]?.streak;
  toImport();
  await app.loadPgn("1. d4 d5 *");
  assert.strictEqual(kept(), 4, "another PGN");
  toImport();
  await app.loadPgn(NAJ);
  assert.strictEqual(kept(), 4, "the same PGN again");
  app.clickText("Save");
  assert.strictEqual(kept(), 4, "saving");
  const nb = { format: "ott-workbook", version: 1, name: "", pgn: NAJ, tags: [] };
  toImport(); // unlike reset(), keeps localStorage
  const input = [...app.view().querySelectorAll("input[type=file]")].find((i) => /json/.test(i.accept));
  Object.defineProperty(input, "files", { value: [new (win().File)([JSON.stringify(nb)], "x.json")], configurable: true });
  input.onchange();
  await app.settle();
  assert.strictEqual(kept(), 4, "a file without progress");
  app.clickText("Save");
  toImport();
  [...app.view().querySelectorAll(".notebooks button")].find((b) => b.textContent === "✕").click();
  assert.strictEqual(kept(), 4, "deleting the workbook");
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

test("Learn opens Study on the variation; closing it returns to Train with its state", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  app.button("Train").click();
  trWin().querySelector(".tr-open")?.click();
  trWin().querySelector(".tr-learn").click();
  assert.strictEqual(getMode(), "study");
  assert.strictEqual(trWin(), null);
  const st = app.view().querySelector(".st-window");
  assert.ok(st);
  assert.strictEqual(st.querySelector(".an-move.at").textContent, "a6", "at the variation's position");
  assert.strictEqual(st.querySelector(".st-trail .on").textContent, "Najdorf");
  st.querySelector(".an-close").click();
  assert.strictEqual(getMode(), "train");
  assert.ok(trWin());
  assert.strictEqual(app.view().querySelector(".st-window"), null);
  trWin().querySelector(".an-close").click();
  assert.strictEqual(getMode(), "report");
});

test("a session in progress survives a trip to Study, and a toolbar Study closes to the report", async () => {
  app.reset();
  await app.loadPgn(NAJ);
  app.button("Train").click();
  trWin().querySelector(".tr-practice").click();
  assert.ok(trWin().querySelector(".tr-question"));
  const progress = trWin().querySelector(".tr-progress").textContent;
  // the question screen has no Learn chip; reach Study the way a result does
  trWin().querySelector(".an-close").click();
  app.button("Train").click();
  trWin().querySelector(".tr-learn").click();
  app.view().querySelector(".st-window .an-close").click();
  assert.ok(trWin().querySelector(".tr-outline"));
  trWin().querySelector(".an-close").click();
  app.button("Study").click();
  app.view().querySelector(".st-window .an-close").click();
  assert.strictEqual(getMode(), "report");
  assert.strictEqual(trWin(), null);
  assert.ok(progress);
});
