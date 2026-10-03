// Shared setup for the browser tests.
//
// index.html resolves "chess.js" through an importmap pointing at esm.sh.
// The tests answer that request from node_modules instead, so they run
// offline and cannot flake on a CDN. The installed chess.js is pinned to the
// same version the importmap names (tests/deps.test.mjs checks that).
import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const chessJs = readFileSync(
  fileURLToPath(new URL("../node_modules/chess.js/dist/esm/chess.js", import.meta.url)),
);

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("https://esm.sh/**", (route) =>
      route.fulfill({ body: chessJs, contentType: "text/javascript" }),
    );
    await use(page);
  },
});

export { expect };

export const FIXTURE = fileURLToPath(new URL("../tests/fixtures/capablanca.pgn", import.meta.url));

const SMALL_PGN = "1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4) 3. Bb5 (3. Bc4 Bc5) a6";

// Open the app and wait for its start-up to settle. A first visit reloads
// once, when sw.js takes over and makes the page cross-origin isolated, so
// that is waited for before anything else. app.js then fetches the piece
// sprite after the first render and renders again once it lands, which
// rebuilds the import panel: text typed into the PGN box before that is
// wiped, and Load & Tag then finds no moves. Waiting for the sprite puts
// every fill after that second render.
export async function openApp(page) {
  await page.goto("./");
  await page.waitForFunction(() => globalThis.crossOriginIsolated);
  await page.locator("#wK").waitFor({ state: "attached" });
}

// Paste a PGN into the import box and load it.
export async function loadPgn(page, pgn = SMALL_PGN) {
  await openApp(page);
  await page.locator("textarea.pgnin").fill(pgn);
  await page.getByRole("button", { name: "Load & Tag" }).click();
  await expect(page.locator(".toolbar")).toBeVisible();
}

// The centre of a square on the analysis board, in page pixels, for
// whichever way up the board is drawn. By position, since a piece drawn over
// a square is what the pointer or finger actually lands on.
export async function squarePoint(page, sq) {
  const board = page.locator(".an-board svg");
  const box = await board.boundingBox();
  const flipped = await board.evaluate((svg) => svg.closest(".an-board")._geom.flipped);
  const f = "abcdefgh".indexOf(sq[0]);
  const r = 8 - Number(sq[1]);
  const s = box.width / 8;
  const col = flipped ? 7 - f : f;
  const row = flipped ? 7 - r : r;
  return { x: box.x + col * s + s / 2, y: box.y + row * s + s / 2 };
}

// Click-click a move on the analysis board: the source square, then the
// target.
export async function playOnBoard(page, from, to) {
  for (const sq of [from, to]) {
    const { x, y } = await squarePoint(page, sq);
    await page.mouse.click(x, y);
  }
}

// Tap-tap a move with a finger. Needs a context with touch (the phone
// project).
export async function tapOnBoard(page, from, to) {
  for (const sq of [from, to]) {
    const { x, y } = await squarePoint(page, sq);
    await page.touchscreen.tap(x, y);
  }
}

// A finger put down at one point, slid to another in small steps and lifted.
// Playwright's touchscreen only taps, so the touches go in through the
// DevTools protocol: real touchstart/touchmove/touchend events, which the
// board's handlers see exactly as a phone sends them.
export async function slide(page, a, b, steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, p) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  await touch("touchStart", a);
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
  }
  await touch("touchEnd");
  await cdp.detach();
}

// Drag a piece from one square to another with a finger.
export async function dragOnBoard(page, from, to) {
  await slide(page, await squarePoint(page, from), await squarePoint(page, to));
}

// Swipe sideways across the board's empty middle: "left" steps forward,
// "right" steps back.
export async function swipeBoard(page, dir) {
  const a = await squarePoint(page, dir === "left" ? "g4" : "b4");
  const b = await squarePoint(page, dir === "left" ? "b4" : "g4");
  await slide(page, a, b);
}
