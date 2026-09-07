import { test } from "node:test";
import assert from "node:assert";
import { bootApp, captureDownloads } from "./helpers.mjs";
import { getCurrent } from "../src/state.js";

const PGN = "1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4) 3. Bb5";

// One app instance for the whole file (see bootApp's note on why this must
// not be re-imported per test); each test resets back to the import panel.
const app = await bootApp();

const key = (l) => l.moves.map((m) => m.san).join(" ");
const find = (k) => getCurrent().lines.find((l) => key(l) === k);

// Drive a file <input> the way a chooser would. jsdom has no DataTransfer to
// build a real FileList with, but the handler only reads files[0] and calls
// .text() on it, so a plain array of jsdom Files is enough.
function choose(input, name, text) {
  const file = new app.dom.window.File([text], name);
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.onchange();
}

test("Save to file downloads the workbook as JSON under a slugged filename", async () => {
  app.reset();
  await app.loadPgn(PGN);
  getCurrent().name = "My Great Book!";
  find("e4 e5 Nf3 Nf6 d4").name = "Petroff";

  const cap = captureDownloads(app.dom.window.document);
  app.clickText("Save to file");
  cap.restore();

  assert.strictEqual(
    app.prompts[0].def,
    "My Great Book!",
    "the prompt is prefilled with the name the workbook already has",
  );

  assert.strictEqual(cap.anchors.length, 1);
  assert.strictEqual(cap.anchors[0].download, "My-Great-Book.json");
  assert.strictEqual(cap.blobs[0].type, "application/json");
  const nb = JSON.parse(await cap.blobs[0].text());
  assert.strictEqual(nb.format, "ott-workbook");
  assert.strictEqual(nb.pgn, PGN);
  assert.ok(
    nb.tags.some((t) => t.name === "Petroff"),
    "the annotation reaches the file",
  );
});

test("a workbook file opened from the import panel restores its annotations", async () => {
  app.reset();
  await app.loadPgn(PGN);
  getCurrent().name = "Saved Book";
  find("e4 e5 Nf3 Nf6 d4").name = "Petroff";
  find("e4 e5 Nf3 Nf6 d4").meta = { eval: "=" };

  const cap = captureDownloads(app.dom.window.document);
  app.clickText("Save to file");
  cap.restore();
  const text = await cap.blobs[0].text();

  app.reset();
  choose(app.view().querySelector("input.wbin"), "book.json", text);
  await app.settle();

  assert.strictEqual(getCurrent().name, "Saved Book");
  assert.strictEqual(find("e4 e5 Nf3 Nf6 d4").name, "Petroff");
  assert.deepStrictEqual(find("e4 e5 Nf3 Nf6 d4").meta, { eval: "=" });
});

test("opening a file that is not a workbook says so and stays on the import panel", async () => {
  app.reset();
  choose(app.view().querySelector("input.wbin"), "notes.json", '{"hello":1}');
  await app.settle();

  assert.match(app.alerts.join("\n"), /not a workbook/i);
  assert.ok(app.view().querySelector("textarea.pgnin"), "still on import");
});

test("Update PGN previews the change without applying it", async () => {
  app.reset();
  await app.loadPgn(PGN);
  find("e4 e5 Nf3 Nc6 Bb5").name = "Ruy Lopez";

  app.clickText("Update PGN");
  const dlg = app.dom.window.document.getElementById("updpgn");
  assert.ok(dlg, "the update dialog opens");
  dlg.querySelector("textarea").value =
    "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... Nf6 4. O-O) 4. Ba4";
  [...dlg.querySelectorAll("button")]
    .find((b) => b.textContent.includes("Preview"))
    .click();

  assert.match(dlg.textContent, /extended/i, "the report names what grew");
  assert.strictEqual(
    getCurrent().pgn,
    PGN,
    "nothing is applied until Apply is clicked",
  );
});

test("applying an update keeps annotations on the lines the new PGN extends", async () => {
  app.reset();
  await app.loadPgn(PGN);
  getCurrent().name = "Repertoire";
  const id = (getCurrent().id = "n-fixed");
  find("e4 e5 Nf3 Nc6 Bb5").name = "Ruy Lopez";
  find("e4 e5 Nf3 Nc6 Bb5").comments = [{ ply: 4, text: "pins the knight" }];

  const NEXT = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... Nf6 4. O-O) 4. Ba4";
  app.clickText("Update PGN");
  const dlg = app.dom.window.document.getElementById("updpgn");
  dlg.querySelector("textarea").value = NEXT;
  [...dlg.querySelectorAll("button")]
    .find((b) => b.textContent.includes("Preview"))
    .click();
  [...dlg.querySelectorAll("button")]
    .find((b) => b.textContent.includes("Apply"))
    .click();
  await app.settle();

  assert.strictEqual(getCurrent().pgn, NEXT, "the new PGN is in force");
  assert.strictEqual(getCurrent().name, "Repertoire", "the name is kept");
  assert.strictEqual(getCurrent().id, id, "it is still the same workbook");
  assert.strictEqual(find("e4 e5 Nf3 Nc6 Bb5 a6 Ba4").name, "Ruy Lopez");
  // the note sits on a move both new branches play, so both carry it
  for (const k of ["e4 e5 Nf3 Nc6 Bb5 a6 Ba4", "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O"])
    assert.deepStrictEqual(find(k).comments, [
      { ply: 4, text: "pins the knight" },
    ]);
});

