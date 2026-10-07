import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expectArchiveBelowStatus } from "./layout-geometry";
import {
  createSheetThroughHydratedForm,
  E2E_SUBPAGE,
  setSheetStatus,
  WORKFLOW_AUTH_FILES,
  type WorkflowUserKey,
} from "./support";

const WORKFLOW_VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1366, height: 768 },
] as const;

async function expectState(page: Page, label: string) {
  await expect(page.locator(".cc-page__header .cc-badge")).toHaveText(label);
}

/**
 * A 主管 places a sheet waiting in 待分派 and sets its 交期, both in the
 * details box (the user, 2026-09-30). The subpage choice is already open for
 * a sheet with none; the 交期 unfolds under its row with 修改.
 */
async function placeAndSetDueDate(page: Page, dueLocal: string) {
  await expect(page.locator("#move-sheet-subpage")).toBeEnabled();
  await page.locator("#move-sheet-subpage").selectOption({ label: E2E_SUBPAGE });
  const placed = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/subpage"),
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "放入子分頁", exact: true }).click();
  expect((await placed).status()).toBe(200);
  // The choice folds away once the sheet has a subpage.
  await expect(page.locator("#move-sheet-subpage")).toHaveCount(0);
  const dueToggle = page.getByRole("button", { name: /^修改\s*交期$/ });
  await expect(dueToggle).toHaveAttribute("aria-expanded", "false");
  await dueToggle.click();
  await page.locator('input[name="dueAt"]').fill(dueLocal);
  const dated = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/due-date"),
  );
  await page.getByRole("button", { name: "設定交期", exact: true }).click();
  expect((await dated).status()).toBe(200);
  await expect(page.locator('input[name="dueAt"]')).toHaveCount(0);
}

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    widest: [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => ({
        selector:
          element.tagName.toLowerCase() +
          (element.className
            ? `.${String(element.className).trim().split(/\s+/)[0]}`
            : ""),
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      }))
      .filter((entry) => entry.right > document.documentElement.clientWidth + 1)
      .sort((left, right) => right.right - left.right)
      .slice(0, 5),
  }));
  expect(
    dimensions.scrollWidth,
    `page-level horizontal overflow: ${JSON.stringify(dimensions)}`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

for (const viewport of WORKFLOW_VIEWPORTS) {
  test(`complete reviewed production workflow on ${viewport.name}`, async ({
    browser,
    baseURL,
  }) => {
    // This one test drives several browser contexts through create, sending
    // on, placing, 交期, status changes, archive and restore. On CI it
    // takes 1.6–1.9 minutes of honest work, so a two-minute budget left almost
    // no headroom: it began failing not because anything broke but because the
    // application shell added a little to every page render, and the run
    // crossed the line. The symptom was misleading — a status badge one step
    // behind — which is just an inner `expect` timing out inside an already
    // exhausted test. Four minutes reflects what this test actually does.
    test.setTimeout(240_000);
    const origin = baseURL ?? "";
    const contexts: BrowserContext[] = [];

    async function actor(key: WorkflowUserKey): Promise<Page> {
      const context = await browser.newContext({
        storageState: WORKFLOW_AUTH_FILES[key],
        viewport: { width: viewport.width, height: viewport.height },
        locale: "zh-Hant-TW",
        timezoneId: "Asia/Taipei",
      });
      contexts.push(context);
      return context.newPage();
    }

    try {
      // 倉管主管 creates the confirmed 分條申請單 and supplies one complete,
      // clearly test-only row. The form remains the image-derived production
      // definition; this test does not invent or publish a template.
      const creator = await actor("originManager");
      await createSheetThroughHydratedForm(creator, "分條申請單", "倉管");
      const sheetPath = new URL(creator.url()).pathname;

      await expect(
        creator.getByRole("heading", { level: 1, name: "分條申請單" }),
      ).toBeVisible();
      // No draft and no review (the user, 2026-09-30): it starts at 待生產.
      await expectState(creator, "待生產");
      await creator.locator("#requestDate").fill("2026-08-11");
      await creator.getByLabel("第 1 列 規格").fill(`E2E-${viewport.width}`);
      await creator.getByLabel("第 1 列 材質").fill("E2E 材質");
      await creator.getByLabel("第 1 列 分類").fill("E2E 分類");
      await creator.getByLabel("第 1 列 需求量").fill("1");
      await creator.getByLabel("第 1 列 備註").fill("Playwright 測試資料");
      await expectNoPageOverflow(creator);

      await creator.getByRole("button", { name: "儲存", exact: true }).click();
      await expect(creator.getByText("所有變更皆已儲存")).toBeVisible();
      // 分條申請單 is reviewed before it goes on to 分條 (the user,
      // 2026-10-01). Its status is 分條's to set, so 倉管 sees no status
      // control, only 送出審核.
      await expect(creator.getByRole("group", { name: "生產狀態" })).toHaveCount(0);
      await creator.getByRole("button", { name: "送出審核", exact: true }).click();
      await expect(creator.getByText("確認送出審核？", { exact: true })).toBeVisible();
      await creator.getByRole("button", { name: "確認送出審核", exact: true }).click();
      await expect(creator.getByText("已送出審核", { exact: true })).toBeVisible();
      await expectState(creator, "待業務審核");

      // 業務, 協理 and 總經理 approve it in turn; after 總經理 it goes to 分條.
      for (const [key, nextState] of [
        ["sales", "待協理審核"],
        ["associate", "待總經理審核"],
        ["generalManager", "待生產"],
      ] as const) {
        const reviewer = await actor(key);
        await reviewer.goto(`${origin}${sheetPath}`);
        await expect(reviewer.getByRole("heading", { name: "審核", exact: true, level: 2 })).toBeVisible();
        const approve = reviewer.getByRole("button", { name: "核准", exact: true });
        await expect(approve).toBeEnabled();
        await approve.click();
        await expectState(reviewer, nextState);
      }

      // It waits in 分條's 待分派. Nobody is assigned: its 主管 places it in
      // a subpage and sets the 交期, and whoever may modify it there sets its
      // status.
      const slittingManager = await actor("slittingManager");
      // Hold hydration deterministically, not with a sleep. The server HTML
      // must not accept a selection that the client state cannot yet retain.
      let releaseScripts!: () => void;
      const scriptsReady = new Promise<void>((resolve) => { releaseScripts = resolve; });
      await slittingManager.route("**/_next/**/*.js*", async (route) => {
        await scriptsReady;
        await route.continue();
      });
      try {
        await slittingManager.goto(`${origin}${sheetPath}`, { waitUntil: "commit" });
        await expect(slittingManager.locator("#move-sheet-subpage")).toBeVisible();
        await expect(slittingManager.locator("#move-sheet-subpage")).toBeDisabled();
        await expect(slittingManager.getByRole("button", { name: "放入子分頁", exact: true })).toBeDisabled();
      } finally {
        releaseScripts();
      }
      await expect(slittingManager.locator("#move-sheet-subpage")).toBeEnabled();
      await slittingManager.unroute("**/_next/**/*.js*");
      await expectState(slittingManager, "待生產");
      await expect(slittingManager.getByText(/尚未放入子分頁/)).toBeVisible();
      await expect(slittingManager.getByRole("group", { name: "生產狀態" })).toHaveCount(0);
      await placeAndSetDueDate(slittingManager, "2099-01-01T09:00");

      const slittingStaff = await actor("slittingStaff");
      await slittingStaff.goto(`${origin}${sheetPath}`);
      await expectState(slittingStaff, "待生產");
      // The 交期 is the 主管's.
      await expect(slittingStaff.locator('input[name="dueAt"]')).toHaveCount(0);
      await setSheetStatus(slittingStaff, "生產中");
      await setSheetStatus(slittingStaff, "已完成");

      // A finished sheet is archived, not handed on (the user, 2026-10-04):
      // its 主管 sees 封存 and nothing to send it elsewhere.
      await slittingManager.goto(`${origin}${sheetPath}`);
      await expectState(slittingManager, "已完成");
      // 已完成 but not archived, it is still worked from its subpage and is
      // not in 完工紀錄 (the user, 2026-10-04).
      await slittingManager.goto(`${origin}/departments/slitting/history`);
      await expect(slittingManager.getByRole("heading", { level: 1, name: "分條・完工紀錄" })).toBeVisible();
      await expect(slittingManager.locator(`a[href^="${sheetPath}"]`)).toHaveCount(0);
      await slittingManager.goto(`${origin}${sheetPath}`);
      await expectState(slittingManager, "已完成");
      await expect(slittingManager.locator("#handoff-department")).toHaveCount(0);
      await expect(slittingManager.getByRole("button", { name: "轉送到其他部門", exact: true })).toHaveCount(0);
      // 封存 sits right under 生產狀態, by 儲存 (the user, 2026-10-04).
      await expectArchiveBelowStatus(slittingManager);
      await slittingManager.getByRole("button", { name: "封存生產單", exact: true }).click();
      await expect(slittingManager.getByText("確認封存？", { exact: true })).toBeVisible();
      // Archived sheets are deleted a year later (the user, 2026-10-01).
      await expect(slittingManager.getByText(/若一年內沒有恢復，它與附件會永久刪除/)).toBeVisible();
      await slittingManager.getByRole("button", { name: "確認封存", exact: true }).click();
      await expectState(slittingManager, "已封存");
      await expect(slittingManager.getByText(/後連同附件永久刪除，無法復原/)).toBeVisible();
      await expect(slittingManager.getByRole("button", { name: "恢復到子分頁", exact: true })).toBeVisible();
      await expectNoPageOverflow(slittingManager);
      // Archiving it here leaves its way back alone (the user, 2026-10-04):
      // back to its subpage, where it is no longer listed.
      await expect(slittingManager.getByRole("link", { name: "返回完工紀錄", exact: true })).toHaveCount(0);
      const backToSubpage = slittingManager.locator(".cc-page__header a.cc-btn");
      await expect(backToSubpage).toHaveAttribute("href", /^\/departments\/slitting\/subpages\//);
      const subpageId = (await backToSubpage.getAttribute("href"))!.split("/").at(-1)!;
      await slittingManager.goto(`${origin}/departments/slitting/subpages/${subpageId}`);
      await expect(slittingManager.getByRole("heading", { level: 2, name: "生產單" })).toBeVisible();
      await expect(slittingManager.locator(`a[href^="${sheetPath}"]`)).toHaveCount(0);
      // Opened from 完工紀錄, its way back is 完工紀錄.
      await slittingManager.goto(`${origin}/departments/slitting/history?subpageId=${subpageId}`);
      await Promise.all([
        slittingManager.waitForURL(new RegExp(`${sheetPath}\\?from=history$`)),
        slittingManager
          .locator("tr, article")
          .filter({ has: slittingManager.locator(`a[href="${sheetPath}?from=history"]`) })
          .filter({ visible: true })
          .getByRole("link", { name: /^開啟/ })
          .click(),
      ]);
      await expect(slittingManager.getByRole("link", { name: "返回完工紀錄", exact: true })).toHaveAttribute(
        "href",
        `/departments/slitting/history?subpageId=${subpageId}`,
      );

      // Its staff cannot bring it back; its 主管 does, from 完工紀錄, and it
      // returns to its subpage as 已完成.
      await slittingStaff.goto(`${origin}${sheetPath}`);
      await expectState(slittingStaff, "已封存");
      await expect(slittingStaff.getByRole("button", { name: "恢復到子分頁", exact: true })).toHaveCount(0);
      await slittingManager.goto(`${origin}/departments/slitting/history?subpageId=${subpageId}`);
      const archivedEntry = slittingManager
        .locator("tr, article")
        .filter({ has: slittingManager.locator(`a[href="${sheetPath}?from=history"]`) })
        .filter({ visible: true });
      await expect(archivedEntry).toHaveCount(1);
      await archivedEntry.getByRole("button", { name: /^恢復到子分頁/ }).click();
      await expect(archivedEntry).toHaveCount(0);
      await slittingManager.goto(`${origin}${sheetPath}`);
      await expectState(slittingManager, "已完成");
      await expect(slittingManager.getByRole("button", { name: "封存生產單", exact: true })).toBeVisible();

      // Archived again, it may be deleted from 完工紀錄 at once, after a
      // confirmation (the user, 2026-10-04).
      await slittingManager.getByRole("button", { name: "封存生產單", exact: true }).click();
      await slittingManager.getByRole("button", { name: "確認封存", exact: true }).click();
      await expectState(slittingManager, "已封存");
      await slittingManager.goto(`${origin}/departments/slitting/history?subpageId=${subpageId}`);
      const entryToDelete = slittingManager
        .locator("tr, article")
        .filter({ has: slittingManager.locator(`a[href="${sheetPath}?from=history"]`) })
        .filter({ visible: true });
      await entryToDelete.getByRole("button", { name: /^刪除/ }).click();
      await expect(entryToDelete.getByText("永久刪除這張生產單與附件？此操作無法復原。")).toBeVisible();
      await entryToDelete.getByRole("button", { name: "取消", exact: true }).click();
      await expect(entryToDelete).toHaveCount(1);
      await entryToDelete.getByRole("button", { name: /^刪除/ }).click();
      await entryToDelete.getByRole("button", { name: "確認刪除", exact: true }).click();
      await expect(entryToDelete).toHaveCount(0);
      // The page streams behind its loading screen, so the status is sent
      // before not-found renders; the screen says the sheet is gone.
      await slittingManager.goto(`${origin}${sheetPath}`);
      await expect(slittingManager.getByText("找不到這個項目")).toBeVisible();
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
}

for (const viewport of WORKFLOW_VIEWPORTS) {
  test(`分條排刀單 reproduces the XLSX and allows department creation on ${viewport.name}`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      storageState:
        viewport.name === "mobile"
          ? WORKFLOW_AUTH_FILES.slittingStaff
          : WORKFLOW_AUTH_FILES.slittingManager,
      viewport: { width: viewport.width, height: viewport.height },
      locale: "zh-Hant-TW",
      timezoneId: "Asia/Taipei",
    });
    const page = await context.newPage();

    try {
      await createSheetThroughHydratedForm(page, "分條排刀單", "分條");

      await expect(page.getByRole("heading", { level: 1, name: "分條排刀單" })).toBeVisible();
      await expect(page.locator(".cc-formsheet__title")).toHaveText("分條排刀單");
      await expect(page.locator(".cc-formsheet__footdoc")).toHaveText(
        "文件編號：F/P1-01-01",
      );
      await expect(
        page.locator(".cc-formsheet__grid thead th"),
      ).toHaveText(["序", "鋼廠", "質材", "規格", "數量", "總寬 & 分條件數"]);
      await expect(page.locator(".cc-formsheet__grid tbody tr")).toHaveCount(10);

      const actualWidths = await page
        .locator(".cc-formsheet__grid thead th")
        .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));
      const sourceWidths = [5.625, 12.625, 26.625, 12.625, 12.625, 26.625];
      const actualTotal = actualWidths.reduce((sum, width) => sum + width, 0);
      const sourceTotal = sourceWidths.reduce((sum, width) => sum + width, 0);
      for (const [index, sourceWidth] of sourceWidths.entries()) {
        expect(actualWidths[index]! / actualTotal).toBeCloseTo(
          sourceWidth / sourceTotal,
          1,
        );
      }

      const pdfButton = page.getByRole("button", { name: "下載 PDF", exact: true });
      await expect(pdfButton).toBeEnabled();
      await page.locator("#knifeDate").fill("2026-08-11");
      await expect(pdfButton).toBeDisabled();
      await expect(pdfButton).toHaveAttribute("title", "請先儲存變更，再下載 PDF。");
      await expect(page.getByText("請先儲存變更，再下載 PDF。")).toBeVisible();
      await page.getByLabel("第 1 列 鋼廠").fill("E2E 鋼廠");
      await page.getByLabel("第 1 列 質材").fill("E2E 質材");
      await page.getByLabel("第 1 列 規格").fill("E2E 規格");
      await page.getByLabel("第 1 列 數量").fill("1");
      await page.getByLabel("第 1 列 總寬 & 分條件數").fill("1000 / 5");
      await page.getByRole("button", { name: "儲存", exact: true }).click();
      await expect(page.getByText("所有變更皆已儲存")).toBeVisible();
      const downloadPromise = page.waitForEvent("download");
      await pdfButton.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/^分條排刀單_\d{8}_[0-9a-f]{8}\.pdf$/);
      const downloadedPath = await download.path();
      expect(downloadedPath).not.toBeNull();
      expect((await readFile(downloadedPath!)).subarray(0, 5).toString("ascii")).toBe("%PDF-");
      await expectNoPageOverflow(page);

      const headerPositions = await page.evaluate(() => {
        const title = document.querySelector(".cc-formsheet__title")!.getBoundingClientRect();
        const date = document.querySelector(".cc-formsheet__date")!.getBoundingClientRect();
        return { titleLeft: title.left, dateLeft: date.left };
      });
      expect(headerPositions.titleLeft).toBeLessThan(headerPositions.dateLeft);
    } finally {
      await context.close();
    }
  });
}
