import { readFileSync } from "node:fs";
import { test, expect, loadPgn, playOnBoard, FIXTURE } from "./fixtures.mjs";

const NAMED = '1. e4 c5 2. Nf3 d6 {[%name "...d6 Sicilians"]} (2... e6 {[%name "...e6 Sicilians"]}) *';

test("train quizzes the named variations and scores a right answer", async ({ page }) => {
  await loadPgn(page, NAMED);
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await expect(page.locator(".tr-outline")).toBeVisible();
  await expect(page.locator(".tr-name")).toHaveText(["...d6 Sicilians", "...e6 Sicilians"]);
  // only name questions, with their moves shown, so the right choice is known
  await page.locator(".tr-settings-open").click();
  for (const label of ["Order", "Book", "Show the moves", "Show a new variation first"]) {
    await page.getByLabel(label, { exact: true }).click();
  }
  await page.locator(".tr-settings-done").click();
  await page.locator(".tr-start").click();
  await expect(page.locator(".tr-prompt")).toHaveText("What is this position called?");
  const moves = await page.locator(".tr-moves").innerText();
  const answer = moves.trim().endsWith("e6") ? "...e6 Sicilians" : "...d6 Sicilians";
  await page.locator(".tr-choice", { hasText: answer }).click();
  await expect(page.locator(".tr-result.right")).toBeVisible();
  await page.locator(".tr-next").click();
  await expect(page.locator(".tr-result")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.locator(".tr-outline, .tr-question")).toHaveCount(0);
});

// Learning a variation opens the ones below it, and their questions join the
// session at once instead of waiting for another day.
test("train asks the questions an answer unlocks in the same session", async ({ page }) => {
  await loadPgn(page, '1. e4 e5 {[%name "Open"]} 2. Nf3 Nc6 {[%name "Open Knight"]} *');
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await page.locator(".tr-settings-open").click();
  for (const label of ["Order", "Book", "Show the moves", "Show a new variation first"]) {
    await page.getByLabel(label, { exact: true }).click();
  }
  await page.getByLabel("Right answers to learn").fill("1");
  await page.getByLabel("Right answers to learn").blur();
  await page.locator(".tr-settings-done").click();
  await page.locator(".tr-start").click();
  await expect(page.locator(".tr-status")).toHaveText("Level 1 · 0 of 1 right to learn · learn it to unlock 1 variation");
  await page.locator(".tr-choice", { hasText: /^Open$/ }).click();
  await expect(page.locator(".tr-result.right")).toBeVisible();
  await expect(page.locator(".tr-unlocked")).toHaveText("Unlocked: Open Knight");
  await page.locator(".tr-next").click();
  await expect(page.locator(".tr-status")).toHaveText(/^Level 2 · /);
  await expect(page.locator(".tr-question")).toBeVisible();
});

// A session is a flow: with no length limit and one question learned at a
// time, learning a question brings the next one in, and the session carries on
// until it is ended; Keep going starts the next one from the summary.
test("train's session flows on, ends on request and keeps going", async ({ page }) => {
  await loadPgn(page, '1. e4 e5 {[%name "Open"]} 2. Nf3 Nc6 {[%name "Open Knight"]} *');
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await page.locator(".tr-settings-open").click();
  for (const label of ["Order", "Book", "Show a new variation first"]) {
    await page.getByLabel(label, { exact: true }).click();
  }
  for (const [label, value] of [["Right answers to learn", "1"], ["Learning at once", "1"], ["Questions per session", "0"]]) {
    await page.getByLabel(label).fill(value);
    await page.getByLabel(label).blur();
  }
  await page.locator(".tr-settings-done").click();
  await page.locator(".tr-start").click();
  await expect(page.locator(".tr-progress")).toHaveText("Question 1");
  await page.locator(".tr-choice", { hasText: /^Open$/ }).click();
  await expect(page.locator(".tr-result.right")).toBeVisible();
  await page.locator(".tr-next").click();
  // learned, so the Open Knight question took its place in the same session
  await expect(page.locator(".tr-progress")).toHaveText("Question 2");
  await expect(page.locator(".tr-choice", { hasText: /^Open Knight$/ })).toBeVisible();
  await page.locator(".tr-end").click();
  await expect(page.locator(".tr-summary")).toContainText("Right 1 / 1");
  await page.locator(".tr-again").click();
  await expect(page.locator(".tr-progress")).toHaveText("Question 1");
  await expect(page.locator(".tr-choice", { hasText: /^Open Knight$/ })).toBeVisible();
});

// The board you play on is the analysis board's, which stretches to fill its
// row; in Train it must keep the size of the pictures the other questions and
// the answered card show, or it jumps when the answer comes up. That size
// follows the window, so a big screen gets a big board.
test("train's board keeps one size across questions and answers", async ({ page }) => {
  await loadPgn(page, readFileSync(FIXTURE, "utf8"));
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await page.locator(".tr-settings-open").click();
  await page.getByLabel("Show a new variation first").click();
  await page.getByLabel("Show the moves", { exact: true }).click(); // so the right name is known
  await page.locator(".tr-settings-done").click();
  await page.locator(".tr-start").click();
  const width = async () => Math.round((await page.locator(".tr-body svg").first().boundingBox()).width);
  const small = await width();
  await page.setViewportSize({ width: 2560, height: 1440 });
  expect(await width()).toBe(640); // its full size: nothing else in the window caps it
  expect(small).toBeLessThan(640); // and a smaller window got a smaller board
  const seen = new Map(); // prompt kind -> widths
  for (let i = 0; i < 6 && (await page.locator(".tr-question").count()); i++) {
    const prompt = await page.locator(".tr-prompt").innerText();
    const widths = [await width()];
    if (prompt.startsWith("Play the moves")) await playOnBoard(page, "a2", "a3"); // never book here: a wrong answer
    else if (await page.locator(".tr-choice").count()) {
      // answered right: two misses in five would hold the Order questions back
      const name = (await page.locator(".tr-moves").innerText()).includes("Bb5") ? "Ruy Lopez" : "Open Game";
      await page.locator(".tr-choice", { hasText: name }).click();
    }
    else await page.locator(".tr-check").click();
    await expect(page.locator(".tr-result")).toBeVisible();
    widths.push(await width());
    seen.set(prompt.split(" ")[0], widths);
    await page.locator(".tr-next").click();
  }
  expect([...seen.keys()]).toEqual(expect.arrayContaining(["What", "Play"]));
  expect(new Set([...seen.values()].flat()).size).toBe(1);
});

