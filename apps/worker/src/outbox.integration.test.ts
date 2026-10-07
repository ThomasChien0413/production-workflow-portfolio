import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  createDatabase,
  notificationAttempts,
  notifications,
  outboxJobs,
  pushSubscriptions,
  users,
} from "@workflow/database";
import { OutboxProcessor, PostgresOutboxRepository } from "./outbox.js";
import { classifyPushFailure } from "./push-client.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("outbox repository with PostgreSQL", () => {
  it("allows only one worker to claim a job and records delivery atomically", async () => {
    const connection = createDatabase(testDatabaseUrl!, 4);
    const suffix = randomUUID();
    let userId: string | null = null;
    let jobId: string | null = null;

    try {
      const [user] = await connection.db
        .insert(users)
        .values({
          username: `vitest-outbox-${suffix.slice(0, 8)}`,
          displayName: "Outbox 測試使用者",
          passwordHash: "not-a-login-test",
          passwordWarning: false,
        })
        .returning({ id: users.id });
      userId = user!.id;
      // Push replaced LINE (the user, 2026-10-04): one phone to send to.
      const [device] = await connection.db
        .insert(pushSubscriptions)
        .values({
          userId,
          endpoint: `https://push.example/vitest-outbox-${suffix}`,
          p256dh: "p256dh-key",
          auth: "auth-key",
          deviceLabel: "測試手機",
        })
        .returning({ id: pushSubscriptions.id });
      const [notification] = await connection.db
        .insert(notifications)
        .values({
          recipientUserId: userId,
          channel: "PUSH",
          eventType: "TEST_OUTBOX",
          summary: "Outbox 整合測試",
          state: "PENDING",
          deduplicationKey: `vitest-outbox-${suffix}:PUSH`,
        })
        .returning({ id: notifications.id });
      const [job] = await connection.db
        .insert(outboxJobs)
        .values({
          jobType: "PUSH_NOTIFICATION",
          payload: { notificationId: notification!.id },
          deduplicationKey: `vitest-outbox-${suffix}:JOB`,
          availableAt: new Date(0),
        })
        .returning({ id: outboxJobs.id });
      jobId = job!.id;

      const repository = new PostgresOutboxRepository(connection.db);
      const [firstClaim, secondClaim] = await Promise.all([
        repository.claim("worker-a", 1, 300_000),
        repository.claim("worker-b", 1, 300_000),
      ]);
      // Only one worker may claim this job. On a database that holds other
      // pending jobs — a developer's, not CI's — the losing worker rightly
      // claims one of those instead, so the property is about this job, and
      // anything else claimed is put back exactly as the claim found it.
      const claimed = [...firstClaim, ...secondClaim];
      const ours = claimed.filter((job) => job.id === jobId);
      const others = claimed.filter((job) => job.id !== jobId);
      if (others.length > 0) {
        await connection.db
          .update(outboxJobs)
          .set({
            state: "PENDING",
            attempts: sql`${outboxJobs.attempts} - 1`,
            lockedAt: null,
            lockedBy: null,
          })
          .where(inArray(outboxJobs.id, others.map((job) => job.id)));
      }
      expect(others.length).toBeLessThanOrEqual(1);
      expect(ours).toHaveLength(1);
      expect(ours[0]).toMatchObject({ id: jobId, attempts: 1 });

      const send = vi.fn().mockResolvedValue(undefined);
      await new OutboxProcessor(
        repository,
        { send },
        { maxAttempts: 3, retryBaseMs: 1_000, retryMaxMs: 10_000 },
      ).process(ours[0]!);

      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0]![0]).toMatchObject({ endpoint: `https://push.example/vitest-outbox-${suffix}` });
      const [savedDevice] = await connection.db
        .select({ lastSuccessAt: pushSubscriptions.lastSuccessAt })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.id, device!.id));
      expect(savedDevice?.lastSuccessAt).toBeInstanceOf(Date);
      const [savedJob] = await connection.db
        .select({ state: outboxJobs.state, attempts: outboxJobs.attempts })
        .from(outboxJobs)
        .where(eq(outboxJobs.id, jobId));
      const [savedNotification] = await connection.db
        .select({
          state: notifications.state,
          deliveredAt: notifications.deliveredAt,
        })
        .from(notifications)
        .where(eq(notifications.id, notification!.id));
      const attempts = await connection.db
        .select({ outcome: notificationAttempts.outcome })
        .from(notificationAttempts)
        .where(eq(notificationAttempts.notificationId, notification!.id));

      expect(savedJob).toEqual({ state: "COMPLETED", attempts: 1 });
      expect(savedNotification).toMatchObject({ state: "DELIVERED" });
      expect(savedNotification?.deliveredAt).toBeInstanceOf(Date);
      expect(attempts).toEqual([{ outcome: "DELIVERED" }]);
    } finally {
      if (jobId) {
        await connection.db.delete(outboxJobs).where(eq(outboxJobs.id, jobId));
      }
      if (userId) {
        await connection.db.delete(users).where(eq(users.id, userId));
      }
      await connection.close();
    }
  });

  it("prevents an expired worker generation from overwriting a newer success", async () => {
    const connection = createDatabase(testDatabaseUrl!, 3);
    const suffix = randomUUID();
    let userId: string | null = null;
    let jobId: string | null = null;

    try {
      const [user] = await connection.db
        .insert(users)
        .values({
          username: `vitest-stale-${suffix.slice(0, 8)}`,
          displayName: "Stale worker 測試使用者",
          passwordHash: "not-a-login-test",
          passwordWarning: false,
        })
        .returning({ id: users.id });
      userId = user!.id;
      const [notification] = await connection.db
        .insert(notifications)
        .values({
          recipientUserId: userId,
          channel: "PUSH",
          eventType: "TEST_STALE_WORKER",
          summary: "Stale worker 整合測試",
          state: "PENDING",
          deduplicationKey: `vitest-stale-${suffix}:PUSH`,
        })
        .returning({ id: notifications.id });
      const [job] = await connection.db
        .insert(outboxJobs)
        .values({
          jobType: "PUSH_NOTIFICATION",
          payload: { notificationId: notification!.id },
          deduplicationKey: `vitest-stale-${suffix}:JOB`,
          availableAt: new Date(0),
        })
        .returning({ id: outboxJobs.id });
      jobId = job!.id;

      const firstTime = new Date();
      const firstRepository = new PostgresOutboxRepository(
        connection.db,
        () => firstTime,
      );
      const [firstGeneration] = await firstRepository.claim(
        "worker-old",
        1,
        300_000,
      );
      expect(firstGeneration?.attempts).toBe(1);

      const secondTime = new Date(firstTime.getTime() + 360_000);
      const secondRepository = new PostgresOutboxRepository(
        connection.db,
        () => secondTime,
      );
      const [secondGeneration] = await secondRepository.claim(
        "worker-new",
        1,
        300_000,
      );
      expect(secondGeneration?.attempts).toBe(2);

      await secondRepository.recordSuccess(
        secondGeneration!,
        notification!.id,
      );
      await firstRepository.recordFailure(
        firstGeneration!,
        notification!.id,
        "STALE_FAILURE",
        503,
        "This stale result must be ignored",
      );

      const [savedJob] = await connection.db
        .select({ state: outboxJobs.state, attempts: outboxJobs.attempts })
        .from(outboxJobs)
        .where(eq(outboxJobs.id, jobId));
      const [savedNotification] = await connection.db
        .select({ state: notifications.state })
        .from(notifications)
        .where(eq(notifications.id, notification!.id));
      const attempts = await connection.db
        .select({ attemptNumber: notificationAttempts.attemptNumber })
        .from(notificationAttempts)
        .where(eq(notificationAttempts.notificationId, notification!.id));

      expect(savedJob).toEqual({ state: "COMPLETED", attempts: 2 });
      expect(savedNotification).toEqual({ state: "DELIVERED" });
      expect(attempts).toEqual([{ attemptNumber: 2 }]);
    } finally {
      if (jobId) {
        await connection.db.delete(outboxJobs).where(eq(outboxJobs.id, jobId));
      }
      if (userId) {
        await connection.db.delete(users).where(eq(users.id, userId));
      }
      await connection.close();
    }
  });

  it("forgets a device the push service says is gone, and closes the job without failing it", async () => {
    const connection = createDatabase(testDatabaseUrl!, 3);
    const suffix = randomUUID();
    let userId: string | null = null;
    let jobId: string | null = null;

    try {
      const [user] = await connection.db
        .insert(users)
        .values({
          username: `vitest-gone-${suffix.slice(0, 8)}`,
          displayName: "Gone device 測試使用者",
          passwordHash: "not-a-login-test",
          passwordWarning: false,
        })
        .returning({ id: users.id });
      userId = user!.id;
      await connection.db.insert(pushSubscriptions).values({
        userId,
        endpoint: `https://push.example/vitest-gone-${suffix}`,
        p256dh: "p256dh-key",
        auth: "auth-key",
      });
      const [notification] = await connection.db
        .insert(notifications)
        .values({
          recipientUserId: userId,
          channel: "PUSH",
          eventType: "TEST_GONE_DEVICE",
          summary: "Gone device 整合測試",
          state: "PENDING",
          deduplicationKey: `vitest-gone-${suffix}:PUSH`,
        })
        .returning({ id: notifications.id });
      const [job] = await connection.db
        .insert(outboxJobs)
        .values({
          jobType: "PUSH_NOTIFICATION",
          payload: { notificationId: notification!.id },
          deduplicationKey: `vitest-gone-${suffix}:JOB`,
          availableAt: new Date(0),
        })
        .returning({ id: outboxJobs.id });
      jobId = job!.id;

      const repository = new PostgresOutboxRepository(connection.db);
      const claimed = await repository.claim(`worker-gone-${suffix}`, 100, 300_000);
      const ours = claimed.find((candidate) => candidate.id === jobId);
      const others = claimed.filter((candidate) => candidate.id !== jobId);
      if (others.length > 0) {
        await connection.db
          .update(outboxJobs)
          .set({ state: "PENDING", attempts: sql`${outboxJobs.attempts} - 1`, lockedAt: null, lockedBy: null })
          .where(inArray(outboxJobs.id, others.map((candidate) => candidate.id)));
      }
      expect(ours).toBeDefined();
      await new OutboxProcessor(
        repository,
        { send: vi.fn().mockRejectedValue(classifyPushFailure(410)) },
        { maxAttempts: 3, retryBaseMs: 1_000, retryMaxMs: 10_000 },
      ).process(ours!);

      expect(
        await connection.db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)),
      ).toEqual([]);
      const [savedJob] = await connection.db
        .select({ state: outboxJobs.state })
        .from(outboxJobs)
        .where(eq(outboxJobs.id, jobId));
      const [savedNotification] = await connection.db
        .select({ state: notifications.state })
        .from(notifications)
        .where(eq(notifications.id, notification!.id));
      const attempts = await connection.db
        .select({ outcome: notificationAttempts.outcome })
        .from(notificationAttempts)
        .where(eq(notificationAttempts.notificationId, notification!.id));
      // Not a push fault: the job completes, so the failure alarm stays quiet.
      expect(savedJob).toEqual({ state: "COMPLETED" });
      expect(savedNotification).toEqual({ state: "FAILED" });
      expect(attempts).toEqual([{ outcome: "NO_DEVICE" }]);
    } finally {
      if (jobId) {
        await connection.db.delete(outboxJobs).where(eq(outboxJobs.id, jobId));
      }
      if (userId) {
        await connection.db.delete(users).where(eq(users.id, userId));
      }
      await connection.close();
    }
  });
});
