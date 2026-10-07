import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_SUBPAGE, WCAG_TAGS, WORKFLOW_AUTH_FILES, WORKFLOW_USERS } from "./support";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1366, height: 768 },
] as const;

const sheetId = randomUUID();
// A same-template record makes broad title selectors deterministically unsafe
// when clearing filters; parallel files may create more of these as well.
const decoySheetId = randomUUID();
const searchMarker = `history-browser-${sheetId.slice(0, 8)}`;
/** CUT's test subpage, the one the sheet is filed in; set in beforeAll. */
let subpageId = "";

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test.beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  expect(databaseUrl, "DATABASE_URL is required for history browser fixtures").toBeTruthy();
  const sql = postgres(databaseUrl ?? "", { max: 1, prepare: false });
  try {
    const [fixture] = await sql<
      {
        departmentId: string;
        templateVersionId: string;
        managerId: string;
        staffId: string;
        subpageId: string;
      }[]
    >`
      select
        d.id as "departmentId",
        stv.id as "templateVersionId",
        manager.id as "managerId",
        staff.id as "staffId",
        subpage.id as "subpageId"
      from departments d
      join sheet_templates st on st.slug = 'slitting-request'
      join sheet_template_versions stv
        on stv.template_id = st.id
       and stv.version = st.current_version_number
      join users manager on manager.username = ${WORKFLOW_USERS.cutManager.username}
      join users staff on staff.username = ${WORKFLOW_USERS.cutStaff.username}
      join department_subpages subpage
        on subpage.department_id = d.id
       and subpage.name = ${E2E_SUBPAGE}
      where d.code = 'CUT'
      limit 1
    `;
    expect(fixture, "CUT and workflow users must be prepared by auth.setup").toBeTruthy();
    subpageId = fixture!.subpageId;

    await sql.begin(async (transaction) => {
      for (const fixtureSheetId of [sheetId, decoySheetId]) {
        await transaction`
          insert into production_sheets (
            id, sheet_number, template_version_id, origin_department_id,
            current_department_id, created_by_user_id, assigned_user_id, state,
            subpage_id,
            completed_at, archived_at, created_at, updated_at
          ) values (
            ${fixtureSheetId}, ${fixtureSheetId}, ${fixture!.templateVersionId},
            ${fixture!.departmentId}, ${fixture!.departmentId}, ${fixture!.managerId},
            ${fixture!.staffId}, 'ARCHIVED', ${fixture!.subpageId},
            '2026-08-13T01:00:00.000Z', '2026-08-13T02:00:00.000Z', now(), now()
          )
        `;
        await transaction`
          insert into sheet_values (sheet_id, values, updated_at)
          values (
            ${fixtureSheetId},
            ${JSON.stringify({
              requestDate: "2026-08-13",
              items: [
                {
                  specification: fixtureSheetId === sheetId
                    ? searchMarker : `history-decoy-${decoySheetId}`,
                  material: "E2E 材質",
                  category: "E2E 分類",
                  requiredQuantity: "1",
                  notes: "完工紀錄瀏覽器測試",
                },
                ...Array.from({ length: 7 }, () => ({
                  specification: "",
                  material: "",
                  category: "",
                  requiredQuantity: "",
                  notes: "",
                })),
              ],
            })}::jsonb,
            now()
          )
        `;
      }
    });
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await sql`delete from production_sheets where id in ${sql([sheetId, decoySheetId])}`;
  } finally {
    await sql.end();
  }
});

