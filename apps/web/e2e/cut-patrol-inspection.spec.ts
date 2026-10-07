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
 * CUT's 首件/巡迴檢驗單, no review (the user, 2026-09-29), printed as the
 * paper is: 首件檢驗 with its core views beside it, six 製程 rounds headed
 * with when each was checked, the 公差 table beside 鋼捲號.
 */
const NAME = "首件/巡迴檢驗單";

test.describe("CUT 首件/巡迴檢驗單", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.cutOrderTaker });

  test("keeps readings, ticks, marks and each round's time", async ({ page }) => {
    test.setTimeout(120_000);
    await createSheetThroughHydratedForm(page, NAME, "CUT");
    const form = formSheetOf(page);
    await expect(form.locator(".cc-formsheet__title")).toHaveText(NAME);

    // Both blocks named down their left, the drawing beside 首件檢驗.
    await expect(form.locator(".cc-formsheet__sidelabel")).toHaveText(["首件檢驗", "製程檢驗"]);
    await expect(form.locator(".cc-formsheet__aside img")).toBeVisible();
    // The note sits at the foot of the cell, and the drawing takes the room
    // between it and 類型 (the user, 2026-10-02).
    const cell = (await form.locator(".cc-formsheet__aside").boundingBox())!;
    const note = (await form.locator(".cc-formsheet__aside-note").boundingBox())!;
    const drawing = (await form.locator(".cc-formsheet__aside img").boundingBox())!;
    expect(cell.y + cell.height - (note.y + note.height)).toBeLessThan(20);
    expect(drawing.height).toBeGreaterThan(cell.height * 0.6);
    await expect(form.locator(".cc-formsheet__aside")).toContainText(
      "※環形只檢驗:捲繞.尺寸及有無變形",
    );
    await expect(form.getByRole("columnheader", { name: "檢測值" })).toHaveAttribute("colspan", "3");

    // 首件: a reading, a tick across the readings, a ✓ and a ✗, and 類型.
    await form.getByLabel("首件檢驗 A 標準").fill("0.5");
    await form.getByLabel("首件檢驗 A 檢測值 2").fill("0.52");
    await form.getByRole("radiogroup", { name: "首件檢驗 A 判定" }).getByRole("radio", { name: "✓" }).check();
    await form.getByRole("radiogroup", { name: "首件檢驗 龜裂", exact: true }).getByRole("radio", { name: "無" }).check();
    await form.getByRole("radiogroup", { name: "首件檢驗 龜裂 判定" }).getByRole("radio", { name: "✗" }).check();
    await form.getByRole("radiogroup", { name: "類型" }).getByRole("radio", { name: "環型" }).check();

    // 製程: the first round's time, a reading and its verdict.
    await form.getByLabel("製程檢驗 第1次 檢驗時間 日").fill("29");
    await form.getByLabel("製程檢驗 第1次 檢驗時間 時").fill("08");
    await form.getByLabel("製程檢驗 第1次 檢驗時間 分").fill("30");
    await form.getByLabel("製程檢驗 A 第1次").fill("0.5");
    await form.getByRole("radiogroup", { name: "製程檢驗 判定 第1次" }).getByRole("radio", { name: "OK" }).check();
    await form.getByRole("textbox", { name: "鋼捲號" }).fill("C-101\nC-102");
    await saveSheet(page);

    await page.reload();
    const reloaded = formSheetOf(page);
    await expect(reloaded.getByLabel("首件檢驗 A 檢測值 2")).toHaveValue("0.52");
    await expect(
      reloaded.getByRole("radiogroup", { name: "首件檢驗 龜裂 判定" }).getByRole("radio", { name: "✗" }),
    ).toBeChecked();
    await expect(
      reloaded.getByRole("radiogroup", { name: "類型" }).getByRole("radio", { name: "環型" }),
    ).toBeChecked();
    await expect(reloaded.getByLabel("製程檢驗 第1次 檢驗時間 分")).toHaveValue("30");
    await expect(reloaded.getByRole("textbox", { name: "鋼捲號" })).toHaveValue("C-101\nC-102");

    // The API holds the same shape: nothing under a spanned tick, and 判定
    // takes only ✓ or ✗.
    expect(await patchSheetValue(page, "firstPiece.crack.reading2", "有")).toBe(403);
    expect(await patchSheetValue(page, "firstPiece.b1.verdict", "OK")).toBe(409);

    // No review: handing it on keeps it in CUT, waiting to start.
    await page.reload();
    await expect(page.getByRole("button", { name: "送出審核" })).toHaveCount(0);
    // No draft and no review (the user, 2026-09-30): it has been at 待生產
    // since it was created, and its status is set here by hand.
    await expect(page.getByRole("button", { name: "送交生產" })).toHaveCount(0);
    await expect(page.locator(".cc-page__header .cc-badge")).toHaveText("待生產");
    await setSheetStatus(page, "生產中");
  });
});
