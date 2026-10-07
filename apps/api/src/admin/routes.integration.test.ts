import { randomUUID } from "node:crypto";
import { and, ilike, inArray, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditEvents,
  createDatabase,
  departmentMemberships,
  roleAssignments,
  sessions,
  users,
} from "@workflow/database";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const appOrigin = "http://localhost:3000";
const testPrefix = `vitest-admin-${randomUUID().slice(0, 8)}`;
const staffUsername = `${testPrefix}-staff`;
const salesUsername = `${testPrefix}-sales`;
const duplicateSalesUsername = `${testPrefix}-sales-duplicate`;
const generalManagerUsername = `${testPrefix}-gm`;
const managedUsername = `${testPrefix}-managed`;
const initialPassword = "temporary-password-123";
const resetPassword = "replacement-password-456";

type AuthCookies = {
  cookie: string;
  csrf: string;
};

function cookiesFrom(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): AuthCookies {
  const rawSetCookie = response.headers["set-cookie"];
  const setCookie = typeof rawSetCookie === "number" ? undefined : rawSetCookie;
  const lines = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
  const pairs = lines.flatMap((line) => {
    const pair = line.split(";", 1)[0];
    return pair ? [pair] : [];
  });
  const csrfPair = pairs.find((pair) => pair.startsWith("workflow_csrf="));
  if (!csrfPair) throw new Error("CSRF cookie missing from login response");
  return {
    cookie: pairs.join("; "),
    csrf: csrfPair.slice("workflow_csrf=".length),
  };
}

async function deactivateOldTestUsers(): Promise<void> {
  if (!testDatabaseUrl) return;
  const connection = createDatabase(testDatabaseUrl, 1);
  try {
    const rows = await connection.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(ilike(users.username, "vitest-admin-%"), ne(users.username, "admin")),
      );
    const userIds = rows.map((row) => row.id);
    if (userIds.length === 0) return;
    const now = new Date();
    await connection.db.transaction(async (tx) => {
      await tx
        .update(roleAssignments)
        .set({ active: false })
        .where(inArray(roleAssignments.userId, userIds));
      await tx
        .update(departmentMemberships)
        .set({ active: false })
        .where(inArray(departmentMemberships.userId, userIds));
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(inArray(sessions.userId, userIds));
      await tx
        .update(users)
        .set({ active: false, updatedAt: now })
        .where(inArray(users.id, userIds));
    });
  } finally {
    await connection.close();
  }
}

