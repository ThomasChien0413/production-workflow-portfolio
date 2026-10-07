import { expect, test } from "@playwright/test";
import {
  WORKFLOW_AUTH_FILES,
  createSheetThroughHydratedForm,
  formSheetOf,
  saveSheet,
  setSheetStatus,
} from "./support";

/**
 * 沖壓's 生產作業看板: no review (the user, 2026-09-28). It shares CUT's
 * board's name; 沖壓 is offered only its own.
 */
const NAME = "生產作業看板";

test.describe("沖壓 生產作業看板", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.stampingOrderTaker });

  test("numbers twelve presses, and keeps what is on each and what waits", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await createSheetThroughHydratedForm(page, NAME, "沖壓");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(NAME);
    await expect(form.locator("thead th")).toHaveText([
      "編號", "規格材質", "日期", "預計產量", "待沖規格", "材質", "預計產量", "安裝日期", "備註",
    ]);
    await expect(form.locator("tbody tr")).toHaveCount(12);
    await expect(form.locator("tbody .cc-formsheet__no").last()).toHaveText("12");
    // 沖壓's own identifier, not CUT's board's F/P5-01-01.
    await expect(page.locator(".cc-page__header .cc-body-sm")).toContainText(
      "文件編號：F/P2-09-01",
    );

    // The two 預計產量 are told apart.
    await form.getByLabel("第 1 列 預計產量", { exact: true }).fill("3000");
    await form.getByLabel("第 1 列 待沖預計產量").fill("1200");
    await form.getByLabel("第 12 列 備註").fill("換模");
    await saveSheet(page);
    await page.reload();
    const reloaded = formSheetOf(page);
    await expect(reloaded.getByLabel("第 1 列 預計產量", { exact: true })).toHaveValue("3000");
    await expect(reloaded.getByLabel("第 1 列 待沖預計產量")).toHaveValue("1200");
    await expect(reloaded.getByLabel("第 12 列 備註")).toHaveValue("換模");

    // No review: handing it on keeps it in 沖壓, waiting to start.
    await expect(page.getByRole("button", { name: "送出審核" })).toHaveCount(0);
    // No draft and no review (the user, 2026-09-30): it has been at 待生產
    // since it was created, and its status is set here by hand.
    await expect(page.getByRole("button", { name: "送交生產" })).toHaveCount(0);
    await expect(page.locator(".cc-page__header .cc-badge")).toHaveText("待生產");
    await setSheetStatus(page, "生產中");
  });
});
