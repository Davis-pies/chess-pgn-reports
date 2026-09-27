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

export const SMALL_PGN = "1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4) 3. Bb5 (3. Bc4 Bc5) a6";

// Open the app and wait for its start-up to settle. app.js fetches the piece
// sprite after the first render and renders again once it lands, which
// rebuilds the import panel: text typed into the PGN box before that is
// wiped, and Load & Tag then finds no moves. Waiting for the sprite puts
// every fill after that second render.
export async function openApp(page) {
  await page.goto("./");
  await page.locator("#wK").waitFor({ state: "attached" });
}

// Paste a PGN into the import box and load it.
export async function loadPgn(page, pgn = SMALL_PGN) {
  await openApp(page);
  await page.locator("textarea.pgnin").fill(pgn);
  await page.getByRole("button", { name: "Load & Tag" }).click();
  await expect(page.locator(".toolbar")).toBeVisible();
}

// Click-click a move on the analysis board: the source square, then the
// target. Clicked by position, since a piece drawn over a square is what the
// pointer actually lands on.
export async function playOnBoard(page, from, to) {
  const board = page.locator(".an-board svg");
  const box = await board.boundingBox();
  const flipped = await board.evaluate((svg) => svg.closest(".an-board")._geom.flipped);
  const at = (sq) => {
    const f = "abcdefgh".indexOf(sq[0]);
    const r = 8 - Number(sq[1]);
    const s = box.width / 8;
    const col = flipped ? 7 - f : f;
    const row = flipped ? 7 - r : r;
    return { x: box.x + col * s + s / 2, y: box.y + row * s + s / 2 };
  };
  for (const sq of [from, to]) {
    const { x, y } = at(sq);
    await page.mouse.click(x, y);
  }
}
