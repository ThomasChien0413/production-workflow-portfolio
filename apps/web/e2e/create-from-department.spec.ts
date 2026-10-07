import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { E2E_SUBPAGE, SHEET_DETAIL_PATH, WORKFLOW_AUTH_FILES, accessibilityViolations } from "./support";

/**
 * Sheets are created on their own page (the user, 2026-09-30), opened from
 * the department or subpage header: the user picks the subpage and a form it
 * ticks, and sees the form blank below before creating it.
 */
async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const csrf = document.cookie
        .split("; ")
        .find((pair) => pair.startsWith("workflow_csrf="))
        ?.slice("workflow_csrf=".length);
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json", "x-csrf-token": csrf ?? "" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    { method, path, body },
  ) as Promise<{ status: number; body: T }>;
}

type Subpages = {
  subpages: { id: string; name: string; revision: number }[];
  eligibleTemplates: { id: string; displayName: string }[];
};

test.describe("creating from the department page", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.slittingManager });

  for (const viewport of [
    { name: "desktop", width: 1366, height: 768 },
    { name: "mobile", width: 390, height: 844 },
  ] as const) {
    test(`picks the subpage, then a form it ticks, on ${viewport.name}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/departments/slitting");
      // The department opens its first subpage; there is no 全部 view.
      await page.waitForURL(/\/departments\/slitting\/subpages\/[^/]+$/);
      const departments = await api<{ departments: { id: string; slug: string }[] }>(page, "GET", "/api/departments");
      const slitting = departments.body.departments.find((department) => department.slug === "slitting")!;

      // A second subpage that ticks only 分條排刀單.
      const name = `建立測試-${viewport.name}-${randomUUID().slice(0, 6)}`;
      const created = await api<{ result: { subpageId: string } }>(page, "POST", `/api/departments/${slitting.id}/subpages`, {
        clientMutationId: randomUUID(),
        name,
      });
      expect(created.status).toBe(201);
      const subpageId = created.body.result.subpageId;
      const listed = await api<Subpages>(page, "GET", `/api/departments/${slitting.id}/subpages`);
      const knife = listed.body.eligibleTemplates.find((template) => template.displayName === "分條排刀單")!;
      const revision = listed.body.subpages.find((subpage) => subpage.id === subpageId)!.revision;
      const ticked = await api(page, "PUT", `/api/departments/${slitting.id}/subpages/${subpageId}/templates`, {
        clientMutationId: randomUUID(),
        revision,
        templateIds: [knife.id],
      });
      expect(ticked.status).toBe(200);
      // And one that ticks nothing yet: listed all the same (the user,
      // 2026-10-01), with why nothing can be created there.
      const emptyName = `未開放-${viewport.name}-${randomUUID().slice(0, 6)}`;
      const empty = await api(page, "POST", `/api/departments/${slitting.id}/subpages`, {
        clientMutationId: randomUUID(),
        name: emptyName,
      });
      expect(empty.status).toBe(201);

      // A subpage's header button opens the create page in that subpage.
      await page.reload();
      await expect(page.getByRole("heading", { name: "建立新的生產單" })).toHaveCount(0);
      await page.getByRole("link", { name: "建立生產單", exact: true }).click();
      await expect(page).toHaveURL(/\/departments\/slitting\/new\?from=subpage&subpage=[^&]+$/);
      await expect(page.getByLabel("工作子分頁")).toHaveCount(0);
      // Opened for the department rather than one subpage, the user picks the
      // subpage and form and sees the form blank below. Nothing links here
      // since the department page became its first subpage (2026-10-03),
      // but the address still works.
      await page.goto("/departments/slitting/new");
      await expect(page.getByRole("heading", { level: 1, name: "建立生產單" })).toBeVisible();
      const create = page.getByRole("button", { name: "建立生產單", exact: true });
      await expect(create).toBeEnabled({ timeout: 30_000 });

      // The two choices sit side by side and line up.
      if (viewport.name === "desktop") {
        const [subpageBox, formBox] = await Promise.all([
          page.getByLabel("工作子分頁").boundingBox(),
          page.getByLabel("表單範本").boundingBox(),
        ]);
        expect(formBox?.y).toBe(subpageBox?.y);
      }

      // A subpage that ticks no form is listed, and says why it creates nothing.
      await page.getByLabel("工作子分頁").selectOption({ label: `${emptyName}（尚未開放表單）` });
      await expect(page.getByLabel("表單範本")).toBeDisabled();
      await expect(page.getByLabel("表單範本").locator("option")).toHaveText(["此子分頁尚未開放表單"]);
      await expect(page.getByText(`「${emptyName}」尚未開放可建立的表單`)).toBeVisible();
      await expect(create).toBeDisabled();

      // Choosing the subpage offers only the forms it ticks.
      await page.getByLabel("工作子分頁").selectOption({ label: E2E_SUBPAGE });
      expect(await page.getByLabel("表單範本").locator("option").count()).toBeGreaterThan(1);
      await page.getByLabel("工作子分頁").selectOption({ label: name });
      await expect(page.getByLabel("表單範本").locator("option")).toHaveText(["分條排刀單"]);
      // The chosen form shows blank right below, and nothing in it is editable.
      await expect(page.getByRole("heading", { name: "表單預覽・分條排刀單" })).toBeVisible();
      await expect(page.locator(".cc-formsheet__title")).toHaveText("分條排刀單");
      await expect(page.locator(".cc-formsheet input:not([readonly]):not([disabled])")).toHaveCount(0);
      await expect(page.locator(".cc-action-bar")).toContainText(`將在「${name}」建立「分條排刀單」`);
      // A reload keeps the choice.
      await expect(page).toHaveURL(new RegExp(`[?&]subpage=${subpageId}`));

      const dimensions = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
      await page.locator(".cc-btn").evaluateAll(async (buttons) => {
        await Promise.allSettled(buttons.flatMap((button) => button.getAnimations().map((animation) => animation.finished)));
      });
      expect(await accessibilityViolations(page)).toEqual([]);

      await Promise.all([
        page.waitForURL((url) => SHEET_DETAIL_PATH.test(url.pathname)),
        create.click(),
      ]);
      // Created in the subpage chosen on the create page.
      const sheetId = new URL(page.url()).pathname.split("/").pop()!;
      const detail = await api<{ sheet: { subpageId: string | null } }>(page, "GET", `/api/sheets/${sheetId}`);
      expect(detail.body.sheet.subpageId).toBe(subpageId);
      await expect(page.locator(".cc-formsheet__title")).toHaveText("分條排刀單");

      // The way back leads to the subpage the sheet is in, and the
      // breadcrumb names the department and subpage.
      const breadcrumb = page.locator(".cc-breadcrumb");
      await expect(breadcrumb.getByRole("link", { name: "分條", exact: true })).toHaveAttribute("href", "/departments/slitting");
      await expect(breadcrumb.getByRole("link", { name, exact: true })).toBeVisible();
      await page.getByRole("link", { name: `返回${name}`, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/departments/slitting/subpages/${subpageId}$`));

      // From a subpage, its button opens the same page with that subpage
      // implied, and 返回 leads back to it.
      await page.getByRole("link", { name: "建立生產單", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "建立生產單" })).toBeVisible();
      await expect(page.getByLabel("工作子分頁")).toHaveCount(0);
      await expect(page.getByLabel("表單範本").locator("option")).toHaveText(["分條排刀單"]);
      await page.getByRole("link", { name: `返回${name}`, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/departments/slitting/subpages/${subpageId}$`));
    });
  }
});
