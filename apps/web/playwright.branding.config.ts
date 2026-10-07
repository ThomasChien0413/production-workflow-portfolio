import { defineConfig } from "@playwright/test";

// The signed-out page needs no database or API. This separate suite preserves
// visual coverage of the new branding without altering the Linux form references.
export default defineConfig({
  testDir: "./branding",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  reporter: "list",
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{arg}{ext}",
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { threshold: 0.1, maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide", scale: "css" },
  },
  use: { baseURL: "http://localhost:3200", locale: "zh-Hant-TW", timezoneId: "Asia/Taipei" },
  webServer: {
    command: "pnpm --filter @workflow/web dev --port 3200",
    cwd: "../..",
    url: "http://localhost:3200/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { API_ORIGIN: "http://127.0.0.1:3201" },
  },
});
