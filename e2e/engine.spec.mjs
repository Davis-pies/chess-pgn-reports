import { test, expect, loadPgn, SMALL_PGN } from "./fixtures.mjs";

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

// sw.js makes the page cross-origin isolated. A first visit is not: the page
// registers the worker, reloads once when it takes over, and is isolated
// after that reload.
test("a first visit reloads once and comes back cross-origin isolated", async ({ page }) => {
  // each document that starts in this tab notes whether it was isolated
  await page.addInitScript(() => {
    const seen = JSON.parse(sessionStorage.getItem("seen") || "[]");
    seen.push(globalThis.crossOriginIsolated);
    sessionStorage.setItem("seen", JSON.stringify(seen));
  });
  const seen = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("seen")));
  await page.goto("./");
  await page.waitForFunction(() => globalThis.crossOriginIsolated);
  await page.locator("#wK").waitFor({ state: "attached" });
  expect(await seen()).toEqual([false, true]);
  expect(await page.evaluate(() => sessionStorage.getItem("coi-reloaded"))).toBe("1");
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // later loads are isolated from the start, with no second reload
  await page.reload();
  await page.locator("#wK").waitFor({ state: "attached" });
  expect(await seen()).toEqual([false, true, true]);
});

// Records every UCI command the page sends its engine worker.
const recordUci = (page) =>
  page.addInitScript(() => {
    globalThis.__uci = [];
    const proto = globalThis.Worker.prototype;
    const post = proto.postMessage;
    proto.postMessage = function (m) {
      if (typeof m === "string") globalThis.__uci.push(m);
      return post.call(this, m);
    };
  });

// On the isolated page the multi-threaded build runs, starts on the count
// picked for this machine, and takes a new count from the menu at once.
test("the engine runs multi-threaded, with a thread count that takes effect and is remembered", async ({ page }) => {
  const builds = [];
  page.on("request", (r) => {
    const m = r.url().match(/stockfish-19[^/#]*\.(js|wasm)/);
    if (m) builds.push(m[0]);
  });
  await recordUci(page);
  await loadPgn(page);
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
  await page.getByRole("button", { name: "Analysis", exact: true }).click();
  await page.locator(".an-engine-toggle").click();
  await expect(page.locator(".an-engine-info")).toHaveText(/^depth \d+/, { timeout: 30_000 });
  expect(builds).toContain("stockfish-19-lite.js");
  expect(builds).toContain("stockfish-19-lite.wasm");
  expect(builds).not.toContain("stockfish-19-lite-single.js");

  const cores = await page.evaluate(() => navigator.hardwareConcurrency);
  const start = Math.max(1, Math.min(4, cores - 1));
  const uci = () => page.evaluate(() => globalThis.__uci);
  expect(await uci()).toContain(`setoption name Threads value ${start}`);

  test.skip(cores < 2, "one core: there is no count to pick");
  const threads = page.locator(".an-engine-threads");
  await expect(threads.locator("option")).toHaveCount(cores);
  await expect(threads).toHaveValue(String(start));
  const pick = start === 2 ? "1" : "2";
  await threads.selectOption(pick);
  // the running search is stopped, the count sent, and the search restarted
  await expect.poll(async () => (await uci()).slice(-4).join("|")).toMatch(
    new RegExp(`stop\\|setoption name Threads value ${pick}\\|position fen .+\\|go depth \\d+`),
  );
  await expect(page.locator(".an-engine-info")).toHaveText(/^depth \d+/, { timeout: 30_000 });
  await page.reload();
  await page.locator("#wK").waitFor({ state: "attached" });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ott-prefs")).engineThreads)).toBe(Number(pick));
});

// Without a service worker (blocked, as in some private windows) the page is
// never isolated: no reload, the single-threaded build, no thread menu.
test.describe("without a service worker", () => {
  test.use({ serviceWorkers: "block" });
  test("the engine falls back to the single-threaded build", async ({ page }) => {
    const builds = [];
    page.on("request", (r) => {
      const m = r.url().match(/stockfish-19[^/#]*\.(js|wasm)/);
      if (m) builds.push(m[0]);
    });
    await recordUci(page);
    await page.goto("./");
    await page.locator("#wK").waitFor({ state: "attached" });
    await page.locator("textarea.pgnin").fill(SMALL_PGN);
    await page.getByRole("button", { name: "Load & Tag" }).click();
    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(false);
    await page.getByRole("button", { name: "Analysis", exact: true }).click();
    await page.locator(".an-engine-toggle").click();
    await expect(page.locator(".an-engine-info")).toHaveText(/^depth \d+/, { timeout: 30_000 });
    expect(builds).toContain("stockfish-19-lite-single.js");
    expect(builds).not.toContain("stockfish-19-lite.js");
    await expect(page.locator(".an-engine-threads")).toHaveCount(0);
    expect((await page.evaluate(() => globalThis.__uci)).some((c) => c.includes("Threads"))).toBe(false);
  });
});

// The repertoire audit runs real engines of its own, in the background: the
// study opens and is used while it searches, and its findings link back to
// the board.
test("the audit searches every position while the study stays usable", async ({ page }) => {
  await loadPgn(page);
  await page.locator(".audit-toggle").click();
  await expect(page.locator(".audit-status")).toHaveText(/each of the workbook's 11 positions/);
  await page.locator(".audit-run").click();
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await page.locator(".study").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".st-window")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".audit-status")).toHaveText("All 11 positions searched at depth 16.", { timeout: 60_000 });
  await expect(page.locator(".audit-toggle")).toHaveText("Audit");
  await expect(page.locator(".audit-sum")).toBeVisible();
  await page.locator(".audit-ends summary").click();
  await expect(page.locator(".audit-ends .audit-row")).toHaveCount(3);
  await expect(page.locator(".audit-ends .audit-evals").first()).toHaveText(/^[+−]?\d+\.\d\d$|^#/);
  await page.locator(".audit-ends .audit-study").first().click();
  await expect(page.locator(".st-window")).toBeVisible();

  // kept in the browser by position: on a fresh page nothing is left to search
  await loadPgn(page);
  await page.locator(".audit-toggle").click();
  await expect(page.locator(".audit-status")).toHaveText("All 11 positions searched at depth 16.");
  await expect(page.locator(".audit-run")).toHaveCount(0);
});
