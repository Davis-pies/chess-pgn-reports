import { readFileSync } from "node:fs";
import { test, expect, loadPgn, FIXTURE } from "./fixtures.mjs";

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
  // (the footnote keeps its place in the count: it is still Line 1 in the editor)
  await expect(page.locator(".pv-table th.var-head")).toHaveText([/^Mainline/, /^Line 2/]);
  await expect(page.locator('.pv-table tr[data-ply="4"] td.main')).toHaveText("Bb51");

  await page.getByRole("button", { name: "Lines (print)" }).click();
  await expect(page.locator(".pv-cards .card-name")).toHaveText(["Mainline", "Line 2"]);
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

// Branches sit latest-leaving first, as in print. A group folds by its move
// path, so clicking one opens that group in place and leaves the other shut.
test("a group in the table opens and folds in place", async ({ page }) => {
  await loadPgn(
    page,
    "1. e4 e5 (1... c5 2. Nf3 d6 3. d4 (3. Bb5+)) 2. Nf3 Nc6 (2... Nf6 3. Nxe5 (3. d4)) 3. Bb5",
  );
  const heads = page.locator(".pv-table th.var-head");
  await expect(heads).toHaveText([/^Mainline/, /2 lines/, /2 lines/]);
  // the later-leaving 2...Nf6 group comes first
  const row = (ply) => page.locator(`.pv-table tr[data-ply="${ply}"] td`);
  await expect(row(3).nth(1)).toHaveText("Nf6");
  // open the second group, the one through 1...c5
  await heads.nth(2).click();
  await expect(heads).toHaveCount(5);
  await expect(heads.nth(1)).toHaveText(/2 lines/);
  await expect(row(3).nth(1)).toHaveText("Nf6");
  await expect(row(4).nth(3)).toHaveText(/^(d4|Bb5\+)$/);
  await expect(row(4).nth(4)).toHaveText(/^(d4|Bb5\+)$/);
  // and fold it again
  await heads.nth(2).click();
  await expect(heads).toHaveCount(3);
});

test("a note's [n] scrolls the table to its move", async ({ page }) => {
  await loadPgn(page, readFileSync(FIXTURE, "utf8"));
  const note = page.locator(".notes .nt").filter({ hasText: "46.g6" });
  await note.scrollIntoViewIfNeeded();
  await note.locator(".note-jump").click();
  const cell = page.locator(".pv-table td.note-hit");
  await expect(cell).toHaveText(/^g6/);
  await expect(cell).toBeInViewport();
  await expect(cell).toBeFocused();
});

// Firefox ignores break-after: avoid, so the stem's own rule could not hold it
// to its table: a table kept whole went over a page break and left its stem
// behind. The block around the two is what is kept whole now.
test("a printed table and its stem are kept whole together", async ({ page }) => {
  await loadPgn(page);
  await page.evaluate(() => globalThis.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  const blocks = page.locator(".pv-htable .print-block");
  await expect(blocks.first().locator(".print-stem + table.tbl")).toHaveCount(1);
  const rules = await blocks.first().evaluate((b) => ({
    block: globalThis.getComputedStyle(b).breakInside,
    table: globalThis.getComputedStyle(b.querySelector("table.tbl")).breakInside,
  }));
  expect(rules).toEqual({ block: "avoid", table: "auto" });
});
