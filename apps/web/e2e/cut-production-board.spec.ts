import { expect, test } from "@playwright/test";
import { WORKFLOW_AUTH_FILES, createSheetThroughHydratedForm, setSheetStatus } from "./support";

/**
 * 生產作業看板 is CUT's production board: seven columns over eight unnumbered
 * rows, closed by a printed legend that says what each 工序 code means. The
 * legend is part of the form, so it has to appear inside the ruled box and
 * never as something anyone can type in.
 */
const COLUMNS = ["工單號", "規格", "材質", "數量", "工序", "交期", "備註"];
const LEGEND =
  "定義： 捲繞 = (1)、油壓定型 = (2)、燒炖 = (3)、退模芯 = (4)、抽真空 = (5)、烘乾 = (6)、切割 = (7)、研磨 = (8)、包裝 = (9)";

test.describe("CUT 生產作業看板", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.cutOrderTaker });

  test("opens as the paper prints it", async ({ page }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, "生產作業看板", "CUT");

    const form = page
      .locator(".cc-formsheet")
      .filter({ has: page.locator(".cc-formsheet__title") });
    await expect(form.locator(".cc-formsheet__title")).toHaveText("生產作業看板");

    await expect(form.locator("thead th")).toHaveText(COLUMNS);
    await expect(form.locator("tbody tr")).toHaveCount(8);
    // The first column is 工單號, so no row is numbered.
    await expect(form.locator(".cc-formsheet__no")).toHaveCount(0);

    // The legend closes the register inside its box, across every column.
    const legend = form.locator("tfoot .cc-formsheet__legend");
    await expect(legend).toHaveText(LEGEND);
    await expect(legend).toHaveAttribute("colspan", String(COLUMNS.length));
    await expect(form.locator("tfoot input, tfoot textarea")).toHaveCount(0);

    await expect(page.locator(".cc-page__header .cc-body-sm")).toContainText(
      "文件編號：F/P5-01-01",
    );
    // No draft and no review: a new sheet starts at 待生產.
    await expect(page.locator(".cc-page__header").first()).toContainText("待生產");
  });

  test("starts at 待生產 and has its status set by hand, never sent for review", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, "生產作業看板", "CUT");

    // Nothing is reviewed or handed on, so nothing may promise either.
    await expect(page.getByRole("button", { name: "送出審核" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "送交生產" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "審核歷程" })).toHaveCount(0);
    await expect(page.locator(".cc-page__header .cc-badge")).toHaveText("待生產");

    // Any of the three, in any order.
    await setSheetStatus(page, "已完成");
    await setSheetStatus(page, "生產中");
    await setSheetStatus(page, "待生產");
  });

  test("keeps what is typed into 工序 as written", async ({ page }) => {
    test.setTimeout(90_000);
    await createSheetThroughHydratedForm(page, "生產作業看板", "CUT");

    const form = page
      .locator(".cc-formsheet")
      .filter({ has: page.locator(".cc-formsheet__title") });
    // 工序 is free text: the legend explains the codes, it does not limit
    // what may be written, so a code and a note both survive.
    const process = form.getByLabel("第 1 列 工序");
    await process.fill("(3) 燒炖中");
    // Nothing is written until 儲存 is pressed. Wait for the save itself: the
    // "all saved" status is also true before anything is typed, so it cannot
    // tell a finished save from none at all.
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        /^\/api\/sheets\/[^/]+\/values$/.test(new URL(response.url()).pathname) &&
        response.ok(),
    );
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    await saved;

    await page.reload();
    await expect(
      page
        .locator(".cc-formsheet")
        .filter({ has: page.locator(".cc-formsheet__title") })
        .getByLabel("第 1 列 工序"),
    ).toHaveValue("(3) 燒炖中");
  });
});
