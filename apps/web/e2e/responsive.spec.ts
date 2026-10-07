import { expect, test, type Page } from "@playwright/test";
import { AUTH_FILE, VIEWPORTS } from "./support";

const ANONYMOUS_ROUTES = ["/login"] as const;
const AUTHENTICATED_ROUTES = [
  "/change-password",
  "/settings",
  "/notifications",
  // /admin/users carries the table-to-card swap, so it is the route most likely
  // to overflow horizontally on a 360px viewport.
  "/admin/users",
  "/admin/users/new",
  // Definition tables are the widest content in the app; the 360px viewport is
  // where they would overflow the page if the wrapper ever lost its scroll.
  "/admin/templates",
  // Audit rows carry ids and metadata: the densest text in the app, and the
  // most likely to push a table past a 360px viewport.
  "/admin/audit",
  "/admin/notifications",
] as const;

/** AGENTS.md section 7: minimum interactive target is 44x44px. */
const MIN_TARGET = 44;

/**
 * Sub-pixel layout rounding means a 1px overflow is noise, not a finding.
 * Anything a user could actually scroll is well above this.
 */
const OVERFLOW_TOLERANCE = 1;

async function horizontalOverflow(page: Page) {
  await expect(page.locator("h1, h2").first()).toBeVisible();
  return page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      // Name the widest offenders so a failure is actionable.
      widest: [...document.querySelectorAll<HTMLElement>("body *")]
        .map((el) => ({
          selector:
            el.tagName.toLowerCase() +
            (el.className ? `.${String(el.className).split(" ")[0]}` : ""),
          right: Math.round(el.getBoundingClientRect().right),
        }))
        .filter((entry) => entry.right > doc.clientWidth + 1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 3),
    };
  });
}

async function undersizedTargets(page: Page, min: number) {
  await expect(page.locator("h1, h2").first()).toBeVisible();
  return page.evaluate((minimum) => {
    const selector = "a, button, input, select, textarea, [role='button']";

    /**
     * The area a user can actually hit.
     *
     * The design system deliberately renders a 20px checkbox inside a 44px
     * label (DESIGN.md §3.2.4). Clicking anywhere in that label activates the
     * control, so the label is the real target and measuring the input alone
     * would report a false failure. Only a wrapping label counts — a `for=`
     * label sits elsewhere on screen and does not enlarge the control.
     */
    const targetBox = (el: HTMLElement): DOMRect => {
      const isBoxControl =
        el instanceof HTMLInputElement &&
        (el.type === "checkbox" || el.type === "radio");
      if (!isBoxControl) return el.getBoundingClientRect();
      const wrapping = el.closest("label");
      return (wrapping ?? el).getBoundingClientRect();
    };

    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (el.hasAttribute("hidden")) return false;
        const own = el.getBoundingClientRect();
        if (own.width === 0 && own.height === 0) return false;
        // WCAG 2.5.8 exempts links flowing inside a block of text; the rule
        // targets standalone controls.
        if (el.tagName === "A" && el.closest("p") !== null) return false;
        const box = targetBox(el);
        return box.height < minimum || box.width < minimum;
      })
      .map((el) => {
        const box = targetBox(el);
        return {
          selector:
            el.tagName.toLowerCase() +
            (el.className ? `.${String(el.className).split(" ")[0]}` : ""),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      });
  }, min);
}

for (const viewport of VIEWPORTS) {
  test.describe(`responsive at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test.describe("anonymous", () => {
      for (const route of ANONYMOUS_ROUTES) {
        test(`${route} does not scroll horizontally`, async ({ page }) => {
          await page.goto(route);
          const overflow = await horizontalOverflow(page);
          expect(
            overflow.scrollWidth,
            `${route} overflows at ${viewport.width}px. Widest: ${JSON.stringify(overflow.widest)}`,
          ).toBeLessThanOrEqual(overflow.clientWidth + OVERFLOW_TOLERANCE);
        });

        test(`${route} targets are at least ${MIN_TARGET}px`, async ({ page }) => {
          await page.goto(route);
          const undersized = await undersizedTargets(page, MIN_TARGET);
          expect(
            undersized,
            `${route} at ${viewport.width}px: ${JSON.stringify(undersized)}`,
          ).toEqual([]);
        });
      }
    });

    test.describe("authenticated", () => {
      test.use({ storageState: AUTH_FILE });

      for (const route of AUTHENTICATED_ROUTES) {
        test(`${route} does not scroll horizontally`, async ({ page }) => {
          await page.goto(route);
          const overflow = await horizontalOverflow(page);
          expect(
            overflow.scrollWidth,
            `${route} overflows at ${viewport.width}px. Widest: ${JSON.stringify(overflow.widest)}`,
          ).toBeLessThanOrEqual(overflow.clientWidth + OVERFLOW_TOLERANCE);
        });

        test(`${route} targets are at least ${MIN_TARGET}px`, async ({ page }) => {
          await page.goto(route);
          const undersized = await undersizedTargets(page, MIN_TARGET);
          expect(
            undersized,
            `${route} at ${viewport.width}px: ${JSON.stringify(undersized)}`,
          ).toEqual([]);
        });
      }
    });
  });
}

test.describe("keyboard", () => {
  test("focus is visible on the login controls", async ({ page }) => {
    await page.goto("/login");

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    const focusOutline = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return null;
      const style = getComputedStyle(active);
      return {
        tag: active.tagName.toLowerCase(),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });

    expect(focusOutline, "tabbing must move focus to a control").not.toBeNull();
    // DESIGN.md section 3.4: focus is always visible, never removed.
    expect(focusOutline?.outlineStyle).not.toBe("none");
    expect(parseFloat(focusOutline?.outlineWidth ?? "0")).toBeGreaterThan(0);
  });

  test("the whole login form is reachable by keyboard", async ({ page }) => {
    await page.goto("/login");

    const reached: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active) return null;
        return active.getAttribute("name") ?? active.tagName.toLowerCase();
      });
      if (name) reached.push(name);
    }

    expect(reached).toContain("username");
    expect(reached).toContain("password");
    expect(reached).toContain("button");
  });
});
