import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";
import { WCAG_TAGS, WORKFLOW_AUTH_FILES } from "./support";

/**
 * Phone and browser push notifications replaced LINE (the user, 2026-10-04).
 * Nothing reaches a real push service in the suite: the browser's own
 * subscription is stood in for, so the app's side — permission, the service
 * worker, registering the device, the device list, the test push and turning
 * it off — runs for real against the API.
 */
async function fakePushService(context: BrowserContext, endpoint: string) {
  await context.addInitScript((fakeEndpoint) => {
    const key = "e2e-push-subscribed";
    // Headless Chromium reports notifications as denied whatever is granted,
    // so the permission prompt is stood in for too: not asked, then allowed.
    Object.defineProperty(Notification, "permission", {
      configurable: true,
      get: () => localStorage.getItem("e2e-push-permission") ?? "default",
    });
    Notification.requestPermission = async () => {
      localStorage.setItem("e2e-push-permission", "granted");
      return "granted";
    };
    const subscription = {
      endpoint: fakeEndpoint,
      toJSON: () => ({
        endpoint: fakeEndpoint,
        keys: {
          p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
          auth: "tBHItJI5svbpez7KI4CCXg",
        },
      }),
      unsubscribe: async () => {
        localStorage.removeItem(key);
        return true;
      },
    };
    PushManager.prototype.getSubscription = async function getSubscription() {
      return (localStorage.getItem(key) === "1" ? subscription : null) as unknown as PushSubscription;
    };
    PushManager.prototype.subscribe = async function subscribe() {
      localStorage.setItem(key, "1");
      return subscription as unknown as PushSubscription;
    };
  }, endpoint);
}

test("a person turns notifications on for this device, tests them, and turns them off", async ({ browser }) => {
  const context = await browser.newContext({ storageState: WORKFLOW_AUTH_FILES.cutStaff });
  await fakePushService(context, `https://push.example/e2e-${Date.now()}`);
  const page = await context.newPage();

  try {
    // Until this device is on, the home page says so; it never blocks.
    await page.goto("/");
    const reminder = page.getByRole("link", { name: "前往設定" });
    await expect(page.getByText("開啟通知，才收得到生產單提醒")).toBeVisible();
    await reminder.click();
    await expect(page).toHaveURL(/\/settings#notifications$/);

    const card = page.locator("#notifications");
    await expect(card.getByRole("heading", { name: "通知", exact: true })).toBeVisible();
    await expect(card.getByText("還沒有任何裝置。")).toBeVisible();
    const accessibility = await new AxeBuilder({ page }).include("#notifications").withTags(WCAG_TAGS).analyze();
    expect(accessibility.violations).toEqual([]);

    const registered = page.waitForResponse(
      (response) => response.url().endsWith("/api/push/subscriptions") && response.request().method() === "POST",
    );
    await card.getByRole("button", { name: "在此裝置開啟通知", exact: true }).click();
    expect((await registered).status()).toBe(200);
    await expect(card.getByText("此裝置已開啟通知。可以傳送一則測試通知確認。")).toBeVisible();
    await expect(card.getByText("還沒有任何裝置。")).toHaveCount(0);
    await expect(card.locator("li")).toHaveCount(1);
    await expect(card.locator("li")).toContainText("最近收到：尚未收到");

    const tested = page.waitForResponse((response) => response.url().endsWith("/api/push/test"));
    await card.getByRole("button", { name: "傳送測試通知", exact: true }).click();
    expect(await (await tested).json()).toEqual({ queued: true });
    await expect(card.getByText("測試通知已送出，幾秒內應會在此裝置跳出。")).toBeVisible();

    // On, the home page no longer reminds.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("開啟通知，才收得到生產單提醒")).toHaveCount(0);

    await page.goto("/settings#notifications");
    await card.getByRole("button", { name: "關閉此裝置的通知", exact: true }).click();
    await expect(card.getByText("此裝置已關閉通知。")).toBeVisible();
    await expect(card.getByText("還沒有任何裝置。")).toBeVisible();
    await expect(card.getByRole("button", { name: "在此裝置開啟通知", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("an iPhone not opened from the Home Screen is shown how to add it first", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: WORKFLOW_AUTH_FILES.cutStaff,
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(page.getByText(/iPhone／iPad 需要先把 Workflow Portfolio 加入主畫面/)).toBeVisible();
    await page.goto("/settings#notifications");
    const card = page.locator("#notifications");
    await expect(card.getByText("iPhone／iPad 需要先加入主畫面")).toBeVisible();
    await expect(card.getByText(/選擇「加入主畫面」/)).toBeVisible();
    await expect(card.getByRole("button", { name: "在此裝置開啟通知", exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("the app can be added to a Home Screen", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({
    short_name: "Workflow Portfolio",
    display: "standalone",
    start_url: "/",
    icons: expect.arrayContaining([expect.objectContaining({ sizes: "512x512" })]),
  });
  const worker = await request.get("/sw.js");
  expect(worker.ok()).toBe(true);
  expect(await worker.text()).toContain("showNotification");
});
