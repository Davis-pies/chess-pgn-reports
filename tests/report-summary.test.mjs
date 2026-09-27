import { test } from "node:test";
import assert from "node:assert";
import { installDom, loadState } from "./helpers.mjs";
import { grid } from "../src/table.js";
import { allNotes } from "../src/notes.js";
import { pgnTags } from "../src/pgn.js";
import {
  headerFacts,
  verdictOf,
  reportSummary,
  verdictText,
  appendReportSummary,
  summaryMarkdown,
} from "../src/report-summary.js";
import { buildMarkdown } from "../src/export.js";

const HEAD = [
  '[Event "Wijk aan Zee"]',
  '[Site "Wijk aan Zee NED"]',
  '[Date "1999.01.20"]',
  '[White "Kasparov, Garry"]',
  '[Black "Topalov, Veselin"]',
  '[ECO "B07"]',
  '[Opening "Pirc"]',
  '[Variation "Austrian attack"]',
  "",
].join("\n");

const summaryOf = (s) => reportSummary(s, grid(s.lines), allNotes());

test("pgnTags reads tag pairs without touching the moves", () => {
  assert.deepStrictEqual(pgnTags(HEAD + "1. e4 {a [%eval 0.3] note} *"), {
    Event: "Wijk aan Zee",
    Site: "Wijk aan Zee NED",
    Date: "1999.01.20",
    White: "Kasparov, Garry",
    Black: "Topalov, Veselin",
    ECO: "B07",
    Opening: "Pirc",
    Variation: "Austrian attack",
  });
  assert.deepStrictEqual(pgnTags(undefined), {});
  // a multi-game file: the first game's header, not the last one's
  assert.deepStrictEqual(
    pgnTags('[White "A"]\n\n1. e4 *\n\n[White "B"]\n\n1. d4 *'),
    { White: "A" },
  );
});

test("headerFacts states the opening, then the game", () => {
  assert.deepStrictEqual(headerFacts(pgnTags(HEAD)), [
    "ECO B07 · Pirc, Austrian attack",
    "Kasparov, Garry – Topalov, Veselin, Wijk aan Zee, Wijk aan Zee NED 1999",
  ]);
});

test("headerFacts leaves out the spec's unknown placeholders", () => {
  const tags = {
    Event: "?",
    Site: "?",
    Date: "????.??.??",
    White: "?",
    Black: "?",
    ECO: "C60",
  };
  assert.deepStrictEqual(headerFacts(tags), ["ECO C60"]);
  // one player alone is not a game
  assert.deepStrictEqual(headerFacts({ White: "Carlsen" }), []);
  // nor are an event and date without players: the app's own PGN export
  // writes the notebook's name as the Event
  assert.deepStrictEqual(
    headerFacts({ Event: "My Pirc", Site: "Oslo", Date: "2024.??.??" }),
    [],
  );
  // with players, only what is known follows them
  assert.deepStrictEqual(
    headerFacts({ White: "A", Black: "B", Event: "?", Date: "????.??.??" }),
    ["A – B"],
  );
});

test("verdictOf reads the line-end eval, else the last move's assessment", () => {
  const line = (meta, marks) => ({
    moves: [{ ply: 0, san: "e4" }, { ply: 1, san: "e5" }],
    meta,
    marks,
  });
  assert.strictEqual(verdictOf(line({ eval: "±" }, {})), "white");
  assert.strictEqual(verdictOf(line({ eval: "=+" }, {})), "black", "alias");
  assert.strictEqual(verdictOf(line({}, { 1: "$13" })), "unclear");
  assert.strictEqual(verdictOf(line({}, { 1: "$10" })), "equal");
  // the line-end eval wins over the last move's mark
  assert.strictEqual(verdictOf(line({ eval: "∓" }, { 1: "$16" })), "black");
  // a move-quality mark is not a verdict, nor is one on an earlier move
  assert.strictEqual(verdictOf(line({}, { 1: "$1" })), null);
  assert.strictEqual(verdictOf(line({}, { 0: "$16" })), null);
  assert.strictEqual(verdictOf(line({ eval: "N" }, {})), null);
  assert.strictEqual(verdictOf({ moves: [], meta: {} }), null);
});

