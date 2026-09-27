import { test, expect, loadPgn } from "./fixtures.mjs";

// The real lite Stockfish from vendor/, in a real Worker: the one part of the
// board jsdom cannot run at all.
test("the engine analyses the position and its move can be played", async ({ page }) => {
  await loadPgn(page);
  await page.getByRole("button", { name: "Analysis", exact: true }).click();
  const toggle = page.locator(".an-engine-toggle");
  await expect(toggle).toHaveText("Engine off");
  await expect(page.locator(".an-evalbar")).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveText("Engine on");
  await expect(page.locator(".an-engine-info")).toHaveText(/^depth \d+/, { timeout: 30_000 });
  await expect(page.locator(".an-evalbar")).toBeVisible();
  // The search keeps repainting its lines, so which move is first can change
  // under the click; what matters is that a click on it plays one.
  await page.locator(".an-pv:not(.empty) .an-pvmove").first().click();
  await expect(page.locator(".an-line.active .an-move")).toHaveText([/^1\.[A-Za-h]/]);
  await expect(page.locator(".an-status")).toHaveText("Black to move");

  // E switches it off again
  await page.locator(".analysis").focus();
  await page.keyboard.press("e");
  await expect(toggle).toHaveText("Engine off");
});
