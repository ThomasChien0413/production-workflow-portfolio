import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1366, height: 900 },
]) {
  test(`neutral login branding at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await expect(page.getByRole("img", { name: "Workflow Portfolio", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "登入", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(accessibility.violations).toEqual([]);
    await expect(page).toHaveScreenshot(`portfolio-login-${viewport.name}.png`, {
      fullPage: true,
      stylePath: fileURLToPath(new URL("../e2e/screenshot.css", import.meta.url)),
    });
  });
}
