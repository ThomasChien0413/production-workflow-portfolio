import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AttachmentStorage } from "@workflow/attachment-storage";
import { outboxJobs, sheetAttachments, type Database } from "@workflow/database";

const attachmentDeletePayloadSchema = z
  .object({
    attachmentId: z.string().uuid(),
    storageKey: z.string().min(1),
    storageVersionId: z.string().min(1).nullable(),
  })
  .strict();

export type ClaimedAttachmentDeleteJob = {
  id: string;
  payload: Record<string, unknown>;
  attempts: number;
};

function sanitizedError(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 120) : "UnknownError";
}

export class AttachmentCleanupRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async claim(workerId: string, batchSize: number, staleAfterMs: number) {
    const now = this.now();
    const staleBefore = new Date(now.getTime() - staleAfterMs);
    return await this.db.transaction(async (tx) => {
      const candidates = await tx
        .select({
          id: outboxJobs.id,
          payload: outboxJobs.payload,
          attempts: outboxJobs.attempts,
        })
        .from(outboxJobs)
        .where(
          and(
            eq(outboxJobs.jobType, "SHEET_ATTACHMENT_DELETE"),
            or(
              and(eq(outboxJobs.state, "PENDING"), lte(outboxJobs.availableAt, now)),
              and(
                eq(outboxJobs.state, "PROCESSING"),
                or(isNull(outboxJobs.lockedAt), lt(outboxJobs.lockedAt, staleBefore)),
              ),
            ),
          ),
        )
        .orderBy(asc(outboxJobs.availableAt), asc(outboxJobs.createdAt))
        .limit(batchSize)
        .for("update", { skipLocked: true });
      if (candidates.length === 0) return [];
      await tx
        .update(outboxJobs)
        .set({
          state: "PROCESSING",
          attempts: sql`${outboxJobs.attempts} + 1`,
          lockedAt: now,
          lockedBy: workerId,
          updatedAt: now,
        })
        .where(inArray(outboxJobs.id, candidates.map((job) => job.id)));
      return candidates.map((job) => ({ ...job, attempts: job.attempts + 1 }));
    });
  }

  async success(job: ClaimedAttachmentDeleteJob, attachmentId: string) {
    const now = this.now();
    await this.db.transaction(async (tx) => {
      const [owned] = await tx
        .update(outboxJobs)
        .set({
          state: "COMPLETED",
          completedAt: now,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(outboxJobs.id, job.id),
            eq(outboxJobs.state, "PROCESSING"),
            eq(outboxJobs.attempts, job.attempts),
          ),
        )
        .returning({ id: outboxJobs.id });
      if (!owned) return;
      await tx
        .update(sheetAttachments)
        .set({
          state: "REMOVED",
          deletedAt: now,
          cleanupError: null,
          updatedAt: now,
        })
        .where(eq(sheetAttachments.id, attachmentId));
    });
  }

  async retry(
    job: ClaimedAttachmentDeleteJob,
    attachmentId: string,
    retryAt: Date,
    error: string,
  ) {
    const now = this.now();
    await this.db.transaction(async (tx) => {
      const [owned] = await tx
        .update(outboxJobs)
        .set({
          state: "PENDING",
          availableAt: retryAt,
          lockedAt: null,
          lockedBy: null,
          lastError: error,
          updatedAt: now,
        })
        .where(
          and(
            eq(outboxJobs.id, job.id),
            eq(outboxJobs.state, "PROCESSING"),
            eq(outboxJobs.attempts, job.attempts),
          ),
        )
        .returning({ id: outboxJobs.id });
      if (!owned) return;
      await tx
        .update(sheetAttachments)
        .set({ state: "FAILED_CLEANUP", cleanupError: error, updatedAt: now })
        .where(eq(sheetAttachments.id, attachmentId));
    });
  }

  async invalid(job: ClaimedAttachmentDeleteJob) {
    const now = this.now();
    await this.db
      .update(outboxJobs)
      .set({
        state: "FAILED",
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        lastError: "Invalid attachment deletion payload",
        updatedAt: now,
      })
      .where(
        and(
          eq(outboxJobs.id, job.id),
          eq(outboxJobs.state, "PROCESSING"),
          eq(outboxJobs.attempts, job.attempts),
        ),
      );
  }
}

export class AttachmentCleanupProcessor {
  constructor(
    private readonly repository: AttachmentCleanupRepository,
    private readonly storage: AttachmentStorage,
    private readonly retryBaseMs: number,
    private readonly retryMaxMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(job: ClaimedAttachmentDeleteJob): Promise<"DELETED" | "RETRYING" | "INVALID"> {
    const payload = attachmentDeletePayloadSchema.safeParse(job.payload);
    if (!payload.success) {
      await this.repository.invalid(job);
      return "INVALID";
    }
    try {
      await this.storage.delete({
        key: payload.data.storageKey,
        versionId: payload.data.storageVersionId,
      });
      await this.repository.success(job, payload.data.attachmentId);
      return "DELETED";
    } catch (error) {
      const wait = Math.min(
        this.retryBaseMs * 2 ** Math.min(job.attempts - 1, 20),
        this.retryMaxMs,
      );
      await this.repository.retry(
        job,
        payload.data.attachmentId,
        new Date(this.now().getTime() + wait),
        sanitizedError(error),
      );
      return "RETRYING";
    }
  }
}
