import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The five viewports PLAN.md section 6 requires every core workflow to pass. */
export const VIEWPORTS = [
  { name: "mobile 360", width: 360, height: 800 },
  { name: "mobile 390", width: 390, height: 844 },
  { name: "tablet 768", width: 768, height: 1024 },
  { name: "desktop 1366", width: 1366, height: 768 },
  { name: "desktop 1920", width: 1920, height: 1080 },
] as const;

/**
 * The subpage auth.setup.ts creates in every department, with that
 * department's forms ticked and the workflow identities granted. The seed no
 * longer makes a default subpage (the user, 2026-10-03): a 主管 creates them.
 */
export const E2E_SUBPAGE = "測試子分頁";

/** Bootstrap administrator created by `pnpm db:seed`. */
export const SEEDED_ADMIN = { username: "admin", password: "DemoOnly2026!" } as const;

/**
 * A second account created once by auth.setup.ts, so the deactivation flow has
 * a target that is not the signed-in administrator — nobody can deactivate
 * themselves, and a freshly seeded database has only the bootstrap admin.
 * The test cancels rather than confirms, so this account stays active.
 */
export const DEACTIVATION_TARGET = {
  username: "e2e-deactivation-target",
  displayName: "E2E 停用測試帳號",
  password: "e2e-fixture-password-123",
} as const;

/**
 * Cookies captured once by auth.setup.ts and reused by every authenticated
 * test, so the run performs a single login rather than one per test.
 */
export const AUTH_FILE = "e2e/.auth/admin.json";

/**
 * Operational accounts used only by the browser workflow suite.
 *
 * They are created through the administrator API during Playwright setup.
 * They are intentionally absent from the production seed.
 */
export const WORKFLOW_USERS = {
  originManager: {
    username: "e2e-warehouse-manager",
    displayName: "E2E 倉管主管",
    password: "e2e-production-workflow-123",
    roles: [],
    departmentCode: "WAREHOUSE",
    membershipKind: "MANAGER",
  },
  sales: {
    username: "e2e-sales-reviewer",
    displayName: "E2E 業務",
    password: "e2e-production-workflow-123",
    roles: ["SALES"],
  },
  associate: {
    username: "e2e-associate-reviewer",
    displayName: "E2E 協理",
    password: "e2e-production-workflow-123",
    roles: ["ASSOCIATE"],
  },
  generalManager: {
    username: "e2e-general-manager",
    displayName: "E2E 總經理",
    password: "e2e-production-workflow-123",
    roles: ["GENERAL_MANAGER"],
  },
  slittingManager: {
    username: "e2e-slitting-manager",
    displayName: "E2E 分條主管",
    password: "e2e-production-workflow-123",
    roles: [],
    departmentCode: "SLITTING",
    membershipKind: "MANAGER",
  },
  slittingStaff: {
    username: "e2e-slitting-staff",
    displayName: "E2E 分條員工",
    password: "e2e-production-workflow-123",
    roles: [],
    departmentCode: "SLITTING",
    membershipKind: "STAFF",
  },
  cutManager: {
    username: "e2e-cut-manager",
    displayName: "E2E CUT 主管",
    password: "e2e-production-workflow-123",
    roles: [],
    departmentCode: "CUT",
    membershipKind: "MANAGER",
  },
  cutStaff: {
    username: "e2e-cut-staff",
    displayName: "E2E CUT 員工",
    password: "e2e-production-workflow-123",
    roles: [],
    departmentCode: "CUT",
    membershipKind: "STAFF",
  },
  cutOrderTaker: {
    username: "e2e-cut-order-taker",
    displayName: "E2E CUT 訂單人員",
    password: "e2e-production-workflow-123",
    roles: [],
    departmentCode: "CUT",
    membershipKind: "ORDER_TAKER",
  },
  stampingOrderTaker: {
    username: "e2e-stamping-order-taker",
    displayName: "E2E 沖壓訂單人員",
    password: "e2e-production-workflow-123",
    roles: [],
    departmentCode: "STAMPING",
    membershipKind: "ORDER_TAKER",
  },
  flatShearOrderTaker: {
    username: "e2e-flat-shear-order-taker",
    displayName: "E2E 平板剪訂單人員",
    password: "e2e-production-workflow-123",
    roles: [],
    departmentCode: "FLAT_SHEAR",
    membershipKind: "ORDER_TAKER",
  },
  // 退火明細表 is sent on to 燒頓, which must have a 主管 to receive it.
  shaoDunManager: {
    username: "e2e-shao-dun-manager",
    displayName: "E2E 燒頓主管",
    password: "e2e-production-workflow-123",
    roles: [],
    departmentCode: "SHAO_DUN",
    membershipKind: "MANAGER",
  },
} as const;

