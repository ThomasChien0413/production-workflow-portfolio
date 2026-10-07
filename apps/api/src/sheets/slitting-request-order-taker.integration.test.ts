import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { and, eq, inArray, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  auditEvents,
  approvalRuns,
  createDatabase,
  departmentMemberships,
  departmentSubpageIdentityPermissions,
  departmentSubpageTemplates,
  departmentSubpages,
  departments,
  outboxJobs,
  productionSheets,
  roleAssignments,
  sheetTemplates,
  sheetTemplateVersions,
  sheetValues,
  users,
} from "@workflow/database";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const appOrigin = "http://localhost:3000";
const password = "order-taker-policy-test-password";

function sessionCookies(response: {
  headers: Record<string, string | string[] | number | undefined>;
}) {
  const raw = response.headers["set-cookie"];
  const lines = Array.isArray(raw) ? raw : [typeof raw === "string" ? raw : ""];
  const pairs = lines.flatMap((line) => {
    const pair = line.split(";", 1)[0];
    return pair ? [pair] : [];
  });
  const csrf = pairs
    .find((pair) => pair.startsWith("workflow_csrf="))
    ?.slice("workflow_csrf=".length);
  if (!csrf) throw new Error("CSRF cookie missing");
  return { cookie: pairs.join("; "), csrf };
}

