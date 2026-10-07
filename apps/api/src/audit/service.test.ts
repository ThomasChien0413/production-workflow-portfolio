import { describe, expect, it } from "vitest";
import { sanitizeAuditMetadata } from "./service.js";

describe("sanitizeAuditMetadata", () => {
  it("keeps operational metadata but redacts secrets and production values recursively", () => {
    expect(
      sanitizeAuditMetadata({
        changedFields: ["requestDate", "items.0.material"],
        newVersion: 3,
        nested: {
          passwordHash: "argon hash",
          accessToken: "LINE token",
          values: { requestDate: "2026-08-11" },
        },
      }),
    ).toEqual({
      changedFields: ["requestDate", "items.0.material"],
      newVersion: 3,
      nested: {
        passwordHash: "[REDACTED]",
        accessToken: "[REDACTED]",
        values: "[REDACTED]",
      },
    });
  });
});
