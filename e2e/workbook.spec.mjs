import { readFile } from "node:fs/promises";
import { test, expect, loadPgn, playOnBoard } from "./fixtures.mjs";

test("a saved workbook survives a reload and reopens with its edits", async ({ page }) => {
  await loadPgn(page);
  await page.locator(".toolbar input.name").fill("Ruy Lopez");
  await page.locator(".markup").getByRole("button", { name: "Expand all" }).click();
  const group = page.locator(".markup details.lgroup").filter({ hasText: "3.Bc4" });
  await group.locator(".ledge input.ln").fill("Italian");
  await group.locator(".ledge input.ln").blur();
  await expect(page.locator(".pv-table th.var-head")).toHaveText([/^Mainline/, /^Line 1/, /^Italian/]);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved ✓" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Open: Ruy Lopez" }).click();
  await expect(page.locator(".toolbar input.name")).toHaveValue("Ruy Lopez");
  await expect(page.locator(".pv-table th.var-head")).toHaveText([/^Mainline/, /^Line 1/, /^Italian/]);
});

test("a saved workbook can be deleted from the list", async ({ page }) => {
  await loadPgn(page);
  await page.locator(".toolbar input.name").fill("Scratch");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "New / Import" }).click();

  const entry = page.locator(".notebooks span").filter({ hasText: "Open: Scratch" });
  page.once("dialog", (d) => d.accept());
  await entry.getByRole("button", { name: "✕" }).click();
  await expect(entry).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Open: Scratch" })).toHaveCount(0);
});

test("a workbook saved to a file opens again from that file", async ({ page }) => {
  await loadPgn(page);
  // analysis in progress travels with the workbook
  await page.getByRole("button", { name: "Analysis", exact: true }).click();
  await playOnBoard(page, "d2", "d4");
  await page.keyboard.press("Escape");

  page.once("dialog", (d) => d.accept("My Repertoire"));
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save to file" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.json$/);
  const path = await file.path();
  const saved = JSON.parse(await readFile(path, "utf8"));
  expect(saved.name).toBe("My Repertoire");

  await page.getByRole("button", { name: "New / Import" }).click();
  await page.locator("input.wbin").setInputFiles(path);
  await expect(page.locator(".toolbar input.name")).toHaveValue("My Repertoire");
  await expect(page.locator(".pv-table th.var-head")).toHaveCount(3);
  await page.getByRole("button", { name: "Analysis", exact: true }).click();
  await expect(page.locator(".an-line.active .an-move")).toHaveText(["1.d4"]);
});

test("Export PGN downloads every line", async ({ page }) => {
  await loadPgn(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PGN" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pgn$/);
  const pgn = await readFile(await file.path(), "utf8");
  for (const san of ["e4", "Bb5", "Nf6", "d4", "Bc4", "Bc5"]) expect(pgn).toContain(san);
});

test("Update PGN previews what changes, then applies it", async ({ page }) => {
  await loadPgn(page);
  await page.getByRole("button", { name: "Update PGN…" }).click();
  const dialog = page.locator("#updpgn");
  const apply = dialog.getByRole("button", { name: "Apply" });
  await expect(apply).toBeDisabled();

  // drops the Bc4 line, adds a Sicilian
  await dialog.locator("textarea").fill("1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 (2... Nf6 3. d4) 3. Bb5 a6");
  const counts = dialog.locator(".mergecounts li");
  await expect(counts).toContainText(["2 lines unchanged", "1 new lines", "1 lines no longer present"]);
  await expect(dialog.locator(".warn")).toContainText("1 line will be removed");

  await apply.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".pv-table th.var-head")).toHaveCount(3);
  await expect(page.locator(".pv-table")).toContainText("c5");
  await expect(page.locator(".pv-table")).not.toContainText("Bc4");
});

test("Update PGN can be cancelled without touching the workbook", async ({ page }) => {
  await loadPgn(page);
  await page.getByRole("button", { name: "Update PGN…" }).click();
  await page.locator("#updpgn textarea").fill("1. d4 d5");
  await expect(page.locator("#updpgn .mergecounts")).toBeVisible();
  await page.locator("#updpgn").getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#updpgn")).toHaveCount(0);
  await expect(page.locator(".pv-table td.main").first()).toHaveText("e4");
});
