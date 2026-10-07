import { describe, expect, it } from "vitest";
import { loginRequestSchema, usernameSchema } from "./auth.js";

describe("real-name login contracts", () => {
  it.each(["陳小明", "王小明-二", "Jean-Luc", "O’Connor", "林·美玲", "José Silva", "admin", "staff.one", "_staff", "員工123"])("accepts name or alias %s", (username) => {
    expect(loginRequestSchema.parse({ username, password: "unchanged-password" }).username).toBe(username);
  });

  it("trims surrounding ordinary spaces without joining internal spaces", () => {
    expect(usernameSchema.parse("  王 小明  ")).toBe("王 小明");
  });

  it("uses NFC so composed and decomposed spellings resolve to the same login name", () => {
    expect(usernameSchema.parse("Jose\u0301")).toBe("José");
  });

  it.each(["", "   ", "a".repeat(65), "<王小明>", "王/小明", "王😀", "王\n小明", "王\t小明", "王\u200b小明", "王\u202e小明", "admin\u0000", "\nadmin", "王\u2028小明"])("rejects invalid login name %j", (username) => {
    expect(usernameSchema.safeParse(username).success).toBe(false);
  });
});
