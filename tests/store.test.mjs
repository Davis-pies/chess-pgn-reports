import { test } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";
import {
  saveNotebook,
  loadNotebook,
  listNotebooks,
  deleteNotebook,
  toNotebook,
  applyNotebook,
  parseWorkbook,
} from "../src/store.js";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";

// store.js reads/writes the bare `localStorage` global, same as the browser;
// stand one up via jsdom for each test so entries don't leak between tests.
function withStorage(fn) {
  const dom = new JSDOM("", { url: "http://localhost/" });
  global.localStorage = dom.window.localStorage;
  try {
    return fn();
  } finally {
    delete global.localStorage;
  }
}

test("saveNotebook / loadNotebook round-trip", () => {
  withStorage(() => {
    const lines = [
      { isMain: true, moves: [{ san: "e4", ply: 0 }], name: "Mainline" },
      {
        isMain: false,
        tag: "sideline",
        moves: [
          { san: "e4", ply: 0 },
          { san: "c5", ply: 1 },
        ],
        name: "Sicilian",
        meta: { note: "spicy" },
        marks: { 1: "$1" },
        comments: [{ ply: 1, text: "sharp" }],
      },
    ];
    const ok = saveNotebook("abc", { name: "My Book", pgn: "1. e4 c5", lines });
    assert.strictEqual(ok, true, "save reports success");

    const loaded = loadNotebook("abc");
    assert.ok(loaded, "notebook loads back");
    assert.strictEqual(loaded.name, "My Book");
    assert.strictEqual(loaded.pgn, "1. e4 c5");
    assert.strictEqual(loaded.main, "e4"); // keyFor the mainline's moves
    assert.strictEqual(loaded.tags.length, 2);
    const side = loaded.tags.find((t) => t.key === "e4 c5");
    assert.ok(side, "sideline tag entry present");
    assert.strictEqual(side.tag, "sideline");
    assert.strictEqual(side.name, "Sicilian");
    assert.deepStrictEqual(side.meta, { note: "spicy" });
    assert.deepStrictEqual(side.marks, { 1: "$1" });
    assert.deepStrictEqual(side.comments, [{ ply: 1, text: "sharp" }]);
  });
});

test("saveNotebook returns false and does not throw when setItem throws", () => {
  withStorage(() => {
    // jsdom's Storage writes through any property assignment on the
    // instance to the backing store (per the WebStorage named-property
    // setter spec), so `localStorage.setItem = fn` silently no-ops
    // instead of overriding the method — stub it on the prototype.
    const proto = Object.getPrototypeOf(global.localStorage);
    const origSetItem = proto.setItem;
    proto.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      const lines = [{ isMain: true, moves: [{ san: "e4", ply: 0 }] }];
      let ok;
      assert.doesNotThrow(() => {
        ok = saveNotebook("full", { name: "N", pgn: "1. e4", lines });
      });
      assert.strictEqual(ok, false, "failure is surfaced to the caller");
    } finally {
      proto.setItem = origSetItem;
    }
  });
});

test("loadNotebook returns null for corrupt JSON instead of throwing", () => {
  withStorage(() => {
    global.localStorage.setItem("ott:bad", "{not json");
    let result;
    assert.doesNotThrow(() => {
      result = loadNotebook("bad");
    });
    assert.strictEqual(result, null);
  });
});

test("listNotebooks tolerates a corrupt entry alongside a valid one", () => {
  withStorage(() => {
    const lines = [{ isMain: true, moves: [{ san: "e4", ply: 0 }] }];
    saveNotebook("good", { name: "Good Book", pgn: "1. e4", lines });
    global.localStorage.setItem("ott:bad", "{not json");

    let list;
    assert.doesNotThrow(() => {
      list = listNotebooks();
    });
    list.sort((a, b) => a.id.localeCompare(b.id));
    assert.deepStrictEqual(list, [
      { id: "bad", name: "" },
      { id: "good", name: "Good Book" },
    ]);
  });
});

test("deleteNotebook removes only the targeted key", () => {
  withStorage(() => {
    const lines = [{ isMain: true, moves: [{ san: "e4", ply: 0 }] }];
    saveNotebook("keep", { name: "Keep", pgn: "1. e4", lines });
    saveNotebook("gone", { name: "Gone", pgn: "1. e4", lines });

    deleteNotebook("gone");

    assert.strictEqual(loadNotebook("gone"), null);
    assert.ok(loadNotebook("keep"), "untouched entry survives");
    const ids = listNotebooks()
      .map((n) => n.id)
      .sort();
    assert.deepStrictEqual(ids, ["keep"]);
  });
});

test("saveNotebook persists print-affecting view settings", () => {
  withStorage(() => {
    const lines = [
      { isMain: true, moves: [{ san: "e4", ply: 0 }], name: "Mainline" },
    ];
    saveNotebook("withview", {
      name: "Sized",
      pgn: "1. e4",
      lines,
      view: { boardSize: 400, showBoards: true, showFinalBoard: false },
    });
    const loaded = loadNotebook("withview");
    assert.strictEqual(loaded.view.boardSize, 400);
    assert.strictEqual(loaded.view.showBoards, true);
    assert.strictEqual(loaded.view.showFinalBoard, false);
  });
});

test("saveNotebook without view stores an empty object, not undefined", () => {
  withStorage(() => {
    saveNotebook("noview", {
      name: "Plain",
      pgn: "1. e4",
      lines: [{ isMain: true, moves: [{ san: "e4", ply: 0 }] }],
    });
    // notebooks saved before `view` existed must still load and fall back
    assert.deepStrictEqual(loadNotebook("noview").view, {});
  });
});

