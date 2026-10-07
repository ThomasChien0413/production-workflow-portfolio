import { describe, expect, it } from "vitest";
import { escapeHistoryLike } from "./service.js";

describe("department sheet history search", () => {
  it("escapes PostgreSQL LIKE metacharacters so search remains literal", () => {
    expect(escapeHistoryLike(String.raw`A%_\\B`)).toBe(String.raw`A\%\_\\\\B`);
  });
});
