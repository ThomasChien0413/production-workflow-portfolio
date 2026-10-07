import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import argon2 from "argon2";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FileAttachmentStorage } from "@workflow/attachment-storage";
import {
  auditEvents,
  createDatabase,
  departmentMemberships,
  departmentSubpageIdentityPermissions,
  departmentSubpages,
  departments,
  notifications,
  outboxJobs,
  productionSheets,
  sheetAttachmentMutations,
  sheetAttachments,
  sheetTemplateVersions,
  sheetTemplates,
  sheetValues,
  users,
} from "@workflow/database";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const appOrigin = "http://localhost:3000";

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

function multipartPdf(
  boundary: string,
  filename: string,
  contentType: string,
  bytes: Buffer,
): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      "utf8",
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
}

describe.skipIf(!testDatabaseUrl)("sheet PDF attachment routes", () => {
  it("streams, authorizes, audits, ranges, idempotently removes, and leaves the sheet unchanged", async () => {
    const connection = createDatabase(testDatabaseUrl!, 1);
    const root = await mkdtemp(join(tmpdir(), "workflow-attachment-api-"));
    const suffix = randomUUID().slice(0, 8);
    const password = `Attachment-${suffix}-Password!`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const managerId = randomUUID();
    const departmentStaffId = randomUUID();
    const outsiderId = randomUUID();
    const secondStaffId = randomUUID();
    const sheetId = randomUUID();
    let createdAttachmentId: string | null = null;
    let createdSubpageId: string | null = null;
    const userIds = [managerId, departmentStaffId, outsiderId, secondStaffId];
    const app = await buildApp(
      loadConfig({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
        APP_ORIGIN: appOrigin,
        ATTACHMENT_LOCAL_DIRECTORY: join(root, "objects"),
        ATTACHMENT_TEMP_DIRECTORY: join(root, "temp"),
      }),
      { attachmentStorage: new FileAttachmentStorage(join(root, "objects")) },
    );

    try {
      const departmentRows = await connection.db
        .select({ id: departments.id, code: departments.code })
        .from(departments);
      const departmentByCode = new Map(
        departmentRows.map((department) => [department.code, department.id]),
      );
      const warehouseId = departmentByCode.get("WAREHOUSE")!;
      const cutId = departmentByCode.get("CUT")!;
      const [warehouseSubpage] = await connection.db.insert(departmentSubpages).values({ departmentId: warehouseId, name: `附件測試-${suffix}`, position: 100 }).returning({ id: departmentSubpages.id });
      if (!warehouseSubpage) throw new Error("Could not create isolated WAREHOUSE subpage");
      createdSubpageId = warehouseSubpage.id;
      const [template] = await connection.db
        .select({ versionId: sheetTemplateVersions.id })
        .from(sheetTemplates)
        .innerJoin(
          sheetTemplateVersions,
          and(
            eq(sheetTemplateVersions.templateId, sheetTemplates.id),
            eq(sheetTemplateVersions.version, sheetTemplates.currentVersionNumber),
          ),
        )
        .where(eq(sheetTemplates.slug, "warehouse-location-intake"))
        .limit(1);
      expect(template).toBeTruthy();

      await connection.db.insert(users).values([
        {
          id: managerId,
          username: `attachment-manager-${suffix}`,
          displayName: `附件主管 ${suffix}`,
          passwordHash,
        },
        {
          id: departmentStaffId,
          username: `attachment-staff-${suffix}`,
          displayName: `附件員工 ${suffix}`,
          passwordHash,
        },
        {
          id: outsiderId,
          username: `attachment-outsider-${suffix}`,
          displayName: `外部員工 ${suffix}`,
          passwordHash,
        },
        {
          id: secondStaffId,
          username: `attachment-second-staff-${suffix}`,
          displayName: `第二位倉管員工 ${suffix}`,
          passwordHash,
        },
      ]);
      await connection.db.insert(departmentMemberships).values([
        { userId: managerId, departmentId: warehouseId, kind: "MANAGER" },
        { userId: departmentStaffId, departmentId: warehouseId, kind: "STAFF" },
        { userId: outsiderId, departmentId: cutId, kind: "STAFF" },
        { userId: secondStaffId, departmentId: warehouseId, kind: "STAFF" },
      ]);
      await connection.db.insert(departmentSubpageIdentityPermissions).values({
        subpageId: warehouseSubpage.id,
        kind: "STAFF",
        canView: true,
        canCreate: false,
        canEdit: true,
        canSubmit: false,
        updatedByUserId: managerId,
      });
      await connection.db.insert(productionSheets).values({
        id: sheetId,
        sheetNumber: sheetId,
        templateVersionId: template!.versionId,
        originDepartmentId: warehouseId,
        currentDepartmentId: warehouseId,
        subpageId: warehouseSubpage.id,
        createdByUserId: managerId,
        state: "DRAFT",
      });
      await connection.db.insert(sheetValues).values({ sheetId, values: {} });

      const login = async (username: string) => {
        const response = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin: appOrigin },
          payload: { username, password },
        });
        expect(response.statusCode).toBe(200);
        return cookies(response);
      };
      const manager = await login(`attachment-manager-${suffix}`);
      const departmentStaff = await login(`attachment-staff-${suffix}`);
      const outsider = await login(`attachment-outsider-${suffix}`);
      const secondStaff = await login(`attachment-second-staff-${suffix}`);
      const boundary = `workflow-${suffix}`;
      const pdf = Buffer.from("%PDF-1.7\nattachment contents", "utf8");
      const uploadKey = randomUUID();
      const upload = async (key: string, bytes = pdf) =>
        await app.inject({
          method: "POST",
          url: `/api/sheets/${sheetId}/attachments`,
          headers: {
            origin: appOrigin,
            cookie: manager.cookie,
            "x-csrf-token": manager.csrf,
            "idempotency-key": key,
            "content-type": `multipart/form-data; boundary=${boundary}`,
          },
          payload: multipartPdf(boundary, "生產補充資料.pdf", "application/pdf", bytes),
        });

      const invalid = await upload(randomUUID(), Buffer.from("not a PDF"));
      expect(invalid.statusCode).toBe(409);

      const before = await connection.db
        .select({ version: productionSheets.version, state: productionSheets.state })
        .from(productionSheets)
        .where(eq(productionSheets.id, sheetId));
      const created = await upload(uploadKey);
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as {
        attachment: { id: string; filename: string; sizeBytes: number };
        replayed: boolean;
      };
      expect(createdBody.replayed).toBe(false);
      expect(createdBody.attachment.filename).toBe("生產補充資料.pdf");
      expect(createdBody.attachment.sizeBytes).toBe(pdf.length);
      const attachmentId = createdBody.attachment.id;
      createdAttachmentId = attachmentId;

      const replay = await upload(uploadKey);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({
        replayed: true,
        attachment: { id: attachmentId },
      });
      expect(
        await connection.db
          .select()
          .from(sheetAttachments)
          .where(eq(sheetAttachments.sheetId, sheetId)),
      ).toHaveLength(1);
      expect(
        await connection.db
          .select({ attachmentId: sheetAttachmentMutations.attachmentId })
          .from(sheetAttachmentMutations)
          .where(
            and(
              eq(sheetAttachmentMutations.actorUserId, managerId),
              eq(sheetAttachmentMutations.idempotencyKey, uploadKey),
            ),
          ),
      ).toEqual([{ attachmentId }]);

      const list = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/attachments`,
        headers: { cookie: manager.cookie },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json()).toMatchObject({
        total: 1,
        pageSize: 25,
        canModify: true,
        items: [{ id: attachmentId, filename: "生產補充資料.pdf" }],
      });

      const denied = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/attachments`,
        headers: { cookie: outsider.cookie },
      });
      expect(denied.statusCode).toBe(403);
      const deniedUpload = await app.inject({
        method: "POST",
        url: `/api/sheets/${sheetId}/attachments`,
        headers: {
          origin: appOrigin,
          cookie: outsider.cookie,
          "x-csrf-token": outsider.csrf,
          "idempotency-key": randomUUID(),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: multipartPdf(boundary, "denied.pdf", "application/pdf", pdf),
      });
      expect(deniedUpload.statusCode).toBe(403);
      // No LINE step any more (the user, 2026-10-04): another 倉管 員工 reads them.
      const secondStaffList = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/attachments`,
        headers: { cookie: secondStaff.cookie },
      });
      expect(secondStaffList.statusCode).toBe(200);

      const range = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/attachments/${attachmentId}/content?disposition=inline`,
        headers: { cookie: manager.cookie, range: "bytes=0-4" },
      });
      expect(range.statusCode).toBe(206);
      expect(range.body).toBe("%PDF-");
      expect(range.headers["content-range"]).toBe(`bytes 0-4/${pdf.length}`);
      expect(range.headers["cache-control"]).toBe("private, no-store");
      expect(range.headers["x-content-type-options"]).toBe("nosniff");

      const invalidRange = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/attachments/${attachmentId}/content`,
        headers: { cookie: manager.cookie, range: `bytes=${pdf.length}-` },
      });
      expect(invalidRange.statusCode).toBe(416);
      expect(invalidRange.headers["content-range"]).toBe(`bytes */${pdf.length}`);

      await connection.db
        .update(productionSheets)
        .set({ state: "COMPLETED", completedAt: new Date() })
        .where(eq(productionSheets.id, sheetId));
      const finalReaderList = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/attachments`,
        headers: { cookie: departmentStaff.cookie },
      });
      expect(finalReaderList.statusCode).toBe(200);
      expect(finalReaderList.json()).toMatchObject({ total: 1, canModify: false });
      const finalReaderContent = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/attachments/${attachmentId}/content?disposition=inline`,
        headers: { cookie: departmentStaff.cookie },
      });
      expect(finalReaderContent.statusCode).toBe(200);
      const lockedRemoval = await app.inject({
        method: "DELETE",
        url: `/api/sheets/${sheetId}/attachments/${attachmentId}`,
        headers: {
          origin: appOrigin,
          cookie: manager.cookie,
          "x-csrf-token": manager.csrf,
          "idempotency-key": randomUUID(),
        },
      });
      expect(lockedRemoval.statusCode).toBe(403);
      await connection.db
        .update(departmentMemberships)
        .set({ active: false })
        .where(
          and(
            eq(departmentMemberships.userId, departmentStaffId),
            eq(departmentMemberships.departmentId, warehouseId),
          ),
        );
      const revoked = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/attachments`,
        headers: { cookie: departmentStaff.cookie },
      });
      expect(revoked.statusCode).toBe(403);
      await connection.db
        .update(productionSheets)
        .set({ state: "DRAFT", completedAt: null })
        .where(eq(productionSheets.id, sheetId));

      const removeKey = randomUUID();
      const removed = await app.inject({
        method: "DELETE",
        url: `/api/sheets/${sheetId}/attachments/${attachmentId}`,
        headers: {
          origin: appOrigin,
          cookie: manager.cookie,
          "x-csrf-token": manager.csrf,
          "idempotency-key": removeKey,
        },
      });
      expect(removed.statusCode).toBe(200);
      const removedReplay = await app.inject({
        method: "DELETE",
        url: `/api/sheets/${sheetId}/attachments/${attachmentId}`,
        headers: {
          origin: appOrigin,
          cookie: manager.cookie,
          "x-csrf-token": manager.csrf,
          "idempotency-key": removeKey,
        },
      });
      expect(removedReplay.statusCode).toBe(200);
      expect(removedReplay.json()).toMatchObject({ result: { replayed: true } });

      const deniedRemovedContent = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/attachments/${attachmentId}/content`,
        headers: { cookie: manager.cookie },
      });
      expect(deniedRemovedContent.statusCode).toBe(404);
      const afterList = await app.inject({
        method: "GET",
        url: `/api/sheets/${sheetId}/attachments`,
        headers: { cookie: manager.cookie },
      });
      expect(afterList.json()).toMatchObject({ total: 0, items: [] });

      const after = await connection.db
        .select({ version: productionSheets.version, state: productionSheets.state })
        .from(productionSheets)
        .where(eq(productionSheets.id, sheetId));
      expect(after).toEqual(before);
      const sheetNotifications = await connection.db
        .select()
        .from(notifications)
        .where(eq(notifications.sheetId, sheetId));
      expect(sheetNotifications).toHaveLength(0);
      const actions = await connection.db
        .select({ action: auditEvents.action, metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(eq(auditEvents.targetId, attachmentId));
      expect(actions.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          "SHEET_ATTACHMENT_PREVIEWED",
          "SHEET_ATTACHMENT_REMOVED",
          "SHEET_ATTACHMENT_UPLOADED",
        ]),
      );
      expect(actions.filter((row) => row.action === "SHEET_ATTACHMENT_PREVIEWED")).toHaveLength(2);
      expect(JSON.stringify(actions)).not.toContain("storageKey");
      const cleanup = await connection.db
        .select()
        .from(outboxJobs)
        .where(eq(outboxJobs.deduplicationKey, `sheet-attachment-delete:${attachmentId}`));
      expect(cleanup).toHaveLength(1);
    } finally {
      await app.close();
      if (createdAttachmentId) {
        await connection.db
          .delete(outboxJobs)
          .where(
            eq(
              outboxJobs.deduplicationKey,
              `sheet-attachment-delete:${createdAttachmentId}`,
            ),
          );
      }
      await connection.db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
      await connection.db.delete(productionSheets).where(eq(productionSheets.id, sheetId));
      await connection.db.delete(users).where(inArray(users.id, userIds));
      if (createdSubpageId) await connection.db.delete(departmentSubpages).where(eq(departmentSubpages.id, createdSubpageId));
      await connection.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
