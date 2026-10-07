import { expect, type Page } from "@playwright/test";

/** Sample both viewport rectangles in the same browser task, never across RPCs. */
export async function readStatusArchiveGap(page: Page): Promise<number | null> {
  const status = page.getByRole("group", { name: "生產狀態", exact: true });
  const archive = page.getByRole("button", { name: "封存生產單", exact: true });
  return status.or(archive).evaluateAll((elements) => {
    if (elements.length !== 2) return null;
    const statusElement = elements.find((element) => element.tagName !== "BUTTON");
    const archiveElement = elements.find((element) => element.tagName === "BUTTON");
    if (!statusElement || !archiveElement) return null;
    const statusRect = statusElement.getBoundingClientRect();
    const archiveRect = archiveElement.getBoundingClientRect();
    if (!statusRect.width || !statusRect.height || !archiveRect.width || !archiveRect.height) return null;
    return archiveRect.top - statusRect.bottom;
  });
}

export async function expectArchiveBelowStatus(page: Page, options?: { timeout?: number }) {
  await expect.poll(async () => {
    const gap = await readStatusArchiveGap(page);
    return {
      present: gap !== null,
      below: gap !== null && gap > -1,
      nearby: gap !== null && gap < 400,
    };
  }, options).toEqual({ present: true, below: true, nearby: true });
}
