import { expect, test, type Page } from "@playwright/test";
import { AUTH_FILE, WORKFLOW_AUTH_FILES } from "./support";

/**
 * Fields set side by side in a form grid line up. The grid's gap spaces
 * them; the margin a stacked field takes after another must not apply here,
 * or the second field of a row drops by that margin. It once put 姓名 20px
 * below 帳號 on 新增帳號 (2026-10-01).
 */
async function expectRowsAligned(page: Page) {
  const grids = page.locator(".cc-form-grid");
  await expect(grids.first()).toBeVisible();
  const rows = await grids.evaluateAll((elements) =>
    elements.map((grid) =>
      [...grid.querySelectorAll(":scope > .cc-field")].map((field) => ({
        label: field.querySelector("label")?.firstChild?.textContent ?? "",
        top: Math.round(field.getBoundingClientRect().top),
        left: Math.round(field.getBoundingClientRect().left),
        controlTop: Math.round(
          field.querySelector("input, select, textarea")?.getBoundingClientRect().top ?? -1,
        ),
        marginTop: getComputedStyle(field).marginTop,
      })),
    ),
  );
  for (const fields of rows) {
    for (const field of fields) expect(field.marginTop, field.label).toBe("0px");
    // Fields whose labels start on the same line have controls on the same line.
    for (const field of fields) {
      for (const other of fields) {
        if (other !== field && other.top === field.top) {
          expect(other.controlTop, `${other.label} beside ${field.label}`).toBe(field.controlTop);
        }
      }
    }
  }
}

test.describe("form grid alignment at desktop", () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test.describe("account administration", () => {
    test.use({ storageState: AUTH_FILE });

    test("新增帳號 lines up 姓名 and optional 登入名稱", async ({ page }) => {
      await page.goto("/admin/users/new");
      const account = page.getByLabel("登入名稱", { exact: false }).first();
      const name = page.getByLabel("姓名", { exact: false }).first();
      await expect(account).toBeVisible();
      const [accountBox, nameBox] = await Promise.all([account.boundingBox(), name.boundingBox()]);
      expect(nameBox?.y).toBe(accountBox?.y);
      await expectRowsAligned(page);
    });

    test("稽核紀錄 filters line up", async ({ page }) => {
      await page.goto("/admin/audit");
      await expectRowsAligned(page);
    });
  });

  test("完工紀錄 filters line up", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: WORKFLOW_AUTH_FILES.cutManager,
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();
    await page.goto("/departments/cut/history");
    await expectRowsAligned(page);
    await context.close();
  });
});
