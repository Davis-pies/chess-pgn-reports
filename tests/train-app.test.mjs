import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp, captureDownloads } from "./helpers.mjs";
import { getCurrent } from "../src/state.js";
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
