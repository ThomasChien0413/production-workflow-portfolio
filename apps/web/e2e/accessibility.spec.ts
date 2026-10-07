import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  AUTH_FILE,
  DEACTIVATION_TARGET,
  VIEWPORTS,
  WCAG_TAGS,
  WORKFLOW_AUTH_FILES,
  createSheetThroughHydratedForm,
} from "./support";

const ANONYMOUS_ROUTES = ["/login"] as const;
const AUTHENTICATED_ROUTES = [
  "/change-password",
  "/settings",
  "/notifications",
  // The seeded bootstrap account holds ADMIN, so these render for the shared
  // session rather than needing a second fixture.
  "/admin/users",
  "/admin/users/new",
  "/admin/templates",
  "/admin/audit",
  "/admin/notifications",
] as const;

/**
 * A violation list is far more useful than a bare count when this fails in CI,
 * so surface the rule id, impact and the offending selector.
 */
function describeViolations(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
): string {
  if (violations.length === 0) return "no violations";
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .map((node) => node.target.join(" "))
        .slice(0, 3)
        .join(", ");
      return `[${violation.impact ?? "unknown"}] ${violation.id}: ${violation.help}\n    ${targets}`;
    })
    .join("\n");
}

async function scan(page: import("@playwright/test").Page) {
  await expect(page.locator("h1, h2").first()).toBeVisible();
  return new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
}

/**
 * Create the image-confirmed 分條排刀單 inside 分條's default subpage.
 */
async function createSheet(page: import("@playwright/test").Page) {
  await createSheetThroughHydratedForm(page, "分條排刀單", "分條");
}