for (const viewport of VIEWPORTS) {
  test(`完工紀錄 search, download and read-only opening on ${viewport.name}`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({
      storageState: WORKFLOW_AUTH_FILES.cutStaff,
      viewport: { width: viewport.width, height: viewport.height },
      locale: "zh-Hant-TW",
      timezoneId: "Asia/Taipei",
    });
    const page = await context.newPage();
    try {
      // The department opens a subpage; its 完工紀錄 is that subpage's.
      await page.goto(`${baseURL ?? ""}/departments/cut/subpages/${subpageId}`);
      await page.locator(`a[href="/departments/cut/history?subpageId=${subpageId}"]`).click();
      await expect(page).toHaveURL(/\/departments\/cut\/history\?subpageId=/);
      await expect(
        page.getByRole("heading", { level: 1, name: "CUT・完工紀錄" }),
      ).toBeVisible();

      const keyword = page.getByLabel("關鍵字");
      await expect(keyword).toBeEnabled();
      await keyword.click();
      await expect(keyword).toBeFocused();
      await keyword.fill(searchMarker);
      // 完工紀錄 holds archived sheets only, so there is no 狀態 to filter by
      // (the user, 2026-10-04).
      await expect(page.getByLabel("狀態", { exact: true })).toHaveCount(0);
      await page.getByLabel("表單範本", { exact: true }).selectOption({
        label: "分條申請單",
      });
      // Nobody is assigned, so there is no 負責員工 (the user, 2026-10-04).
      await expect(page.getByLabel("負責員工", { exact: true })).toHaveCount(0);
      await page.getByLabel("開始日期").fill("2026-08-13");
      await page.getByLabel("結束日期").fill("2026-08-13");
      // The two dates never run into each other; on a phone they stack (the
      // user, 2026-10-04).
      const fromBox = (await page.getByLabel("開始日期").boundingBox())!;
      const toBox = (await page.getByLabel("結束日期").boundingBox())!;
      const apart =
        fromBox.x + fromBox.width <= toBox.x || fromBox.y + fromBox.height <= toBox.y;
      expect(apart).toBe(true);
      if (viewport.name !== "desktop") expect(toBox.y).toBeGreaterThan(fromBox.y + fromBox.height - 1);
      await page.getByRole("button", { name: "搜尋", exact: true }).click();
      await expect(page).toHaveURL(/q=history-browser-/);
      await expect(page.getByText("共 1 筆完工紀錄")).toBeVisible();

      const result =
        viewport.name === "desktop"
          ? page.locator(".cc-only-wide tbody tr").filter({
              has: page.locator(`a[href="/sheets/${sheetId}?from=history"]`),
            })
          : page.locator(".cc-only-narrow article").filter({
              has: page.locator(`a[href="/sheets/${sheetId}?from=history"]`),
            });
      await expect(result).toHaveCount(1);
      await expect(result).toBeVisible();
      // Archived 2026-08-13 10:00 Taipei, so deleted one year later.
      await expect(result.getByText(/2027\/8\/13/)).toBeVisible();
      await expect(result.getByText(searchMarker, { exact: true })).toHaveCount(0);
      await expectNoPageOverflow(page);

      const accessibility = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(accessibility.violations).toEqual([]);

      if (viewport.name === "desktop") {
        await page
          .getByRole("link", { name: "完成時間，改為正向排序" })
          .click();
        await expect(page).toHaveURL(/direction=asc/);
      }

      await page.route(`**/api/sheets/${sheetId}/pdf`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/pdf",
          headers: { "content-disposition": "attachment; filename=sheet.pdf" },
          body: "%PDF-1.7\n% history browser test\n",
        });
      });
      await result.getByRole("button", { name: /^下載 PDF\s*：/ }).click();
      await expect(result.getByRole("status")).toHaveText("PDF 已開始下載。");

      await page.getByRole("button", { name: "清除篩選", exact: true }).click();
      await expect(page).toHaveURL(/\/departments\/cut\/history$/);
      const visibleRecords = page.locator(
        viewport.name === "desktop" ? ".cc-only-wide" : ".cc-only-narrow",
      );
      await expect(visibleRecords.locator(`a[href="/sheets/${sheetId}?from=history"]`)).toBeVisible();
      await expect(visibleRecords.locator(`a[href="/sheets/${decoySheetId}?from=history"]`)).toBeVisible();
      await expect(result).toHaveCount(1);
      await page.goBack();
      await expect(page).toHaveURL(/\/departments\/cut\/history\?.*q=history-browser-/);
      // URL navigation can precede the refreshed server tree. Verify both the
      // restored control and filtered data before opening this exact record.
      await expect(page.getByLabel("關鍵字")).toHaveValue(searchMarker);
      await expect(page.getByText("共 1 筆完工紀錄")).toBeVisible();
      await expect(visibleRecords.locator(`a[href="/sheets/${decoySheetId}?from=history"]`)).toHaveCount(0);

      await Promise.all([
        page.waitForURL(new RegExp(`/sheets/${sheetId}\\?from=history$`)),
        result.getByRole("link", { name: /^開啟\s*：/ }).click(),
      ]);
      await expect(
        page.getByRole("heading", { level: 1, name: "分條申請單" }),
      ).toBeVisible();
      await expect(page.getByText(/封存，僅供查閱/)).toBeVisible();
      // Opened from 完工紀錄, it leads back there (the user, 2026-10-04).
      await expect(page.getByRole("link", { name: "返回完工紀錄", exact: true })).toHaveAttribute(
        "href",
        /^\/departments\/cut\/history/,
      );
      await expect(page.getByText(/將於\s*2027\/8\/13.*後連同附件永久刪除/)).toBeVisible();
    } finally {
      // Sheet detail holds an intentional WebSocket. Some Windows Playwright
      // builds wait indefinitely for that socket during graceful context
      // shutdown, so bound cleanup; the browser fixture closes any remainder.
      await Promise.race([
        context.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
  });
}
