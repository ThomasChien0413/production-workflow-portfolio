import { expect, test } from "@playwright/test";
import {
  WORKFLOW_AUTH_FILES,
  createSheetThroughHydratedForm,
  formSheetOf,
  saveSheet,
  setSheetStatus,
} from "./support";

/**
 * 沖壓's 生產日報表: two sides, no review (the user, 2026-09-29). The back —
 * twelve spaces for the material labels — shows below the front.
 */
const NAME = "生產日報表";

test.describe("沖壓 生產日報表", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.stampingOrderTaker });

  test("writes the front's shared cells and the back's labels, and keeps them", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await createSheetThroughHydratedForm(page, NAME, "沖壓");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(NAME);

    // 上班: five boxes; writing the hours ticks 請假.
    const shift = form.getByRole("radiogroup", { name: "上班" });
    await expect(shift.getByRole("radio")).toHaveCount(5);
    await form.getByLabel("上班 請假").fill("4");
    await expect(shift.getByRole("radio", { name: "請假" })).toBeChecked();

    // Two heading rows: 箱重/箱數 runs down both, 不良品 spans three.
    const headingRows = form.locator("table.cc-formsheet__grid").last().locator("thead tr");
    await expect(headingRows).toHaveCount(2);
    await expect(headingRows.nth(0).locator("th")).toHaveText([
      "工單號", "起訖時間", "規格/\n材質", "材料\n重量", "箱重/箱數", "N品", "待燒",
      "太陽日", "次日續\n沖重量", "不良品", "異常原\n因備註",
    ]);
    await expect(headingRows.nth(1).locator("th")).toHaveText(["C級", "D級", "報廢"]);
    await expect(headingRows.nth(0).locator("th", { hasText: "箱重/箱數" })).toHaveAttribute(
      "rowspan",
      "2",
    );

    // Each part of a shared cell is its own box.
    await form.getByLabel("第 1 列 E 箱重").fill("25");
    await form.getByLabel("第 1 列 E 箱數").fill("3");
    await form.getByLabel("第 1 列 C級 E").fill("1.2");
    await form.getByLabel("第 1 列 C級 I").fill("0.8");
    await expect(
      form.locator("td.cc-formsheet__shared--stacked").first().locator("input"),
    ).toHaveCount(2);

    // The back, below the front, numbered down each column.
    const back = page.getByRole("region", { name: "背面" });
    await expect(back).toBeVisible();
    await expect(back.getByRole("textbox")).toHaveCount(12);
    const one = await back.getByLabel("背面 1", { exact: true }).boundingBox();
    const six = await back.getByLabel("背面 6", { exact: true }).boundingBox();
    const seven = await back.getByLabel("背面 7", { exact: true }).boundingBox();
    expect(six!.y).toBeGreaterThan(one!.y);
    expect(seven!.x).toBeGreaterThan(one!.x);
    expect(Math.abs(seven!.y - one!.y)).toBeLessThan(2);
    await back.getByLabel("背面 7", { exact: true }).fill("B-07");
    await saveSheet(page);

    await page.reload();
    const reloaded = formSheetOf(page);
    await expect(reloaded.getByLabel("上班 請假")).toHaveValue("4");
    await expect(reloaded.getByLabel("第 1 列 E 箱數")).toHaveValue("3");
    await expect(reloaded.getByLabel("第 1 列 C級 I")).toHaveValue("0.8");
    await expect(
      page.getByRole("region", { name: "背面" }).getByLabel("背面 7", { exact: true }),
    ).toHaveValue("B-07");

    // No review: handing it on keeps it in 沖壓, waiting to start.
    await expect(page.getByRole("button", { name: "送出審核" })).toHaveCount(0);
    // No draft and no review (the user, 2026-09-30): it has been at 待生產
    // since it was created, and its status is set here by hand.
    await expect(page.getByRole("button", { name: "送交生產" })).toHaveCount(0);
    await expect(page.locator(".cc-page__header .cc-badge")).toHaveText("待生產");
    await setSheetStatus(page, "生產中");
  });
});
