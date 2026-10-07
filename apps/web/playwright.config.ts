import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// The workflow setup writes its subpages straight to the database, so the
// Playwright process itself needs DATABASE_URL — not just the
// servers it starts. CI sets it in the job environment; locally it lives in the
// workspace .env, the same file every other script in this repo reads. Real
// environment variables still win: dotenv never overwrites what is already set.
loadEnv({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});

/**
 * End-to-end accessibility and responsive checks.
 *
 * Both servers are started by Playwright so a single command works locally and
 * in CI. The API needs DATABASE_URL: locally it comes from the workspace .env
 * via apps/api/src/load-env.ts, in CI from the job environment.
 *
 * Everything asserted here is a rule from DESIGN.md section 3 — WCAG 2.2 AA,
 * no page-level horizontal scrolling, and 44x44px interactive targets. There
 * are deliberately no pixel snapshots; see e2e/README.md for why.
 */
const webPort = 3100;
const apiPort = 3101;
const baseURL = `http://localhost:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: true,
  // Two workers locally. Both servers run under `next dev` / `tsx watch` on
  // the developer's machine, and at Playwright's default of half the CPUs the
  // compile-on-demand dev server fell behind: by 2026-09-26 a full local run
  // had 26 tests time out that all passed one at a time, and at two workers
  // the same suite passed 203 of 203. CI keeps the default, on the GitHub-hosted runner.
  // `--workers` on the command line still overrides this.
  ...(process.env.CI ? {} : { workers: 2 }),
  forbidOnly: Boolean(process.env.CI),
  // Retry once, and still fail the run.
  //
  // The retry is worth keeping: it separates a deterministic failure from an
  // intermittent one, and 'retain-on-failure' keeps the trace of the attempt
  // that failed. But a retry that turns the run green hides the defect it just
  // caught. Between 2026-08-11 and 2026-08-18 the sheet status badge could
  // render one state behind after a completion or an archive; it failed three
  // main runs outright and was silently retried away in two more, including the
  // 裁剪需求表 merge, which reported success. Two green ticks meant a live bug
  // nobody was looking at. A flaky test is now a red build.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  // The HTML report is what CI uploads alongside the traces; without it the
  // `github` reporter annotates the failing line and nothing else survives the
  // runner. `open: never` keeps it from trying to launch a browser there.
  // The JSON report is what scripts/operations/adopt-new-baselines.mjs reads
  // to tell a run that failed only on missing baselines from any other.
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        ["html", { open: "never" }],
        ["json", { outputFile: "playwright-results.json" }],
      ]
    : [["list"]],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Tight enough to catch a spacing or colour drift, loose enough to
      // survive text antialiasing. A whole-element diff of 0.2% is far more
      // than a rendering nicety and far less than anything a person would
      // call "the same screen".
      maxDiffPixelRatio: 0.002,
      // How different one pixel must be before it counts at all. Playwright
      // defaults to 0.2, and that default let a real change through: when
      // 大銀.直得 gained the grey heading row its worksheet prints, the mobile
      // baseline still passed. pixelmatch scores a pixel as
      // 0.5053*dY^2 + 0.299*dI^2 + 0.1957*dQ^2 and compares it against
      // 35215*threshold^2, so #d9d9d9 against white scores 730 against a
      // tolerance of 1409 — a shading change the suite could not see, on a
      // suite whose whole job is to catch a drift against the paper. At 0.1
      // the tolerance is 352, which sees it with room to spare; antialiasing
      // is excluded separately by pixelmatch, and maxDiffPixelRatio above
      // still absorbs a few stray pixels.
      threshold: 0.1,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  // Baselines are per platform because rasterisation is. CI is Linux and the
  // development machines are not, so the platform is in the path and only the
  // Linux set is committed — see e2e/README.md.
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{arg}{ext}",

  use: {
    baseURL,
    trace: "retain-on-failure",
    locale: "zh-Hant-TW",
    timezoneId: "Asia/Taipei",
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],

  webServer: [
    {
      command: "pnpm --filter @workflow/api dev",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      cwd: "../..",
      env: {
        API_PORT: String(apiPort),
        APP_ORIGIN: baseURL,
        // A key for browsers to subscribe with; nothing is actually pushed
        // in the suite (the worker does not run).
        WEB_PUSH_VAPID_PUBLIC_KEY:
          "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
      },
    },
    {
      command: `pnpm --filter @workflow/web dev --port ${webPort}`,
      url: `${baseURL}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      cwd: "../..",
      env: {
        API_ORIGIN: `http://127.0.0.1:${apiPort}`,
      },
    },
  ],
});
