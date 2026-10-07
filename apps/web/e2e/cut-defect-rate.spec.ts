import { expect, test } from "@playwright/test";
import {
  WORKFLOW_AUTH_FILES,
  createSheetThroughHydratedForm,
  formSheetOf,
  saveSheet,
  setSheetStatus,
} from "./support";

/**
 * 不良率統計表: the month in the title strip, over twenty-one work orders of
 * seven written columns. No review.
 */
const NAME = "不良率統計表";
const COLUMNS = ["工單號", "訂單數", "成品數", "不良數", "單顆重量", "良品總重", "不良重量"];

test.describe("CUT 不良率統計表", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.cutOrderTaker });

  test("opens as the blank worksheet prints it, and keeps what is written", async ({ page }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, NAME, "CUT");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(NAME);
    await expect(form.locator(".cc-formsheet__letterhead img")).toHaveAttribute(
      "src",
      "/templates/cut/letterhead.png",
    );
    await expect(form.locator(".cc-formsheet__doc")).toHaveText("文件編號：F/P5-09-02");
    await expect(form.locator("thead th")).toHaveText(COLUMNS);
    await expect(form.locator("tbody tr")).toHaveCount(21);
    await expect(form.locator(".cc-formsheet__no")).toHaveCount(0);

    await form.getByLabel("月份:").fill("6");
    await form.getByLabel("第 1 列 工單號").fill("900001");
    await form.getByLabel("第 1 列 不良數").fill("2");
    await saveSheet(page);
    await page.reload();
    const reloaded = formSheetOf(page);
    await expect(reloaded.getByLabel("月份:")).toHaveValue("6");
    await expect(reloaded.getByLabel("第 1 列 工單號")).toHaveValue("900001");
    await expect(reloaded.getByLabel("第 1 列 不良數")).toHaveValue("2");
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
