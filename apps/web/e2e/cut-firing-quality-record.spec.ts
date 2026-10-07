import { expect, test } from "@playwright/test";
import {
  WORKFLOW_AUTH_FILES,
  createSheetThroughHydratedForm,
  formSheetOf,
  saveSheet,
} from "./support";

/**
 * 燒炖質量記錄表: written in CUT or 沖壓 and sent on to 燒頓, no review (the
 * user, 2026-09-28). Handing it on sends it straight to 燒頓's 待分派.
 */
const NAME = "燒炖質量記錄表";

test.describe("燒炖質量記錄表", () => {
  test("is created in CUT and offers to send it to 燒頓", async ({ browser }) => {
    test.setTimeout(90_000);
    const cut = await browser.newContext({ storageState: WORKFLOW_AUTH_FILES.cutOrderTaker });
    const page = await cut.newPage();
    await createSheetThroughHydratedForm(page, NAME, "CUT");
    await expect(formSheetOf(page).locator(".cc-formsheet__title")).toHaveText(NAME);
    await expect(page.getByRole("button", { name: "送交燒頓", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "送出審核" })).toHaveCount(0);
    await cut.close();
  });

  test("is written in 沖壓 and sent on to 燒頓's 待分派", async ({ browser }) => {
    test.setTimeout(120_000);
    const stamping = await browser.newContext({
      storageState: WORKFLOW_AUTH_FILES.stampingOrderTaker,
    });
    const page = await stamping.newPage();
    await createSheetThroughHydratedForm(page, NAME, "沖壓");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(NAME);

    // Twelve headings over ten unnumbered rows, broken where the paper
    // breaks them.
    await expect(form.locator("thead th")).toHaveText([
      "工單號", "日期", "客戶\n簡稱", "規格/材質", "數量", "爐號/\n胆號",
      "燒炖\n時間", "燒炖\n溫度", "掀蓋\n溫度", "外觀\n色澤", "備註", "裝箱日/\n時間",
    ]);
    const furnace = form.locator("thead th").nth(5);
    await expect(furnace).toHaveCSS("white-space", "pre-line");
    expect(await furnace.evaluate((cell) => (cell as HTMLElement).innerText)).toBe("爐號/\n胆號");
    // Set smaller, as the paper sets it, so 裝箱日/ stays on one line.
    await expect(form.locator("thead th").last()).toHaveClass(/cc-formsheet__heading--small/);
    await expect(form.locator("tbody tr")).toHaveCount(10);
    await expect(form.locator(".cc-formsheet__no")).toHaveCount(0);
    await expect(page.locator(".cc-page__header .cc-body-sm")).toContainText(
      "文件編號：F/P4-01-02",
    );

    // A broken heading is still one name to a screen reader.
    await form.getByLabel("第 1 列 工單號").fill("W-1");
    await form.getByLabel("第 1 列 爐號/胆號").fill("3/12");
    await form.getByLabel("第 10 列 裝箱日/時間").fill("9/28 15:00");
    await saveSheet(page);

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
    await expect(formSheetOf(received).getByLabel("第 1 列 爐號/胆號")).toHaveValue("3/12");
    await expect(formSheetOf(received).getByLabel("第 10 列 裝箱日/時間")).toHaveValue(
      "9/28 15:00",
    );
    await expect(received.getByRole("button", { name: "送交燒頓" })).toHaveCount(0);
    await shaoDun.close();
  });
});
