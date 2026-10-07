import { describe, expect, it } from "vitest";
import { hashToken } from "./service.js";

describe("session token hashing", () => {
  it("is deterministic without retaining the raw token", () => {
    const token = "session-token-that-must-not-be-persisted";
    const hash = hashToken(token);

    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
    expect(hashToken(`${token}-different`)).not.toBe(hash);
  });
});
