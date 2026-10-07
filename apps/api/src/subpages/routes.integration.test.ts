import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  auditEvents,
  createDatabase,
  departmentMemberships,
  departmentSubpageIdentityPermissions,
  departmentSubpagePermissions,
  departments,
  departmentSubpageMutations,
  departmentSubpages,
  productionSheets,
  sheetSubpageHistory,
  users,
} from "@workflow/database";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const appOrigin = "http://localhost:3000";

function cookies(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const raw = response.headers["set-cookie"];
  const lines = Array.isArray(raw) ? raw : [typeof raw === "string" ? raw : ""];
  const pairs = lines.flatMap((line) => {
    const pair = line.split(";", 1)[0];
    return pair ? [pair] : [];
  });
  const csrf = pairs.find((pair) => pair.startsWith("workflow_csrf="))?.slice("workflow_csrf=".length);
  if (!csrf) throw new Error("CSRF cookie missing");
  return { cookie: pairs.join("; "), csrf };
}

describe.skipIf(!testDatabaseUrl)("department subpage routes", () => {
  it("enforces management, idempotency, permission dependencies, and active membership", async () => {
    const connection = createDatabase(testDatabaseUrl!, 1);
    const suffix = randomUUID().slice(0, 8);
    const password = `Subpage-${suffix}-Password!`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const userIds: string[] = [];
    let createdSubpageId: string | null = null;
    let otherSubpageId: string | null = null;
    let sheetId: string | null = null;
    const app = await buildApp(loadConfig({ DATABASE_URL: testDatabaseUrl, NODE_ENV: "test", APP_ORIGIN: appOrigin }));

    try {
      const departmentRows = await connection.db.select({ id: departments.id, code: departments.code }).from(departments);
      const cutId = departmentRows.find((row) => row.code === "CUT")!.id;
      const slittingId = departmentRows.find((row) => row.code === "SLITTING")!.id;

      async function identity(label: string, departmentId: string, kinds: ("MANAGER" | "ORDER_TAKER" | "STAFF")[]) {
        const [user] = await connection.db.insert(users).values({
          username: `subpage-${label}-${suffix}`,
          displayName: `子分頁測試 ${label}`,
          passwordHash,
        }).returning({ id: users.id, username: users.username });
        if (!user) throw new Error("Failed to create identity");
        userIds.push(user.id);
        await connection.db.insert(departmentMemberships).values(kinds.map((kind) => ({ userId: user.id, departmentId, kind })));
        const login = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: appOrigin }, payload: { username: user.username, password } });
        expect(login.statusCode).toBe(200);
        return { ...user, ...cookies(login) };
      }

      const manager = await identity("manager", cutId, ["MANAGER"]);
      const member = await identity("member", cutId, ["STAFF", "ORDER_TAKER"]);
      const unrelatedManager = await identity("other-manager", slittingId, ["MANAGER"]);
      const adminLogin = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: appOrigin }, payload: { username: "admin", password: "DemoOnly2026!" } });
      expect(adminLogin.statusCode).toBe(200);
      const admin = cookies(adminLogin);
      const createMutationId = randomUUID();
      const createPayload = { clientMutationId: createMutationId, name: `大分條 ${suffix}` };

      const denied = await app.inject({ method: "POST", url: `/api/departments/${cutId}/subpages`, headers: { origin: appOrigin, cookie: unrelatedManager.cookie, "x-csrf-token": unrelatedManager.csrf }, payload: createPayload });
      expect(denied.statusCode).toBe(403);

      const created = await app.inject({ method: "POST", url: `/api/departments/${cutId}/subpages`, headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf }, payload: createPayload });
      expect(created.statusCode).toBe(201);
      createdSubpageId = created.json().result.subpageId as string;
      const replay = await app.inject({ method: "POST", url: `/api/departments/${cutId}/subpages`, headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf }, payload: createPayload });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().result).toMatchObject({ subpageId: createdSubpageId, replayed: true });

      const invalidDependency = await app.inject({ method: "PUT", url: `/api/departments/${cutId}/subpages/${createdSubpageId}/identities`, headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf }, payload: { clientMutationId: randomUUID(), revision: 1, permissions: [{ kind: "STAFF", canView: false, canCreate: false, canEdit: true, canSubmit: false }, { kind: "ORDER_TAKER", canView: false, canCreate: false, canEdit: false, canSubmit: false }] } });
      expect(invalidDependency.statusCode).toBe(400);

      const oldIndividualRoute = await app.inject({ method: "PUT", url: `/api/departments/${cutId}/subpages/${createdSubpageId}/permissions`, headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf }, payload: { clientMutationId: randomUUID(), revision: 1, permissions: [{ userId: member.id, canView: true, canCreate: true, canEdit: true, canSubmit: true }] } });
      expect(oldIndividualRoute.statusCode).toBe(404);
      await connection.db.insert(departmentSubpagePermissions).values({ subpageId: createdSubpageId, userId: member.id, canView: true, canCreate: true, canEdit: true, canSubmit: true, updatedByUserId: manager.id });
      const historicalGrantOnly = await app.inject({ method: "GET", url: `/api/departments/${cutId}/subpages`, headers: { cookie: member.cookie } });
      expect(historicalGrantOnly.json().subpages).not.toContainEqual(expect.objectContaining({ id: createdSubpageId }));

      const permissions = await app.inject({ method: "PUT", url: `/api/departments/${cutId}/subpages/${createdSubpageId}/identities`, headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf }, payload: { clientMutationId: randomUUID(), revision: 1, permissions: [{ kind: "STAFF", canView: true, canCreate: false, canEdit: true, canSubmit: false }, { kind: "ORDER_TAKER", canView: true, canCreate: true, canEdit: false, canSubmit: true }] } });
      expect(permissions.statusCode).toBe(200);

      const managerList = await app.inject({ method: "GET", url: `/api/departments/${cutId}/subpages`, headers: { cookie: manager.cookie } });
      const eligibleTemplateId = (managerList.json().eligibleTemplates as { id: string; displayName: string }[]).find((entry) => entry.displayName === "分條申請單")?.id;
      expect(eligibleTemplateId).toBeDefined();
      const initiallyEmpty = await app.inject({ method: "GET", url: `/api/departments/${cutId}/subpages/${createdSubpageId}/creation-options`, headers: { cookie: member.cookie } });
      expect(initiallyEmpty.json().templates).toEqual([]);
      const unselectedCreate = await app.inject({ method: "POST", url: "/api/sheets", headers: { origin: appOrigin, cookie: member.cookie, "x-csrf-token": member.csrf }, payload: { clientMutationId: randomUUID(), templateId: eligibleTemplateId, originDepartmentId: cutId, subpageId: createdSubpageId } });
      expect(unselectedCreate.statusCode).toBe(403);
      const templateMutationId = randomUUID();
      const selected = await app.inject({ method: "PUT", url: `/api/departments/${cutId}/subpages/${createdSubpageId}/templates`, headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf }, payload: { clientMutationId: templateMutationId, revision: 2, templateIds: [eligibleTemplateId] } });
      expect(selected.statusCode).toBe(200);
      const selectedReplay = await app.inject({ method: "PUT", url: `/api/departments/${cutId}/subpages/${createdSubpageId}/templates`, headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf }, payload: { clientMutationId: templateMutationId, revision: 2, templateIds: [eligibleTemplateId] } });
      expect(selectedReplay.json().result.replayed).toBe(true);
      const staleSelection = await app.inject({ method: "PUT", url: `/api/departments/${cutId}/subpages/${createdSubpageId}/templates`, headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf }, payload: { clientMutationId: randomUUID(), revision: 2, templateIds: [] } });
      expect(staleSelection.statusCode).toBe(409);
      const creationOptions = await app.inject({ method: "GET", url: `/api/departments/${cutId}/subpages/${createdSubpageId}/creation-options`, headers: { cookie: member.cookie } });
      expect(creationOptions.json().templates).toContainEqual(expect.objectContaining({ id: eligibleTemplateId }));
      const createSheetMutationId = randomUUID();
      const createdSheet = await app.inject({ method: "POST", url: "/api/sheets", headers: { origin: appOrigin, cookie: member.cookie, "x-csrf-token": member.csrf }, payload: { clientMutationId: createSheetMutationId, templateId: eligibleTemplateId, originDepartmentId: cutId, subpageId: createdSubpageId } });
      expect(createdSheet.statusCode).toBe(201);
      sheetId = createdSheet.json().sheet.id as string;
      expect(sheetId).toBe(createSheetMutationId);
      const replayedSheet = await app.inject({ method: "POST", url: "/api/sheets", headers: { origin: appOrigin, cookie: member.cookie, "x-csrf-token": member.csrf }, payload: { clientMutationId: createSheetMutationId, templateId: eligibleTemplateId, originDepartmentId: cutId, subpageId: createdSubpageId } });
      expect(replayedSheet.json().sheet.replayed).toBe(true);

      const memberList = await app.inject({ method: "GET", url: `/api/departments/${cutId}/subpages`, headers: { cookie: member.cookie } });
      expect(memberList.statusCode).toBe(200);
      expect(memberList.json().subpages).toContainEqual(expect.objectContaining({ id: createdSubpageId, capabilities: { canView: true, canCreate: true, canEdit: true, canSubmit: true } }));

      const removeCutMembership = await app.inject({
        method: "PATCH",
        url: `/api/users/${member.id}`,
        headers: { origin: appOrigin, cookie: admin.cookie, "x-csrf-token": admin.csrf },
        payload: { memberships: [{ departmentId: slittingId, kind: "STAFF" }] },
      });
      expect(removeCutMembership.statusCode).toBe(200);
      const identityGrant = await connection.db.select({ kind: departmentSubpageIdentityPermissions.kind })
        .from(departmentSubpageIdentityPermissions)
        .where(eq(departmentSubpageIdentityPermissions.subpageId, createdSubpageId));
      expect(identityGrant).toContainEqual({ kind: "STAFF" });
      const revokedList = await app.inject({ method: "GET", url: `/api/departments/${cutId}/subpages`, headers: { cookie: member.cookie } });
      expect(revokedList.statusCode).toBe(401);
      const removedMembershipLogin = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: appOrigin }, payload: { username: member.username, password } });
      const removedMembershipDetail = await app.inject({ method: "GET", url: `/api/sheets/${sheetId}`, headers: { cookie: cookies(removedMembershipLogin).cookie } });
      expect(removedMembershipDetail.statusCode).toBe(403);
      const rejoinCut = await app.inject({
        method: "PATCH",
        url: `/api/users/${member.id}`,
        headers: { origin: appOrigin, cookie: admin.cookie, "x-csrf-token": admin.csrf },
        payload: { memberships: [{ departmentId: cutId, kind: "STAFF" }] },
      });
      expect(rejoinCut.statusCode).toBe(200);
      const relogin = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: appOrigin }, payload: { username: member.username, password } });
      const rejoined = await app.inject({ method: "GET", url: `/api/departments/${cutId}/subpages`, headers: { cookie: cookies(relogin).cookie } });
      expect(rejoined.json().subpages).toContainEqual(expect.objectContaining({ id: createdSubpageId, capabilities: expect.objectContaining({ canView: true }) }));
      const rejoinedDetail = await app.inject({ method: "GET", url: `/api/sheets/${sheetId}`, headers: { cookie: cookies(relogin).cookie } });
      expect(rejoinedDetail.statusCode).toBe(200);

      // A second CUT subpage to move the sheet into; the seed makes none.
      const [defaultSubpage] = await connection.db.insert(departmentSubpages).values({ departmentId: cutId, name: `移入測試-${randomUUID().slice(0, 8)}`, position: 100 }).returning({ id: departmentSubpages.id });
      if (!defaultSubpage) throw new Error("Could not create a second CUT subpage");
      otherSubpageId = defaultSubpage.id;

      const occupiedDelete = await app.inject({ method: "DELETE", url: `/api/departments/${cutId}/subpages/${createdSubpageId}`, headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf }, payload: { clientMutationId: randomUUID(), revision: 3 } });
      expect(occupiedDelete.statusCode).toBe(409);
      await connection.db.update(productionSheets).set({ subpageId: defaultSubpage.id }).where(eq(productionSheets.id, sheetId));
      const deleted = await app.inject({ method: "DELETE", url: `/api/departments/${cutId}/subpages/${createdSubpageId}`, headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf }, payload: { clientMutationId: randomUUID(), revision: 3 } });
      expect(deleted.statusCode).toBe(200);
      const [snapshot] = await connection.db.select({ subpageId: sheetSubpageHistory.toSubpageId, name: sheetSubpageHistory.toSubpageName }).from(sheetSubpageHistory).where(eq(sheetSubpageHistory.sheetId, sheetId)).limit(1);
      expect(snapshot).toEqual({ subpageId: null, name: createPayload.name });
    } finally {
      await app.close();
      if (sheetId) await connection.db.delete(productionSheets).where(eq(productionSheets.id, sheetId));
      if (createdSubpageId) {
        await connection.db.delete(departmentSubpageMutations).where(eq(departmentSubpageMutations.subpageId, createdSubpageId));
        await connection.db.delete(departmentSubpages).where(eq(departmentSubpages.id, createdSubpageId));
      }
      if (otherSubpageId) await connection.db.delete(departmentSubpages).where(eq(departmentSubpages.id, otherSubpageId));
      if (userIds.length > 0) {
        await connection.db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await connection.db.delete(users).where(inArray(users.id, userIds));
      }
      await connection.close();
    }
  });
});
