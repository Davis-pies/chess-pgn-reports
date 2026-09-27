import { test, expect, loadPgn, FIXTURE } from "./fixtures.mjs";

test("pasted PGN opens as a table with one column per line", async ({ page }) => {
  await loadPgn(page);
  const heads = page.locator(".pv-table th.var-head");
  await expect(heads).toHaveText([/^Mainline/, /^Line 1/, /^Line 2/]);
  // the mainline column reads down the plies
  await expect(page.locator(".pv-table td.main")).toHaveText(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
  // where each sideline leaves it
  await expect(page.locator('.pv-table tr[data-ply="3"] td.sideline')).toHaveText("Nf6");
  await expect(page.locator('.pv-table tr[data-ply="4"] td.sideline')).toHaveText(["d4", "Bc4"]);
});

test("a PGN file loads straight into the report", async ({ page }) => {
  await page.goto("./");
  await page.locator("input.filein").setInputFiles(FIXTURE);
  await expect(page.locator(".toolbar")).toBeVisible();
  await expect(page.locator(".pv-table td.main").first()).toHaveText("e4");
  // Capablanca–Burn carries its side variations as lines of their own
  expect(await page.locator(".pv-table th.var-head").count()).toBeGreaterThan(1);
});

test("a PGN with no moves is refused and the import panel stays", async ({ page }) => {
  await page.goto("./");
  const dialog = page.waitForEvent("dialog");
  await page.locator("textarea.pgnin").fill('[Event "empty"]\n\n*');
  await page.getByRole("button", { name: "Load & Tag" }).click();
  const d = await dialog;
  expect(d.message()).toBe("No moves found in PGN");
  await d.dismiss();
  await expect(page.locator("textarea.pgnin")).toBeVisible();
  await expect(page.locator(".toolbar")).toHaveCount(0);
});

test("New / Import goes back to an empty import panel", async ({ page }) => {
  await loadPgn(page);
  await page.getByRole("button", { name: "New / Import" }).click();
  await expect(page.locator("textarea.pgnin")).toHaveValue("");
  await expect(page.locator(".pv-table")).toHaveCount(0);
});
