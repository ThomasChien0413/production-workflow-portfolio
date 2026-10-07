import { randomUUID } from "node:crypto";
import { and, count, desc, eq } from "drizzle-orm";
import type { AttachmentStorage } from "@workflow/attachment-storage";
import type { SessionUser, SheetAttachmentMetadata } from "@workflow/contracts";
import {
  auditEvents,
  outboxJobs,
  productionSheets,
  sheetAttachmentMutations,
  sheetAttachments,
  users,
  type Database,
} from "@workflow/database";
import {
  AuthorizationError,
  ConflictError,
  ResourceNotFoundError,
  ServiceUnavailableError,
} from "../auth/errors.js";
import type { RequestSecurityContext } from "../auth/service.js";
import type { SheetService } from "../sheets/service.js";
import { parseAttachmentRange } from "./http.js";

export const ATTACHMENT_PAGE_SIZE = 25;

export type PreparedAttachmentUpload = {
  tempPath: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
};

export type AttachmentUploadResult = {
  attachment: SheetAttachmentMetadata;
  replayed: boolean;
};

export type AttachmentRemovalResult = {
  attachmentId: string;
  replayed: boolean;
};

export class AttachmentCapacity {
  private active = 0;

  constructor(private readonly maximum: number) {}

  acquire(): (() => void) | null {
    if (this.active >= this.maximum) return null;
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}

function mutationResult<T>(value: unknown, action: "UPLOAD" | "REMOVE"): T {
  if (
    typeof value !== "object" ||
    value === null ||
    !("action" in value) ||
    value.action !== action
  ) {
    throw new ConflictError("此操作識別碼已被其他附件操作使用");
  }
  return value as T;
}

function cleanupMessage(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 120) : "UnknownError";
}

export class SheetAttachmentService {
  constructor(
    private readonly db: Database,
    private readonly sheets: Pick<
      SheetService,
      "attachmentAccess" | "requireAttachmentModifiable"
    >,
    private readonly storage: AttachmentStorage,
    private readonly storagePrefix: string,
    private readonly capacity: AttachmentCapacity,
    private readonly now: () => Date = () => new Date(),
  ) {}

  acquireUploadCapacity(): () => void {
    const release = this.capacity.acquire();
    if (!release) {
      throw new ServiceUnavailableError("附件上傳繁忙中，請稍後再試");
    }
    return release;
  }

  async requireModifiable(user: SessionUser, sheetId: string): Promise<void> {
    await this.sheets.requireAttachmentModifiable(user, sheetId);
  }

