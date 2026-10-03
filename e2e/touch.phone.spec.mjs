import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import {
  test,
  expect,
  loadPgn,
  tapOnBoard,
  dragOnBoard,
  swipeBoard,
  slide,
  squarePoint,
  FIXTURE,
} from "./fixtures.mjs";

// The board and its layout on a phone, driven with a finger: the phone
// project runs these on a Pixel 7's profile (touch, no mouse, its screen).

const openBoard = async (page) => {
  await page.getByRole("button", { name: "Analysis", exact: true }).click();
  await expect(page.locator(".an-window")).toBeVisible();
};
const openStudy = async (page) => {
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await expect(page.locator(".st-window")).toBeVisible();
};
const engineOn = async (page) => {
  await page.locator(".an-engine-toggle").click();
  await expect(page.locator(".an-engine-toggle")).toHaveText("Engine on");
};
const activeMoves = (page) => page.locator(".an-line.active .an-move");
const anAt = (page) => page.locator(".an-line.active .an-move.at");
const stAt = (page) => page.locator(".st-moves .an-move.at");
const scrollTo = (page, sel, top) => page.locator(sel).evaluate((w, t) => (w.scrollTop = t), top);

// Nothing on the page is wider than the screen: a phone would scroll it
// sideways under the thumb.
async function fitsWidth(page, sel) {
  const { scroll, client } = await page
    .locator(sel)
    .evaluate((w) => ({ scroll: w.scrollWidth, client: w.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(client);
  expect(await page.locator("html").evaluate((h) => h.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize().width,
  );
}

test.describe("upright", () => {
  test("tapping a piece and then a square plays the move", async ({ page }) => {
    await loadPgn(page);
    await openBoard(page);
    await tapOnBoard(page, "e2", "e4");
    await expect(page.locator(".an-status")).toHaveText("Black to move");
    // a tap on a piece shows where it can go; a tap on another of your own
    // pieces picks that one up instead
    const { x, y } = await squarePoint(page, "g8");
    await page.touchscreen.tap(x, y);
    await expect(page.locator(".an-hint")).toHaveCount(2);
    await tapOnBoard(page, "b8", "c6");
    await expect(activeMoves(page)).toHaveText(["1.e4", "Nc6"]);
    // an illegal target drops the piece and plays nothing
    await tapOnBoard(page, "d2", "d5");
    await expect(page.locator(".an-hint")).toHaveCount(0);
    await expect(activeMoves(page)).toHaveCount(2);
  });

  test("dragging a piece with a finger plays the move", async ({ page }) => {
    await loadPgn(page);
    await openBoard(page);
    await dragOnBoard(page, "g1", "f3");
    await expect(activeMoves(page)).toHaveText(["1.Nf3"]);
    await dragOnBoard(page, "d7", "d5");
    await expect(activeMoves(page)).toHaveText(["1.Nf3", "d5"]);
    // dropped on a square it cannot reach, it goes back and nothing is played
    await dragOnBoard(page, "f3", "f5");
    await expect(activeMoves(page)).toHaveCount(2);
    await expect(page.locator(".an-board use.dragging")).toHaveCount(0);
    await expect(page.locator(".an-status")).toHaveText("White to move");
  });

  test("a drag on the board does not scroll the sheet under it", async ({ page }) => {
    await loadPgn(page, readFileSync(FIXTURE, "utf8"));
    await openBoard(page);
    await slide(page, await squarePoint(page, "c4"), await squarePoint(page, "c7"));
    expect(await page.locator(".an-window").evaluate((w) => w.scrollTop)).toBe(0);
  });

  test("swiping the analysis board steps through the line", async ({ page }) => {
    await loadPgn(page);
    await openBoard(page);
    await tapOnBoard(page, "e2", "e4");
    await tapOnBoard(page, "e7", "e5");
    await expect(anAt(page)).toHaveText("e5");
    await swipeBoard(page, "right");
    await expect(anAt(page)).toHaveText("1.e4");
    await swipeBoard(page, "right");
    await expect(anAt(page)).toHaveCount(0);
    await swipeBoard(page, "left");
    await swipeBoard(page, "left");
    await expect(anAt(page)).toHaveText("e5");
    // a mostly-upward stroke is not a swipe
    await slide(page, await squarePoint(page, "c4"), await squarePoint(page, "d6"));
    await expect(anAt(page)).toHaveText("e5");
  });

  test("swiping the study's board steps through the line", async ({ page }) => {
    await loadPgn(page);
    await openStudy(page);
    await swipeBoard(page, "left");
    await expect(stAt(page)).toHaveText("1.e4");
    await swipeBoard(page, "left");
    await swipeBoard(page, "left");
    await expect(stAt(page)).toHaveText("2.Nf3");
    await swipeBoard(page, "right");
    await expect(stAt(page)).toHaveText("e5");
  });

  test("the analysis board fills the screen and says to swipe", async ({ page }) => {
    await loadPgn(page);
    await openBoard(page);
    const win = await page.locator(".an-window").boundingBox();
    expect(win.width).toBe(page.viewportSize().width);
    // the board and its eval bar take the width, less the sheet's margins
    const row = await page.locator(".an-boardrow").boundingBox();
    expect(row.width).toBeGreaterThan(win.width - 30);
    await expect(page.locator(".analysis .an-touch-hint")).toBeVisible();
    await expect(page.locator(".an-keys")).toBeHidden();
    await fitsWidth(page, ".an-window");
  });

  test("engine lines are pinned under a full-width board on the analysis board", async ({ page }) => {
    await loadPgn(page);
    await openBoard(page);
    const off = await page.locator(".an-boardrow").boundingBox();
    await engineOn(page);
    await expect(page.locator(".an-engine-info")).toHaveText(/^depth \d+/, { timeout: 30_000 });
    const board = await page.locator(".an-boardrow").boundingBox();
    expect(board.width).toBeCloseTo(off.width, 0);
    const lines = page.locator(".an-pvs");
    const before = await lines.boundingBox();
    expect(before.y - (board.y + board.height)).toBeLessThan(60);
    expect(before.y + before.height).toBeLessThanOrEqual(page.viewportSize().height);
    await scrollTo(page, ".an-window", 2000);
    expect(Math.abs((await lines.boundingBox()).y - before.y)).toBeLessThan(2);
    await fitsWidth(page, ".an-window");
    // its moves still play with a finger
    const move = page.locator(".an-pv:not(.empty) .an-pvmove").first();
    const p = await move.boundingBox();
    await page.touchscreen.tap(p.x + p.width / 2, p.y + p.height / 2);
    await expect(activeMoves(page)).toHaveText([/^1\.[A-Za-h]/]);
  });

  test("engine lines are pinned under a full-width board in the study", async ({ page }) => {
    await loadPgn(page, readFileSync(FIXTURE, "utf8"));
    await openStudy(page);
    const off = await page.locator(".study .an-boardrow").boundingBox();
    await engineOn(page);
    const board = await page.locator(".study .an-boardrow").boundingBox();
    expect(board.width).toBeCloseTo(off.width, 0);
    const lines = page.locator(".study .an-pvs");
    const before = await lines.boundingBox();
    expect(before.y - (board.y + board.height)).toBeLessThan(60);
    expect(before.y + before.height).toBeLessThanOrEqual(page.viewportSize().height);
    await scrollTo(page, ".st-window", 2000);
    expect(Math.abs((await lines.boundingBox()).y - before.y)).toBeLessThan(2);
    await fitsWidth(page, ".st-window");
    // and the board still swipes with the engine on
    await scrollTo(page, ".st-window", 0);
    await swipeBoard(page, "left");
    await expect(stAt(page)).toHaveText("1.e4");
  });
});

test.describe("sideways", () => {
  // the same phone turned round: only its screen changes
  test.use({ viewport: devices["Pixel 7 landscape"].viewport, screen: devices["Pixel 7 landscape"].screen });

  // Board and lines both on screen at once, however far the panel beside
  // them is scrolled.
  for (const [name, open, win] of [
    ["the analysis board", openBoard, ".an-window"],
    ["the study", openStudy, ".st-window"],
  ]) {
    test(`engine lines stay on screen under the board on ${name}`, async ({ page }) => {
      await loadPgn(page, readFileSync(FIXTURE, "utf8"));
      await open(page);
      await engineOn(page);
      const h = page.viewportSize().height;
      for (const top of [0, 2000]) {
        await scrollTo(page, win, top);
        const head = await page.locator(`${win} .an-head`).boundingBox();
        const board = await page.locator(".an-boardrow").boundingBox();
        const lines = await page.locator(".an-pvs").boundingBox();
        expect(board.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
        // the box's head between them: one row in the study, two on the
        // analysis board (Go deeper wraps under the toggle)
        expect(lines.y - (board.y + board.height)).toBeLessThan(100);
        expect(lines.y + lines.height).toBeLessThanOrEqual(h);
      }
      await fitsWidth(page, win);
    });
  }

  // With the engine off, the board, its toggle, whose move it is and the
  // steppers all fit on a 360px-tall screen without scrolling.
  for (const [name, open] of [
    ["the analysis board", openBoard],
    ["the study", openStudy],
  ]) {
    test(`the board and its steppers fit the height on ${name}`, async ({ page }) => {
      await loadPgn(page, readFileSync(FIXTURE, "utf8"));
      await open(page);
      const h = page.viewportSize().height;
      const board = await page.locator(".an-board svg").boundingBox();
      expect(board.y + board.height).toBeLessThanOrEqual(h);
      expect(board.height).toBeGreaterThan(150);
      for (const sel of [".an-back", ".an-fwd", ".an-engine-toggle"]) {
        const b = await page.locator(sel).boundingBox();
        expect(b.y + b.height, sel).toBeLessThanOrEqual(h);
      }
    });
  }

  test("the board plays by drag, tap and swipe", async ({ page }) => {
    await loadPgn(page);
    await openBoard(page);
    await dragOnBoard(page, "e2", "e4");
    await tapOnBoard(page, "c7", "c5");
    await expect(activeMoves(page)).toHaveText(["1.e4", "c5"]);
    await swipeBoard(page, "right");
    await expect(anAt(page)).toHaveText("1.e4");
    await fitsWidth(page, ".an-window");
  });
});
