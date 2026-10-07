import { describe, expect, it, vi } from "vitest";
import { SheetRetentionPurger, type PurgedSheet } from "./retention.js";

function clock(start: number) {
  let current = start;
  return { now: () => new Date(current), advance: (ms: number) => (current += ms) };
}

const purged = (sheetId: string): PurgedSheet => ({ sheetId, attachmentFiles: 0 });

describe("archived sheet retention purger", () => {
  it("runs once an interval, deleting until nothing more qualifies", async () => {
    const time = clock(Date.UTC(2027, 9, 1));
    const purgeOne = vi
      .fn()
      .mockResolvedValueOnce(purged("a"))
      .mockResolvedValueOnce(purged("b"))
      .mockResolvedValue(null);
    const purger = new SheetRetentionPurger({ purgeOne }, 3_600_000, 100, time.now);

    await expect(purger.runIfDue()).resolves.toBe(2);
    time.advance(60_000);
    await expect(purger.runIfDue()).resolves.toBeNull();
    time.advance(3_600_000);
    await expect(purger.runIfDue()).resolves.toBe(0);
    expect(purgeOne).toHaveBeenCalledTimes(4);
  });

  it("returns on the next cycle when a full batch may have left more", async () => {
    const time = clock(Date.UTC(2027, 9, 1));
    const purgeOne = vi.fn().mockResolvedValue(purged("x"));
    const purger = new SheetRetentionPurger({ purgeOne }, 3_600_000, 3, time.now);

    await expect(purger.runIfDue()).resolves.toBe(3);
    time.advance(5_000);
    await expect(purger.runIfDue()).resolves.toBe(3);
  });

  it("keeps its schedule when a deletion fails, so the next cycle retries", async () => {
    const time = clock(Date.UTC(2027, 9, 1));
    const purgeOne = vi.fn().mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValue(null);
    const purger = new SheetRetentionPurger({ purgeOne }, 3_600_000, 100, time.now);

    await expect(purger.runIfDue()).rejects.toThrow("database unavailable");
    time.advance(5_000);
    await expect(purger.runIfDue()).resolves.toBe(0);
  });
});