// The first time a session reaches a variation it shows it before asking:
// its position, the moves and the notes; Got it moves on to the question.
test("train shows a new variation before its first question", async ({ page }) => {
  await loadPgn(page, '1. e4 {King pawn.} e5 {[%name "Open"] Symmetry.} *');
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await page.locator(".tr-start").click();
  await expect(page.locator(".tr-prompt")).toHaveText("New: Open");
  await expect(page.locator(".tr-moves")).toHaveText("1.e4 e5");
  // one move at a time, with only that move's notes
  await expect(page.locator(".tr-note")).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".tr-note")).toHaveText(["1.e4 King pawn."]);
  await page.locator(".tr-fwd").click();
  await expect(page.locator(".tr-note")).toHaveText(["1...e5 Symmetry."]);
  await expect(page.locator(".tr-steps .an-move.at")).toHaveText("e5");
  await expect(page.locator(".tr-choice")).toHaveCount(0);
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.locator(".tr-prompt")).not.toHaveText(/^New:/);
  await expect(page.locator(".tr-progress")).toHaveText(/^Question 1 of /);
});

// The engine is Study's, shown under Train's board while learning: on a name
// question before and after answering, never while an order question waits
// for moves. The real engine worker runs here, so the first line can take a
// while to arrive.
async function trainOnly(page, off) {
  await loadPgn(page, NAMED);
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await page.locator(".tr-settings-open").click();
  for (const label of [...off, "Show a new variation first"]) await page.getByLabel(label, { exact: true }).click();
  return page.locator(".tr-settings-done");
}

test("train's engine shows its bar and lines on a name question, not on an order question", async ({ page }) => {
  await (await trainOnly(page, ["Order", "Book"])).click();
  await page.locator(".tr-start").click();
  await expect(page.locator(".tr-prompt")).toHaveText("What is this position called?");
  await expect(page.locator(".tr-body .an-evalbar")).toBeHidden(); // its place is kept, empty
  await page.locator(".an-engine-toggle").click();
  await expect(page.locator(".tr-body .an-evalbar")).toBeVisible();
  await expect(page.locator(".tr-body .an-pv .an-pvmove").first()).toBeVisible({ timeout: 60_000 });
  // the lines are text here: nothing plays when one is clicked
  expect(await page.locator(".tr-body .an-pv button.an-pvmove").count()).toBe(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Train", exact: true }).click();
  await page.locator(".tr-settings-open").click();
  await page.getByLabel("Name", { exact: true }).click();
  await page.getByLabel("Order", { exact: true }).click();
  await page.locator(".tr-settings-done").click();
  await page.locator(".tr-start").click();
  await expect(page.locator(".tr-prompt")).toHaveText(/^Play the moves/);
  await expect(page.locator(".tr-body .an-board")).toBeVisible();
  await expect(page.locator(".an-engine")).toHaveCount(0);
});

test("Eval only, in the engine box's lines menu, shows the score in its head and no lines", async ({ page }) => {
  await (await trainOnly(page, ["Order", "Book"])).click();
  await page.locator(".tr-start").click();
  await page.locator(".an-engine-toggle").click();
  await page.locator(".an-engine-pv").selectOption({ label: "Eval only" });
  await expect(page.locator(".tr-body .an-evalbar")).toBeVisible();
  await expect(page.locator(".an-engine-head .an-engine-eval")).toHaveText(/^[+-]|^#/, { timeout: 60_000 });
  await expect(page.locator(".an-pvs")).toHaveCount(0);
  await expect(page.locator(".an-arrows")).toHaveCount(0);
  // remembered: the next board's box starts on Eval only too
  await page.getByRole("button", { name: "End session" }).click();
  await page.locator(".tr-again").click();
  await expect(page.locator(".an-engine-pv")).toHaveValue("0");
});

// The engine's lines menu and depth are this browser's, kept across visits
// (prefs.js), so they are not set again every time.
test("the engine's lines menu and depth come back after a reload", async ({ page }) => {
  await (await trainOnly(page, ["Order", "Book"])).click();
  await page.locator(".tr-start").click();
  await page.locator(".an-engine-toggle").click();
  await page.locator(".an-engine-pv").selectOption({ label: "Eval only" });
  await page.locator(".an-engine-depth").fill("15");
  await page.locator(".an-engine-depth").press("Enter");
  await (await trainOnly(page, ["Order", "Book"])).click(); // loads the page afresh
  await page.locator(".tr-start").click();
  await page.locator(".an-engine-toggle").click();
  await expect(page.locator(".an-engine-pv")).toHaveValue("0");
  await expect(page.locator(".an-engine-depth")).toHaveValue("15");
});
