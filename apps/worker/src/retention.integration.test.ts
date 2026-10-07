import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  auditEvents,
  createDatabase,
  departments,
  notifications,
  outboxJobs,
  productionSheets,
  sheetAttachments,
  sheetTemplates,
  sheetTemplateVersions,
  users,
} from "@workflow/database";
import { SheetRetentionRepository } from "./retention.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/**
 * Sheets are archived in 2000 and 2001 here, so no other suite's sheet
 * qualifies before these do, and the measuring instant is fixed.
 */
describe.skipIf(!testDatabaseUrl)("archived sheet retention with PostgreSQL", () => {
  it("deletes an archived sheet a year after 封存, queues its files and audits it", async () => {
    const connection = createDatabase(testDatabaseUrl!, 2);
    const db = connection.db;
    const suffix = randomUUID().slice(0, 8);
    const sheetIds: string[] = [];
    const attachmentIds: string[] = [];
    let userId: string | null = null;
    let templateId: string | null = null;

    try {
      const [department] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.active, true))
        .limit(1);
      if (!department) throw new Error("Seeded department is required");

      const [user] = await db
        .insert(users)
        .values({
          username: `retention-${suffix}`,
          displayName: "保存期限測試",
          passwordHash: "not-an-authentication-test",
          passwordWarning: false,
        })
        .returning({ id: users.id });
      userId = user!.id;
      const [template] = await db
        .insert(sheetTemplates)
        .values({
          departmentId: department.id,
          slug: `retention-test-${suffix}`,
          displayName: "保存期限測試範本",
          active: true,
          currentVersionNumber: 1,
        })
        .returning({ id: sheetTemplates.id });
      templateId = template!.id;
      const [version] = await db
        .insert(sheetTemplateVersions)
        .values({
          templateId,
          version: 1,
          definition: {},
          requiresReview: false,
          publishedByUserId: userId,
          publishedAt: new Date("2000-01-01T00:00:00.000Z"),
        })
        .returning({ id: sheetTemplateVersions.id });

      async function sheet(label: string, state: "ARCHIVED" | "COMPLETED", archivedAt: Date | null) {
        const [row] = await db
          .insert(productionSheets)
          .values({
            sheetNumber: `RETENTION-${label}-${suffix}`,
            templateVersionId: version!.id,
            originDepartmentId: department!.id,
            currentDepartmentId: department!.id,
            createdByUserId: userId!,
            state,
            completedAt: new Date("2000-01-01T00:00:00.000Z"),
            archivedAt,
          })
          .returning({ id: productionSheets.id });
        sheetIds.push(row!.id);
        return row!.id;
      }

      const expired = await sheet("expired", "ARCHIVED", new Date("2000-03-01T00:00:00.000Z"));
      const recent = await sheet("recent", "ARCHIVED", new Date("2001-03-01T00:00:00.000Z"));
      // Old, but never archived: active work is never deleted.
      const completed = await sheet("completed", "COMPLETED", null);

      const files = await db
        .insert(sheetAttachments)
        .values(
          ["stored", "gone"].map((name) => ({
            sheetId: expired,
            uploadedByUserId: userId!,
            originalFilename: `${name}.pdf`,
            sizeBytes: 1,
            sha256: "0".repeat(64),
            storageKey: `vitest-retention/${suffix}/${name}`,
            state: name === "gone" ? ("REMOVED" as const) : ("AVAILABLE" as const),
            deletedAt: name === "gone" ? new Date("2000-02-01T00:00:00.000Z") : null,
          })),
        )
        .returning({ id: sheetAttachments.id, storageKey: sheetAttachments.storageKey });
      attachmentIds.push(...files.map((file) => file.id));
      const stored = files.find((file) => file.storageKey.endsWith("/stored"))!;
      await db.insert(notifications).values({
        recipientUserId: userId,
        sheetId: expired,
        channel: "IN_APP",
        eventType: "SHEET_ARCHIVED",
        summary: "保存期限測試",
        state: "DELIVERED",
        deduplicationKey: `vitest-retention-${suffix}`,
      });

      const repository = new SheetRetentionRepository(db);
      // One year after 2000-03-01 is 2001-03-01: a moment before, nothing.
      await expect(repository.purgeOne(new Date("2001-02-28T23:59:59.000Z"))).resolves.toBeNull();

      const purged = await repository.purgeOne(new Date("2001-03-01T00:00:00.000Z"));
      expect(purged).toEqual({ sheetId: expired, attachmentFiles: 1 });
      await expect(repository.purgeOne(new Date("2001-03-01T00:00:00.000Z"))).resolves.toBeNull();

      const remaining = await db
        .select({ id: productionSheets.id })
        .from(productionSheets)
        .where(inArray(productionSheets.id, sheetIds));
      expect(remaining.map((row) => row.id).sort()).toEqual([recent, completed].sort());
      await expect(
        db.select().from(sheetAttachments).where(eq(sheetAttachments.sheetId, expired)),
      ).resolves.toEqual([]);
      await expect(
        db.select().from(notifications).where(eq(notifications.sheetId, expired)),
      ).resolves.toEqual([]);

      // Only the file still in storage is queued, with the key the API uses.
      const jobs = await db
        .select({ payload: outboxJobs.payload, key: outboxJobs.deduplicationKey })
        .from(outboxJobs)
        .where(inArray(outboxJobs.deduplicationKey, attachmentIds.map((id) => `sheet-attachment-delete:${id}`)));
      expect(jobs).toEqual([
        {
          key: `sheet-attachment-delete:${stored.id}`,
          payload: { attachmentId: stored.id, storageKey: stored.storageKey, storageVersionId: null },
        },
      ]);

      const [audit] = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, "SHEET_RETENTION_DELETED"), eq(auditEvents.targetId, expired)));
      expect(audit).toMatchObject({
        actorUserId: null,
        targetType: "PRODUCTION_SHEET",
        metadata: {
          sheetNumber: `RETENTION-expired-${suffix}`,
          departmentId: department.id,
          template: `retention-test-${suffix}@1`,
          archivedAt: "2000-03-01T00:00:00.000Z",
          attachmentFiles: 1,
        },
      });

      // The recent one follows a year after its own 封存.
      await expect(repository.purgeOne(new Date("2002-03-01T00:00:00.000Z"))).resolves.toEqual({
        sheetId: recent,
        attachmentFiles: 0,
      });
    } finally {
      await db
        .delete(outboxJobs)
        .where(inArray(outboxJobs.deduplicationKey, attachmentIds.map((id) => `sheet-attachment-delete:${id}`).concat("-")));
      await db
        .delete(auditEvents)
        .where(and(eq(auditEvents.action, "SHEET_RETENTION_DELETED"), inArray(auditEvents.targetId, sheetIds.concat("-"))));
      if (sheetIds.length > 0) await db.delete(productionSheets).where(inArray(productionSheets.id, sheetIds));
      if (templateId) {
        await db.delete(sheetTemplateVersions).where(eq(sheetTemplateVersions.templateId, templateId));
        await db.delete(sheetTemplates).where(eq(sheetTemplates.id, templateId));
      }
      if (userId) await db.delete(users).where(eq(users.id, userId));
      await connection.close();
    }
  });
});
