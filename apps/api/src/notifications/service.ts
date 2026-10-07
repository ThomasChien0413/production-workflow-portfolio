import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type {
  NotificationEventInput,
  NotificationListQuery,
} from "@workflow/contracts";
import {
  notificationAttempts,
  notifications,
  outboxJobs,
  pushSubscriptions,
  users,
  type Database,
} from "@workflow/database";
import { ResourceNotFoundError } from "../auth/errors.js";

function stateCounts<TState extends string>(
  states: ReadonlyArray<TState>,
  rows: ReadonlyArray<{ state: TState; count: number }>,
): Record<TState, number> {
  const counts = Object.fromEntries(states.map((state) => [state, 0])) as Record<
    TState,
    number
  >;
  for (const row of rows) counts[row.state] = row.count;
  return counts;
}

export class NotificationService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listForUser(userId: string, query: NotificationListQuery) {
    const conditions = [
      eq(notifications.recipientUserId, userId),
      eq(notifications.channel, "IN_APP"),
    ];
    if (query.unreadOnly) conditions.push(isNull(notifications.readAt));

    const where = and(...conditions);
    const [items, totalRows, unreadRows] = await Promise.all([
      this.db
        .select({
          id: notifications.id,
          sheetId: notifications.sheetId,
          eventType: notifications.eventType,
          summary: notifications.summary,
          deepLink: notifications.deepLink,
          state: notifications.state,
          deliveredAt: notifications.deliveredAt,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(notifications).where(where),
      this.db
        .select({ value: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientUserId, userId),
            eq(notifications.channel, "IN_APP"),
            isNull(notifications.readAt),
          ),
        ),
    ]);

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: totalRows[0]?.value ?? 0,
      unread: unreadRows[0]?.value ?? 0,
    };
  }

  async markRead(userId: string, notificationId: string) {
    const now = this.now();
    const [updated] = await this.db
      .update(notifications)
      .set({ readAt: now, state: "READ" })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientUserId, userId),
          eq(notifications.channel, "IN_APP"),
        ),
      )
      .returning({ id: notifications.id, readAt: notifications.readAt });

    if (!updated) throw new ResourceNotFoundError("找不到通知");
    return updated;
  }

  async markAllRead(userId: string) {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: this.now(), state: "READ" })
      .where(
        and(
          eq(notifications.recipientUserId, userId),
          eq(notifications.channel, "IN_APP"),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return { updated: rows.length };
  }

  /**
   * Opening a sheet reads every unread notification about it (the user,
   * 2026-10-04), so 通知 stops calling something 未讀 that was already looked at.
   * Only the reader's own notifications change, and an already-read one keeps
   * the time it was first read.
   */
  async markSheetRead(userId: string, sheetId: string) {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: this.now(), state: "READ" })
      .where(
        and(
          eq(notifications.recipientUserId, userId),
          eq(notifications.sheetId, sheetId),
          eq(notifications.channel, "IN_APP"),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return { updated: rows.length };
  }

  /**
   * Push delivery health for ADMIN (the user, 2026-10-04; it was LINE's):
   * how many active people have a device with notifications on, how pushes
   * fared, the delivery queue, and the latest failures.
   */
  async getAdminHealth(recentFailureLimit: number) {
    const [[people], [devices], deliveryCounts, outboxCounts, recentFailures] =
      await Promise.all([
        this.db
          .select({
            activeUsers: count(),
            usersWithDevice: sql<number>`count(*) filter (where exists (
              select 1 from ${pushSubscriptions}
              where ${pushSubscriptions.userId} = ${users.id}
            ))::int`,
          })
          .from(users)
          .where(eq(users.active, true)),
        this.db.select({ value: count() }).from(pushSubscriptions),
        this.db
          .select({ state: notifications.state, count: count() })
          .from(notifications)
          .where(eq(notifications.channel, "PUSH"))
          .groupBy(notifications.state),
        this.db
          .select({ state: outboxJobs.state, count: count() })
          .from(outboxJobs)
          .where(eq(outboxJobs.jobType, "PUSH_NOTIFICATION"))
          .groupBy(outboxJobs.state),
        this.db
          .select({
            notificationId: notifications.id,
            recipientUserId: notifications.recipientUserId,
            recipientUsername: users.username,
            recipientDisplayName: users.displayName,
            eventType: notifications.eventType,
            summary: notifications.summary,
            createdAt: notifications.createdAt,
            lastAttemptAt: sql<Date | null>`max(${notificationAttempts.createdAt})`,
            lastOutcome: sql<string | null>`(array_agg(${notificationAttempts.outcome} order by ${notificationAttempts.createdAt} desc))[1]`,
          })
          .from(notifications)
          .innerJoin(users, eq(users.id, notifications.recipientUserId))
          .leftJoin(
            notificationAttempts,
            eq(notificationAttempts.notificationId, notifications.id),
          )
          .where(
            and(
              eq(notifications.channel, "PUSH"),
              eq(notifications.state, "FAILED"),
            ),
          )
          .groupBy(notifications.id, users.id)
          .orderBy(desc(notifications.createdAt))
          .limit(recentFailureLimit),
      ]);

    return {
      generatedAt: this.now(),
      pushDevices: {
        activeUsers: people?.activeUsers ?? 0,
        usersWithDevice: people?.usersWithDevice ?? 0,
        devices: devices?.value ?? 0,
      },
      pushDeliveries: stateCounts(
        ["PENDING", "DELIVERED", "FAILED", "READ"],
        deliveryCounts,
      ),
      outbox: stateCounts(
        ["PENDING", "PROCESSING", "COMPLETED", "FAILED"],
        outboxCounts,
      ),
      recentFailures,
    };
  }

  /**
   * Records a notice in 通知 and queues it for the recipient's phones and
   * browsers (the user, 2026-10-04). Both rows and the delivery job are one
   * transaction, deduplicated by key. `inApp: false` pushes without a 通知
   * entry, for the device test.
   */
  async enqueueEvent(input: NotificationEventInput, options: { inApp: boolean } = { inApp: true }) {
    const now = this.now();
    return await this.db.transaction(async (tx) => {
      const [inApp] = options.inApp
        ? await tx
            .insert(notifications)
            .values({
              recipientUserId: input.recipientUserId,
              sheetId: input.sheetId ?? null,
              channel: "IN_APP",
              eventType: input.eventType,
              summary: input.summary,
              deepLink: input.deepLink ?? null,
              state: "DELIVERED",
              deduplicationKey: `${input.deduplicationKey}:IN_APP`,
              deliveredAt: now,
            })
            .onConflictDoNothing({ target: notifications.deduplicationKey })
            .returning({ id: notifications.id })
        : [];

      const [push] = await tx
        .insert(notifications)
        .values({
          recipientUserId: input.recipientUserId,
          sheetId: input.sheetId ?? null,
          channel: "PUSH",
          eventType: input.eventType,
          summary: input.summary,
          deepLink: input.deepLink ?? null,
          state: "PENDING",
          deduplicationKey: `${input.deduplicationKey}:PUSH`,
        })
        .onConflictDoNothing({ target: notifications.deduplicationKey })
        .returning({ id: notifications.id });

      if (push) {
        await tx.insert(outboxJobs).values({
          jobType: "PUSH_NOTIFICATION",
          payload: { notificationId: push.id },
          deduplicationKey: `${input.deduplicationKey}:PUSH_JOB`,
        });
      }

      return {
        created: Boolean(inApp || push),
        inAppNotificationId: inApp?.id ?? null,
        pushNotificationId: push?.id ?? null,
      };
    });
  }
}
