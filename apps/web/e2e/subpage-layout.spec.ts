import { chromium, expect, test } from "@playwright/test";
import { WORKFLOW_AUTH_FILES } from "./support";

/**
 * Moving between a subpage full of sheets and an empty one must not shift the
 * page sideways (the user, 2026-10-03). The long page grows a scrollbar and
 * the short one does not, so without a reserved gutter everything moved by
 * the scrollbar's width. Headless Chromium hides scrollbars, so this launches
 * one that draws them, as Chrome on Windows does.
 */
test("a page keeps its width whether or not it scrolls", async ({ baseURL }) => {
  const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    const context = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: WORKFLOW_AUTH_FILES.cutManager,
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.goto("/departments/cut");
    await page.waitForURL(/\/subpages\//);
    const header = page.locator(".cc-page__header");
    await expect(header).toBeVisible();
    const width = async () => {
      const box = await header.boundingBox();
      return [Math.round(box!.x), Math.round(box!.width)];
    };

    // Short enough not to scroll, then long enough to.
    await page.evaluate(() => document.querySelector("main")!.style.setProperty("min-height", "0"));
    await page.evaluate(() => { for (const el of document.querySelectorAll("main > :not(.cc-page__header)")) (el as HTMLElement).style.display = "none"; });
    const short = await width();
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(false);
    await page.evaluate(() => {
      const filler = document.createElement("div");
      filler.style.height = "3000px";
      document.querySelector("main")!.append(filler);
    });
    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);
    expect(await width()).toEqual(short);
  } finally {
    await browser.close();
  }
});
