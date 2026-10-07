import { expect, test, type Browser } from "@playwright/test";
import { WORKFLOW_AUTH_FILES, type WorkflowUserKey } from "./support";

/**
 * Passwords are set by ADMIN and 總經理 (the user, 2026-10-04). They alone
 * change their own and see the default-password warning; everyone else is told
 * who sets theirs, and the change page sends them back to 設定. Every fixture
 * account here was given its password by an administrator.
 */
async function signedIn(browser: Browser, key: WorkflowUserKey) {
  const context = await browser.newContext({ storageState: WORKFLOW_AUTH_FILES[key] });
  return { context, page: await context.newPage() };
}

for (const key of ["cutStaff", "cutManager", "sales"] as const) {
  test(`${key} is not warned about a password they cannot change`, async ({ browser }) => {
    const { context, page } = await signedIn(browser, key);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("此帳號仍使用預設密碼")).toHaveCount(0);

    await page.goto("/settings");
    await expect(page.getByText("密碼由系統管理員或總經理設定。如需變更，請聯絡他們。")).toBeVisible();
    await expect(page.getByText("此帳號仍使用預設密碼")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "變更密碼", exact: true })).toHaveCount(0);

    await page.goto("/change-password");
    await expect(page).toHaveURL(/\/settings$/);
    await context.close();
  });
}

test("總經理 is warned about the default password and may change it", async ({ browser }) => {
  const { context, page } = await signedIn(browser, "generalManager");
  await page.goto("/settings");
  await expect(page.getByText("此帳號仍使用預設密碼")).toBeVisible();
  await expect(page.getByRole("link", { name: "變更密碼", exact: true })).toHaveAttribute("href", "/change-password");
  await page.goto("/change-password");
  await expect(page.getByRole("heading", { level: 1, name: "變更密碼" })).toBeVisible();
  await context.close();
});
