import { describe, expect, it } from "vitest";
import {
  createAdminUserRequestSchema,
  resetAdminUserPasswordRequestSchema,
} from "./admin.js";
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  PASSWORD_MIN_LENGTH,
} from "./auth.js";

const departmentId = "00000000-0000-4000-8000-000000000001";
const seven = "abcdefg";
const eight = "abcdefgh";

// The minimum is 8 characters (the user, 2026-10-01; it was 12).
describe("password length", () => {
  it("is 8 characters", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it("applies to changing your own password", () => {
    const change = (newPassword: string) =>
      changePasswordRequestSchema.safeParse({ currentPassword: "DemoOnly2026!", newPassword }).success;
    expect(change(seven)).toBe(false);
    expect(change(eight)).toBe(true);
  });

  it("applies to an account's initial password", () => {
    const create = (initialPassword: string) =>
      createAdminUserRequestSchema.safeParse({
        username: "staff.one",
        displayName: "測試員工",
        initialPassword,
        memberships: [{ departmentId, kind: "STAFF" }],
      }).success;
    expect(create(seven)).toBe(false);
    expect(create(eight)).toBe(true);
  });

  it("applies to a password reset", () => {
    const reset = (newPassword: string) =>
      resetAdminUserPasswordRequestSchema.safeParse({ newPassword }).success;
    expect(reset(seven)).toBe(false);
    expect(reset(eight)).toBe(true);
  });

  it("does not apply to signing in with a legacy six-character test password", () => {
    expect(loginRequestSchema.safeParse({ username: "admin", password: "123456" }).success).toBe(true);
  });
});
