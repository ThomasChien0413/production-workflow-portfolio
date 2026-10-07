import { expect, test } from "@playwright/test";
import {
  WORKFLOW_AUTH_FILES,
  createSheetThroughHydratedForm,
  formSheetOf,
  saveSheet,
  patchSheetValue,
  setSheetStatus,
} from "./support";

/**
 * CUT's characteristic inspections, four forms from one workbook, none
 * reviewed: 特性檢驗報告單, 崧貿's copy, 巧力's 出廠檢驗單 and 信太's version
 * 2.0.
 */
const BASE = "特性檢驗報告單";
const SONGMAO = "特性檢驗報告單（崧貿）";
const CHIAOLI = "出廠檢驗單（巧力）";
const SHINTAI = "特性檢驗報告單（信太）";

/** A printed label's left edge and width, rounded to the pixel. */
async function labelEdges(form: ReturnType<typeof formSheetOf>, label: string) {
  const heading = form
    .locator("th.cc-formsheet__rowlabel")
    .filter({ hasText: new RegExp(`^${label}$`) });
  const rect = await heading.boundingBox();
  return [Math.round(rect!.x), Math.round(rect!.width)];
}

/** Labels that should stand in one column, each the same width. */
async function expectColumn(form: ReturnType<typeof formSheetOf>, labels: string[]) {
  const [first, ...rest] = await Promise.all(labels.map((label) => labelEdges(form, label)));
  for (const other of rest) expect(other).toEqual(first);
}

test.describe("CUT 特性檢驗報告單", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.cutOrderTaker });

  test("writes the standard under each heading and the tests below it", async ({ page }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, BASE, "CUT");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(BASE);

    // The header on the worksheet's columns (version 2, 2026-10-02).
    await expectColumn(form, ["客戶", "工單號", "品名", "電壓"]);
    await expectColumn(form, ["規格", "頻率"]);
    await expectColumn(form, ["材質", "匝數"]);
    // 出貨數量, 抽樣數量 and 檢驗者 are written in about column A's width, and
    // the A–D views take the room beside them.
    await expectColumn(form, ["出貨數量", "抽樣數量", "檢驗者"]);
    const formWidth = (await form.locator("table").first().boundingBox())!.width;
    const views = await form.locator(".cc-formsheet__fieldaside img").boundingBox();
    for (const name of ["出貨數量（PCS）", "抽樣數量（PCS）", "檢驗者"]) {
      const box = await form.getByLabel(name, { exact: true }).locator("xpath=ancestor::td[1]").boundingBox();
      expect(box!.width).toBeLessThan(formWidth * 0.2);
      expect(views!.x).toBeGreaterThan(box!.x + box!.width);
    }
    expect(views!.height).toBeGreaterThan(150);

    const grid = form.locator("table.cc-formsheet__grid").filter({ hasText: "鐵損" });
    const corner = grid.locator("thead .cc-formsheet__corner");
    await expect(corner).toContainText("標準值");
    await expect(corner).toContainText("測試值");
    await expect(grid.locator("thead tr.cc-formsheet__standard")).toHaveCount(1);
    await expect(grid.locator("tbody tr")).toHaveCount(15);
    // Units are printed in the cells.
    await expect(grid.locator("tbody tr").first()).toContainText("mA");
    await expect(grid.locator("tbody tr").first()).toContainText("W");

    await form.getByLabel("標準值 A").fill("12.0");
    await form.getByLabel("第 1 列 測試值").fill("1");
    await form.getByLabel("第 1 列 電流").fill("35");
    await saveSheet(page);
    await page.reload();
    await expect(formSheetOf(page).getByLabel("標準值 A")).toHaveValue("12.0");
    await expect(formSheetOf(page).getByLabel("第 1 列 測試值")).toHaveValue("1");
    await expect(formSheetOf(page).getByLabel("第 1 列 電流")).toHaveValue("35");

    // The corner covers the standard row's first cell.
    expect(await patchSheetValue(page, "tests.0.sample", "看不見")).toBe(403);
  });

  test("numbers 崧貿's tests 1 to 15 under a ruled standard", async ({ page }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, SONGMAO, "CUT");
    const form = formSheetOf(page);
    const grid = form.locator("table.cc-formsheet__grid").filter({ hasText: "鐵損" });
    await expect(grid.locator("thead .cc-formsheet__corner")).toContainText("位置");
    await expect(grid.locator("tbody .cc-formsheet__no")).toHaveText(
      Array.from({ length: 15 }, (_, index) => String(index + 1)),
    );
    await expect(form.getByRole("rowheader", { name: "崧貿" })).toBeVisible();
  });

  test("prints 巧力's ten readings side by side", async ({ page }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, CHIAOLI, "CUT");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__headerline").first()).toContainText("TO: 採購部");
    await expect(form.locator(".cc-formsheet__headerline").last()).toContainText("巧力工業股份有限公司");
    await expect(form.locator(".cc-formsheet__letterhead")).toHaveCount(0);
    await expectColumn(form, ["1.電壓", "匝數"]);
    await expectColumn(form, ["品名", "訂號"]);
    const grid = form.locator("table.cc-formsheet__grid--blocks");
    await expect(grid.locator("tbody tr")).toHaveCount(5);
    await expect(grid.locator("tbody tr").first().locator(".cc-formsheet__no")).toHaveText(["1", "6"]);
    await form.getByLabel("第 6 列 激磁電流").fill("30");
    await saveSheet(page);
    await page.reload();
    await expect(formSheetOf(page).getByLabel("第 6 列 激磁電流")).toHaveValue("30");
  });

  test("ticks 信太's rows 合格 or 不合格 and refuses anything else", async ({ page }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, SHINTAI, "CUT");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__footdoc")).toContainText("VER 2.0");
    // Each pair of readings is written in one box (version 2, 2026-10-02).
    await expect(form.getByLabel("電壓(2)", { exact: true })).toBeVisible();
    await expect(form.getByLabel("電流(1)最小值", { exact: true })).toBeVisible();
    await expectColumn(form, ["客戶", "品名", "頻率", "電壓"]);
    await expectColumn(form, ["訂購單號", "規格", "匝數"]);
    await expectColumn(form, ["檢驗日期", "材質", "客戶單號"]);
    // The toroid's views sit beside 檢驗者 and 備註, as the worksheet sets them.
    const toroid = await form.locator(".cc-formsheet__fieldaside img").boundingBox();
    for (const name of ["檢驗者", "備註"]) {
      const box = await form.getByLabel(name, { exact: true }).locator("xpath=ancestor::td[1]").boundingBox();
      expect(toroid!.x).toBeGreaterThan(box!.x + box!.width);
    }
    expect(toroid!.height).toBeGreaterThan(100);
    const firstCheck = form.getByRole("radiogroup", { name: "第 1 列 尺寸/外觀檢查" });
    await firstCheck.getByRole("radio", { name: "不合格" }).check();
    await form.getByLabel("客戶單號").fill("12345");
    await saveSheet(page);
    await page.reload();
    await expect(
      formSheetOf(page)
        .getByRole("radiogroup", { name: "第 1 列 尺寸/外觀檢查" })
        .getByRole("radio", { name: "不合格" }),
    ).toBeChecked();
    expect(await patchSheetValue(page, "tests.2.check", "MAYBE")).toBe(409);
    expect(await patchSheetValue(page, "tests.2.check", "合格")).toBe(200);
  });

  test("all four are handed on to production, with no review", async ({ page }) => {
    test.setTimeout(120_000);
    for (const name of [BASE, SONGMAO, CHIAOLI, SHINTAI]) {
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
