import { test, expect, loadPgn } from "./fixtures.mjs";

const NAMED = '1. e4 c5 2. Nf3 d6 {[%name "...d6 Sicilians"]} (2... e6 {[%name "...e6 Sicilians"]}) *';

test("train quizzes the named variations and scores a right answer", async ({ page }) => {
  await loadPgn(page, NAMED);
  await page.getByRole("button", { name: "Train", exact: true }).click();
  await expect(page.locator(".tr-outline")).toBeVisible();
  await expect(page.locator(".tr-name")).toHaveText(["...d6 Sicilians", "...e6 Sicilians"]);
  // only name questions, with their moves shown, so the right choice is known
  await page.locator(".tr-settings-open").click();
  for (const label of ["Order questions", "Book questions", "Show the moves"]) {
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
