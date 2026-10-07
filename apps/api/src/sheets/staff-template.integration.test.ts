import { randomUUID } from "node:crypto";
import type fastifyWebsocket from "@fastify/websocket";
import argon2 from "argon2";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sheetTemplateDefinitionSchema } from "@workflow/contracts";
import {
  auditEvents,
  createDatabase,
  departmentMemberships,
  departmentSubpageIdentityPermissions,
  departmentSubpageTemplates,
  departmentSubpages,
  departments,
  productionSheets,
  sheetAssignments,
  sheetRouteParticipants,
  sheetTemplates,
  sheetTemplateVersions,
  users,
} from "@workflow/database";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const appOrigin = "http://localhost:3000";
const password = "staff-template-policy-test-password";

function cookies(response: {
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

function nextSocketEvent(
  socket: fastifyWebsocket.WebSocket,
  type: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", listener);
      reject(new Error(`Timed out waiting for WebSocket event ${type}`));
    }, 3_000);
    const listener = (data: { toString(): string }) => {
      const event = JSON.parse(data.toString()) as Record<string, unknown>;
      if (event.type !== type) return;
      clearTimeout(timeout);
      socket.off("message", listener);
      resolve(event);
    };
    socket.on("message", listener);
  });
}

describe.skipIf(!testDatabaseUrl)("subpage-enabled sheet editing", () => {
  it("enforces explicit create, view, and edit grants across HTTP and WebSocket access", async () => {
    const connection = createDatabase(testDatabaseUrl!, 1);
    const suffix = randomUUID().slice(0, 8);
    const createdUserIds: string[] = [];
    let templateId: string | null = null;
    let createdSubpageId: string | null = null;
    let templateVersionId: string | null = null;
    let sheetId: string | null = null;
    const sockets: fastifyWebsocket.WebSocket[] = [];
    const app = await buildApp(
      loadConfig({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
        APP_ORIGIN: appOrigin,
      }),
    );

    try {
      const [slitting] = await connection.db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.code, "SLITTING"))
        .limit(1);
      if (!slitting) throw new Error("SLITTING department seed is missing");
      const slittingId = slitting.id;
      const [testSubpage] = await connection.db.insert(departmentSubpages).values({ departmentId: slittingId, name: `員工測試-${suffix}`, position: 100 }).returning({ id: departmentSubpages.id });
      if (!testSubpage) throw new Error("Could not create isolated SLITTING subpage");
      createdSubpageId = testSubpage.id;
      const slittingSubpageId = testSubpage.id;

      const testDefinition = sheetTemplateDefinitionSchema.parse({
        schemaVersion: 1,
        status: "APPROVED",
        templateKey: `automated-staff-policy-${suffix}`,
        displayName: "自動化員工權限測試範本",
        documentLabel: "測試專用文件編號",
        documentCode: `TEST-${suffix}`,
        ownerDepartmentCode: "SLITTING",
        allowedCreatorDepartmentCodes: ["SLITTING"],
        allowedCreatorKinds: ["MANAGER", "STAFF"],
        staffEditScope: "OWN_OR_ASSIGNED",
        workflow: {
          requiresReview: false,
          approvalRoles: [],
          destinationDepartmentCode: "SLITTING",
          avoidSelfHandoff: true,
        },
        sections: [
          {
            type: "FIELDS",
            key: "automatedTestOnly",
            fields: [
              {
                key: "testValue",
                label: "自動化測試專用欄位",
                type: "TEXT",
                required: false,
                reviewed: false,
                editableBy: ["ORIGIN_MANAGER", "ORIGIN_STAFF"],
                editableStates: ["DRAFT", "ASSIGNED", "IN_PROGRESS"],
                validationStatus: "CONFIRMED",
              },
            ],
          },
        ],
        source: {
          receivedDate: "2026-08-10",
          imageSha256: "A".repeat(64),
          imageWidth: 1,
          imageHeight: 1,
        },
        openQuestions: [],
      });
      const [template] = await connection.db
        .insert(sheetTemplates)
        .values({
          departmentId: slittingId,
          slug: testDefinition.templateKey,
          displayName: testDefinition.displayName,
          description: "TEST ONLY - staff authorization integration fixture",
          active: true,
          currentVersionNumber: 1,
        })
        .returning({ id: sheetTemplates.id });
      if (!template) throw new Error("Failed to create test template");
      templateId = template.id;
      const [version] = await connection.db
        .insert(sheetTemplateVersions)
        .values({
          templateId,
          version: 1,
          definition: testDefinition,
          requiresReview: false,
          sourceReference: "TEST ONLY - no production form",
          changeNotes: "Automated authorization fixture",
          publishedAt: new Date(),
        })
        .returning({ id: sheetTemplateVersions.id });
      if (!version) throw new Error("Failed to create test template version");
      templateVersionId = version.id;
      await connection.db.insert(departmentSubpageTemplates).values({ subpageId: slittingSubpageId, templateId });

      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      async function createIdentity(label: string, kind: "MANAGER" | "STAFF") {
        const [user] = await connection.db
          .insert(users)
          .values({
            username: `staff-policy-${label}-${suffix}`,
            displayName: `員工範本測試 ${label}`,
            passwordHash,
          })
          .returning({ id: users.id, username: users.username });
        if (!user) throw new Error("Failed to create test user");
        createdUserIds.push(user.id);
        await connection.db.insert(departmentMemberships).values({
          userId: user.id,
          departmentId: slittingId,
          kind,
        });
        const login = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin: appOrigin },
          payload: { username: user.username, password },
        });
        expect(login.statusCode).toBe(200);
        return { ...user, ...cookies(login) };
      }

      const manager = await createIdentity("manager", "MANAGER");
      const creator = await createIdentity("creator", "STAFF");
      const assignee = await createIdentity("assignee", "STAFF");
      const unrelated = await createIdentity("unrelated", "STAFF");
      await connection.db.insert(departmentSubpageIdentityPermissions).values({
        subpageId: slittingSubpageId, kind: "STAFF", canView: true, canCreate: true, canEdit: true, canSubmit: true, updatedByUserId: manager.id,
      });

      const [managerOnlyTemplate] = await connection.db
        .select({ id: sheetTemplates.id })
        .from(sheetTemplates)
        .where(eq(sheetTemplates.slug, "slitting-request"))
        .limit(1);
      if (!managerOnlyTemplate) throw new Error("Manager-only template seed is missing");
      const available = await app.inject({
        method: "GET",
        url: `/api/departments/${slittingId}/subpages/${slittingSubpageId}/creation-options`,
        headers: { cookie: creator.cookie },
      });
      expect(available.statusCode).toBe(200);
      expect(available.json().templates).toContainEqual(
        expect.objectContaining({ id: templateId }),
      );
      expect(available.json().templates).not.toContainEqual(
        expect.objectContaining({ id: managerOnlyTemplate.id }),
      );

      const createMutationId = randomUUID();
      const create = await app.inject({
        method: "POST",
        url: "/api/sheets",
        headers: {
          origin: appOrigin,
          cookie: creator.cookie,
          "x-csrf-token": creator.csrf,
        },
        payload: {
          clientMutationId: createMutationId,
          templateId,
          originDepartmentId: slittingId,
          subpageId: slittingSubpageId,
        },
      });
      expect(create.statusCode).toBe(201);
      const activeSheetId = create.json().sheet.id as string;
      sheetId = activeSheetId;

      const participantRows = await connection.db
        .select()
        .from(sheetRouteParticipants)
        .where(eq(sheetRouteParticipants.sheetId, activeSheetId));
      expect(participantRows).toEqual([]);

      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/sheets/${activeSheetId}`,
            headers: { cookie: creator.cookie },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/sheets/${activeSheetId}`,
            headers: { cookie: unrelated.cookie },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/sheets/${activeSheetId}`,
            headers: { cookie: manager.cookie },
          })
        ).statusCode,
      ).toBe(200);

      async function connectSocket(identity: { cookie: string }) {
        let ready!: Promise<Record<string, unknown>>;
        const socket = await app.injectWS(
          "/api/ws",
          { headers: { cookie: identity.cookie, origin: appOrigin } },
          {
            onInit(initializedSocket) {
              ready = nextSocketEvent(initializedSocket, "connection.ready");
            },
          },
        );
        sockets.push(socket);
        await ready;
        return socket;
      }
      const creatorSocket = await connectSocket(creator);
      const creatorSnapshot = nextSocketEvent(creatorSocket, "sheet.snapshot");
      creatorSocket.send(JSON.stringify({ type: "sheet.join", sheetId: activeSheetId }));
      await expect(creatorSnapshot).resolves.toMatchObject({ sheetId: activeSheetId });
      const unrelatedSocket = await connectSocket(unrelated);
      const unrelatedSnapshot = nextSocketEvent(unrelatedSocket, "sheet.snapshot");
      unrelatedSocket.send(JSON.stringify({ type: "sheet.join", sheetId: activeSheetId }));
      await expect(unrelatedSnapshot).resolves.toMatchObject({ sheetId: activeSheetId });

      const creatorPatch = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${activeSheetId}/values`,
        headers: {
          origin: appOrigin,
          cookie: creator.cookie,
          "x-csrf-token": creator.csrf,
        },
        payload: {
          baseVersion: 0,
          clientMutationId: randomUUID(),
          changes: [{ fieldKey: "testValue", value: "creator update" }],
        },
      });
      expect(creatorPatch.statusCode).toBe(200);
      expect(creatorPatch.json().result.version).toBe(1);

      const unrelatedPatch = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${activeSheetId}/values`,
        headers: {
          origin: appOrigin,
          cookie: unrelated.cookie,
          "x-csrf-token": unrelated.csrf,
        },
        payload: {
          baseVersion: 1,
          clientMutationId: randomUUID(),
          changes: [{ fieldKey: "testValue", value: "same-identity update" }],
        },
      });
      expect(unrelatedPatch.statusCode).toBe(200);
      expect(unrelatedPatch.json().result.version).toBe(2);

      await connection.db
        .update(productionSheets)
        .set({
          state: "ASSIGNED",
          assignedUserId: assignee.id,
          dueAt: new Date("2026-09-01T00:00:00.000Z"),
        })
        .where(eq(productionSheets.id, activeSheetId));
      const assignedPatch = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${activeSheetId}/values`,
        headers: {
          origin: appOrigin,
          cookie: assignee.cookie,
          "x-csrf-token": assignee.csrf,
        },
        payload: {
          baseVersion: 2,
          clientMutationId: randomUUID(),
          changes: [{ fieldKey: "testValue", value: "assignee update" }],
        },
      });
      expect(assignedPatch.statusCode).toBe(200);
      expect(assignedPatch.json().result.version).toBe(3);

      const now = new Date();
      await connection.db.insert(sheetAssignments).values({
        sheetId: activeSheetId,
        departmentId: slittingId,
        assignedUserId: assignee.id,
        assignedByUserId: manager.id,
        dueAt: new Date("2026-09-01T00:00:00.000Z"),
        endedAt: now,
        createdAt: new Date(now.getTime() - 1_000),
      });
      await connection.db
        .update(productionSheets)
        .set({ assignedUserId: creator.id })
        .where(eq(productionSheets.id, activeSheetId));

      const historicalRead = await app.inject({
        method: "GET",
        url: `/api/sheets/${activeSheetId}`,
        headers: { cookie: assignee.cookie },
      });
      expect(historicalRead.statusCode).toBe(200);
      const stillAuthorizedPatch = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${activeSheetId}/values`,
        headers: {
          origin: appOrigin,
          cookie: assignee.cookie,
          "x-csrf-token": assignee.csrf,
        },
        payload: {
          baseVersion: 3,
          clientMutationId: randomUUID(),
          changes: [{ fieldKey: "testValue", value: "subpage-authorized update" }],
        },
      });
      expect(stillAuthorizedPatch.statusCode).toBe(200);
      expect(stillAuthorizedPatch.json().result.version).toBe(4);

      const staffEditEvents = await connection.db
        .select({ actorUserId: auditEvents.actorUserId })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.targetType, "PRODUCTION_SHEET"),
            eq(auditEvents.targetId, activeSheetId),
            eq(auditEvents.action, "SHEET_VALUES_PATCHED"),
          ),
        );
      expect(staffEditEvents.map((event) => event.actorUserId)).toEqual(
        expect.arrayContaining([creator.id, assignee.id, unrelated.id]),
      );

      await connection.db.update(departmentSubpageIdentityPermissions)
        .set({ canEdit: false })
        .where(and(eq(departmentSubpageIdentityPermissions.subpageId, slittingSubpageId), eq(departmentSubpageIdentityPermissions.kind, "STAFF")));
      const revokedEdit = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${activeSheetId}/values`,
        headers: { origin: appOrigin, cookie: unrelated.cookie, "x-csrf-token": unrelated.csrf },
        payload: { baseVersion: 4, clientMutationId: randomUUID(), changes: [{ fieldKey: "testValue", value: "blocked after revocation" }] },
      });
      expect(revokedEdit.statusCode).toBe(403);

      // 分條製令單 was inactive while its transcription still carried open
      // questions. The user supplied the source document and answered all ten
      // on 2026-08-11, so it is now published and active — this asserts the
      // seeded state, not that a draft stays unpublished.
      const [productionOrder] = await connection.db
        .select({
          active: sheetTemplates.active,
          currentVersionNumber: sheetTemplates.currentVersionNumber,
        })
        .from(sheetTemplates)
        .where(eq(sheetTemplates.slug, "slitting-production-order"))
        .limit(1);
      expect(productionOrder).toMatchObject({
        active: true,
        currentVersionNumber: 2,
      });
    } finally {
      for (const socket of sockets) socket.close();
      await app.close();
      if (sheetId) {
        await connection.db.delete(productionSheets).where(eq(productionSheets.id, sheetId));
        await connection.db
          .delete(auditEvents)
          .where(
            and(
              eq(auditEvents.targetType, "PRODUCTION_SHEET"),
              eq(auditEvents.targetId, sheetId),
            ),
          );
      }
      if (templateVersionId) {
        await connection.db
          .delete(sheetTemplateVersions)
          .where(eq(sheetTemplateVersions.id, templateVersionId));
      }
      if (templateId) {
        await connection.db.delete(departmentSubpageTemplates).where(eq(departmentSubpageTemplates.templateId, templateId));
        await connection.db.delete(sheetTemplates).where(eq(sheetTemplates.id, templateId));
      }
      if (createdUserIds.length > 0) {
        await connection.db.delete(auditEvents).where(inArray(auditEvents.actorUserId, createdUserIds));
        await connection.db.delete(users).where(inArray(users.id, createdUserIds));
      }
      if (createdSubpageId) await connection.db.delete(departmentSubpages).where(eq(departmentSubpages.id, createdSubpageId));
      await connection.close();
    }
  }, 20_000);
});