describe.skipIf(!testDatabaseUrl)("administrator user routes with PostgreSQL", () => {
  beforeAll(deactivateOldTestUsers);
  afterAll(deactivateOldTestUsers);

  it("enforces ADMIN access and manages accounts atomically with audit history", async () => {
    const app = await buildApp(
      loadConfig({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
        APP_ORIGIN: appOrigin,
      }),
    );

    try {
      const adminLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username: "admin", password: "DemoOnly2026!" },
      });
      expect(adminLogin.statusCode).toBe(200);
      const adminCookies = cookiesFrom(adminLogin);
      const adminWriteHeaders = {
        origin: appOrigin,
        cookie: adminCookies.cookie,
        "x-csrf-token": adminCookies.csrf,
      };

      const departmentsResponse = await app.inject({
        method: "GET",
        url: "/api/departments",
        headers: { cookie: adminCookies.cookie },
      });
      expect(departmentsResponse.statusCode).toBe(200);
      expect(departmentsResponse.json().departments).toHaveLength(6);
      const slittingDepartment = departmentsResponse
        .json()
        .departments.find((department: { displayName: string }) =>
          department.displayName === "分條",
        );
      expect(slittingDepartment).toBeDefined();

      const rolesResponse = await app.inject({
        method: "GET",
        url: "/api/roles",
        headers: { cookie: adminCookies.cookie },
      });
      expect(rolesResponse.statusCode).toBe(200);
      expect(rolesResponse.json().roles).toContainEqual({
        code: "SALES",
        label: "業務",
        singleton: true,
      });

      const staffPayload = {
        username: staffUsername,
        displayName: "整合測試員工",
        initialPassword,
        memberships: [
          { departmentId: slittingDepartment.id, kind: "MANAGER" },
          { departmentId: slittingDepartment.id, kind: "ORDER_TAKER" },
          { departmentId: slittingDepartment.id, kind: "STAFF" },
        ],
      };
      const missingCsrf = await app.inject({
        method: "POST",
        url: "/api/users",
        headers: { origin: appOrigin, cookie: adminCookies.cookie },
        payload: staffPayload,
      });
      expect(missingCsrf.statusCode).toBe(403);

      const duplicateIdentity = await app.inject({
        method: "POST",
        url: "/api/users",
        headers: adminWriteHeaders,
        payload: {
          ...staffPayload,
          memberships: [
            { departmentId: slittingDepartment.id, kind: "STAFF" },
            { departmentId: slittingDepartment.id, kind: "STAFF" },
          ],
        },
      });
      expect(duplicateIdentity.statusCode).toBe(400);
      expect(duplicateIdentity.json()).toMatchObject({
        error: "VALIDATION_ERROR",
        message: "輸入資料格式不正確",
      });
      expect(duplicateIdentity.json().issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: "同一部門身分不可重複設定" }),
        ]),
      );

      const createStaff = await app.inject({
        method: "POST",
        url: "/api/users",
        headers: adminWriteHeaders,
        payload: staffPayload,
      });
      expect(createStaff.statusCode).toBe(201);
      const staff = createStaff.json().user;
      expect(staff).toMatchObject({
        username: staffUsername,
        active: true,
        // Only ADMIN and 總經理 change their own password, so nobody else is
        // warned about a default one (the user, 2026-10-04).
        passwordWarning: false,
        roles: [],
      });
      expect(staff.memberships).toEqual(
        expect.arrayContaining(
          ["MANAGER", "ORDER_TAKER", "STAFF"].map((kind) =>
            expect.objectContaining({ departmentName: "分條", kind }),
          ),
        ),
      );
      expect(staff.memberships).toHaveLength(3);

      const staffLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username: staffUsername, password: initialPassword },
      });
      expect(staffLogin.statusCode).toBe(200);
      expect(staffLogin.json().user.memberships).toHaveLength(3);
      const staffCookies = cookiesFrom(staffLogin);
      const forbiddenList = await app.inject({
        method: "GET",
        url: "/api/users",
        headers: { cookie: staffCookies.cookie },
      });
      expect(forbiddenList.statusCode).toBe(403);

      // Department names are navigation, readable by anyone signed in, while
      // the people in them stay behind the account-manager guard above.
      const staffDepartments = await app.inject({
        method: "GET",
        url: "/api/departments",
        headers: { cookie: staffCookies.cookie },
      });
      expect(staffDepartments.statusCode).toBe(200);
      expect(staffDepartments.json().departments).toHaveLength(6);

      const anonymousDepartments = await app.inject({
        method: "GET",
        url: "/api/departments",
      });
      expect(anonymousDepartments.statusCode).toBe(401);

      const createSales = await app.inject({
        method: "POST",
        url: "/api/users",
        headers: adminWriteHeaders,
        payload: {
          username: salesUsername,
          displayName: "整合測試業務",
          initialPassword,
          roles: ["SALES"],
        },
      });
      expect(createSales.statusCode).toBe(201);
      const sales = createSales.json().user;

      const duplicateSales = await app.inject({
        method: "POST",
        url: "/api/users",
        headers: adminWriteHeaders,
        payload: {
          username: duplicateSalesUsername,
          displayName: "重複業務",
          initialPassword,
          roles: ["SALES"],
        },
      });
      expect(duplicateSales.statusCode).toBe(409);
      expect(duplicateSales.json().message).toContain("業務已有啟用中的使用者");

      const updateStaff = await app.inject({
        method: "PATCH",
        url: `/api/users/${staff.id}`,
        headers: adminWriteHeaders,
        payload: {
          displayName: "整合測試主管",
          memberships: [
            { departmentId: slittingDepartment.id, kind: "MANAGER" },
            { departmentId: slittingDepartment.id, kind: "STAFF" },
          ],
        },
      });
      expect(updateStaff.statusCode).toBe(200);
      expect(updateStaff.json().user).toMatchObject({
        displayName: "整合測試主管",
      });
      expect(updateStaff.json().user.memberships).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "MANAGER" }),
          expect.objectContaining({ kind: "STAFF" }),
        ]),
      );
      expect(updateStaff.json().user.memberships).toHaveLength(2);

      const revokedAfterPermissionChange = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: { cookie: staffCookies.cookie },
      });
      expect(revokedAfterPermissionChange.statusCode).toBe(401);

      const salesLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username: salesUsername, password: initialPassword },
      });
      expect(salesLogin.statusCode).toBe(200);
      const salesCookies = cookiesFrom(salesLogin);

      const passwordReset = await app.inject({
        method: "POST",
        url: `/api/users/${sales.id}/password-reset`,
        headers: adminWriteHeaders,
        payload: { newPassword: resetPassword },
      });
      expect(passwordReset.statusCode).toBe(200);

      const revokedAfterReset = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: { cookie: salesCookies.cookie },
      });
      expect(revokedAfterReset.statusCode).toBe(401);

      const oldPasswordLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username: salesUsername, password: initialPassword },
      });
      expect(oldPasswordLogin.statusCode).toBe(401);
      const newPasswordLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username: salesUsername, password: resetPassword },
      });
      expect(newPasswordLogin.statusCode).toBe(200);
      expect(newPasswordLogin.json().user.passwordWarning).toBe(false);
      const newPasswordCookies = cookiesFrom(newPasswordLogin);
      // 業務 cannot change the password they were given (the user, 2026-10-04).
      const forbiddenOwnChange = await app.inject({
        method: "PATCH",
        url: "/api/auth/password",
        headers: {
          origin: appOrigin,
          cookie: newPasswordCookies.cookie,
          "x-csrf-token": newPasswordCookies.csrf,
        },
        payload: { currentPassword: resetPassword, newPassword: `${resetPassword}-changed` },
      });
      expect(forbiddenOwnChange.statusCode).toBe(403);
      const stillReset = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username: salesUsername, password: resetPassword },
      });
      expect(stillReset.statusCode).toBe(200);

      const forbiddenAudit = await app.inject({
        method: "GET",
        url: "/api/audit",
        headers: { cookie: newPasswordCookies.cookie },
      });
      expect(forbiddenAudit.statusCode).toBe(403);

      const selfDeactivation = await app.inject({
        method: "PATCH",
        url: `/api/users/${adminLogin.json().user.id}`,
        headers: adminWriteHeaders,
        payload: { active: false },
      });
      expect(selfDeactivation.statusCode).toBe(409);

      const deactivateStaff = await app.inject({
        method: "PATCH",
        url: `/api/users/${staff.id}`,
        headers: adminWriteHeaders,
        payload: { active: false },
      });
      expect(deactivateStaff.statusCode).toBe(200);
      expect(deactivateStaff.json().user).toMatchObject({
        active: false,
        roles: [],
        memberships: [],
      });

      const connection = createDatabase(testDatabaseUrl!, 1);
      try {
        const events = await connection.db
          .select({ action: auditEvents.action, metadata: auditEvents.metadata })
          .from(auditEvents)
          .where(inArray(auditEvents.targetId, [staff.id, sales.id]));
        expect(events.map((event) => event.action)).toEqual(
          expect.arrayContaining([
            "ADMIN_USER_CREATED",
            "ADMIN_USER_UPDATED",
            "ADMIN_PASSWORD_RESET",
          ]),
        );
        expect(JSON.stringify(events)).not.toContain(initialPassword);
        expect(JSON.stringify(events)).not.toContain(resetPassword);
      } finally {
        await connection.close();
      }

      const auditSearch = await app.inject({
        method: "GET",
        url: `/api/audit?action=ADMIN_PASSWORD_RESET&targetId=${sales.id}&pageSize=1`,
        headers: { cookie: adminCookies.cookie },
      });
      expect(auditSearch.statusCode).toBe(200);
      expect(auditSearch.json()).toMatchObject({
        page: 1,
        pageSize: 1,
        total: 1,
        items: [
          {
            action: "ADMIN_PASSWORD_RESET",
            targetType: "USER",
            targetId: sales.id,
            actor: {
              id: adminLogin.json().user.id,
              username: "admin",
            },
          },
        ],
      });
      expect(JSON.stringify(auditSearch.json())).not.toContain(resetPassword);

      const malformedAuditSearch = await app.inject({
        method: "GET",
        url: "/api/audit?pageSize=101",
        headers: { cookie: adminCookies.cookie },
      });
      expect(malformedAuditSearch.statusCode).toBe(400);

      const deactivateSales = await app.inject({
        method: "PATCH",
        url: `/api/users/${sales.id}`,
        headers: adminWriteHeaders,
        payload: { active: false },
      });
      expect(deactivateSales.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  /**
   * 總經理 manages accounts alongside ADMIN (AGENTS.md §5, amended 2026-08-08).
   * The self-lockout guard has to follow: it must protect whichever
   * account-manager role the actor actually holds, not assume ADMIN.
   */
  it("lets 總經理 manage accounts without being able to strip its own permission", async () => {
    const app = await buildApp(
      loadConfig({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
        APP_ORIGIN: appOrigin,
      }),
    );

    try {
      const adminLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username: "admin", password: "DemoOnly2026!" },
      });
      expect(adminLogin.statusCode).toBe(200);
      const adminCookies = cookiesFrom(adminLogin);

      const createManager = await app.inject({
        method: "POST",
        url: "/api/users",
        headers: {
          origin: appOrigin,
          cookie: adminCookies.cookie,
          "x-csrf-token": adminCookies.csrf,
        },
        payload: {
          username: generalManagerUsername,
          displayName: "整合測試總經理",
          initialPassword,
          roles: ["GENERAL_MANAGER"],
        },
      });
      expect(createManager.statusCode).toBe(201);
      const manager = createManager.json().user;

      const managerLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username: generalManagerUsername, password: initialPassword },
      });
      expect(managerLogin.statusCode).toBe(200);
      const managerCookies = cookiesFrom(managerLogin);
      const managerWriteHeaders = {
        origin: appOrigin,
        cookie: managerCookies.cookie,
        "x-csrf-token": managerCookies.csrf,
      };

      const managerList = await app.inject({
        method: "GET",
        url: "/api/users",
        headers: { cookie: managerCookies.cookie },
      });
      expect(managerList.statusCode).toBe(200);

      const managerAudit = await app.inject({
        method: "GET",
        url: "/api/audit",
        headers: { cookie: managerCookies.cookie },
      });
      expect(managerAudit.statusCode).toBe(403);

      const managerDepartments = await app.inject({
        method: "GET",
        url: "/api/departments",
        headers: { cookie: managerCookies.cookie },
      });
      expect(managerDepartments.statusCode).toBe(200);
      const anyDepartment = managerDepartments.json().departments[0];

      // A department membership rather than a business role: the singleton
      // roles are shared across integration files and this test does not need
      // to compete for one.
      const createdByManager = await app.inject({
        method: "POST",
        url: "/api/users",
        headers: managerWriteHeaders,
        payload: {
          username: managedUsername,
          displayName: "由總經理建立",
          initialPassword,
          memberships: [{ departmentId: anyDepartment.id, kind: "STAFF" }],
        },
      });
      expect(createdByManager.statusCode).toBe(201);

      // Renaming yourself is fine; giving up your own account-manager role is
      // not, because nobody else could give it back except another manager.
      const renameSelf = await app.inject({
        method: "PATCH",
        url: `/api/users/${manager.id}`,
        headers: managerWriteHeaders,
        payload: { displayName: "整合測試總經理（更名）" },
      });
      expect(renameSelf.statusCode).toBe(200);

      const stripOwnRole = await app.inject({
        method: "PATCH",
        url: `/api/users/${manager.id}`,
        headers: managerWriteHeaders,
        payload: { roles: [] },
      });
      expect(stripOwnRole.statusCode).toBe(409);
      expect(stripOwnRole.json().message).toContain("帳號管理權限");

      const deactivateSelf = await app.inject({
        method: "PATCH",
        url: `/api/users/${manager.id}`,
        headers: managerWriteHeaders,
        payload: { active: false },
      });
      expect(deactivateSelf.statusCode).toBe(409);

      // Deactivation is the delete: the row survives, everything that grants
      // access does not.
      const deactivateManaged = await app.inject({
        method: "PATCH",
        url: `/api/users/${createdByManager.json().user.id}`,
        headers: managerWriteHeaders,
        payload: { active: false, roles: [], memberships: [] },
      });
      expect(deactivateManaged.statusCode).toBe(200);
      expect(deactivateManaged.json().user).toMatchObject({
        active: false,
        roles: [],
        memberships: [],
      });

      // 總經理 changes their own password, so the default one is flagged until
      // they do (the user, 2026-10-04).
      expect(manager.passwordWarning).toBe(true);
      expect(managerLogin.json().user.passwordWarning).toBe(true);
      const ownChange = await app.inject({
        method: "PATCH",
        url: "/api/auth/password",
        headers: managerWriteHeaders,
        payload: { currentPassword: initialPassword, newPassword: resetPassword },
      });
      expect(ownChange.statusCode).toBe(200);
      expect(ownChange.json().user.passwordWarning).toBe(false);
    } finally {
      await app.close();
    }
  });
});
