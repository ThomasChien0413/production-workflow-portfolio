import { expect, test } from "@playwright/test";
import { WORKFLOW_AUTH_FILES } from "./support";

/**
 * Below 1024px the menu opens over the page from under the top bar, so the
 * page does not move (the user, 2026-10-03). Tapping the dimmed page beside
 * it closes it, as do the toggle and Escape. From 1024px it is the sidebar.
 */
test.describe("main navigation", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.cutOrderTaker });

  test("opens over the page on a phone, and closes from beside it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const heading = page.getByRole("heading", { level: 1 }).first();
    await expect(heading).toBeVisible();
    const toggle = page.getByRole("button", { name: "開啟主選單" });
    await expect(toggle).toBeEnabled();
    const before = (await heading.boundingBox())!;

    await toggle.click();
    const nav = page.getByRole("navigation", { name: "主導覽" });
    await expect(nav).toBeVisible();
    await expect(page.getByRole("button", { name: "關閉主選單" })).toHaveAttribute("aria-expanded", "true");
    // The page underneath has not moved.
    expect((await heading.boundingBox())!.y).toBe(before.y);
    // The menu floats over the page, from under the top bar, at the left.
    const panel = (await nav.boundingBox())!;
    expect(panel.x).toBe(0);
    expect(panel.y).toBe((await page.locator(".cc-shell__topbar").boundingBox())!.height);
    expect(panel.width).toBeLessThan(390);

    // Tapping the dimmed page beside the menu closes it. (Clear of the
    // right edge, which the app keeps for a scrollbar on screens that have one.)
    await page.mouse.click(350, 600);
    await expect(nav).toBeHidden();

    // Escape closes it too.
    await toggle.click();
    await expect(nav).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(nav).toBeHidden();
  });

  test("is a sidebar on a desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "主導覽" });
    await expect(nav).toBeVisible();
    await expect(page.getByRole("button", { name: "開啟主選單" })).toBeHidden();
    await expect(page.locator(".cc-shell__scrim")).toHaveCount(0);
    const panel = (await nav.boundingBox())!;
    expect(panel.x).toBe(0);
    expect(panel.y).toBe(0);
    expect(Math.round(panel.width)).toBe(248);
  });
});
