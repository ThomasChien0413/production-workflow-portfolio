import { expect, test, type Page } from "@playwright/test";
import {
  createSheetThroughHydratedForm,
  waitForHydration,
  watchHydrationErrors,
  WORKFLOW_AUTH_FILES,
} from "./support";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1366, height: 768 },
] as const;

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

for (const viewport of VIEWPORTS) {
  test(`附件上傳、預覽、下載和移除（${viewport.name}）`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      storageState: WORKFLOW_AUTH_FILES.originManager,
      viewport: { width: viewport.width, height: viewport.height },
      locale: "zh-Hant-TW",
      timezoneId: "Asia/Taipei",
      acceptDownloads: true,
    });
    const page = await context.newPage();

    try {
      await page.goto("/");
      await createSheetThroughHydratedForm(page, "倉位入庫表", "倉管");

      await expect(page.getByText("一次一個 PDF，每個檔案上限 95 MB。")).toBeVisible();
      // Synthetic file size avoids allocating a 95 MB browser fixture. All
      // other files keep their native size; the later valid upload is real.
      await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(File.prototype, "size")
          ?? Object.getOwnPropertyDescriptor(Blob.prototype, "size");
        Object.defineProperty(File.prototype, "size", {
          configurable: true,
          get() {
            return this.name === "oversized.pdf" ? 95_000_001 : descriptor!.get!.call(this);
          },
        });
      });
      let oversizeUploads = 0;
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().endsWith("/attachments")) oversizeUploads++;
      });
      await waitForHydration(page, "#sheet-attachment-file");
      await page.locator("#sheet-attachment-file").setInputFiles({
        name: "oversized.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n"),
      });
      await expect(page.getByText("附件不可超過 95 MB。")).toBeVisible();
      await expect(page.getByRole("button", { name: "上傳附件", exact: true })).toBeDisabled();
      expect(oversizeUploads).toBe(0);

      const filename = `附件測試-${viewport.width}.pdf`;
      const attachment = {
        name: filename,
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.7\nWorkflow Portfolio browser attachment test\n", "utf8"),
      };
      const selected = page.getByText(new RegExp(`已選擇：${filename}`));
      await expect
        .poll(
          async () => {
            if (await selected.isVisible()) return true;
            await page
              .locator("#sheet-attachment-file")
              .setInputFiles(attachment, { timeout: 1_000 })
              .catch(() => undefined);
            return selected.isVisible();
          },
          {
            message: "selected attachment is reflected after hydration",
            timeout: 30_000,
            intervals: [0, 100, 250, 500],
          },
        )
        .toBe(true);
      await page.getByRole("button", { name: "上傳附件", exact: true }).click();
      await expect(page.getByText("附件已上傳。")).toBeVisible();
      await expect(
        page
          .locator(".cc-attachment-filename")
          .filter({ hasText: filename, visible: true }),
      ).toHaveText(filename);
      await expect(page.getByText("共 1 個附件")).toBeVisible();
      await expectNoPageOverflow(page);

      // Reloaded, the list and its upload time are rendered on the server,
      // and must hydrate in the browser without a mismatch.
      const hydrationErrors = watchHydrationErrors(page);
      await page.reload();
      await expect(page.getByText("共 1 個附件")).toBeVisible();
      await waitForHydration(page, ".cc-attachment-filename");
      expect(hydrationErrors).toEqual([]);

      const preview = page.getByRole("link", { name: new RegExp(`預覽.*${filename}`) });
      const previewResponse = await page.request.get(await preview.getAttribute("href") ?? "");
      expect(previewResponse.status()).toBe(200);
      expect(previewResponse.headers()["content-type"]).toBe("application/pdf");
      expect((await previewResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("link", { name: new RegExp(`下載.*${filename}`) }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(filename);

      await page.getByRole("button", { name: "移除", exact: true }).click();
      await expect(
        page
          .getByText("確定永久移除此附件？此動作無法復原。")
          .filter({ visible: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "確定移除", exact: true }).click();
      await expect(page.getByText("附件已永久移除。")).toBeVisible();
      await expect(page.getByText("尚無附件", { exact: true })).toBeVisible();
      await expect(page.getByText("共 0 個附件")).toBeVisible();
    } finally {
      await context.close();
    }
  });
}
