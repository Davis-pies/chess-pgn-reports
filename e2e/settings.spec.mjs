import { test, expect, openApp } from "./fixtures.mjs";

// The Settings button is a chip on the title's line, not a full-width bar.
test("the start screen's Settings button sits beside the theme button", async ({ page }) => {
  await openApp(page);
  const settings = page.locator(".panel > .settings > summary");
  const theme = page.locator(".panel > .chip").filter({ hasText: /theme$/ });
  const s = await settings.boundingBox();
  const t = await theme.boundingBox();
  expect(s.width).toBeLessThan(200);
  expect(Math.abs(s.y - t.y)).toBeLessThan(4);
});

test("the open Settings menu stays on screen on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openApp(page);
  await page.locator(".settings > summary").click();
  const box = await page.locator(".settings-body").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});
