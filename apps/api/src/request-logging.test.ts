import { describe, expect, it } from "vitest";
import { safeRequestPath } from "./request-logging.js";

describe("safeRequestPath", () => {
  it("never returns authorization codes or state from a callback URL", () => {
    expect(
      safeRequestPath(
        "/api/line/callback?code=sensitive-code&state=sensitive-state",
      ),
    ).toBe("/api/line/callback");
  });

  it("keeps an ordinary path unchanged", () => {
    expect(safeRequestPath("/api/health")).toBe("/api/health");
  });
});
