import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createSheetThroughHydratedForm, WORKFLOW_AUTH_FILES } from "./support";

const SCREENSHOT_CSS = fileURLToPath(new URL("./screenshot.css", import.meta.url));

/**
 * Pixel regression, deliberately narrow.
 *
 * The rule-based specs next door already say *which* element overflows and by
 * how much, and they say it on every platform. What they cannot see is a
 * colour, weight or spacing drift that breaks nothing and looks wrong. That is
 * what these catch, and it is all they are for.
 *
 * Two things keep them from becoming the flaky suite everyone eventually
 * deletes.
 *
 * **Baselines are Linux-only.** Playwright stores a baseline per platform
 * because text rasterisation differs per platform. Form CI uses GitHub-hosted
 * Ubuntu 24.04; neutral login branding has a separate Windows visual suite.
 * A Windows or macOS baseline committed here would fail every CI run, so these
 * tests skip anywhere else rather than invite a developer to overwrite the
 * committed set with their own machine's rendering. To regenerate, run the
 * suite inside the Playwright container — the command is in README.md.
 *
 * **They photograph the things that do not move.** The signed-in shell carries
 * timestamps, sheet ids, presence and unread counts, none of which belong in a
 * baseline. So the subject is the printed form itself — the artifact that must
 * stay faithful to the paper it replaces — and the signed-out screen, which has
 * no data at all.
 */
