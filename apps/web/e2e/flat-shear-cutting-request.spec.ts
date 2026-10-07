import { expect, test } from "@playwright/test";
import { WORKFLOW_AUTH_FILES, createSheetThroughHydratedForm, formSheetOf } from "./support";

/**
 * 平板剪's 裁剪需求表, version 2 (the user, 2026-10-02): the header laid on
 * the Word table's own columns, so its labels and boxes line up and keep the
 * document's sizes.
 */
const NAME = "裁剪需求表";

test.describe("平板剪 裁剪需求表", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.flatShearOrderTaker });

  test("lines its header up on the document's columns", async ({ page }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, NAME, "平板剪");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(NAME);

    // A label's cell and the box after it, each as [left edge, width].
    const label = (text: string) =>
      form.locator("th.cc-formsheet__rowlabel").filter({ hasText: new RegExp(`^${text}$`) });
    const edges = async (text: string) => {
      const heading = label(text);
      return Promise.all(
        [heading, heading.locator("xpath=following-sibling::td[1]")].map(async (cell) => {
          const rect = (await cell.boundingBox())!;
          return [Math.round(rect.x), Math.round(rect.width)];
        }),
      );
    };

    // The second and third rows share every column, label and box alike.
    for (const [upper, lower] of [
      ["工單號", "綁柱長度"],
      ["材質", "台數"],
      ["變壓器容量", "機台"],
      ["積厚", "作業員"],
    ]) {
      expect(await edges(lower!)).toEqual(await edges(upper!));
    }
    // The first row's 交期 starts where 變壓器容量's box does, as on paper.
    const [delivery] = await edges("交期");
    const [, capacityBox] = await edges("變壓器容量");
    expect(delivery![0]).toBe(capacityBox![0]);
    expect(delivery![1]).toBe(capacityBox![1]);

    // 產品規格 is ruled across the full width above 項目 and its headings.
    const products = form.locator("table.cc-formsheet__grid").filter({ hasText: "項目" });
    await expect(products.locator(".cc-formsheet__captionrow")).toHaveText("產品規格");
  });
});