describe.skipIf(!testDatabaseUrl)("分條申請單 訂單人員 policy", () => {
  it("uses subpage grants for creation, editing, and sending on across pinned versions", async () => {
    const connection = createDatabase(testDatabaseUrl!, 1);
    const suffix = randomUUID().slice(0, 8);
    const createdUserIds: string[] = [];
    const createdSheetIds: string[] = [];
    const submitMutationIds: string[] = [];
    let createdSubpageId: string | null = null;
    let shaoDunSubpageId: string | null = null;
    const app = await buildApp(
      loadConfig({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
        APP_ORIGIN: appOrigin,
      }),
    );

    try {
      const departmentRows = await connection.db
        .select({ id: departments.id, code: departments.code })
        .from(departments);
      const departmentByCode = new Map(
        departmentRows.map((department) => [department.code, department.id]),
      );
      const cutId = departmentByCode.get("CUT")!;
      const shaoDunId = departmentByCode.get("SHAO_DUN")!;
      const [testSubpage] = await connection.db.insert(departmentSubpages).values({ departmentId: cutId, name: `訂單測試-${suffix}`, position: 100 }).returning({ id: departmentSubpages.id });
      if (!testSubpage) throw new Error("Could not create isolated CUT subpage");
      createdSubpageId = testSubpage.id;
      const cutSubpageId = testSubpage.id;
      // The seed makes no subpage, so 燒頓 gets one of its own for this test.
      const [shaoDunSubpage] = await connection.db.insert(departmentSubpages).values({ departmentId: shaoDunId, name: `燒頓測試-${suffix}`, position: 100 }).returning({ id: departmentSubpages.id });
      if (!shaoDunSubpage) throw new Error("Could not create isolated 燒頓 subpage");
      shaoDunSubpageId = shaoDunSubpage.id;
      const [template] = await connection.db
        .select({
          id: sheetTemplates.id,
          currentVersionNumber: sheetTemplates.currentVersionNumber,
        })
        .from(sheetTemplates)
        .where(eq(sheetTemplates.slug, "slitting-request"))
        .limit(1);
      expect(template?.currentVersionNumber).toBe(3);
      await connection.db.insert(departmentSubpageTemplates).values({ subpageId: cutSubpageId, templateId: template!.id });

      async function createUser(
        label: string,
        departmentId: string,
        kind: "ORDER_TAKER" | "STAFF" | "MANAGER",
      ) {
        const [user] = await connection.db
          .insert(users)
          .values({
            username: `request-${label}-${suffix}`,
            displayName: `申請單測試 ${label}`,
            passwordHash: await argon2.hash(password, {
              type: argon2.argon2id,
            }),
          })
          .returning({ id: users.id, username: users.username });
        if (!user) throw new Error("Failed to create test user");
        createdUserIds.push(user.id);
        await connection.db.insert(departmentMemberships).values({
          userId: user.id,
          departmentId,
          kind,
        });
        const login = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin: appOrigin },
          payload: { username: user.username, password },
        });
        expect(login.statusCode).toBe(200);
        return { ...user, ...sessionCookies(login) };
      }

      async function ensureReviewer(
        role: "SALES" | "ASSOCIATE" | "GENERAL_MANAGER",
      ) {
        const [existing] = await connection.db
          .select({ userId: roleAssignments.userId })
          .from(roleAssignments)
          .innerJoin(users, eq(users.id, roleAssignments.userId))
          .where(
            and(
              eq(roleAssignments.role, role),
              eq(roleAssignments.active, true),
              eq(users.active, true),
            ),
          )
          .limit(1);
        if (existing) return existing.userId;

        const [reviewer] = await connection.db
          .insert(users)
          .values({
            username: `request-reviewer-${role.toLowerCase()}-${suffix}`,
            displayName: `申請單測試 ${role}`,
            passwordHash: await argon2.hash(password, {
              type: argon2.argon2id,
            }),
          })
          .returning({ id: users.id });
        if (!reviewer) throw new Error(`Failed to create ${role} reviewer`);
        createdUserIds.push(reviewer.id);
        await connection.db.insert(roleAssignments).values({
          userId: reviewer.id,
          role,
        });
        return reviewer.id;
      }

      await ensureReviewer("SALES");
      await ensureReviewer("ASSOCIATE");
      await ensureReviewer("GENERAL_MANAGER");
      // Review is retired (the user, 2026-09-30): 分條申請單 is sent straight
      // on to 分條, which needs an active 主管 to take it.
      const slittingId = departmentByCode.get("SLITTING")!;
      await createUser("slitting-manager", slittingId, "MANAGER");

      const creator = await createUser("creator", cutId, "ORDER_TAKER");
      const colleague = await createUser("colleague", cutId, "ORDER_TAKER");
      const staff = await createUser("staff", cutId, "STAFF");
      const excluded = await createUser("excluded", shaoDunId, "ORDER_TAKER");
      await connection.db.insert(departmentSubpageIdentityPermissions).values({
        subpageId: cutSubpageId, kind: "ORDER_TAKER", canView: true, canCreate: true, canEdit: true, canSubmit: true, updatedByUserId: creator.id,
      });

      const creatorTemplates = await app.inject({
        method: "GET",
        url: "/api/templates",
        headers: { cookie: creator.cookie },
      });
      expect(creatorTemplates.statusCode).toBe(200);
      expect(creatorTemplates.json().templates).toContainEqual(
        expect.objectContaining({ id: template!.id, version: 3 }),
      );

      const excludedTemplates = await app.inject({
        method: "GET",
        url: "/api/templates",
        headers: { cookie: excluded.cookie },
      });
      expect(excludedTemplates.statusCode).toBe(200);
      expect(excludedTemplates.json().templates).not.toContainEqual(
        expect.objectContaining({ id: template!.id }),
      );

      const createId = randomUUID();
      createdSheetIds.push(createId);
      const create = await app.inject({
        method: "POST",
        url: "/api/sheets",
        headers: {
          origin: appOrigin,
          cookie: creator.cookie,
          "x-csrf-token": creator.csrf,
        },
        payload: {
          clientMutationId: createId,
          templateId: template!.id,
          originDepartmentId: cutId,
          subpageId: cutSubpageId,
        },
      });
      expect(create.statusCode).toBe(201);

      const [pinned] = await connection.db
        .select({ version: sheetTemplateVersions.version })
        .from(productionSheets)
        .innerJoin(
          sheetTemplateVersions,
          eq(sheetTemplateVersions.id, productionSheets.templateVersionId),
        )
        .where(eq(productionSheets.id, createId))
        .limit(1);
      expect(pinned?.version).toBe(3);

      const colleaguePatch = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${createId}/values`,
        headers: {
          origin: appOrigin,
          cookie: colleague.cookie,
          "x-csrf-token": colleague.csrf,
        },
        payload: {
          baseVersion: 0,
          clientMutationId: randomUUID(),
          changes: [
            { fieldKey: "requestDate", value: "2026-08-21" },
            { fieldKey: "items.0.specification", value: "1.2 x 100" },
            { fieldKey: "items.0.material", value: "SUS304" },
            { fieldKey: "items.0.category", value: "測試" },
            { fieldKey: "items.0.requiredQuantity", value: "10" },
            { fieldKey: "items.0.notes", value: "訂單人員送審" },
          ],
        },
      });
      expect(colleaguePatch.statusCode).toBe(200);

      const staffPatch = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${createId}/values`,
        headers: {
          origin: appOrigin,
          cookie: staff.cookie,
          "x-csrf-token": staff.csrf,
        },
        payload: {
          baseVersion: 1,
          clientMutationId: randomUUID(),
          changes: [{ fieldKey: "requestDate", value: "2026-08-22" }],
        },
      });
      expect(staffPatch.statusCode).toBe(403);

      const submitMutationId = randomUUID();
      submitMutationIds.push(submitMutationId);
      const orderTakerSubmit = await app.inject({
        method: "POST",
        url: `/api/sheets/${createId}/submit`,
        headers: {
          origin: appOrigin,
          cookie: creator.cookie,
          "x-csrf-token": creator.csrf,
        },
        payload: { clientMutationId: submitMutationId },
      });
      expect(orderTakerSubmit.statusCode, orderTakerSubmit.body).toBe(200);
      // Sent for review first (the user, 2026-10-01): one approval run opens
      // at 業務's stage, and the sheet stays in CUT until it is approved.
      expect(orderTakerSubmit.json().result).toMatchObject({
        action: "SUBMIT",
        sheetId: createId,
        state: "PENDING_SALES",
        routedTo: null,
      });
      const approvalRunsForSheet = await connection.db
        .select({ status: approvalRuns.status })
        .from(approvalRuns)
        .where(eq(approvalRuns.sheetId, createId));
      expect(approvalRunsForSheet).toEqual([{ status: "PENDING" }]);

      const excludedCreateId = randomUUID();
      const excludedCreate = await app.inject({
        method: "POST",
        url: "/api/sheets",
        headers: {
          origin: appOrigin,
          cookie: excluded.cookie,
          "x-csrf-token": excluded.csrf,
        },
        payload: {
          clientMutationId: excludedCreateId,
          templateId: template!.id,
          originDepartmentId: shaoDunId,
          subpageId: shaoDunSubpageId,
        },
      });
      expect(excludedCreate.statusCode).toBe(403);

      const [versionTwo] = await connection.db
        .select({ id: sheetTemplateVersions.id })
        .from(sheetTemplateVersions)
        .where(
          and(
            eq(sheetTemplateVersions.templateId, template!.id),
            eq(sheetTemplateVersions.version, 2),
          ),
        )
        .limit(1);
      if (!versionTwo) throw new Error("分條申請單 version 2 fixture missing");
      const legacySheetId = randomUUID();
      createdSheetIds.push(legacySheetId);
      await connection.db.insert(productionSheets).values({
        id: legacySheetId,
        sheetNumber: legacySheetId,
        templateVersionId: versionTwo.id,
        originDepartmentId: cutId,
        currentDepartmentId: cutId,
        subpageId: cutSubpageId,
        createdByUserId: creator.id,
        state: "DRAFT",
      });
      await connection.db.insert(sheetValues).values({
        sheetId: legacySheetId,
        values: {
          requestDate: "2026-08-21",
          items: Array.from({ length: 8 }, (_, index) => ({
            specification: index === 0 ? "1.2 x 100" : "",
            material: index === 0 ? "SUS304" : "",
            category: index === 0 ? "測試" : "",
            requiredQuantity: index === 0 ? "10" : "",
            notes: index === 0 ? "舊版送審" : "",
          })),
        },
      });
      const legacySubmitMutationId = randomUUID();
      submitMutationIds.push(legacySubmitMutationId);
      const legacySubmit = await app.inject({
        method: "POST",
        url: `/api/sheets/${legacySheetId}/submit`,
        headers: {
          origin: appOrigin,
          cookie: creator.cookie,
          "x-csrf-token": creator.csrf,
        },
        payload: { clientMutationId: legacySubmitMutationId },
      });
      // A draft from before is sent for review the same way, and stays in CUT
      // while it is reviewed.
      expect(legacySubmit.statusCode).toBe(200);
      expect(legacySubmit.json().result).toMatchObject({ state: "PENDING_SALES", routedTo: null });
      const legacyDetail = await app.inject({
        method: "GET",
        url: `/api/sheets/${legacySheetId}`,
        headers: { cookie: creator.cookie },
      });
      expect(legacyDetail.statusCode).toBe(200);
      expect(legacyDetail.json().sheet ?? legacyDetail.json()).toMatchObject({
        review: { required: true, outstanding: true, stageRole: "SALES" },
      });

      await connection.db
        .update(departmentMemberships)
        .set({ active: false })
        .where(eq(departmentMemberships.userId, colleague.id));
      const revokedDetail = await app.inject({
        method: "GET",
        url: `/api/sheets/${createId}`,
        headers: { cookie: colleague.cookie },
      });
      expect(revokedDetail.statusCode).toBe(403);
    } finally {
      await app.close();
      if (createdUserIds.length > 0) {
        await connection.db
          .delete(auditEvents)
          .where(inArray(auditEvents.actorUserId, createdUserIds));
      }
      if (createdSheetIds.length > 0) {
        await connection.db
          .delete(productionSheets)
          .where(inArray(productionSheets.id, createdSheetIds));
      }
      for (const mutationId of submitMutationIds) {
        await connection.db
          .delete(outboxJobs)
          .where(like(outboxJobs.deduplicationKey, `${mutationId}:%`));
      }
      if (createdUserIds.length > 0) {
        await connection.db.delete(users).where(inArray(users.id, createdUserIds));
      }
      if (createdSubpageId) await connection.db.delete(departmentSubpages).where(eq(departmentSubpages.id, createdSubpageId));
      if (shaoDunSubpageId) await connection.db.delete(departmentSubpages).where(eq(departmentSubpages.id, shaoDunSubpageId));
      await connection.close();
    }
  }, 20_000);
});
