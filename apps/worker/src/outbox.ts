import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lte,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { pushNotificationJobPayloadSchema } from "@workflow/contracts";
import {
  notificationAttempts,
  notifications,
  outboxJobs,
  pushSubscriptions,
  users,
  type Database,
} from "@workflow/database";
import { PushSendError, type PushClient } from "./push-client.js";

export type ClaimedOutboxJob = {
  id: string;
  jobType: string;
  payload: Record<string, unknown>;
  attempts: number;
};

/**
 * One PUSH notification and the recipient's phones and browsers (the user,
 * 2026-10-04: push replaced LINE).
 */
export type PushDelivery = {
  notificationId: string;
  notificationState: "PENDING" | "DELIVERED" | "FAILED" | "READ";
  recipientActive: boolean;
  summary: string;
  deepLink: string | null;
  devices: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;
};

export interface OutboxRepository {
  claim(workerId: string, batchSize: number, staleAfterMs: number): Promise<ClaimedOutboxJob[]>;
  getPushDelivery(notificationId: string): Promise<PushDelivery | null>;
  /** Devices that took the notice, and devices the push service forgot. */
  recordDevices(deliveredIds: readonly string[], goneIds: readonly string[]): Promise<void>;
  completeAlreadyHandled(job: ClaimedOutboxJob): Promise<void>;
  recordSuccess(job: ClaimedOutboxJob, notificationId: string): Promise<void>;
  recordRetry(
    job: ClaimedOutboxJob,
    notificationId: string,
    retryAt: Date,
    statusCode: number | null,
    error: string,
  ): Promise<void>;
  recordFailure(
    job: ClaimedOutboxJob,
    notificationId: string | null,
    outcome: string,
    statusCode: number | null,
    error: string,
  ): Promise<void>;
  /**
   * Nobody to send to: the recipient has no device with notifications on.
   * The notice is undelivered, but the job is done, not failed: it is not a
   * push fault, and the worker's failure alarm must not count it.
   */
  recordNoDevice(job: ClaimedOutboxJob, notificationId: string): Promise<void>;
}

