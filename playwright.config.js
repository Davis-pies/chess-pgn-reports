import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

// Browser tests of the app as it is served: the same files, the same
// dev server, a real Chromium. Unit tests (tests/) cover the modules under
// jsdom; these cover what only a browser shows -- clicks on the board,
// keyboard navigation, file inputs, downloads, storage across reloads.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: "retain-on-failure",
  },
  // The phone project is a real phone's profile -- its screen, its pixel
  // density, touch instead of a mouse -- for the tests in *.phone.spec.mjs,
  // which tap, drag and swipe with a finger and check the phone layout.
  // Both run in Chromium, so CI still installs one browser.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /\.phone\.spec\.mjs$/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /\.phone\.spec\.mjs$/ },
  ],
  webServer: {
    command: `node tools/dev-server.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
