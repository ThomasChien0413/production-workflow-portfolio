import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditEvents, createDatabase, departmentMemberships, sessions, users } from "@workflow/database";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = "http://localhost:3000";
const password = "synthetic-real-name-password";

describe.skipIf(!databaseUrl)("real-name accounts with PostgreSQL", () => {
  it("creates and authenticates distinct same-name employees without changing existing accounts", async () => {
    if (!databaseUrl) return;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
      throw new Error("Real-name fixtures require an explicitly configured loopback TEST_DATABASE_URL");
    }
    const connection = createDatabase(databaseUrl, 1);
    const app = await buildApp(loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "test", APP_ORIGIN: origin }));
    const createdIds: string[] = [];
    const realName = `姓名測試-${randomUUID().slice(0, 8)}`;
    const alias = `${realName}-José`;
    const cookie = (response: { headers: Record<string, unknown> }) => {
      const value = response.headers["set-cookie"];
      const lines = Array.isArray(value) ? value : [value];
      return lines.filter((line): line is string => typeof line === "string").map((line) => line.split(";")[0]).join("; ");
    };
    try {
      const admin = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin }, payload: { username: "admin", password: "DemoOnly2026!" } });
      expect(admin.statusCode).toBe(200);
      const adminCookie = cookie(admin);
      const csrf = adminCookie.split("; ").find((pair) => pair.startsWith("workflow_csrf="))!.slice("workflow_csrf=".length);
      const headers = { origin, cookie: adminCookie, "x-csrf-token": csrf };
      const departments = await app.inject({ method: "GET", url: "/api/departments", headers });
      const departmentId = departments.json().departments[0].id;
      const payload = { displayName: realName, initialPassword: password, memberships: [{ departmentId, kind: "STAFF" }] };
      const withoutCsrf = await app.inject({ method: "POST", url: "/api/users", headers: { origin, cookie: adminCookie }, payload });
      expect(withoutCsrf.statusCode).toBe(403);
      const first = await app.inject({ method: "POST", url: "/api/users", headers, payload });
      expect(first.statusCode).toBe(201);
      createdIds.push(first.json().user.id);
      expect(first.json().user).toMatchObject({ username: realName, displayName: realName });
      const duplicate = await app.inject({ method: "POST", url: "/api/users", headers, payload });
      expect(duplicate.statusCode).toBe(409);
      const second = await app.inject({ method: "POST", url: "/api/users", headers, payload: { ...payload, username: alias } });
      expect(second.statusCode).toBe(201);
      createdIds.push(second.json().user.id);
      expect(createdIds[0]).not.toBe(createdIds[1]);
      const duplicateCase = await app.inject({ method: "POST", url: "/api/users", headers, payload: { ...payload, username: alias.normalize("NFD").toUpperCase() } });
      expect(duplicateCase.statusCode).toBe(409);

      for (const [index, username] of [realName, alias.normalize("NFD").toUpperCase()].entries()) {
        const login = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin }, payload: { username: ` ${username} `, password } });
        expect(login.statusCode).toBe(200);
        expect(login.json().user).toMatchObject({ id: createdIds[index], displayName: realName, roles: [] });
        const employeeCookie = cookie(login);
        const employeeCsrf = employeeCookie.split("; ").find((pair) => pair.startsWith("workflow_csrf="))!.slice("workflow_csrf=".length);
        const denied = await app.inject({ method: "POST", url: "/api/users", headers: { origin, cookie: employeeCookie, "x-csrf-token": employeeCsrf }, payload: { ...payload, username: `${realName}-denied` } });
        expect(denied.statusCode).toBe(403);
        const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: employeeCookie } });
        expect(session.json().user.id).toBe(createdIds[index]);
      }
      const wrongPassword = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin }, payload: { username: realName, password: "incorrect-password" } });
      expect(wrongPassword.statusCode).toBe(401);
      const changedName = `${realName}-改名`;
      const updated = await app.inject({ method: "PATCH", url: `/api/users/${createdIds[0]}`, headers, payload: { displayName: changedName } });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().user).toMatchObject({ id: createdIds[0], username: realName, displayName: changedName });
      const noFallback = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin }, payload: { username: changedName, password } });
      expect(noFallback.statusCode).toBe(401);
      const originalLogin = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin }, payload: { username: realName, password } });
      expect(originalLogin.statusCode).toBe(200);
      expect(originalLogin.json().user.id).toBe(createdIds[0]);
      const audits = await connection.db.select({ id: auditEvents.id }).from(auditEvents).where(and(eq(auditEvents.action, "ADMIN_USER_CREATED"), inArray(auditEvents.targetId, createdIds)));
      expect(audits).toHaveLength(2);
      const adminSession = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: adminCookie } });
      expect(adminSession.statusCode).toBe(200);
      expect(adminSession.json().user.username).toBe("admin");
    } finally {
      // Only this test's UUIDs are touched; no seed, existing user or production target.
      if (createdIds.length) await connection.db.transaction(async (tx) => {
        await tx.update(sessions).set({ revokedAt: new Date() }).where(and(inArray(sessions.userId, createdIds), isNull(sessions.revokedAt)));
        await tx.update(departmentMemberships).set({ active: false }).where(inArray(departmentMemberships.userId, createdIds));
        await tx.update(users).set({ active: false }).where(inArray(users.id, createdIds));
      });
      await app.close();
      await connection.close();
    }
  });
});