export class PostgresOutboxRepository implements OutboxRepository {
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
          jobType: outboxJobs.jobType,
          payload: outboxJobs.payload,
          attempts: outboxJobs.attempts,
        })
        .from(outboxJobs)
        .where(
          and(
            eq(outboxJobs.jobType, "PUSH_NOTIFICATION"),
            or(
              and(
                eq(outboxJobs.state, "PENDING"),
                lte(outboxJobs.availableAt, now),
              ),
              and(
                eq(outboxJobs.state, "PROCESSING"),
                or(
                  isNull(outboxJobs.lockedAt),
                  lt(outboxJobs.lockedAt, staleBefore),
                ),
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

  async getPushDelivery(notificationId: string) {
    const [row] = await this.db
      .select({
        notificationId: notifications.id,
        notificationState: notifications.state,
        recipientUserId: notifications.recipientUserId,
        recipientActive: users.active,
        summary: notifications.summary,
        deepLink: notifications.deepLink,
      })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.recipientUserId))
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.channel, "PUSH"),
        ),
      )
      .limit(1);
    if (!row) return null;
    const devices = await this.db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, row.recipientUserId))
      .orderBy(asc(pushSubscriptions.createdAt));
    return {
      notificationId: row.notificationId,
      notificationState: row.notificationState,
      recipientActive: row.recipientActive,
      summary: row.summary,
      deepLink: row.deepLink,
      devices,
    };
  }

  async recordDevices(deliveredIds: readonly string[], goneIds: readonly string[]) {
    const now = this.now();
    if (deliveredIds.length > 0) {
      await this.db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: now, updatedAt: now })
        .where(inArray(pushSubscriptions.id, [...deliveredIds]));
    }
    if (goneIds.length > 0) {
      await this.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, [...goneIds]));
    }
  }

  async completeAlreadyHandled(job: ClaimedOutboxJob) {
    await this.db
      .update(outboxJobs)
      .set({
        state: "COMPLETED",
        completedAt: this.now(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(outboxJobs.id, job.id),
          eq(outboxJobs.state, "PROCESSING"),
          eq(outboxJobs.attempts, job.attempts),
        ),
      );
  }

  async recordSuccess(job: ClaimedOutboxJob, notificationId: string) {
    const now = this.now();
    await this.db.transaction(async (tx) => {
      const [ownedJob] = await tx
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
      if (!ownedJob) return;
      await tx.insert(notificationAttempts).values({
        notificationId,
        attemptNumber: job.attempts,
        outcome: "DELIVERED",
        providerStatusCode: 200,
      });
      await tx
        .update(notifications)
        .set({ state: "DELIVERED", deliveredAt: now })
        .where(eq(notifications.id, notificationId));
    });
  }

  async recordRetry(
    job: ClaimedOutboxJob,
    notificationId: string,
    retryAt: Date,
    statusCode: number | null,
    error: string,
  ) {
    const now = this.now();
    await this.db.transaction(async (tx) => {
      const [ownedJob] = await tx
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
      if (!ownedJob) return;
      await tx.insert(notificationAttempts).values({
        notificationId,
        attemptNumber: job.attempts,
        outcome: "RETRY_SCHEDULED",
        providerStatusCode: statusCode,
        sanitizedError: error,
      });
    });
  }

  async recordFailure(
    job: ClaimedOutboxJob,
    notificationId: string | null,
    outcome: string,
    statusCode: number | null,
    error: string,
  ) {
    const now = this.now();
    await this.db.transaction(async (tx) => {
      const [ownedJob] = await tx
        .update(outboxJobs)
        .set({
          state: "FAILED",
          completedAt: now,
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
      if (!ownedJob) return;
      if (notificationId) {
        await tx.insert(notificationAttempts).values({
          notificationId,
          attemptNumber: job.attempts,
          outcome,
          providerStatusCode: statusCode,
          sanitizedError: error,
        });
        await tx
          .update(notifications)
          .set({ state: "FAILED" })
          .where(eq(notifications.id, notificationId));
      }
    });
  }

  async recordNoDevice(job: ClaimedOutboxJob, notificationId: string) {
    const now = this.now();
    await this.db.transaction(async (tx) => {
      const [ownedJob] = await tx
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
      if (!ownedJob) return;
      await tx.insert(notificationAttempts).values({
        notificationId,
        attemptNumber: job.attempts,
        outcome: "NO_DEVICE",
        sanitizedError: "Recipient has no device with notifications on",
      });
      await tx
        .update(notifications)
        .set({ state: "FAILED" })
        .where(eq(notifications.id, notificationId));
    });
  }
}

export type OutboxProcessorConfig = {
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
};

export class OutboxProcessor {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly pushClient: PushClient,
    private readonly config: OutboxProcessorConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(job: ClaimedOutboxJob): Promise<void> {
    const payload = pushNotificationJobPayloadSchema.safeParse(job.payload);
    if (job.jobType !== "PUSH_NOTIFICATION" || !payload.success) {
      await this.repository.recordFailure(
        job,
        null,
        "INVALID_JOB",
        null,
        "Invalid outbox job payload",
      );
      return;
    }

    const delivery = await this.repository.getPushDelivery(
      payload.data.notificationId,
    );
    if (!delivery) {
      await this.repository.recordFailure(
        job,
        null,
        "MISSING_NOTIFICATION",
        null,
        "Notification no longer exists",
      );
      return;
    }
    if (
      delivery.notificationState === "DELIVERED" ||
      delivery.notificationState === "READ"
    ) {
      await this.repository.completeAlreadyHandled(job);
      return;
    }
    if (delivery.notificationState === "FAILED") {
      await this.repository.recordFailure(
        job,
        delivery.notificationId,
        "ALREADY_FAILED",
        null,
        "Notification is already terminally failed",
      );
      return;
    }
    if (!delivery.recipientActive) {
      await this.repository.recordFailure(
        job,
        delivery.notificationId,
        "RECIPIENT_INACTIVE",
        null,
        "Recipient account is inactive",
      );
      return;
    }
    if (delivery.devices.length === 0) {
      await this.repository.recordNoDevice(job, delivery.notificationId);
      return;
    }

    // Every device the person turned notifications on for. One that takes
    // the notice delivers it; the rest do not hold it back.
    const message = {
      title: "Workflow Portfolio",
      body: delivery.summary,
      url: delivery.deepLink ?? "/notifications",
      tag: delivery.notificationId,
    };
    const delivered: string[] = [];
    const gone: string[] = [];
    let retryable: PushSendError | null = null;
    let terminal: PushSendError | null = null;
    for (const device of delivery.devices) {
      try {
        await this.pushClient.send(device, message);
        delivered.push(device.id);
      } catch (error) {
        const pushError =
          error instanceof PushSendError
            ? error
            : new PushSendError("Unexpected push delivery error", true);
        if (pushError.gone) gone.push(device.id);
        else if (pushError.retryable) retryable = pushError;
        else terminal = pushError;
      }
    }
    await this.repository.recordDevices(delivered, gone);

    if (delivered.length > 0) {
      await this.repository.recordSuccess(job, delivery.notificationId);
      return;
    }
    if (retryable && job.attempts < this.config.maxAttempts) {
      const delay = Math.min(
        this.config.retryBaseMs * 2 ** (job.attempts - 1),
        this.config.retryMaxMs,
      );
      await this.repository.recordRetry(
        job,
        delivery.notificationId,
        new Date(this.now().getTime() + delay),
        retryable.statusCode,
        retryable.message,
      );
      return;
    }
    const reason = retryable ?? terminal;
    if (!reason) {
      // Every device turned out to be gone.
      await this.repository.recordNoDevice(job, delivery.notificationId);
      return;
    }
    await this.repository.recordFailure(
      job,
      delivery.notificationId,
      retryable ? "RETRIES_EXHAUSTED" : "TERMINAL_FAILURE",
      reason.statusCode,
      reason.message,
    );
  }
}
