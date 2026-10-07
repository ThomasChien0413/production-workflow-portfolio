import { expect, test } from "@playwright/test";
import {
  WORKFLOW_AUTH_FILES,
  createSheetThroughHydratedForm,
  formSheetOf,
  patchSheetValue,
  saveSheet,
  setSheetStatus,
} from "./support";

/**
 * 產品需求表: 沖壓's, no review (the user, 2026-09-28). 交期 prints
 * `□庫存□其他：＿＿` — a box to tick, or a line written after 其他.
 */
const NAME = "產品需求表";

test.describe("沖壓 產品需求表", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.stampingOrderTaker });

  test("ticks 庫存, or writes after 其他, and keeps both", async ({ page }) => {
    test.setTimeout(120_000);
    await createSheetThroughHydratedForm(page, NAME, "沖壓");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(NAME);
    await expect(form.locator(".cc-formsheet__letterhead img")).toBeVisible();
    await expect(form.locator("thead th")).toHaveText([
      "製令NO：", "規格", "材質", "數量", "交期", "備註",
    ]);
    await expect(form.locator("tbody tr")).toHaveCount(22);
    await expect(page.locator(".cc-page__header .cc-body-sm")).toContainText(
      "文件編號：F/M1-03-01",
    );

    // Writing on the line after 其他 ticks 其他.
    const first = form.getByRole("radiogroup", { name: "第 1 列 交期" });
    await expect(first.getByRole("radio")).toHaveCount(2);
    await form.getByLabel("第 1 列 製令NO").fill("P8020802");
    await form.getByLabel("第 1 列 交期 其他").fill("2/23");
    await expect(first.getByRole("radio", { name: "其他" })).toBeChecked();
    // Ticking 庫存 leaves nothing written.
    const second = form.getByRole("radiogroup", { name: "第 2 列 交期" });
    await second.getByRole("radio", { name: "庫存" }).check();
    await expect(form.getByLabel("第 2 列 交期 其他")).toHaveValue("");
    await saveSheet(page);

    await page.reload();
    const reloaded = formSheetOf(page);
    await expect(
      reloaded.getByRole("radiogroup", { name: "第 1 列 交期" }).getByRole("radio", { name: "其他" }),
    ).toBeChecked();
    await expect(reloaded.getByLabel("第 1 列 交期 其他")).toHaveValue("2/23");
    await expect(
      reloaded.getByRole("radiogroup", { name: "第 2 列 交期" }).getByRole("radio", { name: "庫存" }),
    ).toBeChecked();
    await expect(reloaded.getByLabel("第 1 列 製令NO")).toHaveValue("P8020802");

    // The API holds the same rule: a value no box can show is refused.
    expect(await patchSheetValue(page, "demands.3.delivery", "2/23")).toBe(409);
    expect(await patchSheetValue(page, "demands.3.delivery", "其他：下週")).toBe(200);

    // No review: handing it on keeps it in 沖壓, waiting to start.
    await page.reload();
    await expect(page.getByRole("button", { name: "送出審核" })).toHaveCount(0);
    // No draft and no review (the user, 2026-09-30): it has been at 待生產
    // since it was created, and its status is set here by hand.
    await expect(page.getByRole("button", { name: "送交生產" })).toHaveCount(0);
    await expect(page.locator(".cc-page__header .cc-badge")).toHaveText("待生產");
    await setSheetStatus(page, "生產中");
  });
});
