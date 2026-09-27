import { test, expect, loadPgn } from "./fixtures.mjs";

test("the preview switches between the table and the print lines", async ({ page }) => {
  await loadPgn(page);
  await expect(page.locator(".pv-table")).toBeVisible();
  await expect(page.locator(".pv-cards")).toBeHidden();

  await page.getByRole("button", { name: "Lines (print)" }).click();
  await expect(page.locator(".pv-cards")).toBeVisible();
  await expect(page.locator(".pv-table")).toBeHidden();
  await expect(page.locator(".pv-cards .card-name")).toHaveText([/^Mainline/, /^Line 1/, /^Line 2/]);
  await expect(page.locator(".pv-cards .card").first().locator(".card-moves")).toHaveText(
    /1\. e4\s+e5\s+2\. Nf3\s+Nc6\s+3\. Bb5\s+a6/,
  );
});

test("hiding a line takes it out of the table and into the drawer", async ({ page }) => {
  await loadPgn(page);
  const group = page.locator(".markup details.lgroup").filter({ hasText: "3.Bc4" });
  await page.locator(".markup").getByRole("button", { name: "Expand all" }).click();
  await group.locator(".ledge button.hide").click();

  await expect(page.locator(".pv-table th.var-head")).toHaveText([/^Mainline/, /^Line 1/]);
  const drawer = page.locator(".hidden-drawer");
  const head = drawer.locator("summary.hd-head");
  await expect(head).toHaveText("Hidden (1)");

  await head.click();
  await drawer.getByRole("button", { name: "Show all" }).click();
  await expect(page.locator(".pv-table th.var-head")).toHaveCount(3);
  await expect(page.locator(".hidden-drawer")).toHaveCount(0);
});

test("a line tagged as a footnote becomes a numbered note on the mainline", async ({ page }) => {
  await loadPgn(page);
  const group = page.locator(".markup details.lgroup").filter({ hasText: "3.Bc4" });
  await page.locator(".markup").getByRole("button", { name: "Expand all" }).click();
  await group.locator(".ledge button.tag.foot").click();

  // out of the table's columns, and marked on the move it replaces
  await expect(page.locator(".pv-table th.var-head")).toHaveText([/^Mainline/, /^Line 1/]);
  await expect(page.locator('.pv-table tr[data-ply="4"] td.main')).toHaveText("Bb51");

  await page.getByRole("button", { name: "Lines (print)" }).click();
  await expect(page.locator(".pv-cards .card-name")).toHaveText(["Mainline", "Line 1"]);
  await expect(page.locator(".pv-cards .card").first()).toContainText("[1] 3.Bc4 Bc5");
});

test("renaming a line renames its table column", async ({ page }) => {
  await loadPgn(page);
  const group = page.locator(".markup details.lgroup").filter({ hasText: "2...Nf6" });
  await page.locator(".markup").getByRole("button", { name: "Expand all" }).click();
  const name = group.locator(".ledge input.ln");
  await name.fill("Two Knights");
  await name.press("Enter");
  await name.blur();
  await expect(page.locator(".pv-table th.var-head").filter({ hasText: "Two Knights" })).toHaveCount(1);
});

test("the dark theme sticks across a reload", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Light theme" })).toBeVisible();
});
