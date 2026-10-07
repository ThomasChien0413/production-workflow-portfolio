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
 * CUT成品檢查表: particulars with a ticked 判定, the 外觀尺寸 register headed by
 * a printed 尺寸 / 序號 corner, and the core views beside the 公差 table.
 * No review.
 */
const NAME = "CUT成品檢查表";

test.describe("CUT 成品檢查表", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.cutOrderTaker });

  test("opens as the document prints it", async ({ page }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, NAME, "CUT");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(NAME);
    await expect(form.locator(".cc-formsheet__letterhead img")).toHaveAttribute(
      "src",
      "/templates/cut/finished-inspection-letterhead.png",
    );
    await expect(form.getByLabel("工單號:")).toBeVisible();

    // 游標卡尺 is printed beside 檢查工具, and nothing can be typed there.
    await expect(form.getByRole("rowheader", { name: "游標卡尺" })).toBeVisible();

    // On the document's columns (version 2, 2026-10-02): 客戶名, 材質 and
    // 檢查工具 line up with boxes the same size, as do 規格, 數量 and 審查員,
    // and 日期 and 判定.
    const edges = async (label: string) => {
      const heading = form
        .locator("th.cc-formsheet__rowlabel")
        .filter({ hasText: new RegExp(`^${label}$`) });
      const rect = await heading.boundingBox();
      return [Math.round(rect!.x), Math.round(rect!.width)];
    };
    const boxEdges = async (label: string) => {
      const rect = await form.getByLabel(label, { exact: true }).locator("xpath=ancestor::td[1]").boundingBox();
      return [Math.round(rect!.x), Math.round(rect!.width)];
    };
    for (const column of [
      ["客戶名", "材質", "檢查工具"],
      ["規格", "數量", "審查員"],
      ["日期", "判定"],
    ]) {
      const [first, ...rest] = await Promise.all(column.map(edges));
      for (const other of rest) expect(other).toEqual(first);
    }
    // The boxes beneath one another are the same size; 規格's runs on to the edge.
    const [customer, material] = await Promise.all(["客戶名", "材質"].map(boxEdges));
    expect(material).toEqual(customer);
    const [quantity, reviewer] = await Promise.all(["數量", "審查員"].map(boxEdges));
    expect(reviewer).toEqual(quantity);
    await expect(form.getByRole("radiogroup", { name: "判定" }).getByRole("radio")).toHaveCount(2);

    const grid = form.locator("table.cc-formsheet__grid").filter({ hasText: "外觀尺寸" });
    await expect(grid.locator(".cc-formsheet__captionrow")).toContainText("單位: mm");
    await expect(grid.locator("thead tr").last().locator("th")).toHaveText([
      "檢查項次",
      "A",
      "B(Di)",
      "C(Do)",
      "D",
      "備註",
    ]);
    await expect(grid.locator("tbody tr")).toHaveCount(9);
    const corner = grid.locator("tbody .cc-formsheet__corner");
    await expect(corner).toHaveCount(1);
    await expect(corner).toContainText("尺寸");
    await expect(corner).toContainText("序號");
    await expect(corner.locator("input")).toHaveCount(0);
    await expect(form.getByLabel("尺寸 A")).toBeVisible();

    const reference = form.getByRole("group", { name: "尺寸位置與公差" });
    await expect(reference.locator("img")).toHaveAttribute(
      "src",
      "/templates/cut/finished-inspection-cores.svg",
    );
    await expect(reference.getByRole("row", { name: /200 ＞/ })).toContainText("+1.0");
    await expect(page.locator(".cc-page__header .cc-body-sm")).toContainText(
      "文件編號：F/P5-02-02",
    );
  });

  test("keeps a ticked 判定 and the measurements, and ticking again clears it", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, NAME, "CUT");
    const form = formSheetOf(page);
    await form.getByRole("radio", { name: "NG" }).check();
    await form.getByLabel("尺寸 A").fill("12.0");
    await form.getByLabel("第 2 列 檢查項次").fill("1");
    await saveSheet(page);
    await page.reload();
    const reloaded = formSheetOf(page);
    await expect(reloaded.getByRole("radio", { name: "NG" })).toBeChecked();
    await expect(reloaded.getByLabel("尺寸 A")).toHaveValue("12.0");
    await expect(reloaded.getByLabel("第 2 列 檢查項次")).toHaveValue("1");

    await reloaded.getByRole("radio", { name: "NG" }).click();
    await expect(reloaded.getByRole("radio", { name: "NG" })).not.toBeChecked();
    await expect(reloaded.getByRole("radio", { name: "OK" })).not.toBeChecked();
  });

  test("refuses a 判定 that is not a printed box, and a value in the corner", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, NAME, "CUT");
    expect(await patchSheetValue(page, "verdict", "MAYBE")).toBe(409);
    expect(await patchSheetValue(page, "dimensions.0.item", "看不見")).toBe(403);
    // 游標卡尺 is printed on the form, not a box: nothing may be stored there.
    expect(await patchSheetValue(page, "tool", "看不見")).toBe(403);
    expect(await patchSheetValue(page, "verdict", "OK")).toBe(200);
  });

  test("is handed on to production, with no review", async ({ page }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, NAME, "CUT");
    await expect(page.getByRole("button", { name: "送出審核" })).toHaveCount(0);
    // No draft and no review (the user, 2026-09-30): it has been at 待生產
    // since it was created, and its status is set here by hand.
    await expect(page.getByRole("button", { name: "送交生產" })).toHaveCount(0);
    await expect(page.locator(".cc-page__header .cc-badge")).toHaveText("待生產");
    await setSheetStatus(page, "生產中");
  });
});
