import { randomUUID } from "node:crypto";
import type fastifyWebsocket from "@fastify/websocket";
import argon2 from "argon2";
import { and, asc, eq, inArray, like, or } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  approvalRuns,
  auditEvents,
  createDatabase,
  departmentMemberships,
  departmentSubpageIdentityPermissions,
  departmentSubpageTemplates,
  departmentSubpageMutations,
  departmentSubpages,
  departments,
  notifications,
  outboxJobs,
  productionSheets,
  roleAssignments,
  sheetHandoffs,
  sheetTemplates,
  sheetTemplateVersions,
  sheetValues,
  users,
} from "@workflow/database";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const appOrigin = "http://localhost:3000";
const password = "sheet-route-test-password";

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

describe.skipIf(!testDatabaseUrl)("production sheet routes", () => {
  it("enforces creator departments, resolves autosave conflicts, restarts review, and routes to 分條", async () => {
    const connection = createDatabase(testDatabaseUrl!, 1);
    const suffix = randomUUID().slice(0, 8);
    const createdUserIds: string[] = [];
    const mutationIds: string[] = [];
    const historyFixtureIds: string[] = [];
    const createdSubpageIds: string[] = [];
    const pdfRenderCalls: string[] = [];
    let failPdfRender = false;
    let sheetId: string | null = null;
    const app = await buildApp(
      loadConfig({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
        APP_ORIGIN: appOrigin,
      }),
      {
        pdfRenderer: {
          async render(input) {
            pdfRenderCalls.push(input.sheetId);
            if (failPdfRender) throw new Error("test PDF failure");
            return Buffer.from("%PDF-1.7\n% test PDF\n", "utf8");
          },
          async close() {},
        },
      },
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
      const slittingId = departmentByCode.get("SLITTING")!;
      const subpageRows = await connection.db.insert(departmentSubpages).values([cutId, slittingId, shaoDunId].map((departmentId) => ({ departmentId, name: `表單測試-${suffix}`, position: 100 }))).returning({ id: departmentSubpages.id, departmentId: departmentSubpages.departmentId, revision: departmentSubpages.revision });
      createdSubpageIds.push(...subpageRows.map((row) => row.id));
      const subpageByDepartment = new Map(subpageRows.map((row) => [row.departmentId, row]));
      const cutSubpage = subpageByDepartment.get(cutId)!;
      const cutSubpageId = cutSubpage.id;
      const slittingSubpageId = subpageByDepartment.get(slittingId)!.id;
      const shaoDunSubpageId = subpageByDepartment.get(shaoDunId)!.id;
      const [template] = await connection.db
        .select({ id: sheetTemplates.id })
        .from(sheetTemplates)
        .where(eq(sheetTemplates.slug, "slitting-request"))
        .limit(1);
      expect(template).toBeTruthy();
      // 分條 may create this form too, so its subpage must tick it to receive
      // one by handoff (DESIGN.md §3.2.24).
      await connection.db.insert(departmentSubpageTemplates).values([
        { subpageId: cutSubpageId, templateId: template!.id },
        { subpageId: slittingSubpageId, templateId: template!.id },
      ]);

      async function createUser(
        label: string,
        options: {
          role?: "SALES" | "ASSOCIATE" | "GENERAL_MANAGER";
          managerDepartmentId?: string;
          staffDepartmentId?: string;
          orderTakerDepartmentId?: string;
        },
      ) {
        const [user] = await connection.db
          .insert(users)
          .values({
            username: `sheet-${label}-${suffix}`,
            displayName: `表單測試 ${label}`,
            passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
          })
          .returning({ id: users.id, username: users.username });
        if (!user) throw new Error("Failed to create test user");
        createdUserIds.push(user.id);
        if (options.role) {
          await connection.db.insert(roleAssignments).values({ userId: user.id, role: options.role });
        }
        if (options.managerDepartmentId) {
          await connection.db.insert(departmentMemberships).values({
            userId: user.id,
            departmentId: options.managerDepartmentId,
            kind: "MANAGER",
          });
        }
        if (options.staffDepartmentId) {
          await connection.db.insert(departmentMemberships).values({
            userId: user.id,
            departmentId: options.staffDepartmentId,
            kind: "STAFF",
          });
        }
        if (options.orderTakerDepartmentId) {
          await connection.db.insert(departmentMemberships).values({
            userId: user.id,
            departmentId: options.orderTakerDepartmentId,
            kind: "ORDER_TAKER",
          });
        }
        const login = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin: appOrigin },
          payload: { username: user.username, password },
        });
        expect(login.statusCode).toBe(200);
        return { ...user, ...cookies(login) };
      }

      const manager = await createUser("manager", { managerDepartmentId: cutId });
      const excludedManager = await createUser("excluded", { managerDepartmentId: shaoDunId });
      const sales = await createUser("sales", { role: "SALES" });
      const associate = await createUser("associate", { role: "ASSOCIATE" });
      const generalManager = await createUser("gm", { role: "GENERAL_MANAGER" });
      const slittingManager = await createUser("slitting-manager", {
        managerDepartmentId: slittingId,
      });
      const slittingStaff = await createUser("slitting-staff", {
        staffDepartmentId: slittingId,
      });
      const otherSlittingStaff = await createUser("other-slitting-staff", {
        staffDepartmentId: slittingId,
      });
      const cutStaff = await createUser("cut-staff", {
        staffDepartmentId: cutId,
      });
      const otherCutStaff = await createUser("other-cut-staff", {
        orderTakerDepartmentId: cutId,
      });
      const inactiveCutStaff = await createUser("inactive-cut-staff", {
        staffDepartmentId: cutId,
      });
      await connection.db
        .update(departmentMemberships)
        .set({ active: false })
        .where(
          and(
            eq(departmentMemberships.userId, inactiveCutStaff.id),
            eq(departmentMemberships.departmentId, cutId),
          ),
        );
      await connection.db.insert(departmentSubpageIdentityPermissions).values([
        { subpageId: slittingSubpageId, kind: "STAFF", canView: true, canCreate: true, canEdit: true, canSubmit: true, updatedByUserId: slittingManager.id },
        { subpageId: cutSubpageId, kind: "STAFF", canView: true, canCreate: false, canEdit: true, canSubmit: false, updatedByUserId: manager.id },
        { subpageId: cutSubpageId, kind: "ORDER_TAKER", canView: true, canCreate: false, canEdit: false, canSubmit: false, updatedByUserId: manager.id },
      ]);

      const generalManagerSubpages = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/subpages`,
        headers: { cookie: generalManager.cookie },
      });
      expect(generalManagerSubpages.statusCode).toBe(200);
      expect(generalManagerSubpages.json()).toMatchObject({
        canManage: true,
        subpages: expect.arrayContaining([
          expect.objectContaining({
            id: cutSubpageId,
            // 總經理 holds a 主管's authority in every department (the user,
            // 2026-09-30), whatever the identity grants say.
            capabilities: { canView: true, canCreate: true, canEdit: true, canSubmit: true },
          }),
        ]),
      });

      const cutStaffDirectory = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/staff`,
        headers: { cookie: manager.cookie },
      });
      expect(cutStaffDirectory.statusCode).toBe(200);
      expect(cutStaffDirectory.json().staff).toEqual(
        expect.arrayContaining([
          { id: cutStaff.id, username: cutStaff.username, displayName: "表單測試 cut-staff" },
        ]),
      );
      expect(
        cutStaffDirectory
          .json()
          .staff.map((staff: { id: string }) => staff.id),
      ).not.toContain(inactiveCutStaff.id);
      expect(JSON.stringify(cutStaffDirectory.json())).not.toContain("passwordHash");

      const wrongDepartmentDirectory = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/staff`,
        headers: { cookie: slittingManager.cookie },
      });
      expect(wrongDepartmentDirectory.statusCode).toBe(403);

      // 總經理 manages every department, so reads its roster; 協理 only
      // reads sheets.
      const generalManagerDirectory = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/staff`,
        headers: { cookie: generalManager.cookie },
      });
      expect(generalManagerDirectory.statusCode).toBe(200);
      const globalReaderDirectory = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/staff`,
        headers: { cookie: associate.cookie },
      });
      expect(globalReaderDirectory.statusCode).toBe(403);

      const slittingStaffDirectory = await app.inject({
        method: "GET",
        url: `/api/departments/${slittingId}/staff`,
        headers: { cookie: slittingManager.cookie },
      });
      expect(slittingStaffDirectory.statusCode).toBe(200);
      expect(
        slittingStaffDirectory
          .json()
          .staff.map((staff: { id: string }) => staff.id),
      ).toEqual(expect.arrayContaining([slittingStaff.id, otherSlittingStaff.id]));

      const availableTemplates = await app.inject({
        method: "GET",
        url: "/api/templates",
        headers: { cookie: manager.cookie },
      });
      expect(availableTemplates.statusCode).toBe(200);
      expect(availableTemplates.json().templates).toContainEqual(
        expect.objectContaining({ id: template!.id, displayName: "分條申請單" }),
      );
      const excludedTemplates = await app.inject({
        method: "GET",
        url: "/api/templates",
        headers: { cookie: excludedManager.cookie },
      });
      expect(excludedTemplates.statusCode).toBe(200);
      expect(excludedTemplates.json().templates).toEqual([]);

      const excludedMutation = randomUUID();
      mutationIds.push(excludedMutation);
      const excluded = await app.inject({
        method: "POST",
        url: "/api/sheets",
        headers: {
          origin: appOrigin,
          cookie: excludedManager.cookie,
          "x-csrf-token": excludedManager.csrf,
        },
        payload: {
          clientMutationId: excludedMutation,
          templateId: template!.id,
          originDepartmentId: shaoDunId,
          subpageId: shaoDunSubpageId,
        },
      });
      expect(excluded.statusCode).toBe(403);

      const createMutation = randomUUID();
      mutationIds.push(createMutation);
      const create = await app.inject({
        method: "POST",
        url: "/api/sheets",
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: {
          clientMutationId: createMutation,
          templateId: template!.id,
          originDepartmentId: cutId,
          subpageId: cutSubpageId,
        },
      });
      expect(create.statusCode).toBe(201);
      sheetId = create.json().sheet.id;
      expect(sheetId).toBe(createMutation);
      const [pinnedTemplate] = await connection.db
        .select({ version: sheetTemplateVersions.version })
        .from(productionSheets)
        .innerJoin(
          sheetTemplateVersions,
          eq(sheetTemplateVersions.id, productionSheets.templateVersionId),
        )
        .where(eq(productionSheets.id, createMutation))
        .limit(1);
      expect(pinnedTemplate?.version).toBe(3);

      const deniedDetail = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}`,
        headers: { cookie: excludedManager.cookie },
      });
      expect(deniedDetail.statusCode).toBe(403);

      const createReplay = await app.inject({
        method: "POST",
        url: "/api/sheets",
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: {
          clientMutationId: createMutation,
          templateId: template!.id,
          originDepartmentId: cutId,
          subpageId: cutSubpageId,
        },
      });
      expect(createReplay.statusCode).toBe(200);
      expect(createReplay.json().sheet.replayed).toBe(true);

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
        await ready;
        return socket;
      }

      const managerSocket = await connectSocket(manager);
      const managerSnapshotEvent = nextSocketEvent(
        managerSocket,
        "sheet.snapshot",
      );
      managerSocket.send(JSON.stringify({ type: "sheet.join", sheetId }));
      const managerSnapshot = await managerSnapshotEvent;
      expect(managerSnapshot).toMatchObject({
        sheetId,
        resyncRequired: false,
        sheet: { id: sheetId, version: 0, state: "READY" },
      });

      const salesSocket = await connectSocket(sales);
      const managerSawSales = nextSocketEvent(
        managerSocket,
        "presence.changed",
      );
      const salesSnapshotEvent = nextSocketEvent(salesSocket, "sheet.snapshot");
      salesSocket.send(JSON.stringify({ type: "sheet.join", sheetId }));
      await expect(salesSnapshotEvent).resolves.toMatchObject({ sheetId });
      await expect(managerSawSales).resolves.toMatchObject({
        sheetId,
        action: "JOINED",
        user: { id: sales.id },
      });

      const excludedSocket = await connectSocket(excludedManager);
      const deniedJoinEvent = nextSocketEvent(
        excludedSocket,
        "connection.error",
      );
      excludedSocket.send(JSON.stringify({ type: "sheet.join", sheetId }));
      await expect(deniedJoinEvent).resolves.toMatchObject({
        sheetId,
        code: "ACCESS_DENIED",
      });

      const firstPatchMutation = randomUUID();
      mutationIds.push(firstPatchMutation);
      const firstPatchPayload = {
        baseVersion: 0,
        clientMutationId: firstPatchMutation,
        changes: [
          { fieldKey: "requestDate", value: "2026-08-08" },
          { fieldKey: "items.0.specification", value: "S1" },
          { fieldKey: "items.0.material", value: "M1" },
          { fieldKey: "items.0.category", value: "C1" },
          { fieldKey: "items.0.requiredQuantity", value: "10" },
          { fieldKey: "items.0.notes", value: "N1" },
        ],
      };
      const managerPatchEvent = nextSocketEvent(
        managerSocket,
        "sheet.patch.applied",
      );
      const salesPatchEvent = nextSocketEvent(
        salesSocket,
        "sheet.patch.applied",
      );
      const firstPatch = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${sheetId}/values`,
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: firstPatchPayload,
      });
      expect(firstPatch.statusCode).toBe(200);
      expect(firstPatch.json().result.version).toBe(1);
      await expect(managerPatchEvent).resolves.toMatchObject({
        sheetId,
        changedFields: expect.arrayContaining(["requestDate"]),
        canonicalValues: { requestDate: "2026-08-08" },
        sheet: { version: 1 },
      });
      await expect(salesPatchEvent).resolves.toMatchObject({
        sheetId,
        sheet: { version: 1 },
      });

      let duplicatePatchBroadcast = false;
      const duplicateListener = (data: { toString(): string }) => {
        const event = JSON.parse(data.toString()) as { type?: string };
        if (event.type === "sheet.patch.applied") duplicatePatchBroadcast = true;
      };
      managerSocket.on("message", duplicateListener);
      const replayedPatch = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${sheetId}/values`,
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: firstPatchPayload,
      });
      expect(replayedPatch.statusCode).toBe(200);
      expect(replayedPatch.json().result).toMatchObject({
        action: "PATCH_VALUES",
        version: 1,
        replayed: true,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      managerSocket.off("message", duplicateListener);
      expect(duplicatePatchBroadcast).toBe(false);

      managerSocket.close();
      const reconnectSocket = await connectSocket(manager);
      const reconnectSnapshotEvent = nextSocketEvent(
        reconnectSocket,
        "sheet.snapshot",
      );
      reconnectSocket.send(
        JSON.stringify({
          type: "sheet.join",
          sheetId,
          lastKnownVersion: 0,
          lastKnownUpdatedAt: (
            managerSnapshot.sheet as { updatedAt: string }
          ).updatedAt,
        }),
      );
      await expect(reconnectSnapshotEvent).resolves.toMatchObject({
        sheetId,
        resyncRequired: true,
        sheet: { version: 1 },
      });
      reconnectSocket.close();
      salesSocket.close();
      excludedSocket.close();

      const memberSocket = await connectSocket(otherCutStaff);
      const memberSnapshot = nextSocketEvent(memberSocket, "sheet.snapshot");
      memberSocket.send(JSON.stringify({ type: "sheet.join", sheetId }));
      await memberSnapshot;
      const accessRevoked = nextSocketEvent(memberSocket, "room.access.revoked");
      const removePermission = await app.inject({
        method: "PUT",
        url: `/api/departments/${cutId}/subpages/${cutSubpageId}/identities`,
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: {
          clientMutationId: randomUUID(),
          revision: cutSubpage.revision,
          permissions: [
            { kind: "STAFF", canView: true, canCreate: false, canEdit: true, canSubmit: false },
            { kind: "ORDER_TAKER", canView: false, canCreate: false, canEdit: false, canSubmit: false },
          ],
        },
      });
      expect(removePermission.statusCode).toBe(200);
      await expect(accessRevoked).resolves.toMatchObject({ sheetId });
      const restorePermission = await app.inject({
        method: "PUT",
        url: `/api/departments/${cutId}/subpages/${cutSubpageId}/identities`,
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: {
          clientMutationId: randomUUID(),
          revision: cutSubpage.revision + 1,
          permissions: [
            { kind: "STAFF", canView: true, canCreate: false, canEdit: true, canSubmit: false },
            { kind: "ORDER_TAKER", canView: true, canCreate: false, canEdit: false, canSubmit: false },
          ],
        },
      });
      expect(restorePermission.statusCode).toBe(200);
      memberSocket.close();

      const nonOverlappingMutation = randomUUID();
      mutationIds.push(nonOverlappingMutation);
      const nonOverlapping = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${sheetId}/values`,
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: {
          baseVersion: 0,
          clientMutationId: nonOverlappingMutation,
          changes: [{ fieldKey: "items.1.notes", value: "draft row" }],
        },
      });
      expect(nonOverlapping.statusCode).toBe(200);
      expect(nonOverlapping.json().result.version).toBe(2);

      const conflictMutation = randomUUID();
      mutationIds.push(conflictMutation);
      const conflict = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${sheetId}/values`,
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: {
          baseVersion: 0,
          clientMutationId: conflictMutation,
          changes: [{ fieldKey: "requestDate", value: "2026-08-09" }],
        },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().details.conflictingFields).toEqual(["requestDate"]);
      expect(conflict.json().details.serverValues).toEqual({
        requestDate: "2026-08-08",
      });

      const fieldHistory = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/field-history?pageSize=100`,
        headers: { cookie: manager.cookie },
      });
      expect(fieldHistory.statusCode).toBe(200);
      expect(fieldHistory.json()).toMatchObject({
        page: 1,
        pageSize: 100,
        total: 7,
      });
      expect(fieldHistory.json().items).toContainEqual(
        expect.objectContaining({
          fieldKey: "requestDate",
          baseVersion: 0,
          newVersion: 1,
          approvalInvalidated: false,
          actor: {
            id: manager.id,
            username: manager.username,
            displayName: "表單測試 manager",
          },
        }),
      );
      expect(JSON.stringify(fieldHistory.json())).not.toContain("2026-08-08");
      expect(JSON.stringify(fieldHistory.json())).not.toContain("draft row");

      const filteredFieldHistory = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/field-history?fieldKey=requestDate`,
        headers: { cookie: manager.cookie },
      });
      expect(filteredFieldHistory.statusCode).toBe(200);
      expect(filteredFieldHistory.json()).toMatchObject({
        total: 1,
        items: [expect.objectContaining({ fieldKey: "requestDate" })],
      });

      const deniedFieldHistory = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/field-history`,
        headers: { cookie: excludedManager.cookie },
      });
      expect(deniedFieldHistory.statusCode).toBe(403);

      // Clear the intentionally partial second row before submission.
      const clearMutation = randomUUID();
      mutationIds.push(clearMutation);
      const clear = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${sheetId}/values`,
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: {
          baseVersion: 2,
          clientMutationId: clearMutation,
          changes: [{ fieldKey: "items.1.notes", value: "" }],
        },
      });
      expect(clear.statusCode).toBe(200);

      async function mutate(
        identity: { cookie: string; csrf: string },
        action: "submit" | "approve" | "reject",
        comment?: string,
      ) {
        const mutationId = randomUUID();
        mutationIds.push(mutationId);
        return app.inject({
          method: "POST",
          url: `/api/sheets/${sheetId}/${action}`,
          headers: { origin: appOrigin, cookie: identity.cookie, "x-csrf-token": identity.csrf },
          payload: { clientMutationId: mutationId, ...(comment ? { comment } : {}) },
        });
      }

      // No draft and no review (the user, 2026-09-30): the sheet has been at
      // 待生產 since it was created, its fields stay open, and it is sent
      // straight on to 分條. Its status is 分條's to set, not CUT's.
      const readyPatchMutation = randomUUID();
      mutationIds.push(readyPatchMutation);
      const readyPatch = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${sheetId}/values`,
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: {
          baseVersion: 3,
          clientMutationId: readyPatchMutation,
          changes: [{ fieldKey: "requestDate", value: "2026-08-09" }],
        },
      });
      expect(readyPatch.statusCode).toBe(200);
      expect(readyPatch.json().result).toMatchObject({ version: 4, state: "READY", approvalInvalidated: false });
      const cutStatus = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/status`,
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: { clientMutationId: randomUUID(), baseVersion: 4, state: "IN_PROGRESS" },
      });
      expect(cutStatus.statusCode).toBe(409);
      const deniedSend = await mutate(sales, "submit");
      expect(deniedSend.statusCode).toBe(403);
      // 分條申請單 is reviewed before it goes to 分條 (the user, 2026-10-01):
      // 送出審核 locks it at 業務's stage.
      const sent = await mutate(manager, "submit");
      expect(sent.statusCode).toBe(200);
      expect(sent.json().result).toMatchObject({ state: "PENDING_SALES", runNumber: 1, routedTo: null });
      const lockedPatch = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${sheetId}/values`,
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: {
          baseVersion: 4,
          clientMutationId: randomUUID(),
          changes: [{ fieldKey: "requestDate", value: "2026-08-10" }],
        },
      });
      expect(lockedPatch.statusCode).toBe(403);
      const lockedStatus = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/status`,
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: { clientMutationId: randomUUID(), baseVersion: 4, state: "IN_PROGRESS" },
      });
      expect(lockedStatus.statusCode).toBe(409);
      // Only the role whose turn it is decides, and 退回 needs a reason.
      expect((await mutate(associate, "approve")).statusCode).toBe(403);
      expect((await mutate(manager, "approve")).statusCode).toBe(403);
      expect((await mutate(sales, "reject")).statusCode).toBe(400);
      const returned = await mutate(sales, "reject", "需求量請再確認");
      expect(returned.statusCode).toBe(200);
      expect(returned.json().result).toMatchObject({ action: "REJECT", state: "RETURNED", runNumber: 1 });
      // A returned round leaves the boxes empty, even 申請單位.
      expect(
        (
          await app.inject({ method: "GET", url: `/api/sheets/${sheetId}`, headers: { cookie: manager.cookie } })
        ).json().sheet.signatures,
      ).toEqual({});
      // Back in CUT and open again; sent again, it starts from 業務.
      const resent = await mutate(manager, "submit");
      expect(resent.statusCode).toBe(200);
      expect(resent.json().result).toMatchObject({ state: "PENDING_SALES", runNumber: 2 });
      const bySales = await mutate(sales, "approve");
      expect(bySales.json().result).toMatchObject({ state: "PENDING_ASSOCIATE", routedTo: null });
      expect((await mutate(sales, "approve")).statusCode).toBe(403);
      // The signature boxes fill as it goes (the user, 2026-10-01): 申請單位 is
      // the department it came from, 業務單位 whoever approved, and the rest
      // stay empty.
      const signaturesNow = async () =>
        (
          await app.inject({
            method: "GET",
            url: `/api/sheets/${sheetId}`,
            headers: { cookie: generalManager.cookie },
          })
        ).json().sheet.signatures as Record<string, { displayName: string; decidedAt: string | null }>;
      const afterSales = await signaturesNow();
      expect(Object.keys(afterSales).sort()).toEqual(["ORIGIN_MANAGER", "SALES"]);
      // 申請單位 names the department it came from, not the sender.
      expect(afterSales.ORIGIN_MANAGER!.displayName).toBe("CUT");
      expect(afterSales.SALES!.displayName).toBe("表單測試 sales");
      expect(afterSales.SALES!.decidedAt).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
      const byAssociate = await mutate(associate, "approve", "同意");
      expect(byAssociate.json().result).toMatchObject({ state: "PENDING_GENERAL_MANAGER" });
      const byGeneralManager = await mutate(generalManager, "approve");
      expect(byGeneralManager.statusCode).toBe(200);
      expect(byGeneralManager.json().result).toMatchObject({
        action: "APPROVE",
        state: "READY",
        runNumber: 2,
        routedTo: { departmentId: slittingId, displayName: "分條" },
      });
      expect((await mutate(generalManager, "approve")).statusCode).toBe(409);
      const approvedSignatures = await signaturesNow();
      expect(
        Object.fromEntries(Object.entries(approvedSignatures).map(([slot, signature]) => [slot, signature.displayName])),
      ).toEqual({
        ORIGIN_MANAGER: "CUT",
        SALES: "表單測試 sales",
        ASSOCIATE: "表單測試 associate",
        GENERAL_MANAGER: "表單測試 gm",
      });
      // Routed to 分條 as a handoff would route it: in no subpage, so it waits
      // in 分條's 待分派 and the CUT subpage's grants no longer reach it.
      const [routed] = await connection.db
        .select({
          currentDepartmentId: productionSheets.currentDepartmentId,
          subpageId: productionSheets.subpageId,
        })
        .from(productionSheets)
        .where(eq(productionSheets.id, sheetId!));
      expect(routed).toEqual({ currentDepartmentId: slittingId, subpageId: null });

      const unchangedApprovedMutation = randomUUID();
      mutationIds.push(unchangedApprovedMutation);
      const unchangedApprovedPatch = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${sheetId}/values`,
        headers: {
          origin: appOrigin,
          cookie: manager.cookie,
          "x-csrf-token": manager.csrf,
        },
        payload: {
          baseVersion: 4,
          clientMutationId: unchangedApprovedMutation,
          changes: [{ fieldKey: "requestDate", value: "2026-08-09" }],
        },
      });
      expect(unchangedApprovedPatch.statusCode).toBe(403);

      // Nobody is assigned (the user, 2026-09-30). The routed sheet waits in
      // 分條's 待分派 until its 主管 places it in a subpage; then whoever may
      // modify it there sets its status, and the 主管 set its 交期.
      const unplacedStart = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/status`,
        headers: { origin: appOrigin, cookie: slittingManager.cookie, "x-csrf-token": slittingManager.csrf },
        payload: { clientMutationId: randomUUID(), baseVersion: 4, state: "IN_PROGRESS" },
      });
      expect(unplacedStart.statusCode).toBe(409);
      const deniedPlacement = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/subpage`,
        headers: { origin: appOrigin, cookie: manager.cookie, "x-csrf-token": manager.csrf },
        payload: { clientMutationId: randomUUID(), baseVersion: 4, subpageId: slittingSubpageId },
      });
      expect(deniedPlacement.statusCode).toBe(403);
      const placeMutation = randomUUID();
      mutationIds.push(placeMutation);
      const placement = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/subpage`,
        headers: { origin: appOrigin, cookie: slittingManager.cookie, "x-csrf-token": slittingManager.csrf },
        payload: { clientMutationId: placeMutation, baseVersion: 4, subpageId: slittingSubpageId },
      });
      expect(placement.statusCode).toBe(200);
      expect(placement.json().result).toMatchObject({ state: "READY", subpageId: slittingSubpageId, version: 5 });
      const placementReplay = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/subpage`,
        headers: { origin: appOrigin, cookie: slittingManager.cookie, "x-csrf-token": slittingManager.csrf },
        payload: { clientMutationId: placeMutation, baseVersion: 4, subpageId: slittingSubpageId },
      });
      expect(placementReplay.statusCode).toBe(200);
      expect(placementReplay.json().result).toMatchObject({ ...placement.json().result, replayed: true });

      const dueAt = new Date(Date.now() + 86_400_000).toISOString();
      const deniedDueDate = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/due-date`,
        headers: { origin: appOrigin, cookie: slittingStaff.cookie, "x-csrf-token": slittingStaff.csrf },
        payload: { clientMutationId: randomUUID(), baseVersion: 5, dueAt },
      });
      expect(deniedDueDate.statusCode).toBe(403);
      const pastDueDate = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/due-date`,
        headers: { origin: appOrigin, cookie: slittingManager.cookie, "x-csrf-token": slittingManager.csrf },
        payload: { clientMutationId: randomUUID(), baseVersion: 5, dueAt: new Date(Date.now() - 60_000).toISOString() },
      });
      expect(pastDueDate.statusCode).toBe(409);
      const dueDateMutation = randomUUID();
      mutationIds.push(dueDateMutation);
      const dueDate = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/due-date`,
        headers: { origin: appOrigin, cookie: slittingManager.cookie, "x-csrf-token": slittingManager.csrf },
        payload: { clientMutationId: dueDateMutation, baseVersion: 5, dueAt },
      });
      expect(dueDate.statusCode).toBe(200);
      expect(dueDate.json().result).toMatchObject({ action: "SET_DUE_DATE", version: 6 });
      expect(Date.parse(dueDate.json().result.dueAt)).toBe(Date.parse(dueAt));

      const otherStaffDetail = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}`,
        headers: { cookie: otherSlittingStaff.cookie },
      });
      expect(otherStaffDetail.statusCode).toBe(200);
      expect(otherStaffDetail.json().sheet.permissions).toMatchObject({ canEdit: true });

      // 業務 reads every sheet but modifies none, so cannot set its status.
      const deniedStart = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/status`,
        headers: { origin: appOrigin, cookie: sales.cookie, "x-csrf-token": sales.csrf },
        payload: { clientMutationId: randomUUID(), baseVersion: 6, state: "IN_PROGRESS" },
      });
      expect(deniedStart.statusCode).toBe(403);

      const startMutation = randomUUID();
      mutationIds.push(startMutation);
      const start = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/status`,
        headers: { origin: appOrigin, cookie: otherSlittingStaff.cookie, "x-csrf-token": otherSlittingStaff.csrf },
        payload: { clientMutationId: startMutation, baseVersion: 6, state: "IN_PROGRESS" },
      });
      expect(start.statusCode).toBe(200);
      expect(start.json().result).toMatchObject({ action: "SET_STATUS", state: "IN_PROGRESS", version: 7 });
      const startReplay = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/status`,
        headers: { origin: appOrigin, cookie: otherSlittingStaff.cookie, "x-csrf-token": otherSlittingStaff.csrf },
        payload: { clientMutationId: startMutation, baseVersion: 6, state: "IN_PROGRESS" },
      });
      expect(startReplay.json().result).toMatchObject({ ...start.json().result, replayed: true });
      const staleStatus = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/status`,
        headers: { origin: appOrigin, cookie: slittingStaff.cookie, "x-csrf-token": slittingStaff.csrf },
        payload: { clientMutationId: randomUUID(), baseVersion: 6, state: "COMPLETED" },
      });
      expect(staleStatus.statusCode).toBe(409);

      const dueDateChangeMutation = randomUUID();
      mutationIds.push(dueDateChangeMutation);
      const changedDueAt = new Date(Date.now() + 172_800_000).toISOString();
      const dueDateChange = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/due-date`,
        headers: { origin: appOrigin, cookie: slittingManager.cookie, "x-csrf-token": slittingManager.csrf },
        payload: { clientMutationId: dueDateChangeMutation, baseVersion: 7, dueAt: changedDueAt },
      });
      expect(dueDateChange.statusCode).toBe(200);
      expect(dueDateChange.json().result.version).toBe(8);

      // With no approval, changing what was once the reviewed specification in
      // production is an ordinary edit: nothing is invalidated or paused.
      const productionSocket = await connectSocket(slittingManager);
      const productionSnapshot = nextSocketEvent(productionSocket, "sheet.snapshot");
      productionSocket.send(JSON.stringify({ type: "sheet.join", sheetId }));
      await productionSnapshot;
      const productionPatchEvent = nextSocketEvent(productionSocket, "sheet.patch.applied");
      const productionEditMutation = randomUUID();
      mutationIds.push(productionEditMutation);
      const productionEdit = await app.inject({
        method: "PATCH",
        url: `/api/sheets/${sheetId}/values`,
        headers: { origin: appOrigin, cookie: slittingManager.cookie, "x-csrf-token": slittingManager.csrf },
        payload: {
          baseVersion: 8,
          clientMutationId: productionEditMutation,
          changes: [{ fieldKey: "requestDate", value: "2026-08-10" }],
        },
      });
      expect(productionEdit.statusCode).toBe(200);
      expect(productionEdit.json().result).toMatchObject({
        action: "PATCH_VALUES",
        version: 9,
        state: "IN_PROGRESS",
        approvalInvalidated: false,
      });
      await expect(productionPatchEvent).resolves.toMatchObject({
        sheetId,
        changedFields: ["requestDate"],
        canonicalValues: { requestDate: "2026-08-10" },
        sheet: { state: "IN_PROGRESS" },
      });
      productionSocket.close();
      const [stillInProduction] = await connection.db
        .select({ state: productionSheets.state, dueAt: productionSheets.dueAt })
        .from(productionSheets)
        .where(eq(productionSheets.id, sheetId!));
      expect(stillInProduction?.state).toBe("IN_PROGRESS");
      expect(stillInProduction?.dueAt?.toISOString()).toBe(new Date(changedDueAt).toISOString());

      // Archiving waits for 已完成.
      const prematureArchiveMutation = randomUUID();
      mutationIds.push(prematureArchiveMutation);
      const prematureArchive = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/archive`,
        headers: {
          origin: appOrigin,
          cookie: slittingManager.cookie,
          "x-csrf-token": slittingManager.csrf,
        },
        payload: { clientMutationId: prematureArchiveMutation },
      });
      expect(prematureArchive.statusCode).toBe(409);

      // Whoever may modify it completes it; 業務 may not.
      const deniedComplete = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/status`,
        headers: { origin: appOrigin, cookie: sales.cookie, "x-csrf-token": sales.csrf },
        payload: { clientMutationId: randomUUID(), baseVersion: 9, state: "COMPLETED" },
      });
      expect(deniedComplete.statusCode).toBe(403);

      const completeMutation = randomUUID();
      mutationIds.push(completeMutation);
      const complete = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/status`,
        headers: { origin: appOrigin, cookie: slittingStaff.cookie, "x-csrf-token": slittingStaff.csrf },
        payload: { clientMutationId: completeMutation, baseVersion: 9, state: "COMPLETED" },
      });
      expect(complete.statusCode).toBe(200);
      expect(complete.json().result.state).toBe("COMPLETED");

      // Notices follow every active 主管 of a department, and a developer's
      // database has 主管 of its own; they are counted in rather than assumed
      // away. On CI's fresh database there are none.
      const otherActiveManagers = async (departmentId: string) =>
        (
          await connection.db
            .select({ userId: departmentMemberships.userId })
            .from(departmentMemberships)
            .innerJoin(users, eq(users.id, departmentMemberships.userId))
            .where(
              and(
                eq(departmentMemberships.departmentId, departmentId),
                eq(departmentMemberships.kind, "MANAGER"),
                eq(departmentMemberships.active, true),
                eq(users.active, true),
              ),
            )
        )
          .map((row) => row.userId)
          .filter((userId) => !createdUserIds.includes(userId));

      // A finished sheet is archived, not handed on (the user, 2026-10-04):
      // there is no handoff to ask for.
      const goneDestinations = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/handoff-destinations`,
        headers: { cookie: slittingManager.cookie },
      });
      expect(goneDestinations.statusCode).toBe(404);
      const goneHandoff = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/handoff`,
        headers: {
          origin: appOrigin,
          cookie: slittingManager.cookie,
          "x-csrf-token": slittingManager.csrf,
        },
        payload: { clientMutationId: randomUUID(), destinationDepartmentId: cutId },
      });
      expect(goneHandoff.statusCode).toBe(404);

      const staffArchiveMutation = randomUUID();
      mutationIds.push(staffArchiveMutation);
      const staffArchive = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/archive`,
        headers: {
          origin: appOrigin,
          cookie: slittingStaff.cookie,
          "x-csrf-token": slittingStaff.csrf,
        },
        payload: { clientMutationId: staffArchiveMutation },
      });
      expect(staffArchive.statusCode).toBe(403);

      const priorManagerArchiveMutation = randomUUID();
      mutationIds.push(priorManagerArchiveMutation);
      const priorManagerArchive = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/archive`,
        headers: {
          origin: appOrigin,
          cookie: manager.cookie,
          "x-csrf-token": manager.csrf,
        },
        payload: { clientMutationId: priorManagerArchiveMutation },
      });
      expect(priorManagerArchive.statusCode).toBe(403);

      const archiveMutation = randomUUID();
      mutationIds.push(archiveMutation);
      const archive = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/archive`,
        headers: {
          origin: appOrigin,
          cookie: slittingManager.cookie,
          "x-csrf-token": slittingManager.csrf,
        },
        payload: { clientMutationId: archiveMutation },
      });
      expect(archive.statusCode).toBe(200);
      expect(archive.json().result).toMatchObject({
        action: "ARCHIVE",
        state: "ARCHIVED",
      });
      const archiveReplay = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/archive`,
        headers: {
          origin: appOrigin,
          cookie: slittingManager.cookie,
          "x-csrf-token": slittingManager.csrf,
        },
        payload: { clientMutationId: archiveMutation },
      });
      expect(archiveReplay.statusCode).toBe(200);
      expect(archiveReplay.json().result).toMatchObject({
        ...archive.json().result,
        replayed: true,
      });
      const secondArchiveMutation = randomUUID();
      mutationIds.push(secondArchiveMutation);
      const secondArchive = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/archive`,
        headers: {
          origin: appOrigin,
          cookie: slittingManager.cookie,
          "x-csrf-token": slittingManager.csrf,
        },
        payload: { clientMutationId: secondArchiveMutation },
      });
      expect(secondArchive.statusCode).toBe(409);

      // Archived, it leaves its subpage's list and count and is found in
      // 完工紀錄, or by asking for 已封存 by name (the user, 2026-10-04).
      const subpageList = await app.inject({
        method: "GET",
        url: `/api/sheets?subpageId=${slittingSubpageId}`,
        headers: { cookie: slittingManager.cookie },
      });
      expect(subpageList.statusCode).toBe(200);
      const listedIds = subpageList.json().sheets.map((sheet: { id: string }) => sheet.id);
      expect(listedIds).not.toContain(sheetId);
      const archivedList = await app.inject({
        method: "GET",
        url: `/api/sheets?subpageId=${slittingSubpageId}&state=ARCHIVED`,
        headers: { cookie: slittingManager.cookie },
      });
      expect(archivedList.json().sheets.map((sheet: { id: string }) => sheet.id)).toContain(sheetId);
      const slittingSubpages = await app.inject({
        method: "GET",
        url: `/api/departments/${slittingId}/subpages`,
        headers: { cookie: slittingManager.cookie },
      });
      expect(
        slittingSubpages.json().subpages.find((subpage: { id: string }) => subpage.id === slittingSubpageId).sheetCount,
      ).toBe(listedIds.length);

      const [storedSheet] = await connection.db
        .select()
        .from(productionSheets)
        .where(eq(productionSheets.id, sheetId!));
      expect(storedSheet).toMatchObject({
        state: "ARCHIVED",
        currentDepartmentId: slittingId,
        assignedUserId: null,
      });
      expect(storedSheet?.completedAt).toBeInstanceOf(Date);
      expect(storedSheet?.archivedAt).toBeInstanceOf(Date);
      const handoffs = await connection.db
        .select()
        .from(sheetHandoffs)
        .where(eq(sheetHandoffs.sheetId, sheetId!))
        .orderBy(asc(sheetHandoffs.sequence));
      // Only the review's release to 分條; nothing hands it on afterwards.
      expect(handoffs).toHaveLength(1);
      expect(handoffs[0]).toMatchObject({
        sequence: 1,
        sourceDepartmentId: cutId,
        destinationDepartmentId: slittingId,
      });
      const runs = await connection.db
        .select({
          runNumber: approvalRuns.runNumber,
          status: approvalRuns.status,
          reviewedDataFingerprint: approvalRuns.reviewedDataFingerprint,
        })
        .from(approvalRuns)
        .where(eq(approvalRuns.sheetId, sheetId!))
        // Without an order, rows come back in heap order, which follows
        // where PostgreSQL put each updated row: free space left by earlier
        // test files can put run 2 first.
        .orderBy(asc(approvalRuns.runNumber));
      // Returned once by 業務, then approved by all three.
      expect(runs.map(({ runNumber, status }) => ({ runNumber, status }))).toEqual([
        { runNumber: 1, status: "RETURNED" },
        { runNumber: 2, status: "APPROVED" },
      ]);
      const sheetNotifications = await connection.db
        .select({
          eventType: notifications.eventType,
          recipientUserId: notifications.recipientUserId,
          channel: notifications.channel,
        })
        .from(notifications)
        .where(eq(notifications.sheetId, sheetId!));
      expect(sheetNotifications.map((notification) => notification.eventType)).toEqual(
        expect.arrayContaining([
          "SHEET_WORK_COMPLETED",
          "SHEET_HANDED_OFF",
          "SHEET_ARCHIVED",
        ]),
      );
      // Each stage told its reviewer; 退回 and completion told the writers.
      const reviewNotices = (role: string) =>
        sheetNotifications.filter(
          (notification) => notification.eventType === "SHEET_REVIEW_REQUIRED" && notification.recipientUserId === role,
        ).length;
      // 業務 twice (sent, then sent again), 協理 and 總經理 once, on each channel.
      expect(reviewNotices(sales.id)).toBe(4);
      expect(reviewNotices(associate.id)).toBe(2);
      expect(reviewNotices(generalManager.id)).toBe(2);
      expect(sheetNotifications.map((notification) => notification.eventType)).toEqual(
        expect.arrayContaining(["SHEET_RETURNED", "SHEET_READY"]),
      );
      const archiveNotifications = sheetNotifications.filter(
        (notification) => notification.eventType === "SHEET_ARCHIVED",
      );
      // 分條's 主管 and the writing department's, who sent it there.
      const archiveRecipients = new Set([
        manager.id,
        slittingManager.id,
        ...(await otherActiveManagers(cutId)),
        ...(await otherActiveManagers(slittingId)),
      ]);
      expect(archiveNotifications).toHaveLength(2 * archiveRecipients.size);
      expect(
        new Set(
          archiveNotifications.map(
            (notification) => notification.recipientUserId,
          ),
        ),
      ).toEqual(archiveRecipients);
      expect(new Set(archiveNotifications.map((notification) => notification.channel))).toEqual(
        new Set(["IN_APP", "PUSH"]),
      );
      const sheetAuditEvents = await connection.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.targetType, "PRODUCTION_SHEET"),
            eq(auditEvents.targetId, sheetId!),
          ),
        );
      expect(sheetAuditEvents).not.toHaveLength(0);
      expect(sheetAuditEvents.map((event) => event.action)).toContain(
        "SHEET_ARCHIVED",
      );
      expect(sheetAuditEvents.map((event) => event.action)).toContain(
        "SHEET_STATUS_CHANGED",
      );

      const historyMarker = `history-${suffix}`;
      const literalWildcardValue = `literal_%_${suffix}`;
      const keyOnlyMarker = `key-only-${suffix}`;
      const [storedValues] = await connection.db
        .select({ values: sheetValues.values })
        .from(sheetValues)
        .where(eq(sheetValues.sheetId, sheetId!));
      await connection.db
        .update(sheetValues)
        .set({
          values: {
            ...storedValues?.values,
            historySearch: {
              marker: historyMarker,
              nested: [{ literal: literalWildcardValue, quantity: 987654321 }],
            },
            [keyOnlyMarker]: "this value does not contain the key name",
          },
        })
        .where(eq(sheetValues.sheetId, sheetId!));

      const templateVersionId = storedSheet!.templateVersionId;
      const fixtureCompletedBase = Date.parse("2026-06-01T00:00:00.000Z");
      const fixtureSheets: (typeof productionSheets.$inferInsert)[] = [];
      const fixtureValues: (typeof sheetValues.$inferInsert)[] = [];
      for (let index = 0; index < 26; index += 1) {
        const id = randomUUID();
        historyFixtureIds.push(id);
        const completedAt = new Date(fixtureCompletedBase + index * 60_000);
        // 完工紀錄 holds archived sheets only (the user, 2026-10-04).
        fixtureSheets.push({
          id,
          sheetNumber: id,
          templateVersionId,
          originDepartmentId: cutId,
          currentDepartmentId: cutId,
          createdByUserId: manager.id,
          assignedUserId: cutStaff.id,
          subpageId: cutSubpageId,
          state: "ARCHIVED",
          completedAt,
          archivedAt: new Date(completedAt.getTime() + 1_000),
        });
        fixtureValues.push({
          sheetId: id,
          values: {
            marker: historyMarker,
            decoy: index === 0 ? `literalABCX${suffix}` : "ordinary",
          },
        });
      }

      // A 已完成 sheet in CUT stays in its subpage and out of 完工紀錄.
      for (const stateFixture of [
        { state: "COMPLETED" as const, currentDepartmentId: cutId },
        { state: "DRAFT" as const, currentDepartmentId: cutId },
        { state: "RETURNED" as const, currentDepartmentId: cutId },
        { state: "COMPLETED" as const, currentDepartmentId: slittingId },
      ]) {
        const id = randomUUID();
        historyFixtureIds.push(id);
        fixtureSheets.push({
          id,
          sheetNumber: id,
          templateVersionId,
          originDepartmentId: cutId,
          currentDepartmentId: stateFixture.currentDepartmentId,
          createdByUserId: manager.id,
          assignedUserId: null,
          subpageId: stateFixture.currentDepartmentId === cutId ? cutSubpageId : slittingSubpageId,
          state: stateFixture.state,
          completedAt:
            stateFixture.state === "COMPLETED"
              ? new Date(fixtureCompletedBase)
              : null,
        });
        fixtureValues.push({
          sheetId: id,
          values: { marker: historyMarker },
        });
      }
      await connection.db.insert(productionSheets).values(fixtureSheets);
      await connection.db.insert(sheetValues).values(fixtureValues);

      const departmentMemberHistory = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/sheet-history?q=${historyMarker}`,
        headers: { cookie: otherCutStaff.cookie },
      });
      expect(departmentMemberHistory.statusCode).toBe(200);
      expect(departmentMemberHistory.json()).toMatchObject({
        page: 1,
        pageSize: 25,
        total: 26,
      });
      expect(departmentMemberHistory.json().items).toHaveLength(25);
      expect(
        departmentMemberHistory.json().items.map((item: { id: string }) => item.id),
      ).not.toContain(historyFixtureIds.at(-1));
      expect(JSON.stringify(departmentMemberHistory.json())).not.toContain(
        literalWildcardValue,
      );
      // 負責員工 went with assignment (the user, 2026-10-04).
      expect(departmentMemberHistory.json().filterOptions).not.toHaveProperty("employees");
      expect(departmentMemberHistory.json().items[0]).not.toHaveProperty("responsibleEmployee");

      const secondHistoryPage = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/sheet-history?q=${historyMarker}&page=2`,
        headers: { cookie: otherCutStaff.cookie },
      });
      expect(secondHistoryPage.statusCode).toBe(200);
      expect(secondHistoryPage.json().items).toHaveLength(1);
      const firstIds = new Set(
        departmentMemberHistory.json().items.map((item: { id: string }) => item.id),
      );
      expect(firstIds.has(secondHistoryPage.json().items[0].id)).toBe(false);

      const oldestFirstHistory = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/sheet-history?q=${historyMarker}&sort=completedAt&direction=asc&pageSize=100`,
        headers: { cookie: otherCutStaff.cookie },
      });
      expect(oldestFirstHistory.statusCode).toBe(200);
      const completionTimes = oldestFirstHistory
        .json()
        .items.map((item: { completedAt: string }) => Date.parse(item.completedAt));
      expect(completionTimes).toEqual([...completionTimes].sort((left, right) => left - right));

      for (const query of [
        sheetId!.slice(0, 12),
        "分條申請單",
        "987654321",
        literalWildcardValue,
        historyMarker.toUpperCase(),
      ]) {
        const search = await app.inject({
          method: "GET",
          url: `/api/departments/${slittingId}/sheet-history?q=${encodeURIComponent(query)}`,
          headers: { cookie: generalManager.cookie },
        });
        expect(search.statusCode).toBe(200);
        expect(search.json().items.map((item: { id: string }) => item.id)).toContain(
          sheetId,
        );
      }
      const literalSearch = await app.inject({
        method: "GET",
        url: `/api/departments/${slittingId}/sheet-history?q=${encodeURIComponent(literalWildcardValue)}`,
        headers: { cookie: generalManager.cookie },
      });
      expect(literalSearch.json().total).toBe(1);
      const keySearch = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/sheet-history?q=${encodeURIComponent(keyOnlyMarker)}`,
        headers: { cookie: otherCutStaff.cookie },
      });
      expect(keySearch.statusCode).toBe(200);
      expect(keySearch.json().total).toBe(0);

      const archivedHistory = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/sheet-history?q=${historyMarker}&templateId=${template!.id}`,
        headers: { cookie: generalManager.cookie },
      });
      expect(archivedHistory.statusCode).toBe(200);
      expect(archivedHistory.json().items.length).toBeGreaterThan(0);
      expect(
        archivedHistory.json().items.every(
          (item: { state: string }) => item.state === "ARCHIVED",
        ),
      ).toBe(true);
      // There is no 已完成 to filter for any more.
      const stateFilter = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/sheet-history?state=COMPLETED`,
        headers: { cookie: generalManager.cookie },
      });
      expect(stateFilter.statusCode).toBe(400);

      const completionInstant = storedSheet!.completedAt!.toISOString();
      const dateFilteredHistory = await app.inject({
        method: "GET",
        url: `/api/departments/${slittingId}/sheet-history?from=${encodeURIComponent(completionInstant)}&to=${encodeURIComponent(completionInstant)}`,
        headers: { cookie: generalManager.cookie },
      });
      expect(dateFilteredHistory.statusCode).toBe(200);
      expect(dateFilteredHistory.json().items.map((item: { id: string }) => item.id)).toEqual([
        sheetId,
      ]);

      const unrelatedHistory = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/sheet-history`,
        headers: { cookie: excludedManager.cookie },
      });
      expect(unrelatedHistory.statusCode).toBe(403);
      const revokedHistory = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/sheet-history`,
        headers: { cookie: inactiveCutStaff.cookie },
      });
      expect(revokedHistory.statusCode).toBe(403);
      const anonymousHistory = await app.inject({
        method: "GET",
        url: `/api/departments/${cutId}/sheet-history`,
      });
      expect(anonymousHistory.statusCode).toBe(401);

      const departmentFinalDetail = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}`,
        headers: { cookie: slittingStaff.cookie },
      });
      expect(departmentFinalDetail.statusCode).toBe(200);
      expect(departmentFinalDetail.json().sheet.state).toBe("ARCHIVED");
      const departmentFinalFieldHistory = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/field-history`,
        headers: { cookie: slittingStaff.cookie },
      });
      expect(departmentFinalFieldHistory.statusCode).toBe(200);
      const revokedFinalDetail = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}`,
        headers: { cookie: inactiveCutStaff.cookie },
      });
      expect(revokedFinalDetail.statusCode).toBe(403);
      const deniedFinalMutation = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/archive`,
        headers: {
          origin: appOrigin,
          cookie: otherCutStaff.cookie,
          "x-csrf-token": otherCutStaff.csrf,
        },
        payload: { clientMutationId: randomUUID() },
      });
      expect(deniedFinalMutation.statusCode).toBe(403);

      const returnedFixtureId = historyFixtureIds.at(-2)!;
      const routedAwayFixtureId = historyFixtureIds.at(-1)!;
      const returnedDetail = await app.inject({
        method: "GET",
        url: `/api/sheets/${returnedFixtureId}`,
        headers: { cookie: otherCutStaff.cookie },
      });
      expect(returnedDetail.statusCode).toBe(200);
      expect(returnedDetail.json().sheet.state).toBe("RETURNED");
      const routedAwayDetail = await app.inject({
        method: "GET",
        url: `/api/sheets/${routedAwayFixtureId}`,
        headers: { cookie: otherCutStaff.cookie },
      });
      expect(routedAwayDetail.statusCode).toBe(403);

      const gmDetail = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}`,
        headers: { cookie: generalManager.cookie },
      });
      expect(gmDetail.statusCode).toBe(200);
      expect(gmDetail.json().sheet.template.definition.displayName).toBe("分條申請單");
      // Nothing is assigned any more, so the sheet has no assignment history.
      expect(gmDetail.json().sheet.assignments).toEqual([]);

      const gmPdf = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/pdf`,
        headers: { cookie: generalManager.cookie },
      });
      expect(gmPdf.statusCode).toBe(200);
      expect(gmPdf.headers["content-type"]).toBe("application/pdf");
      expect(gmPdf.headers["cache-control"]).toBe("private, no-store");
      expect(gmPdf.headers["content-disposition"]).toContain("filename*=UTF-8''");
      expect(gmPdf.rawPayload.subarray(0, 5).toString("utf8")).toBe("%PDF-");
      expect(pdfRenderCalls).toEqual([sheetId]);
      const [pdfAudit] = await connection.db
        .select({ action: auditEvents.action, metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.actorUserId, generalManager.id),
            eq(auditEvents.targetId, sheetId!),
            eq(auditEvents.action, "SHEET_PDF_DOWNLOADED"),
          ),
        )
        .limit(1);
      expect(pdfAudit).toMatchObject({
        action: "SHEET_PDF_DOWNLOADED",
        metadata: expect.objectContaining({
          sheetVersion: storedSheet?.version,
          state: "ARCHIVED",
        }),
      });

      const deniedPdf = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/pdf`,
        headers: { cookie: excludedManager.cookie },
      });
      expect(deniedPdf.statusCode).toBe(403);
      expect(pdfRenderCalls).toEqual([sheetId]);


      const anonymousPdf = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/pdf`,
      });
      expect(anonymousPdf.statusCode).toBe(401);
      expect(pdfRenderCalls).toEqual([sheetId]);

      failPdfRender = true;
      const failedPdf = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/pdf`,
        headers: { cookie: slittingManager.cookie },
      });
      expect(failedPdf.statusCode).toBe(500);
      const failedAudit = await connection.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.actorUserId, slittingManager.id),
            eq(auditEvents.targetId, sheetId!),
            eq(auditEvents.action, "SHEET_PDF_DOWNLOADED"),
          ),
        );
      expect(failedAudit).toHaveLength(0);
      failPdfRender = false;

      const departmentFinalPdf = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/pdf`,
        headers: { cookie: slittingStaff.cookie },
      });
      expect(departmentFinalPdf.statusCode).toBe(200);
      expect(departmentFinalPdf.headers["content-type"]).toBe("application/pdf");

      // Access follows where the sheet is: 分條's 主管 reads it, and the
      // writing department's 主管 no longer does.
      const originManagerDetail = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}`,
        headers: { cookie: manager.cookie },
      });
      expect(originManagerDetail.statusCode).toBe(403);

      const currentManagerDetail = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}`,
        headers: { cookie: slittingManager.cookie },
      });
      expect(currentManagerDetail.statusCode).toBe(200);
    } finally {
      await app.close();
      if (createdUserIds.length > 0) {
        await connection.db.delete(departmentSubpageMutations).where(inArray(departmentSubpageMutations.actorUserId, createdUserIds));
      }
      const sheetIds = [sheetId, ...historyFixtureIds].filter(
        (id): id is string => typeof id === "string",
      );
      if (sheetIds.length > 0) {
        await connection.db.delete(productionSheets).where(inArray(productionSheets.id, sheetIds));
      }
      if (mutationIds.length > 0) {
        await connection.db
          .delete(outboxJobs)
          .where(or(...mutationIds.map((id) => like(outboxJobs.deduplicationKey, `${id}:%`))));
      }
      if (createdUserIds.length > 0) {
        await connection.db.delete(auditEvents).where(inArray(auditEvents.actorUserId, createdUserIds));
        await connection.db.delete(users).where(inArray(users.id, createdUserIds));
      }
      if (createdSubpageIds.length > 0) await connection.db.delete(departmentSubpages).where(inArray(departmentSubpages.id, createdSubpageIds));
      await connection.close();
    }
  }, 20_000);
});