test("reportSummary titles, counts and tallies what the report prints", () => {
  const off = installDom();
  const s = loadState(
    HEAD +
      "1. e4 d6 {main note} (1... c5 2. Nf3 $16) (1... e5 2. Nf3 Nc6 $10) (1... d5 $13) 2. d4 Nf6 3. Nc3 g6 4. f4",
    { name: "Pirc prep", tags: { 3: "foot" } },
  );
  s.lines[0].meta = { eval: "⩲" };
  // a hidden line is not in the report, so not in the counts
  s.lines[2].hidden = true;
  const sum = summaryOf(s);
  assert.strictEqual(sum.title, "Pirc prep");
  assert.deepStrictEqual(sum.counts, [
    "2 lines",
    "1 footnote line",
    "1 note",
    "to move 4",
  ]);
  assert.deepStrictEqual(
    sum.verdicts.map((v) => [v.key, v.count]),
    [
      ["white", 2],
      ["unclear", 1],
    ],
  );
  assert.strictEqual(sum.unassessed, 0);
  assert.strictEqual(verdictText(sum), "White better 2 · unclear 1");
  off();
});

test("an unnamed report is titled by its opening", () => {
  const off = installDom();
  const s = loadState(HEAD + "1. e4 d6 2. d4");
  const sum = summaryOf(s);
  assert.strictEqual(sum.title, "Pirc, Austrian attack");
  assert.deepStrictEqual(sum.counts, ["1 line", "to move 2"]);
  // no verdicts at all: nothing to tally
  assert.strictEqual(verdictText(sum), "");
  off();
});

test("the verdict tally names the unassessed lines", () => {
  assert.strictEqual(
    verdictText({ verdicts: [{ label: "equal", count: 2 }], unassessed: 3 }),
    "equal 2 · 3 unassessed",
  );
});

test("appendReportSummary prints the head, and can be left out of print", () => {
  const off = installDom();
  const s = loadState(HEAD + "1. e4 d6 $10", { name: "Pirc prep" });
  const box = document.createElement("div");
  appendReportSummary(box, summaryOf(s));
  const head = box.querySelector(".report-head");
  assert.strictEqual(head.querySelector("h1").textContent, "Pirc prep");
  assert.deepStrictEqual(
    [...head.querySelectorAll(".rh-fact")].map((f) => f.textContent),
    headerFacts(pgnTags(HEAD)),
  );
  assert.strictEqual(
    head.querySelector(".rh-counts").textContent,
    "1 line · to move 1",
  );
  assert.strictEqual(
    head.querySelector(".rh-verdicts").textContent,
    "Verdicts: equal 1",
  );
  assert.ok(!head.classList.contains("noprint"));
  const quiet = document.createElement("div");
  appendReportSummary(quiet, { ...summaryOf(s), title: "" }, { print: false });
  const q = quiet.querySelector(".report-head");
  assert.ok(q.classList.contains("noprint"));
  assert.strictEqual(q.querySelector("h1"), null, "no empty title");
  off();
});

test("the Markdown export opens with the summary", () => {
  const off = installDom();
  loadState(HEAD + "1. e4 d6 $16 (1... c5)", { name: "Pirc prep" });
  const md = buildMarkdown();
  assert.ok(
    md.startsWith(
      [
        "# Pirc prep",
        "",
        "ECO B07 · Pirc, Austrian attack  ",
        "Kasparov, Garry – Topalov, Veselin, Wijk aan Zee, Wijk aan Zee NED 1999  ",
        "2 lines · to move 1  ",
        "Verdicts: White better 1 · 1 unassessed",
        "",
        "## Lines",
      ].join("\n"),
    ),
    md,
  );
  // no hard break is left dangling on the paragraph's last line
  assert.deepStrictEqual(
    summaryMarkdown({ title: "", facts: [], counts: ["1 line"], verdicts: [] }),
    ["1 line", ""],
  );
  off();
});
