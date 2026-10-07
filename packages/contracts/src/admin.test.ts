import { describe, expect, it } from "vitest";
import {
  createAdminUserRequestSchema,
  updateAdminUserRequestSchema,
} from "./admin.js";

const departmentId = "00000000-0000-4000-8000-000000000001";

describe("administrator user contracts", () => {
  it("defaults an omitted login name to the real name", () => {
    const result = createAdminUserRequestSchema.parse({
      displayName: " 王小明 ", initialPassword: "temporary-password",
      memberships: [{ departmentId, kind: "STAFF" }],
    });
    expect(result.username).toBe("王小明");
    expect(result.displayName).toBe("王小明");
  });

  it("preserves a manager-chosen login name separately from a duplicate real name", () => {
    const result = createAdminUserRequestSchema.parse({
      username: "王小明-二", displayName: "王小明", initialPassword: "temporary-password",
      memberships: [{ departmentId, kind: "STAFF" }],
    });
    expect(result.username).toBe("王小明-二");
    expect(result.displayName).toBe("王小明");
  });

  it("requires a valid, bounded login name even when it defaults from the display name", () => {
    for (const displayName of ["名".repeat(65), "王\u200b小明"]) {
      expect(createAdminUserRequestSchema.safeParse({
        displayName, initialPassword: "temporary-password", roles: ["ADMIN"],
      }).success).toBe(false);
    }
    expect(createAdminUserRequestSchema.safeParse({
      username: "", displayName: "王小明", initialPassword: "temporary-password", roles: ["ADMIN"],
    }).success).toBe(false);
  });

  it("accepts an active user with a department identity", () => {
    const result = createAdminUserRequestSchema.parse({
      username: "staff.one",
      displayName: "測試員工",
      initialPassword: "temporary-password",
      memberships: [{ departmentId, kind: "STAFF" }],
    });

    expect(result).toMatchObject({ active: true, roles: [] });
  });

  it("rejects active users with no role or department identity", () => {
    expect(() =>
      createAdminUserRequestSchema.parse({
        username: "unassigned",
        displayName: "未指派",
        initialPassword: "temporary-password",
      }),
    ).toThrow("啟用中的帳號至少需要一個角色或部門身分");
  });

  it("accepts multiple distinct identities in the same department", () => {
    const result = createAdminUserRequestSchema.parse({
      username: "multi.identity",
      displayName: "多重身分",
      initialPassword: "temporary-password",
      memberships: [
        { departmentId, kind: "MANAGER" },
        { departmentId, kind: "ORDER_TAKER" },
        { departmentId, kind: "STAFF" },
      ],
    });

    expect(result.memberships).toHaveLength(3);
  });

  it("rejects duplicate roles and exact duplicate department identities", () => {
    const result = createAdminUserRequestSchema.safeParse({
      username: "duplicates",
      displayName: "重複設定",
      initialPassword: "temporary-password",
      roles: ["ADMIN", "ADMIN"],
      memberships: [
        { departmentId, kind: "STAFF" },
        { departmentId, kind: "STAFF" },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining(["角色不可重複", "同一部門身分不可重複設定"]),
      );
    }
  });

  it("allows a disabled account only when it has no active assignments", () => {
    expect(
      createAdminUserRequestSchema.parse({
        username: "disabled",
        displayName: "停用帳號",
        initialPassword: "temporary-password",
        active: false,
      }),
    ).toMatchObject({ active: false, roles: [], memberships: [] });

    expect(() =>
      createAdminUserRequestSchema.parse({
        username: "disabled-role",
        displayName: "錯誤停用帳號",
        initialPassword: "temporary-password",
        active: false,
        roles: ["SALES"],
      }),
    ).toThrow("停用帳號不可同時啟用角色或部門身分");
  });

  it("rejects an empty update", () => {
    expect(() => updateAdminUserRequestSchema.parse({})).toThrow(
      "至少需要一項變更",
    );
  });
});
