import { expect, test, type Browser } from "@playwright/test";
import { WORKFLOW_AUTH_FILES, type WorkflowUserKey } from "./support";

/**
 * 審核 replaces 生產單 in the navigation (the user, 2026-10-01). Only the
 * company-wide readers have it: ADMIN, 總經理, 協理 and 業務. Everyone else
 * checks, creates and changes sheets in their department pages, so they have
 * no company-wide list, in the navigation or at its address.
 */
async function signedIn(browser: Browser, key: WorkflowUserKey) {
  const context = await browser.newContext({ storageState: WORKFLOW_AUTH_FILES[key] });
  return { context, page: await context.newPage() };
}

for (const key of ["generalManager", "associate", "sales"] as const) {
  test(`${key} has 審核 in the navigation and opens it`, async ({ browser }) => {
    const { context, page } = await signedIn(browser, key);
    await page.goto("/");
    const navigation = page.getByRole("navigation", { name: "主導覽" });
    await expect(navigation.getByRole("link", { name: "審核", exact: true })).toHaveAttribute("href", "/sheets");
    await expect(navigation.getByRole("link", { name: "生產單", exact: true })).toHaveCount(0);

    await page.goto("/sheets");
    await expect(page).toHaveURL(/\/sheets$/);
    await expect(page.getByRole("heading", { level: 1, name: "審核" })).toBeVisible();
    await expect(page).toHaveTitle(/^審核/);
    await context.close();
  });
}

for (const key of ["slittingManager", "cutStaff", "cutOrderTaker"] as const) {
  test(`${key} has no 審核 and no company-wide list`, async ({ browser }) => {
    const { context, page } = await signedIn(browser, key);
    await page.goto("/");
    const navigation = page.getByRole("navigation", { name: "主導覽" });
    await expect(navigation.getByRole("link", { name: "首頁", exact: true })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "審核", exact: true })).toHaveCount(0);
    await expect(navigation.getByRole("link", { name: "生產單", exact: true })).toHaveCount(0);

    // The old address leads home instead.
    await page.goto("/sheets");
    await expect(page).toHaveURL(/\/$/);

    // Their department page no longer points at the list.
    const department = key === "slittingManager" ? "slitting" : "cut";
    await page.goto(`/departments/${department}`);
    await expect(page.getByRole("link", { name: "前往生產單" })).toHaveCount(0);
    await context.close();
  });
}
