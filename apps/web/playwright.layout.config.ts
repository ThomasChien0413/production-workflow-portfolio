import { defineConfig } from "@playwright/test";

// Run the same geometry regressions locally without an API, seed or database.
// The normal CI config also discovers them as part of the full E2E suite.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "layout-geometry.spec.ts",
  workers: 1,
  retries: 0,
  failOnFlakyTests: true,
  use: { browserName: "chromium" },
});