test.describe("visual regression", () => {
  // `VISUAL_LOCAL=1` runs them anyway, against this machine's own baselines.
  // That is for looking at something while working on it; those files live
  // under their own platform directory and are not committed.
  test.skip(
    process.platform !== "linux" && !process.env.VISUAL_LOCAL,
    "Baselines are Linux-only; set VISUAL_LOCAL=1 to run against this platform.",
  );

  const VIEWPORTS = [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1366, height: 900 },
  ] as const;

  /**
   * Fonts are self-hosted and arrive as one slice per unicode range, so a
   * screenshot taken before they settle photographs the fallback face. This is
   * the single most likely cause of a spurious diff.
   */
  async function settled(page: import("@playwright/test").Page) {
    await page.evaluate(() => document.fonts.ready);
  }

  /**
   * Wait until an element has stopped growing.
   *
   * The sheet page keeps changing height for a moment after the form is
   * visible — hydration swaps the production-action placeholder for the real
   * controls, and the grid finishes laying out. Capturing during that produced
   * baselines of two different heights from the same screen, which is the one
   * failure mode that would have made this suite untrustworthy: a red build
   * that means nothing. Two identical measurements in a row is enough.
   */
  async function stable(locator: import("@playwright/test").Locator) {
    let previous = -1;
    await expect
      .poll(
        async () => {
          const height = (await locator.boundingBox())?.height ?? 0;
          const unchanged = height > 0 && height === previous;
          previous = height;
          return unchanged;
        },
        { timeout: 15_000, intervals: [250] },
      )
      .toBe(true);
  }

  /**
   * One per confirmed source document. These are transcriptions of paper that
   * the shop floor still prints, so a drift in a column width or a rule is a
   * defect against the document, not a matter of taste.
   */
  // Each is created by a manager of the department that owns it — a template
  // is only offered to the departments its definition allows.
  const TEMPLATES = [
    { name: "分條申請單", fixture: "slittingManager", department: "分條" },
    { name: "分條製令單", fixture: "slittingManager", department: "分條" },
    { name: "分條排刀單", fixture: "slittingManager", department: "分條" },
    { name: "倉位入庫表", fixture: "originManager", department: "倉管" },
    // Opened by the 訂單人員 rather than the 主管: the department's order side
    // is the one that starts this form, and the picture must show the cells
    // they may not touch as closed.
    { name: "裁剪需求表", shot: "裁剪需求表（第2版）", fixture: "flatShearOrderTaker", department: "平板剪" },
    // 沖壓's register is opened by its 主管 or 訂單人員; the picture must show
    // the form with no row-number column, as the paper prints it.
    { name: "EI客戶訂購表", fixture: "stampingOrderTaker", department: "沖壓" },
    // CUT's work order carries both a header and a process matrix, so it is
    // the picture that catches either one drifting. Version 2 lays the header
    // on the worksheet's columns (2026-10-02); the picture is named for it,
    // so CI adopts it as new instead of failing on the old one.
    { name: "加工製令單", shot: "加工製令單（第2版）", fixture: "cutOrderTaker", department: "CUT" },
    // CUT keeps three different customer registers. They are separate forms,
    // not versions of one, so each gets its own picture: the generic one, the
    // eleven-column 大銀.直得 sheet that prints no identifier, and 士電's,
    // which names its customer beside the title.
    { name: "CUT客戶訂購表", fixture: "cutOrderTaker", department: "CUT" },
    {
      name: "客戶訂購表（大銀·直得）",
      fixture: "cutOrderTaker",
      department: "CUT",
    },
    // Version 2 writes 品名 on two lines (2026-10-02); the picture is named
    // for it, so CI adopts it as new instead of failing on the old one.
    {
      name: "CUT客戶訂單表（士電）",
      shot: "CUT客戶訂單表（士電）（第2版）",
      fixture: "cutOrderTaker",
      department: "CUT",
    },
    // CUT's production board: landscape, and the one register that closes on
    // a printed legend, so it is the picture that catches either drifting.
    { name: "生產作業看板", fixture: "cutOrderTaker", department: "CUT" },
    // CUT's daily reports: the only header that stacks two fields beside the
    // title, the only left-set two-line legend, and the only form of people —
    // row blocks with a name cell down each.
    { name: "CUT個人生產日報表", fixture: "cutOrderTaker", department: "CUT" },
    { name: "CUT生產日報表", fixture: "cutOrderTaker", department: "CUT" },
    // The only form with boxes to tick, a printed corner cell and a closing
    // reference band of drawings and tolerances.
    { name: "CUT成品檢查表", shot: "CUT成品檢查表（第2版）", fixture: "cutOrderTaker", department: "CUT" },
    // The standard row, joined and ruled; side-by-side blocks under printed
    // heading lines; and ticks, a prefix and red marks in a register.
    { name: "特性檢驗報告單", shot: "特性檢驗報告單（第2版）", fixture: "cutOrderTaker", department: "CUT" },
    {
      name: "特性檢驗報告單（崧貿）",
      shot: "特性檢驗報告單（崧貿）（第2版）",
      fixture: "cutOrderTaker",
      department: "CUT",
    },
    { name: "出廠檢驗單（巧力）", shot: "出廠檢驗單（巧力）（第2版）", fixture: "cutOrderTaker", department: "CUT" },
    {
      name: "特性檢驗報告單（信太）",
      shot: "特性檢驗報告單（信太）（第2版）",
      fixture: "cutOrderTaker",
      department: "CUT",
    },
    // A month in the title strip over a plain register.
    { name: "不良率統計表", fixture: "cutOrderTaker", department: "CUT" },
    // Landscape, side-by-side blocks set edge to edge, and a button named
    // for the department it sends the sheet to.
    { name: "退火明細表", shot: "退火明細表（第2版）", fixture: "cutOrderTaker", department: "CUT" },
    // Headings broken where the paper breaks them; photographed from 沖壓,
    // the second department that writes it.
    { name: "燒炖質量記錄表", fixture: "stampingOrderTaker", department: "沖壓" },
    // Twenty-five numbered rows on one portrait page, sent on to 燒頓.
    { name: "待燒入庫表", fixture: "stampingOrderTaker", department: "沖壓" },
    // A box to tick or a line written after 其他, in every row.
    { name: "產品需求表", fixture: "stampingOrderTaker", department: "沖壓" },
    // 沖壓's board shares CUT's name, so its picture and test carry the
    // department to stay apart from CUT's.
    {
      name: "生產作業看板",
      shot: "生產作業看板（沖壓）",
      fixture: "stampingOrderTaker",
      department: "沖壓",
    },
    // Two-row headings and cells holding two values; the back is its own
    // box below, not part of this picture.
    { name: "生產日報表", fixture: "stampingOrderTaker", department: "沖壓" },
    // Two printed matrices, the core views beside the first, and the 公差
    // table beside 鋼捲號.
    // Renamed when the drawing was corrected and the note moved to the foot
    // of its cell (2026-10-02), so CI takes the picture afresh.
    {
      name: "首件/巡迴檢驗單",
      shot: "首件/巡迴檢驗單（附註置底）",
      fixture: "cutOrderTaker",
      department: "CUT",
    },
    // 沖壓 and 平板剪's shares CUT's name: a printed 公差 column, units in
    // the cells, and rows above the time heading. Photographed from 沖壓.
    {
      name: "首件/巡迴檢驗單",
      shot: "首件/巡迴檢驗單（沖壓・平板剪・附註置底）",
      fixture: "stampingOrderTaker",
      department: "沖壓",
    },
  ] as const;

  for (const template of TEMPLATES) {
    const shot = "shot" in template ? template.shot : template.name;
    for (const viewport of VIEWPORTS) {
      test(`${shot} at ${viewport.name}`, async ({ browser }) => {
        test.setTimeout(90_000);
        const context = await browser.newContext({
          storageState: WORKFLOW_AUTH_FILES[template.fixture],
          viewport: { width: viewport.width, height: viewport.height },
          locale: "zh-Hant-TW",
          timezoneId: "Asia/Taipei",
        });
        const page = await context.newPage();

        await createSheetThroughHydratedForm(page, template.name, template.department);

        // A sheet that has just been created carries no values, no history and
        // no times, so the form below is the same picture every run. The page
        // around it is not, which is why only the form is photographed.
        // loading.tsx deliberately uses the same paper-form shell so the page
        // does not jump. Require the title on the screenshot locator itself so
        // a short route refresh cannot make it re-resolve to that loading shell.
        const form = page
          .locator(".cc-formsheet")
          .filter({ has: page.locator(".cc-formsheet__title") });
        await expect(form.locator(".cc-formsheet__title")).toHaveText(template.name);
        await expect(form).toBeVisible();
        await settled(page);
        await stable(form);
        // screenshot.css says what is excluded from a baseline and why.
        await expect(form).toHaveScreenshot(
          `${shot}-${viewport.name}.png`,
          { stylePath: SCREENSHOT_CSS },
        );

        await context.close();
      });
    }
  }
});