  async list(user: SessionUser, sheetId: string, page: number) {
    const access = await this.sheets.attachmentAccess(user, sheetId);
    const offset = (page - 1) * ATTACHMENT_PAGE_SIZE;
    const [items, [total]] = await Promise.all([
      this.db
        .select({
          id: sheetAttachments.id,
          filename: sheetAttachments.originalFilename,
          sizeBytes: sheetAttachments.sizeBytes,
          uploaderId: users.id,
          uploaderDisplayName: users.displayName,
          uploadedAt: sheetAttachments.availableAt,
        })
        .from(sheetAttachments)
        .innerJoin(users, eq(users.id, sheetAttachments.uploadedByUserId))
        .where(
          and(
            eq(sheetAttachments.sheetId, sheetId),
            eq(sheetAttachments.state, "AVAILABLE"),
          ),
        )
        .orderBy(desc(sheetAttachments.availableAt), desc(sheetAttachments.id))
        .limit(ATTACHMENT_PAGE_SIZE)
        .offset(offset),
      this.db
        .select({ value: count() })
        .from(sheetAttachments)
        .where(
          and(
            eq(sheetAttachments.sheetId, sheetId),
            eq(sheetAttachments.state, "AVAILABLE"),
          ),
        ),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        filename: item.filename,
        sizeBytes: item.sizeBytes,
        uploader: {
          id: item.uploaderId,
          displayName: item.uploaderDisplayName,
        },
        uploadedAt: (item.uploadedAt ?? this.now()).toISOString(),
      })),
      page,
      pageSize: ATTACHMENT_PAGE_SIZE as 25,
      total: total?.value ?? 0,
      canModify: access.canModify,
    };
  }

  async upload(
    user: SessionUser,
    sheetId: string,
    idempotencyKey: string,
    file: PreparedAttachmentUpload,
    context: RequestSecurityContext,
  ): Promise<AttachmentUploadResult> {
    await this.sheets.requireAttachmentModifiable(user, sheetId);
    {
      const prior = await this.findMutation(user.id, idempotencyKey);
      if (prior) {
        if (prior.sheetId !== sheetId || prior.action !== "UPLOAD") {
          throw new ConflictError("此操作識別碼已被其他附件操作使用");
        }
        if (prior.status === "COMPLETED" && prior.result) {
          const result = mutationResult<AttachmentUploadResult>(
            prior.result,
            "UPLOAD",
          );
          return { attachment: result.attachment, replayed: true };
        }
        throw new ConflictError(
          prior.status === "PENDING"
            ? "相同的附件上傳仍在處理中"
            : "先前的附件上傳失敗，請重試並使用新的操作識別碼",
        );
      }

      const attachmentId = randomUUID();
      const storageKey = `${this.storagePrefix}/${sheetId}/${randomUUID()}.pdf`;
      const reserved = await this.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(sheetAttachmentMutations)
          .values({
            actorUserId: user.id,
            idempotencyKey,
            sheetId,
            action: "UPLOAD",
          })
          .onConflictDoNothing()
          .returning({ id: sheetAttachmentMutations.id });
        if (inserted.length === 0) return false;
        await tx.insert(sheetAttachments).values({
          id: attachmentId,
          sheetId,
          uploadedByUserId: user.id,
          originalFilename: file.filename,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          storageKey,
        });
        await tx
          .update(sheetAttachmentMutations)
          .set({ attachmentId })
          .where(eq(sheetAttachmentMutations.id, inserted[0]!.id));
        return true;
      });
      if (!reserved) {
        throw new ConflictError("相同的附件操作已由另一個要求處理");
      }

      let storedVersionId: string | null = null;
      try {
        const stored = await this.storage.put({
          key: storageKey,
          sourcePath: file.tempPath,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
        });
        storedVersionId = stored.versionId;
        const now = this.now();
        const result = await this.db.transaction(async (tx) => {
          const [lockedSheet] = await tx
            .select({ id: productionSheets.id })
            .from(productionSheets)
            .where(eq(productionSheets.id, sheetId))
            .for("update")
            .limit(1);
          if (!lockedSheet) throw new ResourceNotFoundError("找不到生產表單");
          const access = await this.sheets.requireAttachmentModifiable(user, sheetId);
          const attachment: SheetAttachmentMetadata = {
            id: attachmentId,
            filename: file.filename,
            sizeBytes: file.sizeBytes,
            uploader: { id: user.id, displayName: user.displayName },
            uploadedAt: now.toISOString(),
          };
          await tx
            .update(sheetAttachments)
            .set({
              state: "AVAILABLE",
              storageVersionId: storedVersionId,
              availableAt: now,
              updatedAt: now,
            })
            .where(eq(sheetAttachments.id, attachmentId));
          await tx.insert(auditEvents).values({
            actorUserId: user.id,
            action: "SHEET_ATTACHMENT_UPLOADED",
            targetType: "SHEET_ATTACHMENT",
            targetId: attachmentId,
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            metadata: {
              sheetId,
              sheetVersion: access.sheetVersion,
              state: access.state,
              filename: file.filename,
              sizeBytes: file.sizeBytes,
              sha256: file.sha256,
              userAgent: context.userAgent,
            },
          });
          const storedResult = { action: "UPLOAD", attachment };
          await tx
            .update(sheetAttachmentMutations)
            .set({ status: "COMPLETED", result: storedResult, updatedAt: now })
            .where(
              and(
                eq(sheetAttachmentMutations.actorUserId, user.id),
                eq(sheetAttachmentMutations.idempotencyKey, idempotencyKey),
              ),
            );
          return attachment;
        });
        return { attachment: result, replayed: false };
      } catch (error) {
        await this.failUpload(
          user.id,
          sheetId,
          attachmentId,
          idempotencyKey,
          storageKey,
          storedVersionId,
          error,
        );
        if (
          error instanceof AuthorizationError ||
          error instanceof ResourceNotFoundError
        ) {
          throw error;
        }
        throw new ServiceUnavailableError("附件暫時無法儲存，請稍後重試");
      }
    }
  }

  async open(
    user: SessionUser,
    sheetId: string,
    attachmentId: string,
    disposition: "inline" | "attachment",
    rangeHeader: string | undefined,
    context: RequestSecurityContext,
  ) {
    const access = await this.sheets.attachmentAccess(user, sheetId);
    const [attachment] = await this.db
      .select()
      .from(sheetAttachments)
      .where(
        and(
          eq(sheetAttachments.id, attachmentId),
          eq(sheetAttachments.sheetId, sheetId),
          eq(sheetAttachments.state, "AVAILABLE"),
        ),
      )
      .limit(1);
    if (!attachment) throw new ResourceNotFoundError("找不到附件");
    const range = parseAttachmentRange(rangeHeader, attachment.sizeBytes);
    try {
      const object = await this.storage.open({
        key: attachment.storageKey,
        versionId: attachment.storageVersionId,
        ...(range ? { range } : {}),
      });
      await this.db.insert(auditEvents).values({
        actorUserId: user.id,
        action:
          disposition === "inline"
            ? "SHEET_ATTACHMENT_PREVIEWED"
            : "SHEET_ATTACHMENT_DOWNLOADED",
        targetType: "SHEET_ATTACHMENT",
        targetId: attachment.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: {
          sheetId,
          sheetVersion: access.sheetVersion,
          state: access.state,
          filename: attachment.originalFilename,
          sizeBytes: attachment.sizeBytes,
          sha256: attachment.sha256,
          userAgent: context.userAgent,
        },
      });
      return { attachment, object, range };
    } catch (error) {
      if (error instanceof ResourceNotFoundError) throw error;
      throw new ServiceUnavailableError("附件內容暫時無法讀取");
    }
  }

  async remove(
    user: SessionUser,
    sheetId: string,
    attachmentId: string,
    idempotencyKey: string,
    context: RequestSecurityContext,
  ): Promise<AttachmentRemovalResult> {
    await this.sheets.requireAttachmentModifiable(user, sheetId);
    return await this.db.transaction(async (tx) => {
      const [lockedSheet] = await tx
        .select({ id: productionSheets.id })
        .from(productionSheets)
        .where(eq(productionSheets.id, sheetId))
        .for("update")
        .limit(1);
      if (!lockedSheet) throw new ResourceNotFoundError("找不到生產表單");
      await this.sheets.requireAttachmentModifiable(user, sheetId);

      const [prior] = await tx
        .select()
        .from(sheetAttachmentMutations)
        .where(
          and(
            eq(sheetAttachmentMutations.actorUserId, user.id),
            eq(sheetAttachmentMutations.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (prior) {
        if (
          prior.sheetId !== sheetId ||
          prior.action !== "REMOVE" ||
          prior.attachmentId !== attachmentId
        ) {
          throw new ConflictError("此操作識別碼已被其他附件操作使用");
        }
        if (prior.status === "COMPLETED" && prior.result) {
          mutationResult(prior.result, "REMOVE");
          return { attachmentId, replayed: true };
        }
        throw new ConflictError("相同的附件移除仍在處理中");
      }

      const [attachment] = await tx
        .select()
        .from(sheetAttachments)
        .where(
          and(
            eq(sheetAttachments.id, attachmentId),
            eq(sheetAttachments.sheetId, sheetId),
            eq(sheetAttachments.state, "AVAILABLE"),
          ),
        )
        .for("update")
        .limit(1);
      if (!attachment) throw new ResourceNotFoundError("找不到附件");
      const now = this.now();
      const storedResult = { action: "REMOVE", attachmentId };
      await tx.insert(sheetAttachmentMutations).values({
        actorUserId: user.id,
        idempotencyKey,
        sheetId,
        attachmentId,
        action: "REMOVE",
        status: "COMPLETED",
        result: storedResult,
        updatedAt: now,
      });
      await tx
        .update(sheetAttachments)
        .set({
          state: "REMOVED",
          removedAt: now,
          removedByUserId: user.id,
          cleanupError: null,
          updatedAt: now,
        })
        .where(eq(sheetAttachments.id, attachmentId));
      await tx.insert(outboxJobs).values({
        jobType: "SHEET_ATTACHMENT_DELETE",
        payload: {
          attachmentId,
          storageKey: attachment.storageKey,
          storageVersionId: attachment.storageVersionId,
        },
        deduplicationKey: `sheet-attachment-delete:${attachmentId}`,
      });
      await tx.insert(auditEvents).values({
        actorUserId: user.id,
        action: "SHEET_ATTACHMENT_REMOVED",
        targetType: "SHEET_ATTACHMENT",
        targetId: attachmentId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: {
          sheetId,
          filename: attachment.originalFilename,
          sizeBytes: attachment.sizeBytes,
          sha256: attachment.sha256,
          userAgent: context.userAgent,
        },
      });
      return { attachmentId, replayed: false };
    });
  }

  private async findMutation(actorUserId: string, idempotencyKey: string) {
    const [mutation] = await this.db
      .select()
      .from(sheetAttachmentMutations)
      .where(
        and(
          eq(sheetAttachmentMutations.actorUserId, actorUserId),
          eq(sheetAttachmentMutations.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return mutation ?? null;
  }

  private async failUpload(
    actorUserId: string,
    sheetId: string,
    attachmentId: string,
    idempotencyKey: string,
    storageKey: string,
    storageVersionId: string | null,
    error: unknown,
  ): Promise<void> {
    const now = this.now();
    await this.db.transaction(async (tx) => {
      await tx
        .update(sheetAttachments)
        .set({
          state: "FAILED_CLEANUP",
          storageVersionId,
          cleanupError: cleanupMessage(error),
          updatedAt: now,
        })
        .where(eq(sheetAttachments.id, attachmentId));
      await tx
        .update(sheetAttachmentMutations)
        .set({
          status: "FAILED",
          result: { action: "UPLOAD", attachmentId, failed: true },
          updatedAt: now,
        })
        .where(
          and(
            eq(sheetAttachmentMutations.actorUserId, actorUserId),
            eq(sheetAttachmentMutations.idempotencyKey, idempotencyKey),
          ),
        );
      await tx
        .insert(outboxJobs)
        .values({
          jobType: "SHEET_ATTACHMENT_DELETE",
          payload: { attachmentId, storageKey, storageVersionId },
          deduplicationKey: `sheet-attachment-delete:${attachmentId}`,
        })
        .onConflictDoNothing();
    });
  }
}
