import { test } from "node:test";
import assert from "node:assert";
import { parsePgn } from "../src/pgn.js";
import { collectLines } from "../src/tree.js";
import { mergeAnnotations } from "../src/merge.js";

// Lines exactly as the app builds them from an imported PGN.
function linesOf(pgn) {
  const { nodes } = parsePgn(pgn);
  return collectLines(nodes);
}

// Notes are set directly rather than written as PGN {comments}: inside a
// variation a comment swallows the moves that follow it, so a fixture built
// that way would not have the shape the test is about.
function noteAt(line, ply, text) {
  line.comments = line.comments || [];
  line.comments.push({ ply, text });
  return line;
}

const key = (l) => l.moves.map((m) => m.san).join(" ");
const find = (lines, k) => lines.find((l) => key(l) === k);

test("an unchanged line keeps its name, tag and evaluation", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4) 3. Bb5");
  const side = find(before, "e4 e5 Nf3 Nf6 d4");
  side.name = "Petroff";
  side.tag = "foot";
  side.meta = { eval: "=", note: "solid" };

  const after = linesOf("1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4) 3. Bb5");
  mergeAnnotations(before, after);

  const merged = find(after, "e4 e5 Nf3 Nf6 d4");
  assert.strictEqual(merged.name, "Petroff");
  assert.strictEqual(merged.tag, "foot");
  assert.deepStrictEqual(merged.meta, { eval: "=", note: "solid" });
});

test("a line the new PGN extends keeps its line attributes", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5");
  const main = find(before, "e4 e5 Nf3 Nc6 Bb5");
  main.name = "Ruy Lopez";
  main.meta = { eval: "=" };

  const after = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6");
  mergeAnnotations(before, after);

  const merged = find(after, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6");
  assert.strictEqual(merged.name, "Ruy Lopez");
  assert.deepStrictEqual(merged.meta, { eval: "=" });
});

test("a note on a shared move reaches every branch the new PGN grew", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5");
  noteAt(find(before, "e4 e5 Nf3 Nc6 Bb5"), 4, "pins the knight");

  const after = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... Nf6 4. O-O)");
  mergeAnnotations(before, after);

  for (const k of ["e4 e5 Nf3 Nc6 Bb5 a6", "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O"]) {
    const l = find(after, k);
    assert.deepStrictEqual(
      l.comments,
      [{ ply: 4, text: "pins the knight" }],
      `${k} carries the note on the shared move`,
    );
  }
});

test("a mark on a shared move reaches every branch the new PGN grew", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5");
  find(before, "e4 e5 Nf3 Nc6 Bb5").marks = { 4: "$1" };

  const after = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... Nf6 4. O-O)");
  mergeAnnotations(before, after);

  assert.strictEqual(find(after, "e4 e5 Nf3 Nc6 Bb5 a6").marks[4], "$1");
  assert.strictEqual(find(after, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O").marks[4], "$1");
});

test("line attributes go to one branch, not to every branch", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5");
  const main = find(before, "e4 e5 Nf3 Nc6 Bb5");
  main.name = "Ruy Lopez";
  main.meta = { eval: "=" };

  const after = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... Nf6 4. O-O)");
  mergeAnnotations(before, after);

  const named = after.filter((l) => l.name === "Ruy Lopez");
  assert.strictEqual(named.length, 1, "exactly one line inherits the name");
  assert.strictEqual(key(named[0]), "e4 e5 Nf3 Nc6 Bb5 a6", "the first, longest match");
});

test("re-merging the same PGN does not duplicate a note", () => {
  const before = linesOf("1. e4 e5 2. Nf3");
  noteAt(find(before, "e4 e5 Nf3"), 2, "develops");

  const after = linesOf("1. e4 e5 2. Nf3");
  noteAt(find(after, "e4 e5 Nf3"), 2, "develops");
  mergeAnnotations(before, after);

  assert.deepStrictEqual(find(after, "e4 e5 Nf3").comments, [
    { ply: 2, text: "develops" },
  ]);
});

// A line built by hand, for matcher cases a PGN tree cannot express -- one
// leaf line whose moves are a strict prefix of another leaf line's.
function lineOf(sans, attrs = {}) {
  return {
    moves: sans.map((san, ply) => ({ san, ply })),
    marks: {},
    meta: {},
    ...attrs,
  };
}

test("a line the new PGN no longer contains is reported as dropped", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4)");
  const gone = find(before, "e4 e5 Nf3 Nf6 d4");
  gone.name = "Petroff";
  gone.meta = { eval: "±" };

  const after = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5");
  const report = mergeAnnotations(before, after);

  assert.strictEqual(report.droppedLines.length, 1);
  const [d] = report.droppedLines;
  assert.strictEqual(d.key, "e4 e5 Nf3 Nf6 d4");
  assert.strictEqual(d.name, "Petroff");
  assert.strictEqual(d.tag, "sideline");
  assert.strictEqual(d.eval, "±");
  assert.strictEqual(d.note, "");
});

test("a dropped line carrying no annotations is counted but not reported", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4)");
  const after = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5");
  const report = mergeAnnotations(before, after);

  assert.strictEqual(report.removed, 1, "the line is counted as removed");
  assert.deepStrictEqual(report.droppedLines, [], "nothing was lost to report");
});