export type WorkflowUserKey = keyof typeof WORKFLOW_USERS;

export const WORKFLOW_AUTH_FILES: Record<WorkflowUserKey, string> = {
  originManager: "e2e/.auth/workflow-origin-manager.json",
  sales: "e2e/.auth/workflow-sales.json",
  associate: "e2e/.auth/workflow-associate.json",
  generalManager: "e2e/.auth/workflow-general-manager.json",
  slittingManager: "e2e/.auth/workflow-slitting-manager.json",
  slittingStaff: "e2e/.auth/workflow-slitting-staff.json",
  cutManager: "e2e/.auth/workflow-cut-manager.json",
  cutStaff: "e2e/.auth/workflow-cut-staff.json",
  flatShearOrderTaker: "e2e/.auth/workflow-flat-shear-order-taker.json",
  stampingOrderTaker: "e2e/.auth/workflow-stamping-order-taker.json",
  cutOrderTaker: "e2e/.auth/workflow-cut-order-taker.json",
  shaoDunManager: "e2e/.auth/workflow-shao-dun-manager.json",
};

/**
 * WCAG 2.2 AA is the stated target (DESIGN.md section 3.4), so scan the A, AA
 * and 2.2-specific rule sets rather than axe's looser defaults.
 */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** A sheet scaled to fit a phone (SheetFit, the user, 2026-10-03). */
const SCALED_SHEET = ".cc-sheetfit__page[data-scaled]";

/**
 * The WCAG scan, with the one deviation the user chose: on a phone a sheet is
 * shown at its desktop layout scaled down and read with pinch-zoom, so its
 * cells are under the 24px target size until zoomed (DESIGN.md §3.3). The
 * page is scanned in full apart from that sheet, and the sheet for everything
 * but target size.
 */
type AxeViolations = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"];

export async function accessibilityViolations(page: Page): Promise<AxeViolations> {
  const scaled = (await page.locator(SCALED_SHEET).count()) > 0;
  const page_ = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude(SCALED_SHEET).analyze();
  if (!scaled) return page_.violations;
  const sheet = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .include(SCALED_SHEET)
    .disableRules(["target-size"])
    .analyze();
  return [...page_.violations, ...sheet.violations];
}

export const SHEET_DETAIL_PATH = /^\/sheets\/[0-9a-f-]+$/u;

/**
 * GET through the page's request context, once more if the connection was
 * reset.
 *
 * The dev server can close a kept-alive socket at the moment the test client
 * reuses it, and the request fails with ECONNRESET before it reaches the app:
 * seen on CI on 2026-09-27 and in three of seventeen local tests the same day.
 * A GET is safe to repeat, and anything else — a second reset, or a real error
 * response — still fails the test.
 */
async function getRetryingReset(page: Page, url: string) {
  try {
    return await page.request.get(url);
  } catch (error) {
    if (!String(error).includes("ECONNRESET")) throw error;
    return await page.request.get(url);
  }
}

/**
 * Create a sheet from its department's default subpage, once.
 *
 * The create controls are disabled until the component is interactive, so
 * waiting for the button to be enabled *is* waiting for hydration. That matters
 * more than it sounds: an earlier version of this helper clicked repeatedly
 * until the URL changed, and a preserved CI trace showed one call producing
 * four `POST /api/sheets` — four sheets for one intent, with the late responses
 * arriving after navigation and resetting the page underneath the next step.
 */
export async function openCreationSubpage(page: Page, departmentName: string) {
  const departmentsResponse = await getRetryingReset(page, "/api/departments");
  expect(departmentsResponse.ok()).toBeTruthy();
  const departments = (await departmentsResponse.json() as { departments: { id: string; slug: string; displayName: string }[] }).departments;
  const department = departments.find((item) => item.displayName === departmentName);
  expect(department, `Missing department ${departmentName}`).toBeDefined();
  const subpagesResponse = await getRetryingReset(page, `/api/departments/${department!.id}/subpages`);
  expect(subpagesResponse.ok()).toBeTruthy();
  const subpages = (await subpagesResponse.json() as { subpages: { id: string; name: string }[] }).subpages;
  const subpage = subpages.find((item) => item.name === E2E_SUBPAGE);
  expect(subpage, `Missing ${E2E_SUBPAGE} for ${departmentName}; auth.setup creates it`).toBeDefined();
  // Creating has its own page, opened from the subpage's 建立生產單 button.
  await page.goto(`/departments/${department!.slug}/new?from=subpage&subpage=${subpage!.id}`);
}