test("cancelling an update leaves the workbook untouched", async () => {
  app.reset();
  await app.loadPgn(PGN);
  find("e4 e5 Nf3 Nc6 Bb5").name = "Ruy Lopez";

  app.clickText("Update PGN");
  const dlg = app.dom.window.document.getElementById("updpgn");
  dlg.querySelector("textarea").value = "1. d4 d5 2. c4";
  [...dlg.querySelectorAll("button")]
    .find((b) => b.textContent.includes("Preview"))
    .click();
  [...dlg.querySelectorAll("button")]
    .find((b) => b.textContent === "Cancel")
    .click();

  assert.strictEqual(
    app.dom.window.document.getElementById("updpgn"),
    null,
    "the dialog closes",
  );
  assert.strictEqual(getCurrent().pgn, PGN);
  assert.strictEqual(find("e4 e5 Nf3 Nc6 Bb5").name, "Ruy Lopez");
});

test("an update that would drop annotated lines spells them out first", async () => {
  app.reset();
  await app.loadPgn(PGN);
  find("e4 e5 Nf3 Nf6 d4").name = "Petroff";

  app.clickText("Update PGN");
  const dlg = app.dom.window.document.getElementById("updpgn");
  dlg.querySelector("textarea").value = "1. e4 e5 2. Nf3 Nc6 3. Bb5";
  [...dlg.querySelectorAll("button")]
    .find((b) => b.textContent.includes("Preview"))
    .click();

  assert.match(dlg.textContent, /Petroff/, "the line about to be lost is named");
});

test("Update PGN reports a PGN it cannot parse instead of applying it", async () => {
  app.reset();
  await app.loadPgn(PGN);

  app.clickText("Update PGN");
  const dlg = app.dom.window.document.getElementById("updpgn");
  dlg.querySelector("textarea").value = "not a game at all";
  [...dlg.querySelectorAll("button")]
    .find((b) => b.textContent.includes("Preview"))
    .click();

  assert.match(dlg.textContent, /could not read pgn/i);
  assert.strictEqual(getCurrent().pgn, PGN);
  assert.ok(
    [...dlg.querySelectorAll("button")].find((b) => b.textContent === "Apply")
      .disabled,
    "Apply stays disabled after a failed preview",
  );
});

test("Update PGN reports movetext with no moves in it", async () => {
  app.reset();
  await app.loadPgn(PGN);

  app.clickText("Update PGN");
  const dlg = app.dom.window.document.getElementById("updpgn");
  dlg.querySelector("textarea").value = "*";
  [...dlg.querySelectorAll("button")]
    .find((b) => b.textContent.includes("Preview"))
    .click();

  assert.match(dlg.textContent, /no moves/i);
  assert.strictEqual(getCurrent().pgn, PGN);
});

test("Save to file asks for a name, and uses it for the file and the workbook", async () => {
  app.reset();
  await app.loadPgn(PGN);

  app.answerPrompt("Najdorf Repertoire");
  const cap = captureDownloads(app.dom.window.document);
  app.clickText("Save to file");
  cap.restore();

  assert.strictEqual(cap.anchors[0].download, "Najdorf-Repertoire.json");
  assert.strictEqual(
    getCurrent().name,
    "Najdorf Repertoire",
    "the name entered is the workbook's name from now on",
  );
  const nb = JSON.parse(await cap.blobs[0].text());
  assert.strictEqual(nb.name, "Najdorf Repertoire");
});

test("cancelling the name prompt downloads nothing", async () => {
  app.reset();
  await app.loadPgn(PGN);
  getCurrent().name = "Keep This";

  app.answerPrompt(null);
  const cap = captureDownloads(app.dom.window.document);
  app.clickText("Save to file");
  cap.restore();

  assert.strictEqual(cap.anchors.length, 0, "no file is written");
  assert.strictEqual(getCurrent().name, "Keep This", "the name is untouched");
});

test("a blank name at the prompt is refused rather than saved as Untitled", async () => {
  app.reset();
  await app.loadPgn(PGN);
  getCurrent().name = "Keep This";

  app.answerPrompt("   ");
  const cap = captureDownloads(app.dom.window.document);
  app.clickText("Save to file");
  cap.restore();

  assert.strictEqual(cap.anchors.length, 0, "no file is written");
  assert.strictEqual(getCurrent().name, "Keep This");
});
