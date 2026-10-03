// The ways a position or a table leaves the app: the analysis panel's copy and
// save buttons, and the report's copy buttons. The unit tests check the text
// each one builds; these check that it really reaches the clipboard or a
// downloaded file in a browser.
import { readFile } from "node:fs/promises";
import { Chess } from "chess.js";
import { test, expect, loadPgn, playOnBoard } from "./fixtures.mjs";

const AFTER_C5 = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

// The analysis board after 1.e4 c5.
async function boardAfterC5(page) {
  await loadPgn(page);
  await page.getByRole("button", { name: "Analysis", exact: true }).click();
  await expect(page.locator(".an-window")).toBeVisible();
  await playOnBoard(page, "e2", "e4");
  await playOnBoard(page, "c7", "c5");
  await expect(page.locator(".an-line.active .an-move")).toHaveText(["1.e4", "c5"]);
}

const grant = (context) => context.grantPermissions(["clipboard-read", "clipboard-write"]);
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
const msg = (page) => page.locator(".an-msg");

async function save(page, cls) {
  const download = page.waitForEvent("download");
  await page.locator(".an-share ." + cls).click();
  const file = await download;
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}

test("Copy FEN puts the position on the clipboard", async ({ page, context }) => {
  await grant(context);
  await boardAfterC5(page);
  await page.locator(".an-share .an-copy-fen").click();
  await expect(msg(page)).toHaveText("FEN copied.");
  expect(await clipboard(page)).toBe(AFTER_C5);
});

test("Copy PGN puts every line on the clipboard, the first as the main line", async ({ page, context }) => {
  await grant(context);
  await boardAfterC5(page);
  // a second line: back to 1.e4, then 1...e5, then back to 1.e4, where both
  // lines are on view ("every line here")
  await page.keyboard.press("ArrowLeft");
  await playOnBoard(page, "e7", "e5");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".an-line")).toHaveCount(2);
  await page.locator(".an-share .an-copy-pgn").click();
  await expect(msg(page)).toHaveText("PGN copied.");

  const text = await clipboard(page);
  const game = new Chess();
  game.loadPgn(text);
  expect(game.history()).toEqual(["e4", "c5"]);
  expect(text).toMatch(/\(1\.\.\. e5\)/);
});

test("with the clipboard refused, the text is shown to copy by hand", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await boardAfterC5(page);
  await page.locator(".an-share .an-copy-fen").click();
  await expect(msg(page)).toHaveText(AFTER_C5);
});

test("Save PGN downloads the lines as a file named after the position", async ({ page }) => {
  await boardAfterC5(page);
  const { name, bytes } = await save(page, "an-save-pgn");
  expect(name).toBe("after-1b-c5.pgn");
  const game = new Chess();
  game.loadPgn(bytes.toString("utf8"));
  expect(game.history()).toEqual(["e4", "c5"]);
});

test("Save SVG downloads a board that draws on its own", async ({ page }) => {
  await boardAfterC5(page);
  const { name, bytes } = await save(page, "an-save-svg");
  expect(name).toBe("after-1b-c5.svg");
  const svg = bytes.toString("utf8");
  expect(svg).toMatch(/^<svg[^>]* xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  // the pieces come with the file rather than from the page's sprite
  expect((svg.match(/<use /g) || []).length).toBe(32);
  for (const id of ["wK", "bK", "wP", "bP"]) expect(svg).toContain(`<symbol id="${id}"`);

  // as an image of its own, with no page sprite in reach, it still loads
  const size = await page.evaluate(async (text) => {
    const img = new globalThis.Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, svg);
  expect(size).toEqual([480, 480]);
});

test("Save PNG downloads the board as a 480px image", async ({ page }) => {
  await boardAfterC5(page);
  const { name, bytes } = await save(page, "an-save-png");
  expect(name).toBe("after-1b-c5.png");
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  // the IHDR chunk's width and height
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([480, 480]);

  // the pieces are painted, not just the squares: a square with a piece on
  // it differs from an empty square of the same colour
  const differs = await page.evaluate(async (b64) => {
    const img = new globalThis.Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = globalThis.document.createElement("canvas");
    c.width = c.height = 480;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    // centre of a square, white at the bottom
    const px = (sq) => {
      const f = "abcdefgh".indexOf(sq[0]);
      const r = 8 - Number(sq[1]);
      return [...ctx.getImageData(f * 60 + 30, r * 60 + 30, 1, 1).data].join();
    };
    // d2 (pawn) and d4 (empty) are both light squares
    return px("d2") !== px("d4");
  }, bytes.toString("base64"));
  expect(differs).toBe(true);
});

test("the report's copy buttons put the PGN and the Markdown on the clipboard", async ({ page, context }) => {
  await grant(context);
  await loadPgn(page);
  // by text, not accessible name: the name changes while "Copied ✓" shows
  const copyPgn = page.locator(".export button", { hasText: "Copy PGN" });
  await copyPgn.click();
  await expect(page.locator(".export button", { hasText: "Copied ✓" })).toHaveCount(1);
  const pgn = await clipboard(page);
  for (const san of ["e4", "Bb5", "Nf6", "d4", "Bc4", "Bc5"]) expect(pgn).toContain(san);

  const copyReport = page.locator(".export button").nth(4);
  await expect(copyReport).toHaveText("Copy report");
  await copyReport.click();
  await expect(copyReport).toHaveText("Copied ✓");
  const md = await clipboard(page);
  expect(md).toContain("## Lines");
  expect(md).toContain("1. e4  e5  2. Nf3  Nc6  3. Bb5  a6");
  // the same text Export Markdown saves
  const download = page.waitForEvent("download");
  await page.locator(".export button", { hasText: "Export Markdown" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.md$/);
  expect(await readFile(await file.path(), "utf8")).toBe(md);
  // the label comes back
  await expect(copyReport).toHaveText("Copy report");
});
