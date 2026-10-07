import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { AUTH_FILE, WCAG_TAGS } from "./support";

test.use({ storageState: AUTH_FILE });

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1366, height: 768 },
]) {
  test(`${viewport.name}: real-name default and distinct same-name login`, async ({ page, browser }) => {
    await page.setViewportSize(viewport);
    const realName = `姓名測試-${randomUUID().slice(0, 8)}`;
    const alias = `login${randomUUID().replaceAll("-", "")}${"x".repeat(24)}`;
    const password = "synthetic-real-name-password";
    const ids: string[] = [];
    async function fillAccount(username?: string) {
      await page.goto("/admin/users/new");
      await expect(page.getByRole("button", { name: "建立帳號", exact: true })).toBeEnabled();
      await page.getByLabel(/^姓名/).fill(realName);
      if (username) await page.getByLabel(/^登入名稱/).fill(username);
      await page.getByLabel(/^初始密碼/).fill(password);
      await page.getByRole("checkbox", { name: "分條・員工", exact: true }).check();
    }
    async function save() {
      const response = page.waitForResponse((result) => result.url().endsWith("/api/users") && result.request().method() === "POST");
      await page.getByRole("button", { name: "建立帳號", exact: true }).click();
      return response;
    }
    const employeeContext = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport });
    try {
      await fillAccount();
      await expect(page.getByLabel(/^帳號/)).toHaveCount(0);
      await expect(page.getByLabel(/^登入名稱/)).toHaveValue("");
      expect(await page.getByLabel(/^登入名稱/).getAttribute("required")).toBeNull();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      // Checking the department identity scrolls the mobile form. Scan its
      // canonical initial viewport (as accessibility.spec does), not controls
      // partially underneath the sticky shell header after that interaction.
      // Keep every Axe rule enabled and explicitly verify the labelled hit areas.
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      const choices = await page.locator(".cc-choice:visible").evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
      );
      expect(choices).toHaveLength(22);
      for (const box of choices) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      const accessibility = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(accessibility.violations).toEqual([]);
      const first = await save();
      expect(first.status()).toBe(201);
      const firstUser = (await first.json()).user;
      ids.push(firstUser.id);
      expect(firstUser.username).toBe(realName);
      await expect(page).toHaveURL(/\/admin\/users$/);
      await expect(page.getByRole("columnheader", { name: "帳號", exact: true })).toHaveCount(0);

      await fillAccount();
      expect((await save()).status()).toBe(409);
      // Next's separate route announcer also has role=alert, outside this form.
      await expect(page.locator("form").getByRole("alert")).toContainText("使用者名稱已存在");
      await page.getByLabel(/^登入名稱/).fill(alias);
      const second = await save();
      expect(second.status()).toBe(201);
      ids.push((await second.json()).user.id);
      expect(ids[0]).not.toBe(ids[1]);

      for (const [index, username] of [realName, alias].entries()) {
        const employee: Page = await employeeContext.newPage();
        await employee.goto("/login");
        await employee.getByLabel(/^姓名或登入名稱/).fill(username);
        await employee.getByLabel(/^密碼/).fill(password);
        const loginResponse = employee.waitForResponse((result) => result.url().endsWith("/api/auth/login") && result.request().method() === "POST");
        await employee.getByRole("button", { name: "登入", exact: true }).click();
        const login = await loginResponse;
        expect(login.status()).toBe(200);
        expect((await login.json()).user.id).toBe(ids[index]);
        await expect(employee.getByRole("heading", { name: realName, exact: true })).toBeVisible();
        await expect(employee.getByText(`登入名稱：${alias}`, { exact: true })).toHaveCount(index === 0 ? 0 : 1);
        expect(await employee.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await employee.goto("/settings");
        await expect(employee.getByRole("heading", { name: "個人資料", exact: true })).toBeVisible();
        await expect(employee.locator("dt").filter({ hasText: /^帳號$/ })).toHaveCount(0);
        await expect(employee.locator("dt").filter({ hasText: /^登入名稱$/ })).toHaveCount(index === 0 ? 0 : 1);
        expect(await employee.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await employeeContext.clearCookies();
        await employee.close();
      }
    } finally {
      await employeeContext.close();
      const csrf = (await page.context().cookies()).find((value) => value.name === "workflow_csrf")?.value;
      for (const id of ids) {
        const result = await page.request.patch(`/api/users/${id}`, { headers: { "x-csrf-token": csrf ?? "" }, data: { active: false } });
        expect(result.ok(), "Deactivate only this test's synthetic account").toBeTruthy();
      }
    }
  });
}
