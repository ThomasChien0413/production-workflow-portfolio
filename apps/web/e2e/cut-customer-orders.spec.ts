import { expect, test } from "@playwright/test";
import {
  WORKFLOW_AUTH_FILES,
  createSheetThroughHydratedForm,
  openCreationSubpage,
} from "./support";

/**
 * CUT keeps three different customer order registers on paper, and the
 * operator picks the one the customer's order belongs on. They are separate
 * templates rather than one template in three shapes, so what matters here is
 * that the picker offers all three under names that tell them apart and that
 * the chosen one is the form that opens.
 */
const REGISTERS = [
  {
    template: "CUT客戶訂購表",
    identifier: "文件編號：F/P5-07-01",
    columns: [
      "訂貨日",
      "客戶",
      "品名/規格",
      "數量",
      "單價",
      "交期",
      "備註",
      "訂號/工單號",
    ],
    rowCount: 25,
    diagonalCells: 25,
    headerNote: null,
    spacers: 0,
  },
  {
    template: "客戶訂購表（大銀·直得）",
    // This paper prints no identifier, so the page prints none either.
    identifier: null,
    columns: [
      "日期",
      "採購單號/工單號",
      "品號/品名/規格",
      "模具編號/圖號",
      "數量PCS",
      "單價",
      "總金額",
      "旭日期",
      "出貨日期",
      "入帳年/月",
      "備註",
    ],
    rowCount: 16,
    // Four date columns, ruled corner to corner on every row.
    diagonalCells: 64,
    headerNote: null,
    spacers: 0,
  },
  {
    template: "CUT客戶訂單表（士電）",
    identifier: "文件編號：F/P5-07-01",
    columns: [
      "訂日",
      "訂購案號",
      "出貨日期",
      "品名",
      "數量",
      "標籤",
      "交期",
      "備註",
      "日期/發票號碼",
      // The worksheet's own gap prints no heading, then the weight block.
      "",
      "單顆重量",
      "總重",
    ],
    rowCount: 21,
    diagonalCells: 0,
    headerNote: "士林電機",
    // The worksheet holds its weight block off the form with one gap column.
    spacers: 1,
  },
] as const;

test.describe("CUT 客戶訂購表", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.cutOrderTaker });

  test("offers all three registers under names that tell them apart", async ({
    page,
  }) => {
    await openCreationSubpage(page, "CUT");
    await expect(
      page.getByRole("button", { name: "建立生產單", exact: true }),
    ).toBeEnabled({ timeout: 30_000 });
    const labels = await page
      .getByLabel("表單範本")
      .locator("option")
      .evaluateAll((options) => options.map((option) => option.textContent));
    for (const register of REGISTERS) {
      expect(labels).toContain(register.template);
    }
    // Three distinct entries, not one repeated under the same name.
    expect(new Set(labels).size).toBe(labels.length);
  });

  for (const register of REGISTERS) {
    test(`opens ${register.template} as the paper prints it`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await createSheetThroughHydratedForm(page, register.template, "CUT");

      const form = page
        .locator(".cc-formsheet")
        .filter({ has: page.locator(".cc-formsheet__title") });
      await expect(form.locator(".cc-formsheet__title")).toHaveText(
        register.template,
      );

      // Every printed heading, in printed order.
      // The spacer is a <td> in the heading row, not a <th>: it is a gap, not
      // a column anyone reads. Both are checked, in printed order.
      await expect(form.locator("thead tr").first().locator("th, td")).toHaveText([
        ...register.columns,
      ]);
      await expect(form.locator("tbody tr")).toHaveCount(register.rowCount);
      // The register numbers no rows: its first column is the form's own.
      await expect(form.locator(".cc-formsheet__no")).toHaveCount(0);

      // The cells the paper rules corner to corner.
      await expect(form.locator(".cc-formsheet__diagonal")).toHaveCount(
        register.diagonalCells,
      );

      const doc = page.locator(".cc-page__header .cc-body-sm");
      if (register.identifier === null) {
        await expect(doc).not.toContainText("文件編號");
      } else {
        await expect(doc).toContainText(register.identifier);
      }

      const note = form.locator(".cc-formsheet__headernote");
      if (register.headerNote === null) {
        await expect(note).toHaveCount(0);
      } else {
        await expect(note).toHaveText(register.headerNote);
      }

      // The cells the worksheet fills with its own colours.
      await expect(form.locator(".cc-formsheet__spacer")).toHaveCount(
        register.spacers * (register.rowCount + 1),
      );

      // No draft and no review: a new sheet starts at 待生產.
      await expect(page.locator(".cc-page__header").first()).toContainText(
        "待生產",
      );
    });
  }

  test("works 士電's 總重 out from the row as the worksheet does", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, "CUT客戶訂單表（士電）", "CUT");

    const form = page
      .locator(".cc-formsheet")
      .filter({ has: page.locator(".cc-formsheet__title") });
    const firstRow = form.locator("tbody tr").first();
    const total = firstRow.locator(".cc-formsheet__computed");

    // Nothing entered: the cell stays blank rather than showing a zero.
    await expect(total).toHaveText("");

    // The worksheet's own first row: 60 x 2.09 is 125.4 and the paper says 126,
    // because the formula rounds up.
    // By name, not position: 品名 is a two-line box since version 2, not an
    // input, so counting inputs would land on the wrong cells.
    await firstRow.getByRole("textbox", { name: "第 1 列 數量", exact: true }).fill("60");
    await firstRow.getByRole("textbox", { name: "第 1 列 單顆重量", exact: true }).fill("2.09");
    await expect(total).toHaveText("126");

    // 品名 is written on two lines, as the worksheet writes it (2026-10-02).
    const productName = firstRow.getByRole("textbox", { name: "第 1 列 品名", exact: true });
    await expect(productName).toHaveJSProperty("tagName", "TEXTAREA");
    await expect(productName).toHaveAttribute("rows", "2");
    await productName.fill("(不含浸) 2.09K\n(不切) DEMO-PART(38*98) 30W");
    await expect(productName).toHaveValue("(不含浸) 2.09K\n(不切) DEMO-PART(38*98) 30W");

    // Nobody types in a computed cell, so it is not an input at all.
    await expect(total).toHaveJSProperty("tagName", "OUTPUT");
  });
});
