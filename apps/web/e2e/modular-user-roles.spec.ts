import { expect, test } from "@playwright/test";
import { AUTH_FILE, DEACTIVATION_TARGET } from "./support";

test.describe.configure({ mode: "serial" });
test.use({ storageState: AUTH_FILE });

const desiredIdentities = [
  "分條・主管",
  "分條・訂單人員",
  "分條・員工",
  "CUT・員工",
] as const;

async function openFixtureEditor(page: import("@playwright/test").Page) {
  await page.goto(
    `/admin/users?q=${encodeURIComponent(DEACTIVATION_TARGET.username)}`,
  );
  const manage = page
    .locator('a[href^="/admin/users/"]:visible')
    .filter({ hasText: DEACTIVATION_TARGET.displayName })
    .first();
  await expect(manage).toBeVisible();
  await manage.click();
  await expect(page.getByRole("heading", { name: DEACTIVATION_TARGET.displayName })).toBeVisible();
}

async function setExactDepartmentIdentities(
  page: import("@playwright/test").Page,
) {
  const identityCheckboxes = page.locator(
    '.cc-membership-matrix input[type="checkbox"]',
  );
  await expect(identityCheckboxes).toHaveCount(18);

  for (const checkbox of await identityCheckboxes.all()) {
    if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  for (const label of desiredIdentities) {
    await page.getByRole("checkbox", { name: label, exact: true }).check();
  }

  const save = page.getByRole("button", { name: "儲存變更" });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("已儲存", { exact: true })).toBeVisible();
  await page.reload();
  for (const label of desiredIdentities) {
    await expect(
      page.getByRole("checkbox", { name: label, exact: true }),
    ).toBeChecked();
  }
  await expect(identityCheckboxes).toHaveCount(18);
  expect(await identityCheckboxes.evaluateAll((elements) =>
    elements.filter((element) => (element as HTMLInputElement).checked).length,
  )).toBe(desiredIdentities.length);
}

for (const viewport of [
  { name: "desktop", width: 1366, height: 768 },
  { name: "mobile", width: 360, height: 800 },
] as const) {
  test(`${viewport.name}: independently assigns and persists department identities`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openFixtureEditor(page);
    await setExactDepartmentIdentities(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    for (const label of desiredIdentities) {
      const box = await page
        .getByRole("checkbox", { name: label, exact: true })
        .locator("xpath=ancestor::label")
        .boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
}
