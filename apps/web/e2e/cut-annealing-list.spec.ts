import { expect, test } from "@playwright/test";
import {
  WORKFLOW_AUTH_FILES,
  createSheetThroughHydratedForm,
  formSheetOf,
  saveSheet,
} from "./support";

/**
 * 退火明細表: written in CUT and sent on to 燒頓, no review. Handing it on
 * sends it straight to 燒頓's 待分派 (the user, 2026-09-27).
 */
const NAME = "退火明細表";

test.describe("CUT 退火明細表", () => {
  test("is written in CUT and sent on to 燒頓's 待分派", async ({ browser }) => {
    test.setTimeout(120_000);
    const cut = await browser.newContext({ storageState: WORKFLOW_AUTH_FILES.cutOrderTaker });
    const page = await cut.newPage();
    await createSheetThroughHydratedForm(page, NAME, "CUT");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(NAME);

    // Two blocks of five columns, edge to edge: nine printed rows.
    const grid = form.locator("table.cc-formsheet__grid--blocks");
    await expect(grid.locator("thead th")).toHaveText([
      "工單號", "規格", "材質", "數量", "重量",
      "工單號", "規格", "材質", "數量", "重量",
    ]);
    await expect(grid.locator("tbody tr")).toHaveCount(9);
    await expect(grid.locator(".cc-formsheet__blockgap")).toHaveCount(0);
    // 程式編號 is three boxes in one: before 第, between 第 and 程式, and
    // after 程式 (version 2, 2026-10-02).
    const program = form.locator("td").filter({ has: page.getByLabel("程式編號（第幾程式）") });
    await expect(program).toContainText("第");
    await expect(program).toContainText("程式");
    await expect(program.locator("input")).toHaveCount(3);
    for (const name of ["程式編號（第之前）", "程式編號（第幾程式）", "程式編號（程式之後）"]) {
      await expect(program.getByLabel(name, { exact: true })).toBeEditable();
    }
    // 編號, 爐號 and 程式編號 line up with boxes the same size, and so do
    // 起始時間, 溫度 and 外觀檢驗.
    const edges = async (label: string) => {
      const heading = form
        .locator("th.cc-formsheet__rowlabel")
        .filter({ hasText: new RegExp(`^${label}$`) });
      const box = await heading.boundingBox();
      const cell = await heading.locator("xpath=following-sibling::td[1]").boundingBox();
      return [box, cell].map((rect) => [Math.round(rect!.x), Math.round(rect!.width)]);
    };
    for (const column of [
      ["編號", "爐號", "程式編號"],
      ["起始時間", "溫度", "外觀檢驗"],
    ]) {
      const [first, ...rest] = await Promise.all(column.map(edges));
      for (const other of rest) expect(other).toEqual(first);
    }
    await expect(form.getByRole("radiogroup", { name: "外觀檢驗" }).getByRole("radio")).toHaveCount(2);

    await form.getByLabel("第 1 列 工單號").fill("W-1");
    await form.getByLabel("第 10 列 工單號").fill("W-10");
    await saveSheet(page);

    // Handing it on is named for where it goes.
    await expect(page.getByRole("button", { name: "送交生產" })).toHaveCount(0);
    await page.getByRole("button", { name: "送交燒頓", exact: true }).click();
    await expect(page.getByText("確認送交燒頓？", { exact: true })).toBeVisible();
    await expect(page.getByText(/送交後會移至燒頓的待分派/)).toBeVisible();
    await page.getByRole("button", { name: "確認送交", exact: true }).click();
    await expect(page.getByText("已送交燒頓", { exact: true })).toBeVisible();
    const sheetPath = new URL(page.url()).pathname;
    await cut.close();

    // 燒頓's 主管 finds it waiting, with nothing further to send it on to.
    const shaoDun = await browser.newContext({ storageState: WORKFLOW_AUTH_FILES.shaoDunManager });
    const received = await shaoDun.newPage();
    await received.goto("/departments/shao-dun");
    await expect(received.getByRole("link", { name: /待生產/ }).first()).toBeVisible();
    await received.goto(sheetPath);
    await expect(received.locator(".cc-page__header .cc-badge")).toHaveText("待生產");
    await expect(formSheetOf(received).getByLabel("第 10 列 工單號")).toHaveValue("W-10");
    await expect(received.getByRole("button", { name: "送交燒頓" })).toHaveCount(0);
    await shaoDun.close();
  });
});
