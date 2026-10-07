import { expect, test } from "@playwright/test";
import {
  WORKFLOW_AUTH_FILES,
  createSheetThroughHydratedForm,
  formSheetOf,
  saveSheet,
} from "./support";

/**
 * 待燒入庫表: written in 沖壓 and sent on to 燒頓, no review (the user,
 * 2026-09-28). Handing it on sends it straight to 燒頓's 待分派.
 */
const NAME = "待燒入庫表";

test.describe("沖壓 待燒入庫表", () => {
  test("is written in 沖壓 and sent on to 燒頓's 待分派", async ({ browser }) => {
    test.setTimeout(120_000);
    const stamping = await browser.newContext({
      storageState: WORKFLOW_AUTH_FILES.stampingOrderTaker,
    });
    const page = await stamping.newPage();
    await createSheetThroughHydratedForm(page, NAME, "沖壓");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(NAME);

    // 序 numbers twenty-five rows beside the four written columns.
    await expect(form.locator("thead th")).toHaveText([
      "序", "入庫日", "規格/材質", "重量/箱數", "倉位/備註",
    ]);
    await expect(form.locator("tbody tr")).toHaveCount(25);
    await expect(form.locator("tbody .cc-formsheet__no").first()).toHaveText("1");
    await expect(form.locator("tbody .cc-formsheet__no").last()).toHaveText("25");
    await expect(page.locator(".cc-page__header .cc-body-sm")).toContainText(
      "文件編號：F/P4-02-01",
    );

    await form.getByLabel("第 1 列 規格/材質").fill("EI-66 / 50CS600");
    await form.getByLabel("第 25 列 倉位/備註").fill("B-3");
    await saveSheet(page);

    // Handing it on is named for where it goes.
    await expect(page.getByRole("button", { name: "送交生產" })).toHaveCount(0);
    await page.getByRole("button", { name: "送交燒頓", exact: true }).click();
    await expect(page.getByText("確認送交燒頓？", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "確認送交", exact: true }).click();
    await expect(page.getByText("已送交燒頓", { exact: true })).toBeVisible();
    const sheetPath = new URL(page.url()).pathname;
    await stamping.close();

    // 燒頓's 主管 finds it waiting, with nothing further to send it on to.
    const shaoDun = await browser.newContext({ storageState: WORKFLOW_AUTH_FILES.shaoDunManager });
    const received = await shaoDun.newPage();
    await received.goto(sheetPath);
    await expect(received.locator(".cc-page__header .cc-badge")).toHaveText("待生產");
    await expect(formSheetOf(received).getByLabel("第 1 列 規格/材質")).toHaveValue(
      "EI-66 / 50CS600",
    );
    await expect(formSheetOf(received).getByLabel("第 25 列 倉位/備註")).toHaveValue("B-3");
    await expect(received.getByRole("button", { name: "送交燒頓" })).toHaveCount(0);
    await shaoDun.close();
  });
});
