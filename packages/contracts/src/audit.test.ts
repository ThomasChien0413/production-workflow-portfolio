import { describe, expect, it } from "vitest";
import { auditListQuerySchema } from "./audit.js";

describe("auditListQuerySchema", () => {
  it("applies bounded pagination defaults and normalizes empty search text", () => {
    expect(auditListQuerySchema.parse({ q: "  " })).toEqual({
      page: 1,
      pageSize: 25,
      q: undefined,
      action: undefined,
      targetType: undefined,
      targetId: undefined,
    });
  });

  it("rejects inverted time ranges", () => {
    expect(() =>
      auditListQuerySchema.parse({
        from: "2026-08-11T12:00:00+08:00",
        to: "2026-08-11T11:00:00+08:00",
      }),
    ).toThrow("開始時間不可晚於結束時間");
  });

  it("rejects unbounded page sizes and unknown filters", () => {
    expect(() => auditListQuerySchema.parse({ pageSize: "101" })).toThrow();
    expect(() => auditListQuerySchema.parse({ unsafe: "filter" })).toThrow();
  });
});
