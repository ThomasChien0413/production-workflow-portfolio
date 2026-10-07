import { and, eq, isNull, sql } from "drizzle-orm";
import {
  auditEvents,
  outboxJobs,
  productionSheets,
  sheetAttachments,
  sheetTemplates,
  sheetTemplateVersions,
  type Database,
} from "@workflow/database";

/**
 * Permanently deletes archived sheets one year after 封存 (the user,
 * 2026-10-01). `@workflow/domain`'s `archivedSheetDeletionAt` shows the same
 * date on the sheet.
 *
 * One transaction per sheet:
 * - queue the permanent removal of each of its stored attachment files, which
 *   the attachment cleanup job retries until storage confirms;
 * - record an audit event with no sheet values;
 * - delete the sheet, which cascades to its values, history, handoffs,
 *   attachment rows and notifications.
 *
 * Only `ARCHIVED` sheets qualify; nothing active is ever deleted.
 */
export type PurgedSheet = { sheetId: string; attachmentFiles: number };

export class SheetRetentionRepository {
  constructor(private readonly db: Database) {}

  async purgeOne(now: Date): Promise<PurgedSheet | null> {
    return await this.db.transaction(async (tx) => {
      const [sheet] = await tx
        .select({
          id: productionSheets.id,
          sheetNumber: productionSheets.sheetNumber,
          archivedAt: productionSheets.archivedAt,
          currentDepartmentId: productionSheets.currentDepartmentId,
          templateVersionId: productionSheets.templateVersionId,
        })
        .from(productionSheets)
        .where(
          and(
            eq(productionSheets.state, "ARCHIVED"),
            sql`${productionSheets.archivedAt} + interval '1 year' <= ${now.toISOString()}::timestamptz`,
          ),
        )
        .orderBy(productionSheets.archivedAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!sheet) return null;

      const [template] = await tx
        .select({ slug: sheetTemplates.slug, version: sheetTemplateVersions.version })
        .from(sheetTemplateVersions)
        .innerJoin(sheetTemplates, eq(sheetTemplates.id, sheetTemplateVersions.templateId))
        .where(eq(sheetTemplateVersions.id, sheet.templateVersionId))
        .limit(1);

      // Files not yet confirmed gone. A removal already queued keeps its job:
      // the deduplication key is the one the API uses.
      const files = await tx
        .select({
          id: sheetAttachments.id,
          storageKey: sheetAttachments.storageKey,
          storageVersionId: sheetAttachments.storageVersionId,
        })
        .from(sheetAttachments)
        .where(and(eq(sheetAttachments.sheetId, sheet.id), isNull(sheetAttachments.deletedAt)));
      if (files.length > 0) {
        await tx
          .insert(outboxJobs)
          .values(
            files.map((file) => ({
              jobType: "SHEET_ATTACHMENT_DELETE",
              payload: {
                attachmentId: file.id,
                storageKey: file.storageKey,
                storageVersionId: file.storageVersionId,
              },
              deduplicationKey: `sheet-attachment-delete:${file.id}`,
            })),
          )
          .onConflictDoNothing();
      }

      await tx.insert(auditEvents).values({
        actorUserId: null,
        action: "SHEET_RETENTION_DELETED",
        targetType: "PRODUCTION_SHEET",
        targetId: sheet.id,
        metadata: {
          sheetNumber: sheet.sheetNumber,
          departmentId: sheet.currentDepartmentId,
          template: template ? `${template.slug}@${template.version}` : null,
          archivedAt: sheet.archivedAt?.toISOString() ?? null,
          attachmentFiles: files.length,
        },
        createdAt: now,
      });
      await tx.delete(productionSheets).where(eq(productionSheets.id, sheet.id));
      return { sheetId: sheet.id, attachmentFiles: files.length };
    });
  }
}

export class SheetRetentionPurger {
  private nextAt = 0;

  constructor(
    private readonly repository: Pick<SheetRetentionRepository, "purgeOne">,
    private readonly intervalMs: number,
    private readonly batchSize: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Deletes up to one batch when an interval has passed; returns how many. */
  async runIfDue(): Promise<number | null> {
    const now = this.now();
    if (now.getTime() < this.nextAt) return null;
    let deleted = 0;
    while (deleted < this.batchSize) {
      const purged = await this.repository.purgeOne(now);
      if (!purged) break;
      deleted += 1;
    }
    // A full batch may have left more; come back on the next cycle.
    this.nextAt = deleted === this.batchSize ? 0 : now.getTime() + this.intervalMs;
    return deleted;
  }
}