test("a note whose move path is gone is reported as dropped", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4)");
  noteAt(find(before, "e4 e5 Nf3 Nf6 d4"), 4, "the Steinitz attack");

  const after = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5");
  const report = mergeAnnotations(before, after);

  // Only paths that actually carried something are tracked, so the bare
  // "e4 e5 Nf3 Nf6" the note hung below is not itself a loss to report.
  assert.strictEqual(report.droppedNotes.length, 1);
  assert.strictEqual(report.droppedNotes[0].path, "e4 e5 Nf3 Nf6 d4");
  assert.deepStrictEqual(report.droppedNotes[0].comments, [
    "the Steinitz attack",
  ]);
});

test("a note still reachable on another line is not reported as dropped", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4)");
  noteAt(find(before, "e4 e5 Nf3 Nf6 d4"), 2, "the knight comes out");

  const after = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5");
  const report = mergeAnnotations(before, after);

  // The note sits on "e4 e5 Nf3", which the new PGN still plays -- the line
  // that carried it is gone, but the move it annotates is not.
  assert.deepStrictEqual(report.droppedNotes, []);
  assert.deepStrictEqual(find(after, "e4 e5 Nf3 Nc6 Bb5").comments, [
    { ply: 2, text: "the knight comes out" },
  ]);
});

test("a promoted mainline is re-promoted onto the line it became", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4)");
  const promoted = find(before, "e4 e5 Nf3 Nf6 d4");
  before.forEach((l) => (l.isMain = l === promoted));
  promoted.tag = undefined;

  const after = linesOf("1. e4 e5 2. Nf3 Nf6 3. d4 exd4 (2... Nc6 3. Bb5)");
  mergeAnnotations(before, after);

  const main = after.filter((l) => l.isMain);
  assert.strictEqual(main.length, 1, "exactly one mainline");
  assert.strictEqual(key(main[0]), "e4 e5 Nf3 Nf6 d4 exd4");
  assert.strictEqual(main[0].tag, undefined, "the mainline carries no tag");
});

test("the mainline is never left hidden or footnoted by a merge", () => {
  const before = linesOf("1. e4 e5 2. Nf3");
  const main = find(before, "e4 e5 Nf3");
  main.tag = "foot";
  main.hidden = true;

  const after = linesOf("1. e4 e5 2. Nf3 Nc6");
  mergeAnnotations(before, after);

  const merged = find(after, "e4 e5 Nf3 Nc6");
  assert.strictEqual(merged.isMain, true);
  assert.strictEqual(merged.tag, undefined);
  assert.strictEqual(merged.hidden, false);
});

test("counts report what matched, what grew and what arrived", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4)");
  const after = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4)");
  const report = mergeAnnotations(before, after);

  assert.strictEqual(report.exact, 0);
  assert.strictEqual(report.extended, 1);
  assert.strictEqual(report.shortened, 0);
  assert.strictEqual(report.removed, 1);
  assert.strictEqual(report.added, 1);
});

test("the more specific of two nested old lines claims the new line", () => {
  const shallow = lineOf(["e4", "e5"], { name: "King's Pawn", tag: "sideline" });
  const deep = lineOf(["e4", "e5", "Nf3"], { name: "King's Knight", tag: "sideline" });
  const after = [lineOf(["e4", "e5", "Nf3", "Nc6"], { isMain: true })];

  const report = mergeAnnotations([shallow, deep], after);

  assert.strictEqual(after[0].name, "King's Knight", "the longer prefix wins");
  assert.deepStrictEqual(
    report.droppedLines.map((d) => d.name),
    ["King's Pawn"],
    "the line it outbid is reported",
  );
});

test("a line the new PGN cuts short still keeps its attributes", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5");
  find(before, "e4 e5 Nf3 Nc6 Bb5").name = "Ruy Lopez";

  const after = linesOf("1. e4 e5 2. Nf3 Nc6");
  const report = mergeAnnotations(before, after);

  assert.strictEqual(find(after, "e4 e5 Nf3 Nc6").name, "Ruy Lopez");
  assert.strictEqual(report.shortened, 1);
});

test("the editor's placeholder name does not count as work worth reporting", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4)");
  // what lineEditor() writes onto every line it renders, named or not
  before.forEach((l, i) => (l.name = l.isMain ? "Mainline" : "Line " + i));

  const after = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5");
  const report = mergeAnnotations(before, after);

  assert.strictEqual(report.removed, 1, "the line is still counted as removed");
  assert.deepStrictEqual(
    report.droppedLines,
    [],
    "but a placeholder name is not an annotation to warn about",
  );
});

test("a real name alongside the placeholders is still reported", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4)");
  before.forEach((l, i) => (l.name = l.isMain ? "Mainline" : "Line " + i));
  find(before, "e4 e5 Nf3 Nf6 d4").name = "Petroff";

  const after = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5");
  const report = mergeAnnotations(before, after);

  assert.strictEqual(report.droppedLines.length, 1);
  assert.strictEqual(report.droppedLines[0].name, "Petroff");
});

test("a dropped line reports its moves, so the report can number them", () => {
  const before = linesOf("1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4)");
  find(before, "e4 e5 Nf3 Nf6 d4").meta = { eval: "±" };

  const after = linesOf("1. e4 e5 2. Nf3 Nc6 3. Bb5");
  const report = mergeAnnotations(before, after);

  assert.deepStrictEqual(
    report.droppedLines[0].moves.map((m) => [m.ply, m.san]),
    [
      [0, "e4"],
      [1, "e5"],
      [2, "Nf3"],
      [3, "Nf6"],
      [4, "d4"],
    ],
  );
});
