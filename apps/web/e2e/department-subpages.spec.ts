import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { E2E_SUBPAGE, WCAG_TAGS, WORKFLOW_AUTH_FILES } from "./support";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1366, height: 768 },
] as const;

test.describe.configure({ mode: "serial" });

for (const viewport of viewports) {
  test(`department manager configures a subpage permission matrix on ${viewport.name}`, async ({ browser, baseURL }) => {
    // This exercises several persisted mutations, a reload, an accessibility
    // scan, reordering and deletion. The browser suite can take
    // longer than Playwright's 30-second default while Next is compiling the
    // settings route for the first time.
    test.setTimeout(120_000);
    const context = await browser.newContext({
      storageState: WORKFLOW_AUTH_FILES.slittingManager,
      viewport: { width: viewport.width, height: viewport.height },
      locale: "zh-Hant-TW",
      timezoneId: "Asia/Taipei",
    });
    const page = await context.newPage();
    const name = `權限測試-${viewport.name}-${randomUUID().slice(0, 6)}`;

    try {
      await page.goto(`${baseURL ?? ""}/departments/slitting/settings`);
      await expect(page.getByRole("heading", { level: 1, name: "分條・表單權限設定" })).toBeVisible();
      await page.getByLabel("子分頁名稱").fill(name);
      const createResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/subpages"));
      await page.getByRole("button", { name: "新增子分頁", exact: true }).click();
      const createdResponse = await createResponse;
      expect(createdResponse.status()).toBe(201);
      const createdSubpageId = (await createdResponse.json() as { result: { subpageId: string } }).result.subpageId;
      const card = page.locator(".cc-card").filter({ hasText: name });
      await expect(card).toBeVisible();

      // One subpage open at a time: the new one opens, the others fold to
      // their summary, and opening another folds this one.
      const toggle = card.getByRole("button", { name, exact: true });
      const uncategorised = page.getByRole("button", { name: E2E_SUBPAGE, exact: true });
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(uncategorised).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".cc-fold .cc-card__body:not([hidden])")).toHaveCount(1);
      await uncategorised.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(card.getByRole("button", { name: "儲存身分權限" })).toBeHidden();
      await toggle.click();
      await expect(uncategorised).toHaveAttribute("aria-expanded", "false");
      await expect(page).toHaveURL(new RegExp(`[?&]open=${createdSubpageId}`));

      const matrix = card.locator(viewport.name === "mobile" ? ".cc-only-narrow" : ".cc-only-wide");
      const edit = matrix.getByLabel(`${name}・員工・修改`);
      const view = matrix.getByLabel(`${name}・員工・查看`);
      await edit.check();
      await matrix.getByLabel(`${name}・員工・建立`).check();
      await expect(view).toBeChecked();
      await expect(card.getByText("尚未儲存", { exact: true })).toBeVisible();
      const permissionResponse = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/identities"));
      await card.getByRole("button", { name: "儲存身分權限", exact: true }).click();
      expect((await permissionResponse).status()).toBe(200);
      await expect(page.getByText("設定已儲存並立即生效。")).toBeVisible();
      await expect(card.getByText("尚未儲存", { exact: true })).toHaveCount(0);

      // The open subpage is in the URL, so a reload keeps it open.
      await page.reload();
      const refreshedCard = page.locator(".cc-card").filter({ hasText: name });
      await expect(refreshedCard.getByRole("button", { name, exact: true })).toHaveAttribute("aria-expanded", "true");
      const refreshedMatrix = refreshedCard.locator(viewport.name === "mobile" ? ".cc-only-narrow" : ".cc-only-wide");
      await expect(refreshedMatrix.getByLabel(`${name}・員工・查看`)).toBeChecked();
      await expect(refreshedMatrix.getByLabel(`${name}・員工・修改`)).toBeChecked();
      await expect(refreshedMatrix.getByLabel(`${name}・員工・建立`)).toBeChecked();

      const template = refreshedCard.getByRole("checkbox", { name: new RegExp(`${name}・分條排刀單`) });
      await template.check();
      const templateResponse = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith("/templates"));
      await refreshedCard.getByRole("button", { name: "儲存可使用表單" }).click();
      expect((await templateResponse).status()).toBe(200);
      await page.reload();
      await expect(page.locator(".cc-card").filter({ hasText: name }).getByRole("checkbox", { name: new RegExp(`${name}・分條排刀單`) })).toBeChecked();
      // The department page opens its first subpage; there is no 全部 tab
      // across them (the user, 2026-10-03).
      await page.goto(`${baseURL ?? ""}/departments/slitting`);
      await expect(page).toHaveURL(/\/departments\/slitting\/subpages\/[^/]+$/);
      const tabs = page.getByRole("navigation", { name: "工作子分頁" });
      await expect(tabs.getByRole("link", { name: /^全部/ })).toHaveCount(0);
      // The bar scrolls sideways only: nothing in it reaches past its height
      // (the user, 2026-10-03).
      const bar = await tabs.evaluate((nav) => ({ scroll: nav.scrollHeight, client: nav.clientHeight }));
      expect(bar.scroll).toBe(bar.client);
      await tabs.getByRole("link", { name: new RegExp(`^${name}`) }).click();
      await expect(page).toHaveURL(new RegExp(`/departments/slitting/subpages/${createdSubpageId}$`));
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "工作子分頁" }).getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("link", { name: "建立生產單", exact: true })).toHaveAttribute(
        "href",
        `/departments/slitting/new?from=subpage&subpage=${createdSubpageId}`,
      );
      // Arriving without `open`, every subpage starts folded.
      await page.goto(`${baseURL ?? ""}/departments/slitting/settings`);
      await expect(page.locator(".cc-fold .cc-card__body:not([hidden])")).toHaveCount(0);
      await refreshedCard.getByRole("button", { name, exact: true }).click();
      await expect(refreshedCard.getByRole("button", { name: "儲存身分權限" })).toBeVisible();
      const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);

      // All button variants transition after hydration. Axe should inspect
      // their settled state, not a low-contrast mid-transition.
      await expect(refreshedCard.getByRole("button", { name: "儲存身分權限" })).toBeEnabled();
      await page.locator(".cc-btn").evaluateAll(async (buttons) => {
        await Promise.allSettled(buttons.flatMap((button) => button.getAnimations().map((animation) => animation.finished)));
      });
      const accessibility = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(accessibility.violations).toEqual([]);

      const moveResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/subpages/"));
      await refreshedCard.getByRole("button", { name: /^上移/u }).click();
      expect((await moveResponse).status()).toBe(200);
      await page.reload();
      const movedCard = page.locator(".cc-card").filter({ hasText: name });
      await movedCard.getByRole("button", { name: "刪除子分頁", exact: true }).click();
      await expect(movedCard.getByText("確定永久刪除？只有沒有生產單的子分頁可以刪除。")).toBeVisible();
      const deleteResponse = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes("/subpages/"));
      await movedCard.getByRole("button", { name: "確定刪除", exact: true }).click();
      expect((await deleteResponse).status()).toBe(200);
      await expect(page.locator(".cc-card").filter({ hasText: name })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
