import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { headerTags } from "../src/pgn.js";
import { GAME_FIELDS, headerEdits, openGameInfo } from "../src/game-info.js";
import { buildPgn } from "../src/pgn-out.js";
import { toNotebook } from "../src/store.js";

const SRC = '[White "Kasparov"]\n[Black "Topalov"]\n[Event "?"]\n\n1. e4 d6 *';

test("headerEdits keeps only what differs from the PGN", () => {
  assert.deepStrictEqual(
    headerEdits(SRC, { White: "Kasparov", Black: "", Event: "  Wijk  ", ECO: "?" }),
    // Black was cleared; Event typed over a "?"; ECO "?" is still blank
    { Black: "", Event: "Wijk" },
  );
  assert.deepStrictEqual(headerEdits(SRC, { White: "Kasparov", Black: "Topalov" }), {});
});

test("headerTags lays the edits over the PGN's tags", () => {
  assert.deepStrictEqual(
    headerTags({ pgn: SRC, header: { Black: "", ECO: "B07" } }),
    { White: "Kasparov", Black: "", Event: "?", ECO: "B07" },
  );
  assert.deepStrictEqual(headerTags({ pgn: "1. e4 *" }), {});
});

function dialog(state) {
  let saved = 0;
  openGameInfo(state, () => saved++);
  const ov = document.getElementById("gameinfo");
  const input = (k) => ov.querySelector("input.gi-" + k);
  return { ov, input, saved: () => saved };
}

test("the dialog shows the header, blanks the placeholders, and saves edits", () => {
  const off = installDom();
  const s = loadState(SRC);
  const d = dialog(s);
  assert.strictEqual(d.ov.querySelectorAll("input").length, GAME_FIELDS.length);
  assert.strictEqual(d.input("White").value, "Kasparov");
  assert.strictEqual(d.input("Event").value, "", "a ? placeholder shows blank");
  d.input("Opening").value = "Pirc";
  d.input("Black").value = "";
  [...d.ov.querySelectorAll("button")].find((b) => b.textContent === "Save").click();
  assert.deepStrictEqual(s.header, { Opening: "Pirc", Black: "" });
  assert.strictEqual(d.saved(), 1);
  assert.strictEqual(document.getElementById("gameinfo"), null, "closed");
  // the edits reach the export: Black cleared back to the placeholder
  const pgn = buildPgn(s);
  assert.match(pgn, /\[Black "\?"\]/);
  assert.match(pgn, /\[Opening "Pirc"\]/);
  // and travel with the workbook
  assert.deepStrictEqual(toNotebook(s).header, { Opening: "Pirc", Black: "" });
  off();
});

test("saving no changes drops the header; Cancel and Esc save nothing", () => {
  const off = installDom();
  const s = loadState(SRC);
  s.header = { White: "Someone" };
  let d = dialog(s);
  d.input("White").value = "Kasparov"; // back to what the file says
  d.input("White").dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  assert.strictEqual(s.header, undefined);
  assert.strictEqual(toNotebook(s).header, undefined, "not written when empty");

  d = dialog(s);
  d.input("White").value = "Other";
  [...d.ov.querySelectorAll("button")].find((b) => b.textContent === "Cancel").click();
  d = dialog(s);
  d.input("White").value = "Other";
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.strictEqual(document.getElementById("gameinfo"), null);
  d = dialog(s);
  d.ov.onclick({ target: d.ov }); // a click outside
  assert.strictEqual(document.getElementById("gameinfo"), null);
  assert.strictEqual(s.header, undefined);
  assert.strictEqual(d.saved(), 0);
  off();
});

test("a typed Event wins over the workbook's name in the export", () => {
  const s = { name: "My Pirc", pgn: SRC, lines: [], header: { Event: "Wijk" } };
  assert.match(buildPgn(s), /^\[Event "Wijk"\]/);
});