test("saveNotebook records a line's hidden flag", () => {
  withStorage(() => {
    const lines = [
      { isMain: true, moves: [{ san: "e4", ply: 0 }], name: "Mainline" },
      {
        moves: [
          { san: "e4", ply: 0 },
          { san: "e5", ply: 1 },
        ],
        tag: "sideline",
        name: "Hidden one",
        hidden: true,
      },
    ];
    saveNotebook("n1", { name: "t", pgn: "1. e4 e5 *", lines, view: {} });
    const nb = loadNotebook("n1");
    assert.strictEqual(nb.tags[0].hidden, false);
    assert.strictEqual(nb.tags[1].hidden, true);
  });
});

test("a notebook saved with bare glyph marks loads as NAG codes", () => {
  withStorage(() => {
    // written before marks carried codes: the glyph was all there was
    localStorage.setItem(
      "ott:legacy",
      JSON.stringify({
        name: "Old",
        pgn: "1. e4 c5",
        main: "e4",
        view: {},
        tags: [{ key: "e4 c5", marks: { 1: "!", 2: "\u2a00", 3: "TN" } }],
      }),
    );
    const { marks } = loadNotebook("legacy").tags[0];
    assert.strictEqual(marks[1], "$1", "an unpaired glyph maps exactly");
    // \u2a00 is shared by $22/$23; ply 2 is a White move, so the White half.
    // Lossy in exactly the way the app already was -- the side was never in
    // the glyph to recover -- but it converges the data.
    assert.strictEqual(marks[2], "$22");
    assert.strictEqual(marks[3], "TN", "a mark with no NAG code is left alone");
  });
});

// ---------------------------------------------------------------------------
// The format itself, independent of localStorage: toNotebook/applyNotebook are
// what the file save/open path and the localStorage path both go through.
// ---------------------------------------------------------------------------

const linesOf = (pgn) => collectLines(parsePgn(pgn).nodes);
const keyOf = (l) => l.moves.map((m) => m.san).join(" ");
const findLine = (lines, k) => lines.find((l) => keyOf(l) === k);

test("toNotebook stamps the format and version a file needs", () => {
  const nb = toNotebook({
    name: "Book",
    pgn: "1. e4",
    lines: linesOf("1. e4"),
    view: {},
  });
  assert.strictEqual(nb.format, "ott-workbook");
  assert.strictEqual(typeof nb.version, "number");
});

test("applyNotebook restores tags, marks, notes and hidden onto fresh lines", () => {
  const pgn = "1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4)";
  const saved = linesOf(pgn);
  const side = findLine(saved, "e4 e5 Nf3 Nf6 d4");
  side.name = "Petroff";
  side.tag = "foot";
  side.meta = { eval: "=" };
  side.marks = { 4: "$1" };
  side.comments = [{ ply: 4, text: "central break" }];
  side.hidden = true;

  const nb = toNotebook({ name: "B", pgn, lines: saved, view: {} });
  const fresh = linesOf(pgn);
  applyNotebook(nb, fresh);

  const l = findLine(fresh, "e4 e5 Nf3 Nf6 d4");
  assert.strictEqual(l.name, "Petroff");
  assert.strictEqual(l.tag, "foot");
  assert.deepStrictEqual(l.meta, { eval: "=" });
  assert.deepStrictEqual(l.marks, { 4: "$1" });
  assert.deepStrictEqual(l.comments, [{ ply: 4, text: "central break" }]);
  assert.strictEqual(l.hidden, true);
});

test("applyNotebook restores a promoted mainline", () => {
  const pgn = "1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4)";
  const saved = linesOf(pgn);
  const promoted = findLine(saved, "e4 e5 Nf3 Nf6 d4");
  saved.forEach((l) => (l.isMain = l === promoted));

  const nb = toNotebook({ name: "B", pgn, lines: saved, view: {} });
  const fresh = linesOf(pgn);
  applyNotebook(nb, fresh);

  const main = fresh.filter((l) => l.isMain);
  assert.strictEqual(main.length, 1);
  assert.strictEqual(keyOf(main[0]), "e4 e5 Nf3 Nf6 d4");
  assert.strictEqual(main[0].tag, undefined);
});

test("parseWorkbook reads back what toNotebook wrote", () => {
  const pgn = "1. e4 c5";
  const lines = linesOf(pgn);
  lines[0].name = "Sicilian";
  const text = JSON.stringify(toNotebook({ name: "B", pgn, lines, view: {} }));

  const nb = parseWorkbook(text);
  assert.strictEqual(nb.pgn, pgn);
  assert.strictEqual(nb.tags[0].name, "Sicilian");
});

test("parseWorkbook converts a file's legacy glyph marks to NAG codes", () => {
  const nb = parseWorkbook(
    JSON.stringify({
      format: "ott-workbook",
      version: 1,
      name: "Old",
      pgn: "1. e4 c5",
      main: "e4 c5",
      view: {},
      tags: [{ key: "e4 c5", marks: { 1: "!" } }],
    }),
  );
  assert.strictEqual(nb.tags[0].marks[1], "$1");
});

test("parseWorkbook rejects JSON that is not a workbook", () => {
  assert.throws(() => parseWorkbook('{"hello":"world"}'), /not a workbook/i);
});

test("parseWorkbook rejects malformed JSON with a readable message", () => {
  assert.throws(() => parseWorkbook("{not json"), /could not be read/i);
});

test("parseWorkbook refuses a file written by a newer version", () => {
  const text = JSON.stringify({
    format: "ott-workbook",
    version: 99,
    pgn: "1. e4",
    tags: [],
  });
  assert.throws(() => parseWorkbook(text), /newer version/i);
});
