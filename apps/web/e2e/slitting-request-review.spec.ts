import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  createSheetThroughHydratedForm,
  WCAG_TAGS,
  WORKFLOW_AUTH_FILES,
  type WorkflowUserKey,
} from "./support";

/**
 * 分條申請單 is the one reviewed form (the user, 2026-10-01). Its department
 * sends it for review; 業務, 協理 and 總經理 approve it in turn, each finding it
 * in 審核 when it is their turn; any of them may return it with a reason; and
 * 分條 receives it only after 總經理 approves.
 */
async function expectState(page: Page, label: string) {
  await expect(page.locator(".cc-page__header .cc-badge")).toHaveText(label);
}

test("分條申請單 is returned with a reason, sent again, and found in 審核 at each turn", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const origin = baseURL ?? "";
  const contexts: BrowserContext[] = [];
  async function actor(key: WorkflowUserKey): Promise<Page> {
    const context = await browser.newContext({
      storageState: WORKFLOW_AUTH_FILES[key],
      locale: "zh-Hant-TW",
      timezoneId: "Asia/Taipei",
    });
    contexts.push(context);
    return context.newPage();
  }
  // 審核 opens a sheet saying where from, so the sheet leads back to it.
  const queueLink = (page: Page, sheetPath: string) =>
    page.locator(`a[href="${sheetPath}?from=review"]`);

  try {
    const writer = await actor("cutOrderTaker");
    await createSheetThroughHydratedForm(writer, "分條申請單", "CUT");
    const sheetPath = new URL(writer.url()).pathname;
    await writer.locator("#requestDate").fill("2026-10-01");
    await writer.getByLabel("第 1 列 規格").fill("E2E 審核");
    await writer.getByLabel("第 1 列 材質").fill("E2E 材質");
    await writer.getByLabel("第 1 列 分類").fill("E2E 分類");
    await writer.getByLabel("第 1 列 需求量").fill("1");
    await writer.getByLabel("第 1 列 備註").fill("Playwright 測試資料");
    await writer.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(writer.getByText("所有變更皆已儲存")).toBeVisible();
    // Its status waits for the review.
    await expect(writer.getByRole("group", { name: "生產狀態" })).toHaveCount(0);
    await writer.getByRole("button", { name: "送出審核", exact: true }).click();
    await writer.getByRole("button", { name: "確認送出審核", exact: true }).click();
    await expect(writer.getByText("已送出審核", { exact: true })).toBeVisible();
    await expectState(writer, "待業務審核");
    // Sending it leaves its writer where they were (the user, 2026-10-04).
    await expect(writer).toHaveURL(new RegExp(`${sheetPath}$`));
    await expect(writer.getByRole("link", { name: "返回審核", exact: true })).toHaveCount(0);

    // A company-wide reader opening it directly, not at their turn, is not
    // in 審核 either: the way back is its department, and 審核 is not current.
    const reader = await actor("generalManager");
    await reader.goto(`${origin}${sheetPath}`);
    await expectState(reader, "待業務審核");
    await expect(reader.getByRole("link", { name: "返回審核", exact: true })).toHaveCount(0);
    await expect(
      reader.getByRole("navigation", { name: "主導覽" }).getByRole("link", { name: "審核", exact: true }),
    ).not.toHaveAttribute("aria-current", "page");
    await reader.close();

    // 審核 lists it for 業務, whose turn it is, and not yet for 協理.
    const sales = await actor("sales");
    // 業務 is told, and the notice is 未讀 until they open the sheet.
    const notice = sales.locator("article").filter({ has: sales.locator(`a[href="${sheetPath}"]`) });
    await sales.goto(`${origin}/notifications`);
    await expect(notice.getByText("未讀", { exact: true })).toHaveCount(1);
    await sales.goto(`${origin}/sheets`);
    await expect(queueLink(sales, sheetPath).first()).toBeVisible();
    const accessibility = await new AxeBuilder({ page: sales }).withTags(WCAG_TAGS).analyze();
    expect(accessibility.violations).toEqual([]);
    const associate = await actor("associate");
    await associate.goto(`${origin}/sheets`);
    await expect(associate.getByRole("heading", { level: 1, name: "審核" })).toBeVisible();
    await expect(queueLink(associate, sheetPath)).toHaveCount(0);

    // 業務 returns it; 退回 needs a reason.
    await queueLink(sales, sheetPath).first().click();
    await expect(sales).toHaveURL(new RegExp(`${sheetPath}\\?from=review$`));
    // The way back is to 審核, where the reviewer came from (the user, 2026-10-04).
    await expect(sales.getByRole("link", { name: "返回審核", exact: true })).toHaveAttribute("href", "/sheets");
    await expect(
      sales.getByRole("navigation", { name: "主導覽" }).getByRole("link", { name: "審核", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(sales.getByRole("button", { name: "核准", exact: true })).toBeEnabled();
    await sales.getByRole("button", { name: "退回", exact: true }).click();
    await expect(sales.getByText("請先填寫退回原因。")).toBeVisible();
    await expect(sales.getByRole("button", { name: "確認退回", exact: true })).toBeDisabled();
    await sales.locator("#review-comment").fill("需求量請再確認");
    await sales.getByRole("button", { name: "確認退回", exact: true }).click();
    await expectState(sales, "已退回");
    // Opening the sheet read its notice (the user, 2026-10-04).
    await sales.goto(`${origin}/notifications`);
    await expect(notice).toHaveCount(1);
    await expect(notice.getByText("未讀", { exact: true })).toHaveCount(0);

    // CUT sees why, fixes it and sends it again; it starts from 業務.
    await writer.goto(`${origin}${sheetPath}`);
    await expectState(writer, "已退回");
    // The reason is in the notice at the top, and in the review history too.
    const returnedNotice = writer.getByRole("alert").filter({ hasText: "業務 退回了這張生產單" });
    await expect(returnedNotice).toBeVisible();
    await expect(returnedNotice).toContainText("需求量請再確認");
    await writer.getByLabel("第 1 列 需求量").fill("2");
    await writer.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(writer.getByText("所有變更皆已儲存")).toBeVisible();
    await writer.getByRole("button", { name: "送出審核", exact: true }).click();
    await writer.getByRole("button", { name: "確認送出審核", exact: true }).click();
    await expectState(writer, "待業務審核");

    // Each approves in turn and the next finds it in 審核.
    await sales.goto(`${origin}${sheetPath}`);
    await sales.getByRole("button", { name: "核准", exact: true }).click();
    await expectState(sales, "待協理審核");
    await associate.goto(`${origin}/sheets`);
    await queueLink(associate, sheetPath).first().click();
    await associate.getByRole("button", { name: "核准", exact: true }).click();
    await expectState(associate, "待總經理審核");
    // Still under review: no row ticks yet (the user, 2026-10-03).
    await expect(associate.locator(".cc-formsheet__mark")).toHaveCount(0);
    const generalManager = await actor("generalManager");
    await generalManager.goto(`${origin}/sheets`);
    await queueLink(generalManager, sheetPath).first().click();
    await generalManager.getByRole("button", { name: "核准", exact: true }).click();
    await expectState(generalManager, "待生產");
    // Each signature box carries who signed it (the user, 2026-10-01):
    // 申請單位 the department it came from, then each approver.
    const signatureRow = generalManager.locator(".cc-formsheet__signrow");
    for (const [label, name] of [
      ["總經理", "E2E 總經理"],
      ["協理", "E2E 協理"],
      ["業務單位", "E2E 業務"],
      ["申請單位", "CUT"],
    ] as const) {
      await expect(signatureRow.getByText(`${label} 簽核欄：`)).toBeAttached();
      await expect(
        signatureRow.locator(".cc-formsheet__sign", { hasText: new RegExp(`^${label}$`) })
          .locator("+ .cc-formsheet__signspace .cc-formsheet__signname"),
      ).toHaveText(name);
    }

    // Only now does 分條 receive it, waiting in 待分派.
    const slittingManager = await actor("slittingManager");
    await slittingManager.goto(`${origin}${sheetPath}`);
    await expectState(slittingManager, "待生產");
    await expect(slittingManager.getByText(/尚未放入子分頁/)).toBeVisible();

    // Arrived with its review done, 分條's 主管 ticks its rows off, and a
    // ticked row turns green (the user, 2026-10-03).
    const firstTick = slittingManager.getByLabel("勾選第 1 列", { exact: true });
    await expect(firstTick).toBeEnabled();
    const firstRow = slittingManager.locator(".cc-formsheet__grid tbody tr").first();
    await expect(firstRow).not.toHaveClass(/cc-formsheet__row--marked/);
    const tickSaved = slittingManager.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().endsWith("/row-marks"),
    );
    await firstTick.check();
    expect((await tickSaved).status()).toBe(200);
    await expect(firstRow).toHaveClass(/cc-formsheet__row--marked/);
    await slittingManager.reload();
    await expect(slittingManager.getByLabel("勾選第 1 列", { exact: true })).toBeChecked();
    await expect(slittingManager.locator(".cc-formsheet__grid tbody tr").first()).toHaveClass(/cc-formsheet__row--marked/);
    // Unticking clears the green.
    const untickSaved = slittingManager.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().endsWith("/row-marks"),
    );
    await slittingManager.getByLabel("勾選第 1 列", { exact: true }).uncheck();
    expect((await untickSaved).status()).toBe(200);
    await expect(slittingManager.locator(".cc-formsheet__grid tbody tr").first()).not.toHaveClass(/cc-formsheet__row--marked/);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