export async function createSheetThroughHydratedForm(
  page: Page,
  templateName: string,
  departmentName: string,
) {
  await openCreationSubpage(page, departmentName);
  const create = page.getByRole("button", { name: "建立生產單", exact: true });
  await expect(create).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel("表單範本").selectOption({ label: templateName });
  // Matched against the pathname: SHEET_DETAIL_PATH is anchored, and
  // waitForURL tests a whole URL unless it is given a predicate.
  await Promise.all([
    page.waitForURL((url) => SHEET_DETAIL_PATH.test(url.pathname)),
    create.click(),
  ]);
}

/**
 * Set a sheet's production status on its page — 待生產, 生產中 or 已完成 — and
 * wait for the write. There is no draft or review any more (the user,
 * 2026-09-30); this replaced 送交生產, 開始生產 and 完成生產.
 */
export async function setSheetStatus(page: Page, label: "待生產" | "生產中" | "已完成") {
  const control = page.getByRole("group", { name: "生產狀態" });
  await control.getByRole("radio", { name: label, exact: true }).check();
  const written = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/status"),
  );
  await control.getByRole("button", { name: "更新狀態", exact: true }).click();
  expect((await written).status()).toBe(200);
  await expect(page.locator(".cc-page__header .cc-badge").first()).toHaveText(label);
}

/** The printed form on a sheet page: the form sheet that carries a title. */
export function formSheetOf(page: Page) {
  return page
    .locator(".cc-formsheet")
    .filter({ has: page.locator(".cc-formsheet__title") });
}

/**
 * Press 儲存 and wait for the save itself. Nothing is written until 儲存 is
 * pressed, and the "all saved" status is also true before anything was
 * typed, so only the response tells a finished save from none at all.
 */
export async function saveSheet(page: Page) {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /^\/api\/sheets\/[^/]+\/values$/.test(new URL(response.url()).pathname) &&
      response.ok(),
  );
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await saved;
}

/**
 * PATCH one value of the open sheet straight at the API, as a tampered client
 * would, and return the status — for checking what the server refuses.
 */
export async function patchSheetValue(page: Page, fieldKey: string, value: string) {
  const sheetId = new URL(page.url()).pathname.split("/").pop()!;
  return page.evaluate(
    async ({ id, key, next }) => {
      const csrf = document.cookie
        .split("; ")
        .find((pair) => pair.startsWith("workflow_csrf="))
        ?.slice("workflow_csrf=".length);
      const detail = await fetch(`/api/sheets/${id}`).then((response) => response.json());
      const response = await fetch(`/api/sheets/${id}/values`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-csrf-token": csrf ?? "" },
        body: JSON.stringify({
          baseVersion: detail.sheet.version,
          clientMutationId: crypto.randomUUID(),
          changes: [{ fieldKey: key, value: next }],
        }),
      });
      return response.status;
    },
    { id: sheetId, key: fieldKey, next: value },
  );
}

/**
 * Hydration errors the page reports, from the moment this is called.
 *
 * A client component rendered on the server must produce the same text in
 * the browser; when it does not, React discards the server's HTML and only
 * says so in the console. Node and Chromium disagree on the space before 上午
 * in a formatted time, which once did exactly this on every connected user's
 * 設定 page.
 */
export function watchHydrationErrors(page: Page): string[] {
  const errors: string[] = [];
  const record = (text: string) => {
    if (/hydrat/i.test(text)) errors.push(text.split("\n", 1)[0] ?? text);
  };
  page.on("console", (message) => {
    if (message.type() === "error") record(message.text());
  });
  page.on("pageerror", (error) => record(error.message));
  return errors;
}

/** Wait until React has hydrated the element `selector` finds. */
export async function waitForHydration(page: Page, selector: string) {
  await page.waitForFunction(
    (target) => {
      const element = document.querySelector(target);
      return Boolean(element && Object.keys(element).some((key) => key.startsWith("__react")));
    },
    selector,
  );
}
