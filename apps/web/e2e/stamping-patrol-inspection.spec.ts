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
 * 沖壓 and 平板剪's 首件/巡迴檢驗單 (the user, 2026-09-30): one form both
 * departments write and each keeps, no review. 公差 is printed beside a
 * written 標準, 外觀 is ticked once across the readings with its 判定
 * written, and each 製程 round's 製令單號 and 規格 sit above its time.
 */
const NAME = "首件/巡迴檢驗單";

test.describe("沖壓・平板剪 首件/巡迴檢驗單", () => {
  test("is written in 沖壓 with 公差 printed and 外觀 ticked across the readings", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ storageState: WORKFLOW_AUTH_FILES.stampingOrderTaker });
    const page = await context.newPage();
    await createSheetThroughHydratedForm(page, NAME, "沖壓");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(NAME);
    await expect(form.locator(".cc-formsheet__sidelabel")).toHaveText(["首件檢驗", "製程檢驗"]);
    await expect(form.locator(".cc-formsheet__aside")).toContainText("尺寸公差：±0.1mm");

    // 公差 is printed, never an entry.
    const firstPiece = form.locator(".cc-formsheet__printedmatrix").first();
    await expect(firstPiece.locator("td.cc-formsheet__standard")).toHaveText([
      "≦0.1", "±0.1", "±0.1", "±0.1", "±1", "", "±0.1",
    ]);
    await expect(form.getByLabel("首件檢驗 A 公差")).toHaveCount(0);

    // 首件: a 標準 and a reading, 積厚 in mm, 外觀 ticked with a written 判定.
    await form.getByLabel("首件檢驗 A 標準").fill("30");
    await form.getByLabel("首件檢驗 A 檢測值 2").fill("30.05");
    await form.getByLabel("首件檢驗 積厚 標準（mm）").fill("12");
    await form.getByRole("radiogroup", { name: "首件檢驗 劃傷", exact: true }).getByRole("radio", { name: "無" }).check();
    await form.getByLabel("首件檢驗 劃傷 判定").fill("OK");
    await form.getByRole("radiogroup", { name: "類型" }).getByRole("radio", { name: "EI" }).check();

    // 製程: 製令單號 above the first round's time, a 積厚 and an 有/無.
    const rounds = form.locator(".cc-formsheet__printedmatrix").nth(1);
    await expect(rounds.locator("tr").first()).toContainText("製令單號");
    await form.getByLabel("製程檢驗 製令單號 第1次").fill("W-1");
    await form.getByLabel("製程檢驗 第1次 檢驗時間 時").fill("08");
    await form.getByLabel("製程檢驗 積厚 第1次（mm）").fill("12.1");
    await form.getByRole("radiogroup", { name: "製程檢驗 鏽斑 第1次" }).getByRole("radio", { name: "無" }).check();
    await form.getByRole("radiogroup", { name: "品質判定" }).getByRole("radio", { name: "合格", exact: true }).check();
    await saveSheet(page);

    await page.reload();
    const reloaded = formSheetOf(page);
    await expect(reloaded.getByLabel("首件檢驗 A 檢測值 2")).toHaveValue("30.05");
    await expect(reloaded.getByLabel("首件檢驗 劃傷 判定")).toHaveValue("OK");
    await expect(reloaded.getByLabel("製程檢驗 製令單號 第1次")).toHaveValue("W-1");
    await expect(
      reloaded.getByRole("radiogroup", { name: "類型" }).getByRole("radio", { name: "EI" }),
    ).toBeChecked();

    // The API holds the same shape: nothing is written into 公差.
    expect(await patchSheetValue(page, "firstPiece.a.tolerance", "±0.2")).toBe(403);

    // Kept in 沖壓: nothing to send, its status set here.
    await expect(page.getByRole("button", { name: /^送交/ })).toHaveCount(0);
    await expect(page.locator(".cc-page__header .cc-badge")).toHaveText("待生產");
    await setSheetStatus(page, "生產中");
    await context.close();
  });

  test("is written in 平板剪 and kept there", async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ storageState: WORKFLOW_AUTH_FILES.flatShearOrderTaker });
    const page = await context.newPage();
    await createSheetThroughHydratedForm(page, NAME, "平板剪");
    await expect(formSheetOf(page).locator(".cc-formsheet__title")).toHaveText(NAME);
    // Not sent to 沖壓, the form's owner: 平板剪 sets its status.
    await expect(page.getByRole("button", { name: /^送交/ })).toHaveCount(0);
    await expect(page.locator(".cc-breadcrumb")).toContainText("平板剪");
    await setSheetStatus(page, "已完成");
    await context.close();
  });
});
