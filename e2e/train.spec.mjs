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
  await page.getByLabel("Right in a row to learn").fill("1");
  await page.getByLabel("Right in a row to learn").blur();
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
  await expect(page.locator(".tr-moves")).toHaveText("e4 e5");
  await expect(page.locator(".tr-note")).toHaveText(["1.e4 King pawn.", "1...e5 Symmetry."]);
  await expect(page.locator(".tr-choice")).toHaveCount(0);
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.locator(".tr-prompt")).not.toHaveText(/^New:/);
  await expect(page.locator(".tr-progress")).toHaveText(/^Question 1 of /);
});
