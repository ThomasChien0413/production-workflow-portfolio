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
 * CUT's two daily reports, from one workbook and neither reviewed.
 *
 * 個人生產日報表 is one person's day: 姓名 and 日期 beside the title, six rows,
 * and the 工作代號 key inside the box. 生產日報表 is everyone's day: eight
 * people of eight rows, each name written once in a cell down its block.
 */
const PERSONAL = "CUT個人生產日報表";
const TEAM = "CUT生產日報表";

test.describe("CUT daily reports", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.cutOrderTaker });

  test("個人生產日報表 opens as the paper prints it", async ({ page }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, PERSONAL, "CUT");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(PERSONAL);

    // 姓名 over 日期, beside the title.
    const head = form.locator(".cc-formsheet__headfield");
    await expect(head).toHaveCount(2);
    await expect(head.nth(0)).toContainText("姓名");
    await expect(head.nth(1)).toContainText("日期");
    await expect(form.getByLabel("日期:")).toHaveAttribute("type", "date");

    await expect(form.locator("thead th")).toHaveText([
      "工作代號",
      "工作內容",
      "數量",
      "時間",
      "備註",
    ]);
    await expect(form.locator("tbody tr")).toHaveCount(6);
    await expect(form.locator(".cc-formsheet__no")).toHaveCount(0);

    // The 工作代號 key closes the box, from the left, never a field.
    const legend = form.locator("tfoot .cc-formsheet__legend--start");
    await expect(legend).toContainText("工作代號:");
    await expect(legend).toContainText("10.其他");
    await expect(legend).toHaveAttribute("colspan", "5");
    await expect(form.locator("tfoot input")).toHaveCount(0);

    await expect(page.locator(".cc-page__header .cc-body-sm")).toContainText(
      "文件編號：F/P5-04-01",
    );

    // Filled and kept.
    await form.getByLabel("姓名:").fill("王小明");
    await form.getByLabel("第 1 列 工作代號").fill("1");
    await saveSheet(page);
    await page.reload();
    await expect(formSheetOf(page).getByLabel("姓名:")).toHaveValue("王小明");
    await expect(formSheetOf(page).getByLabel("第 1 列 工作代號")).toHaveValue("1");
  });

  test("生產日報表 gives each person a block with their name down its side", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, TEAM, "CUT");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(TEAM);

    await expect(form.locator("thead th:not(.cc-formsheet__groupno)")).toHaveText([
      "姓名",
      "工作內容",
      "數量",
      "時間",
      "備註",
    ]);
    // Eight people of eight rows; one name cell each, numbered 1–8 outside
    // the box. None of the worksheet's printed names is carried over.
    await expect(form.locator("tbody.cc-formsheet__group")).toHaveCount(8);
    await expect(form.locator(".cc-formsheet__grid--grouped tbody tr")).toHaveCount(64);
    await expect(form.locator(".cc-formsheet__groupno[scope=rowgroup]")).toHaveText([
      "1", "2", "3", "4", "5", "6", "7", "8",
    ]);
    const names = form.locator("td.cc-formsheet__groupname");
    await expect(names).toHaveCount(8);
    await expect(names.first()).toHaveAttribute("rowspan", "8");
    await expect(names.locator("input").first()).toHaveValue("");

    // 經理 and 組長 sign beneath the grid; no document identifier.
    const signatures = form.locator(".cc-formsheet__band").last();
    await expect(signatures).toContainText("經理");
    await expect(signatures).toContainText("組長");
    await expect(page.locator(".cc-page__header .cc-body-sm")).not.toContainText("文件編號");

    await form.getByLabel("第 2 位 姓名").fill("王家威");
    await form.getByLabel("第 2 位 第 3 列 工作內容").fill("捲繞");
    await saveSheet(page);
    await page.reload();
    await expect(formSheetOf(page).getByLabel("第 2 位 姓名")).toHaveValue("王家威");
    await expect(formSheetOf(page).getByLabel("第 2 位 第 3 列 工作內容")).toHaveValue("捲繞");
  });

  test("生產日報表 refuses a name written under the spanning cell", async ({ page }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, TEAM, "CUT");
    // The cell a block's name covers does not exist to the API either.
    expect(await patchSheetValue(page, "entries.1.name", "看不見")).toBe(403);
  });

  test("both are handed on to production, with no review", async ({ page }) => {
    test.setTimeout(90_000);
    for (const name of [PERSONAL, TEAM]) {
      await createSheetThroughHydratedForm(page, name, "CUT");
      await expect(page.getByRole("button", { name: "送出審核" })).toHaveCount(0);
      // No draft and no review (the user, 2026-09-30): it has been at 待生產
      // since it was created, and its status is set here by hand.
      await expect(page.getByRole("button", { name: "送交生產" })).toHaveCount(0);
      await expect(page.locator(".cc-page__header .cc-badge")).toHaveText("待生產");
      await setSheetStatus(page, "生產中");
    }
  });
});
