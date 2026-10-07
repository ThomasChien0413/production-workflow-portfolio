import { describe, expect, it } from "vitest";
import { archivedSheetDeletionAt } from "./retention.js";

describe("archived sheet retention", () => {
  it("deletes one calendar year after 封存, to the millisecond", () => {
    expect(archivedSheetDeletionAt(new Date("2026-10-01T16:30:12.345Z")).toISOString()).toBe(
      "2027-10-01T16:30:12.345Z",
    );
  });

  it("falls back from 29 February to 28 February, as PostgreSQL does", () => {
    expect(archivedSheetDeletionAt(new Date("2028-02-29T03:00:00.000Z")).toISOString()).toBe(
      "2029-02-28T03:00:00.000Z",
    );
  });

  it("counts in UTC, so a Taipei date near midnight keeps its instant", () => {
    // 2026-12-31 23:30 in Taipei.
    expect(archivedSheetDeletionAt(new Date("2026-12-31T15:30:00.000Z")).toISOString()).toBe(
      "2027-12-31T15:30:00.000Z",
    );
  });
});
