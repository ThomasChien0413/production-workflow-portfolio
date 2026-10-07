import { expect, test, type Page } from "@playwright/test";
import { expectArchiveBelowStatus, readStatusArchiveGap } from "./layout-geometry";

// Test-only geometry fixture: no application, production form or database.
async function fixture(page: Page) {
  await page.setContent(`
    <style>body{margin:0;min-height:5000px}main{margin-top:1200px}
    [role=group]{height:120px;width:300px}button{display:block;margin-top:24px;width:120px;height:44px}</style>
    <main><div role="group" aria-label="生產狀態"></div><button>封存生產單</button></main>
  `);
}

for (const viewport of [{ name: "mobile", width: 390, height: 844 }, { name: "desktop", width: 1366, height: 768 }]) {
  test.describe(`atomic layout measurement (${viewport.name})`, () => {
    test.use({ viewport });

    test("forced scrolling breaks old separate samples, not the atomic comparison", async ({ page }) => {
      await fixture(page);
      const status = await page.getByRole("group", { name: "生產狀態" }).boundingBox();
      await page.evaluate(() => window.scrollBy(0, 300));
      const archive = await page.getByRole("button", { name: "封存生產單" }).boundingBox();
      expect(archive!.y - (status!.y + status!.height)).toBeLessThan(-1);
      expect(await readStatusArchiveGap(page)).toBe(24);
      await expectArchiveBelowStatus(page);
    });

    test("still rejects an archive control above the status", async ({ page }) => {
      await fixture(page);
      await page.evaluate(() => document.querySelector("main")!.prepend(document.querySelector("button")!));
      expect(await readStatusArchiveGap(page)).toBeLessThan(-1);
      await expect(expectArchiveBelowStatus(page, { timeout: 200 })).rejects.toThrow();
    });

    test("still rejects excessive spacing", async ({ page }) => {
      await fixture(page);
      await page.evaluate(() => { document.querySelector("button")!.style.marginTop = "450px"; });
      expect(await readStatusArchiveGap(page)).toBe(450);
      await expect(expectArchiveBelowStatus(page, { timeout: 200 })).rejects.toThrow();
    });

    test("rejects a missing, hidden or duplicate target", async ({ page }) => {
      for (const variant of ["missing", "hidden", "duplicate"]) {
        await fixture(page);
        await page.evaluate((kind) => {
          const button = document.querySelector("button")!;
          if (kind === "missing") button.remove();
          else if (kind === "hidden") button.style.display = "none";
          else button.after(button.cloneNode(true));
        }, variant);
        expect(await readStatusArchiveGap(page)).toBeNull();
        await expect(expectArchiveBelowStatus(page, { timeout: 200 })).rejects.toThrow();
      }
    });
  });
}
