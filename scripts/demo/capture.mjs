import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../packages/database/dist/client.js";
import { assertLocalDemoDatabase } from "../../packages/database/dist/scripts/demo-target.js";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, DEMO_SUBPAGE } from "../../packages/database/dist/scripts/demo-fixtures.js";
import { containsOnlyBlankValues } from "./capture-safety.mjs";

// Owned local test browser only. Never attach to a user's browser or production.
const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const origin = new URL(process.env.PORTFOLIO_CAPTURE_ORIGIN ?? "http://localhost:3330");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) && origin.protocol === "http:" && !origin.username && !origin.password && origin.pathname === "/", "Capture requires an uncredentialed local HTTP origin");
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is required");
assertLocalDemoDatabase(databaseUrl);
assert.equal(new URL(databaseUrl).pathname, "/workflow_demo_showcase", "Capture requires a dedicated showcase database");
const connection = createDatabase(databaseUrl, 1);
let existingBlankSheetId;
try {
  const accounts = await connection.client`select username from users order by username`;
  assert.deepEqual(accounts.map(account => account.username).sort(), ["admin", ...DEMO_ACCOUNTS.map(account => account.username)].sort(), "Only initialized synthetic accounts are allowed");
  const sheets = await connection.client`select s.id, s.version, u.username, v.values from production_sheets s join users u on u.id=s.created_by_user_id join sheet_values v on v.sheet_id=s.id`;
  assert.ok(sheets.length === 0 || (sheets.length === 1 && sheets[0].username === 'demo.manager' && sheets[0].version === 0 && containsOnlyBlankValues(sheets[0].values)), "Only a fresh showcase or its single unchanged blank demo sheet can be captured");
  existingBlankSheetId = sheets[0]?.id;
} finally { await connection.close(); }

const images = fileURLToPath(new URL("../../docs/images/", import.meta.url));
const examples = fileURLToPath(new URL("../../docs/examples/", import.meta.url));
await mkdir(images, { recursive: true });
await mkdir(examples, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "zh-Hant-TW", timezoneId: "Asia/Taipei" });
try {
  const page = await context.newPage();
  if (process.env.PORTFOLIO_CAPTURE_DIAGNOSTICS === "1") {
    page.on("pageerror", error => console.error(`Local preview error: ${error.message}`));
    page.on("requestfailed", request => console.error(`Local preview failed path: ${new URL(request.url()).pathname}`));
    page.on("websocket", socket => console.log(`Local preview socket path: ${new URL(socket.url()).pathname}`));
  }
  let sheetLive = false;
  page.on("websocket", socket => socket.on("framereceived", frame => {
    try {
      const type = JSON.parse(String(frame.payload)).type;
      if (process.env.PORTFOLIO_CAPTURE_DIAGNOSTICS === "1") console.log(`Local capture socket event: ${type}`);
      if (type === "sheet.snapshot") sheetLive = true;
    }
    catch { /* Development transport messages are not sheet protocol frames. */ }
  }));
  const screenshot = async name => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${images}/${name}.png`, fullPage: true, animations: "disabled", caret: "hide", style: "nextjs-portal { display: none !important; }" });
  };
  // Authenticate through the normal endpoint; never submit a cold, unhydrated
  // HTML login form or write a browser storage-state file.
  const login = await context.request.post(new URL("/api/auth/login", origin).href, {
    headers: { origin: origin.origin }, data: { username: "demo.manager", password: DEMO_PASSWORD },
  });
  assert.equal(login.status(), 200, "Synthetic manager login must succeed");
  await page.goto(new URL("/", origin).href);
  await expect(page.locator(".cc-page")).toBeVisible();
  await screenshot("dashboard-desktop");
  await page.goto(new URL("/departments/slitting", origin).href);
  await expect(page.getByRole("heading", { name: DEMO_SUBPAGE, exact: true })).toBeVisible();
  await screenshot("department-desktop");
  const departments = await (await page.request.get(new URL("/api/departments", origin).href)).json();
  const department = departments.departments.find(item => item.code === "SLITTING");
  assert.ok(department);
  const pages = await (await page.request.get(new URL(`/api/departments/${department.id}/subpages`, origin).href)).json();
  const subpage = pages.subpages.find(item => item.name === DEMO_SUBPAGE);
  assert.ok(subpage);
  if (existingBlankSheetId) await page.goto(new URL(`/sheets/${existingBlankSheetId}`, origin).href);
  else {
  await page.goto(new URL(`/departments/slitting/new?from=subpage&subpage=${subpage.id}`, origin).href);
  const create = page.getByRole("button", { name: "建立生產單", exact: true });
  await expect(create).toBeEnabled();
  await page.getByLabel("表單範本").selectOption({ label: "分條申請單" });
  await Promise.all([page.waitForURL(url => /^\/sheets\/[^/]+$/u.test(url.pathname)), create.click()]);
  }
  await expect(page.locator(".cc-formsheet__title")).toHaveText("分條申請單");
  await expect.poll(() => sheetLive, { timeout: 15_000 }).toBe(true);
  const form = page.locator(".cc-formsheet").filter({ has: page.locator(".cc-formsheet__title") });
  const captureForm = async name => {
    await page.evaluate(() => document.fonts.ready);
    await form.screenshot({ path: `${images}/${name}.png`, animations: "disabled", caret: "hide",
      style: ".cc-action-bar,nextjs-portal{display:none!important} html{scrollbar-gutter:auto!important}" });
  };
  await captureForm("sheet-desktop");
  const sheetId = new URL(page.url()).pathname.split("/").at(-1);
  const pdf = await page.request.get(new URL(`/api/sheets/${sheetId}/pdf`, origin).href, { timeout: 40_000 });
  assert.equal(pdf.status(), 200, "Saved blank demo sheet must export successfully");
  assert.ok(pdf.headers()["content-type"]?.includes("application/pdf"));
  const bytes = await pdf.body();
  assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  await writeFile(`${examples}/blank-demo-sheet.pdf`, bytes);
  await page.setViewportSize({ width: 390, height: 844 });
  await captureForm("sheet-mobile");
  console.log("Captured synthetic dashboard, department, blank sheet and saved-sheet PDF. Manually inspect before publication.");
} finally { await context.close(); await browser.close(); }
