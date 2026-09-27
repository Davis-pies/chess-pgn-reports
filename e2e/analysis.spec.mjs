import { test, expect, loadPgn, playOnBoard } from "./fixtures.mjs";

const openBoard = async (page) => {
  await page.getByRole("button", { name: "Analysis", exact: true }).click();
  await expect(page.locator(".an-window")).toBeVisible();
};
const status = (page) => page.locator(".an-status");
const activeMoves = (page) => page.locator(".an-line.active .an-move");

test("moves played on the board build an analysis line", async ({ page }) => {
  await loadPgn(page);
  await openBoard(page);
  await expect(status(page)).toHaveText("White to move");

  await playOnBoard(page, "e2", "e4");
  await expect(status(page)).toHaveText("Black to move");
  await playOnBoard(page, "c7", "c5");
  await playOnBoard(page, "g1", "f3");

  await expect(activeMoves(page)).toHaveText(["1.e4", "c5", "2.Nf3"]);
  await expect(page.locator(".an-sec").first()).toHaveText("Analysis lines (1)");
  // an illegal move is not played
  await playOnBoard(page, "e8", "e6");
  await expect(activeMoves(page)).toHaveCount(3);
});

test("the arrow keys, Home/End and the buttons step through the line", async ({ page }) => {
  await loadPgn(page);
  await openBoard(page);
  await playOnBoard(page, "e2", "e4");
  await playOnBoard(page, "e7", "e5");
  await playOnBoard(page, "g1", "f3");
  const at = page.locator(".an-line.active .an-move.at");
  await expect(at).toHaveText("2.Nf3");

  await page.keyboard.press("ArrowLeft");
  await expect(at).toHaveText("e5");
  await expect(status(page)).toHaveText("White to move");
  await page.keyboard.press("Home");
  await expect(at).toHaveCount(0);
  await expect(page.locator(".an-back")).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(at).toHaveText("1.e4");
  await page.keyboard.press("End");
  await expect(at).toHaveText("2.Nf3");
  await expect(page.locator(".an-fwd")).toBeDisabled();

  await page.locator(".an-start").click();
  await expect(at).toHaveCount(0);
  await page.locator(".an-fwd").click();
  await page.locator(".an-fwd").click();
  await expect(at).toHaveText("e5");
  await page.locator(".an-end").click();
  await expect(at).toHaveText("2.Nf3");

  // clicking a move in the list jumps there
  await page.locator(".an-line.active .an-move", { hasText: "1.e4" }).click();
  await expect(at).toHaveText("1.e4");
});

test("playing from an earlier position branches a second line", async ({ page }) => {
  await loadPgn(page);
  await openBoard(page);
  await playOnBoard(page, "e2", "e4");
  await playOnBoard(page, "e7", "e5");
  await page.keyboard.press("ArrowLeft");
  await playOnBoard(page, "c7", "c5");

  await expect(activeMoves(page)).toHaveText(["1.e4", "c5"]);
  // the list follows the position: 1...e5 no longer passes through it
  await expect(page.locator(".an-line")).toHaveCount(1);
  await page.getByRole("button", { name: "1 more elsewhere — show" }).click();
  await expect(page.locator(".an-line")).toHaveCount(2);
  await expect(page.locator(".an-line.elsewhere .an-move").last()).toHaveText("e5");
});

test("flip turns the board round", async ({ page }) => {
  await loadPgn(page);
  await openBoard(page);
  await expect(page.locator(".an-evalbar")).not.toHaveClass(/flipped/);
  await page.locator(".an-flip").click();
  await expect(page.locator(".an-evalbar")).toHaveClass(/flipped/);
  // squares are still found where a flipped board draws them
  await playOnBoard(page, "d2", "d4");
  await expect(activeMoves(page)).toHaveText(["1.d4"]);
});

test("the workbook's lines through the position follow the board", async ({ page }) => {
  await loadPgn(page);
  await openBoard(page);
  const wb = page.locator(".an-wb");
  await expect(wb.locator(".an-sec")).toHaveText("Workbook lines (3)");

  await playOnBoard(page, "e2", "e4");
  await playOnBoard(page, "e7", "e5");
  await playOnBoard(page, "g1", "f3");
  await playOnBoard(page, "g8", "f6");
  await expect(wb.locator(".an-sec")).toHaveText("Workbook lines through 2...Nf6 (1)");
  await expect(wb.locator(".an-wb-line.active")).toHaveCount(1);

  // off the workbook entirely
  await playOnBoard(page, "b1", "c3");
  await expect(wb.locator(".an-sec")).toHaveText("Workbook lines through 3.Nc3 (0)");
  await expect(wb).toContainText("None: this position is new to the workbook.");
});