for (const viewport of VIEWPORTS) {
  test.describe(`accessibility at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.describe("anonymous", () => {
      for (const route of ANONYMOUS_ROUTES) {
        test(`${route} has no WCAG 2.2 AA violations`, async ({ page }) => {
          await page.goto(route);
          const results = await scan(page);
          expect(
            results.violations,
            `${route} (${viewport.name})\n${describeViolations(results.violations)}`,
          ).toEqual([]);
        });
      }
    });

    test.describe("authenticated", () => {
      test.use({ storageState: AUTH_FILE });

      for (const route of AUTHENTICATED_ROUTES) {
        test(`${route} has no WCAG 2.2 AA violations`, async ({ page }) => {
          await page.goto(route);
          if (route === "/admin/users/new") {
            const createAccount = page.getByRole("button", {
              name: "建立帳號",
              exact: true,
            });
            await expect(createAccount).toBeEnabled();
            // Hydration changes this controlled form from its disabled palette
            // to the active one. Inspect the settled accessible colours, not
            // an interpolated frame in the design system's 120 ms transition.
            await createAccount.evaluate(async (element) => {
              await Promise.allSettled(
                element.getAnimations().map((animation) => animation.finished),
              );
            });
          }
          const results = await scan(page);
          expect(
            results.violations,
            `${route} (${viewport.name})\n${describeViolations(results.violations)}`,
          ).toEqual([]);
        });
      }
    });
  });
}

/**
 * The account detail screen carries the deactivation flow. Its URL contains a
 * user id, so it cannot sit in the static route list — the test walks to it
 * from the list the way an account manager would.
 */
test.describe("account detail", () => {
  test.use({ storageState: AUTH_FILE });

  test("the account detail screen has no WCAG 2.2 AA violations", async ({ page }) => {
    await page.goto(
      `/admin/users?q=${encodeURIComponent(DEACTIVATION_TARGET.username)}`,
    );
    await page
      .locator('a[href^="/admin/users/"]')
      .filter({ hasText: "管理" })
      .first()
      .click();
    // The fixture account is active, so the scan covers the deactivation
    // control itself rather than only the sentence that replaces it.
    await expect(page.getByRole("button", { name: "停用帳號" })).toBeVisible();

    const results = await scan(page);
    expect(results.violations, describeViolations(results.violations)).toEqual([]);
  });

  test("deactivation asks for confirmation before it commits", async ({ page }) => {
    // Search for the fixture account rather than taking whichever row happens
    // to be first: the list is sorted by display name, and on CI it also holds
    // the deactivated leftovers of the API integration tests.
    await page.goto(
      `/admin/users?q=${encodeURIComponent(DEACTIVATION_TARGET.username)}`,
    );
    await page
      .locator('a[href^="/admin/users/"]')
      .filter({ hasText: "管理" })
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: DEACTIVATION_TARGET.displayName }),
    ).toBeVisible();

    const deactivate = page.getByRole("button", { name: "停用帳號" });
    const confirm = page.getByRole("button", { name: "確認停用" });
    await expect
      .poll(
        async () => {
          if (await confirm.isVisible()) return true;
          await deactivate.click({ timeout: 1_000 }).catch(() => undefined);
          return confirm.isVisible();
        },
        {
          message: "deactivation confirmation appears after hydration",
          timeout: 30_000,
          intervals: [0, 100, 250, 500],
        },
      )
      .toBe(true);

    // Cancelling must leave the account untouched — no request, still active.
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("button", { name: "確認停用" })).toHaveCount(0);
    await expect(
      page.locator(".cc-badge--success").filter({ hasText: "啟用中" }),
    ).toBeVisible();
  });
});

/**
 * The screens nobody plans to see. They are the easiest to leave untranslated
 * or unstyled, because the happy path never renders them.
 */
test.describe("not-found screens", () => {
  test.use({ storageState: AUTH_FILE });

  test("a sheet that does not exist gets the signed-in not-found screen", async ({
    browser,
  }) => {
    // A workflow manager, who works with sheets every day.
    const context = await browser.newContext({
      storageState: WORKFLOW_AUTH_FILES.slittingManager,
    });
    const page = await context.newPage();
    await page.goto("/sheets/00000000-0000-4000-8000-000000000000");
    // Asserting what the operator sees, not the status code: a segment
    // `not-found` renders with 200 under `next dev` and the suite runs against
    // the dev server, so pinning a status here would pin an artifact of the
    // environment rather than the behaviour.
    await expect(page.getByText("找不到這個項目")).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations, describeViolations(results.violations)).toEqual([]);
    await context.close();
  });

  test("an unrouted URL gets the plain not-found screen", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "找不到這個頁面" })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations, describeViolations(results.violations)).toEqual([]);
  });
});

/**
 * The font is vendored, and this is what makes that true rather than intended.
 * A single `next/font/google` call reintroduces both a build-time dependency on
 * Google and a runtime one on every operator's browser.
 */
test.describe("self-hosted typography", () => {
  test("a page loads its font from this origin and asks nobody else", async ({
    page,
    baseURL,
  }) => {
    // Compared against the configured base rather than page.url(), which is
    // still about:blank when the very first request goes out.
    const ownHost = new URL(baseURL ?? "http://localhost:3100").host;
    const external: string[] = [];
    const served: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (!url.startsWith("http")) return;
      if (new URL(url).host !== ownHost) external.push(url);
    });
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/fonts/noto-sans-tc/") && response.status() === 200) {
        served.push(url);
      }
    });

    await page.goto("/login");
    await page.evaluate(() => document.fonts.ready);

    // The family is served under its own name, so the token in tokens.css
    // resolves without anything having to inject a hashed one.
    const family = await page.evaluate(() =>
      getComputedStyle(document.body).fontFamily,
    );
    expect(family).toContain("Noto Sans TC");

    // The page is in Traditional Chinese, so a slice must actually have been
    // fetched and used. Declaring the family without serving it would leave
    // every glyph on the system fallback and this test still passing.
    expect(served.length, "no vendored slice was requested").toBeGreaterThan(0);
    expect(
      await page.evaluate(() => document.fonts.check('16px "Noto Sans TC"', "生產單")),
    ).toBe(true);

    // Nothing leaves this origin — no fonts.googleapis.com, no fonts.gstatic.com.
    expect(external, `unexpected third-party requests:\n${external.join("\n")}`).toEqual(
      [],
    );
  });
});

test.describe("collision warning", () => {
  test.use({ storageState: WORKFLOW_AUTH_FILES.slittingManager });

  test("saving alone on a sheet is never reported as someone else's edit", async ({
    page,
  }) => {
    // Creating a sheet and saving it drives the real API twice; the default
    // 30 seconds is less than the retry budget below and would kill the test
    // before its own guard could finish.
    test.setTimeout(90_000);
    await createSheet(page);

    // Any free-text row cell will do; the sheet's first control is a date.
    const field = page.locator(".cc-formsheet__grid input:not([readonly])").first();
    await expect(field).toBeVisible();
    await field.fill("E2E 單人存檔");
    await page.getByRole("button", { name: "儲存", exact: true }).click();
    // A generous window: this waits on a real write, and the suite runs three
    // workers against one dev server.
    await expect(page.getByText("所有變更皆已儲存")).toBeVisible({ timeout: 30_000 });

    // The room broadcasts every commit to everyone in it, the author included,
    // and that echo used to arrive while the author's own buffer still held
    // the fields — which read as a remote edit. Nobody else is on this sheet.
    const banner = page.getByText("有人同時修改了你正在編輯的欄位");
    await expect(banner).toHaveCount(0);
    // Proving something asynchronous never happens means giving it time to.
    await page.waitForTimeout(2_000);
    await expect(banner).toHaveCount(0);
  });
});

/**
 * The audit time filter. The interesting part is not the control but what it
 * puts in the URL, because a shareable query is most of what an investigation
 * hands to the next person.
 */
test.describe("audit time filter", () => {
  test.use({ storageState: AUTH_FILE });

  /**
   * Nothing typed into this form survives until React has hydrated: a value
   * filled before then is replaced by the component's own state, and a click
   * before then does nothing at all. The suite runs against `next dev`, which
   * compiles this route on first request — precisely when three workers are
   * competing — so hydration is established through a control that reports its
   * own state before the test touches anything else.
   */
  async function settle(page: import("@playwright/test").Page) {
    const today = page.getByRole("button", { name: "今天" });
    await expect
      .poll(async () => {
        await today.click();
        return today.getAttribute("aria-pressed");
      })
      .toBe("true");
  }

  test("the range travels in the URL as plain days", async ({ page }) => {
    await page.goto("/admin/audit");
    await settle(page);
    await page.getByLabel("開始日期").fill("2020-01-01");
    await page.getByLabel("結束日期").fill("2020-01-02");
    await page.getByRole("button", { name: "搜尋" }).click();

    // Days, not the instants the API is given: the link has to stay readable.
    await expect(page).toHaveURL(/from=2020-01-01&to=2020-01-02/);
    // The system did not exist in 2020, so an empty result is the proof that
    // the filter reached the API rather than being dropped on the way.
    await expect(page.getByText("沒有符合的紀錄")).toBeVisible();
  });

  test("a preset sets both ends and says which one is applied", async ({ page }) => {
    await page.goto("/admin/audit");
    const preset = page.getByRole("button", { name: "近 7 天" });
    await expect(preset).toHaveAttribute("aria-pressed", "false");

    await settle(page);
    // Only one range is applied at a time, so 今天 must let go when 近 7 天
    // takes over.
    await preset.click();
    await expect(preset).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "今天" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByLabel("開始日期")).not.toHaveValue("");
    await expect(page.getByLabel("結束日期")).not.toHaveValue("");
  });

  test("an inverted range is refused before the request", async ({ page }) => {
    await page.goto("/admin/audit");
    await settle(page);
    await page.getByLabel("開始日期").fill("2026-08-11");
    await page.getByLabel("結束日期").fill("2026-08-05");
    await page.getByRole("button", { name: "搜尋" }).click();

    await expect(page.getByText("開始日期不可晚於結束日期。")).toBeVisible();
    // The contract would answer 400; nothing should have been asked.
    await expect(page).toHaveURL(/\/admin\/audit$/);

    // The error state is where a grouped control is most likely to lose its
    // wiring, so scan it rather than only the resting form.
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations, describeViolations(results.violations)).toEqual([]);
  });
});

test.describe("form error states", () => {
  test("login validation errors are announced and associated", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "登入" }).click();

    const username = page.getByLabel("姓名或登入名稱");
    await expect(username).toHaveAttribute("aria-invalid", "true");

    // The message must be reachable programmatically, not merely visible.
    const describedBy = await username.getAttribute("aria-describedby");
    expect(describedBy, "invalid input must point at its error text").toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toBeVisible();

    // An invalid form is exactly when a scan is most likely to regress.
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations, describeViolations(results.violations)).toEqual([]);
  });
});
