import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Home Screen manifest exposes real neutral PNGs at both required sizes", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    short_name: "Workflow Portfolio",
    display: "standalone",
    start_url: "/",
    icons: expect.arrayContaining([
      { src: "/icon", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
    ]),
  });
  for (const [path, size] of [["/icon", 192], ["/icons/icon-512", 512], ["/apple-icon", 180]] as const) {
    const icon = await request.get(path);
    expect(icon.ok(), path).toBe(true);
    expect(icon.headers()["content-type"]).toContain("image/png");
    const png = await icon.body();
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.toString("ascii", 12, 16)).toBe("IHDR");
    expect(png.readUInt32BE(16), `${path} width`).toBe(size);
    expect(png.readUInt32BE(20), `${path} height`).toBe(size);
  }
});

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