test("a click on a workbook move plays that line up to it", async ({ page }) => {
  await loadPgn(page);
  await openBoard(page);
  const bc4 = page.locator(".an-wb-line").filter({ hasText: "Bc4" });
  await bc4.locator(".an-move", { hasText: "Bc5" }).click();
  await expect(activeMoves(page)).toHaveText(["1.e4", "e5", "2.Nf3", "Nc6", "3.Bc4", "Bc5"]);
  await expect(status(page)).toHaveText("White to move");
});

test("an analysis line added to the notebook shows up in the report", async ({ page }) => {
  await loadPgn(page);
  await openBoard(page);
  await playOnBoard(page, "e2", "e4");
  await playOnBoard(page, "c7", "c5");
  await page.locator(".an-line.active .an-add").click();

  // adding closes the board and lands back on the report
  await expect(page.locator(".an-window")).toHaveCount(0);
  await expect(page.locator(".pv-table th.var-head")).toHaveCount(4);
  await expect(page.locator('.pv-table tr[data-ply="1"] td.sideline')).toHaveText("c5");

  // reopened, the board knows the notebook has it
  await openBoard(page);
  await expect(page.locator(".an-line.active .an-badge")).toHaveText("in notebook");
});

test("a line the notebook already has is refused", async ({ page }) => {
  await loadPgn(page);
  await openBoard(page);
  await page.locator(".an-wb-line").first().locator(".an-move").last().click();
  // the workbook's own mainline, played out move for move
  await expect(page.locator(".an-line.active .an-badge")).toHaveText("in notebook");
  await page.getByRole("button", { name: "Add all lines on view" }).click();
  await expect(page.locator(".an-msg")).toHaveText(
    "Nothing added: every line is empty or already in the notebook.",
  );
  await expect(page.locator(".an-window")).toBeVisible();
});

test("the board keeps its lines when closed and reopened", async ({ page }) => {
  await loadPgn(page);
  await openBoard(page);
  await playOnBoard(page, "d2", "d4");
  await page.keyboard.press("Escape");
  await expect(page.locator(".an-window")).toHaveCount(0);

  await openBoard(page);
  await expect(activeMoves(page)).toHaveText(["1.d4"]);
  await page.locator(".an-close").click();
  await expect(page.locator(".an-window")).toHaveCount(0);
});

test("a deleted line comes back with undo", async ({ page }) => {
  await loadPgn(page);
  await openBoard(page);
  await playOnBoard(page, "d2", "d4");
  // from the start, so nothing of the line is left standing at the cursor
  await page.keyboard.press("Home");
  await page.locator(".an-line.active .an-del").click();
  await expect(page.locator(".an-line .an-move")).toHaveCount(0);
  await page.locator(".an-undo").click();
  await expect(activeMoves(page)).toHaveText(["1.d4"]);
});

test("a notebook can be started from a board with no PGN", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Start from a board" }).click();
  await expect(page.locator(".an-window")).toBeVisible();
  await playOnBoard(page, "e2", "e4");
  await playOnBoard(page, "e7", "e5");
  await page.locator(".an-line.active .an-add").click();

  await expect(page.locator(".toolbar")).toBeVisible();
  await expect(page.locator(".pv-table th.var-head")).toHaveText([/^Mainline/]);
  await expect(page.locator(".pv-table td.main")).toHaveText(["e4", "e5"]);
});

test("a note written on the board is saved to the notebook's move", async ({ page }) => {
  await loadPgn(page);
  await openBoard(page);
  await page.locator(".an-wb-line").first().locator(".an-move", { hasText: "e4" }).click();
  await expect(page.locator(".an-right")).toContainText("Note on 1.e4");
  await expect(page.locator(".an-note-nb")).toHaveCount(0); // nothing to differ yet
  await page.locator(".an-right .cedit input.lno").first().fill("The king's pawn.");
  await page.getByRole("button", { name: "Save note to notebook" }).click();
  await expect(page.locator(".an-note-msg")).toHaveText("Note saved to the notebook.");
  await expect(page.locator(".an-note-nb")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.locator(".notes")).toContainText("The king's pawn.");
});
