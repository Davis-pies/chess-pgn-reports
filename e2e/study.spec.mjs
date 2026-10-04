import { readFileSync } from "node:fs";
import { test, expect, loadPgn, playOnBoard, FIXTURE } from "./fixtures.mjs";

const NOTED = "1. e4 e5 2. Nf3 {Develops with tempo.} Nc6 (2... Nf6 3. d4 {The Petroff, then d4.}) 3. Bb5 a6";

const openStudy = async (page) => {
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await expect(page.locator(".st-window")).toBeVisible();
};
const at = (page) => page.locator(".st-moves .an-move.at");
const here = (page) => page.locator(".st-here");

test("the study steps through the workbook's lines with their notes", async ({ page }) => {
  await loadPgn(page, NOTED);
  await openStudy(page);
  await expect(page.locator(".st-name")).toHaveText("Mainline");
  await expect(here(page)).toHaveText("The start position.");
  // every note along the mainline is listed: the Petroff's is on another line
  await expect(page.locator(".st-note")).toHaveCount(1);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(at(page)).toHaveText(/2\.Nf3/);
  await expect(here(page)).toContainText("Develops with tempo.");
  await expect(page.locator(".st-note.here")).toContainText("Develops with tempo.");

  // the Petroff is another line through here; reading it shows its own note
  // the next line is the Petroff, read from where it is on the board
  await page.locator(".st-next").click();
  await expect(page.locator(".st-count")).toHaveText("1 of 1");
  await expect(page.locator(".st-note")).toHaveCount(2);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(at(page)).toHaveText(/3\.d4/);
  await expect(here(page)).toContainText("The Petroff, then d4.");
  await expect(here(page).locator("sup")).toHaveText("[2]");
});

test("moves of your own leave the book and come back, saving nothing", async ({ page }) => {
  await loadPgn(page, NOTED);
  const before = await page.locator(".tbl, table").first().innerText();
  await openStudy(page);
  await playOnBoard(page, "d2", "d4");
  await expect(page.locator(".st-name")).toHaveText("Your moves");
  await expect(page.locator(".st-off")).toContainText("Off the book from the start");
  await page.keyboard.press("b");
  await expect(page.locator(".st-name")).toHaveText("Mainline");
  await expect(at(page)).toHaveCount(0);

  // a book move follows the book
  await playOnBoard(page, "e2", "e4");
  await expect(page.locator(".st-name")).toHaveText("Mainline");
  await expect(at(page)).toHaveText("1.e4");

  await page.keyboard.press("Escape");
  await expect(page.locator(".st-window")).toHaveCount(0);
  expect(await page.locator(".tbl, table").first().innerText()).toBe(before);
});

test("the table's menu opens the study at a move", async ({ page }) => {
  await loadPgn(page, NOTED);
  await page.locator("td", { hasText: /d4/ }).first().click({ button: "right" });
  await page.getByRole("button", { name: "Study from here" }).click();
  await expect(page.locator(".st-window")).toBeVisible();
  await expect(at(page)).toHaveText(/3\.d4/);
  await expect(here(page)).toContainText("The Petroff, then d4.");
});

test("a real game reads in the study", async ({ page }) => {
  await loadPgn(page, readFileSync(FIXTURE, "utf8"));
  await openStudy(page);
  await page.keyboard.press("End");
  await expect(page.locator(".st-note").first()).toBeVisible();
  if (process.env.STUDY_SHOT) {
    await page.keyboard.press("Home");
    for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowRight");
    await page.screenshot({ path: process.env.STUDY_SHOT, fullPage: true });
  }
});

test("on a phone the board stays put while the notes scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadPgn(page, readFileSync(FIXTURE, "utf8"));
  await openStudy(page);
  for (let i = 0; i < 9; i++) await page.locator(".an-fwd").click();
  await expect(here(page)).toContainText("very solid development");
  const board = page.locator(".study .an-board");
  const before = await board.boundingBox();
  await page.locator(".st-window").evaluate((w) => (w.scrollTop = 600));
  const after = await board.boundingBox();
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  // the line switcher fits the width and still works
  const picker = await page.locator(".st-picker").boundingBox();
  expect(picker.x + picker.width).toBeLessThanOrEqual(390);
  await page.locator(".st-window").evaluate((w) => (w.scrollTop = 0));
  await page.locator(".st-next").click();
  await expect(page.locator(".st-name")).not.toHaveText("Mainline");
});

test("on a phone the engine's lines stay right under the board", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadPgn(page, readFileSync(FIXTURE, "utf8"));
  await openStudy(page);
  const off = await page.locator(".study .an-boardrow").boundingBox();
  await page.locator(".an-engine-toggle").click();
  await expect(page.locator(".an-engine-toggle")).toHaveText("Engine on");
  const board = await page.locator(".study .an-boardrow").boundingBox();
  expect(board.width).toBeCloseTo(off.width, 0);
  const box = page.locator(".study .an-engine");
  const before = await box.boundingBox();
  expect(before.y - (board.y + board.height)).toBeLessThan(16);
  // pinned with the board while the notes scroll
  await page.locator(".st-window").evaluate((w) => (w.scrollTop = 600));
  expect(Math.abs((await box.boundingBox()).y - before.y)).toBeLessThan(2);
});

// Sideways the board shrinks so the engine's lines fit under it, and they stay
// on screen however far the notes beside them are scrolled.
test("on a phone held sideways the engine's lines stay on screen under the board", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await loadPgn(page, readFileSync(FIXTURE, "utf8"));
  await openStudy(page);
  await page.locator(".an-engine-toggle").click();
  await expect(page.locator(".an-engine-toggle")).toHaveText("Engine on");
  for (const top of [0, 2000]) {
    await page.locator(".st-window").evaluate((w, t) => (w.scrollTop = t), top);
    const head = await page.locator(".st-window .an-head").boundingBox();
    const board = await page.locator(".study .an-boardrow").boundingBox();
    const lines = await page.locator(".study .an-pvs").boundingBox();
    expect(board.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
    expect(lines.y - (board.y + board.height)).toBeLessThan(60);
    expect(lines.y + lines.height).toBeLessThanOrEqual(375);
  }
});
