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

// On a phone the engine's lines are pinned with the board: scrolling the rest
// of the analysis board away leaves both where they were.
test("on a phone the engine's lines stay pinned under the board", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadPgn(page);
  await page.getByRole("button", { name: "Analysis", exact: true }).click();
  const off = await page.locator(".an-boardrow").boundingBox();
  await page.locator(".an-engine-toggle").click();
  await expect(page.locator(".an-engine-toggle")).toHaveText("Engine on");
  // the board keeps its full width: the box under it is what stays small
  expect((await page.locator(".an-boardrow").boundingBox()).width).toBeCloseTo(off.width, 0);
  const lines = page.locator(".an-pvs");
  const before = await lines.boundingBox();
  const board = await page.locator(".an-boardrow").boundingBox();
  expect(before.y - (board.y + board.height)).toBeLessThan(60);
  await page.locator(".an-window").evaluate((w) => (w.scrollTop = 2000));
  expect(await page.locator(".an-window").evaluate((w) => w.scrollTop)).toBeGreaterThan(0);
  expect(Math.abs((await lines.boundingBox()).y - before.y)).toBeLessThan(2);
});

// sw.js makes the page cross-origin isolated, so the multi-threaded build runs
// and its thread count can be picked, and the pick outlives a reload.
test("the engine runs multi-threaded, with a thread count that is remembered", async ({ page }) => {
  const builds = [];
  page.on("request", (r) => {
    const m = r.url().match(/stockfish-19[^/#]*\.(js|wasm)/);
    if (m) builds.push(m[0]);
  });
  await loadPgn(page);
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
  await page.getByRole("button", { name: "Analysis", exact: true }).click();
  await page.locator(".an-engine-toggle").click();
  await expect(page.locator(".an-engine-info")).toHaveText(/^depth \d+/, { timeout: 30_000 });
  expect(builds).toContain("stockfish-19-lite.js");
  expect(builds).not.toContain("stockfish-19-lite-single.js");

  const threads = page.locator(".an-engine-threads");
  const cores = await page.evaluate(() => navigator.hardwareConcurrency);
  test.skip(cores < 2, "one core: there is no count to pick");
  await expect(threads.locator("option")).toHaveCount(cores);
  await threads.selectOption("2");
  // the search restarts on two threads and still reaches a depth
  await expect(page.locator(".an-engine-info")).toHaveText(/^depth \d+/, { timeout: 30_000 });
  await page.reload();
  await page.locator("#wK").waitFor({ state: "attached" });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ott-prefs")).engineThreads)).toBe(2);
});
