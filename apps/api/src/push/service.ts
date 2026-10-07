import { and, asc, eq } from "drizzle-orm";
import type { PushDevice, PushSubscriptionRequest } from "@workflow/contracts";
import { auditEvents, pushSubscriptions, type Database } from "@workflow/database";
import type { RequestSecurityContext } from "../auth/service.js";

/**
 * The phones and browsers a person turned notifications on for (the user,
 * 2026-10-04). Push replaced LINE: the worker sends each notification to every
 * device here. A device is identified by its push endpoint, so the same
 * browser registered again by someone else moves to whoever signed in on it
 * last; nobody keeps receiving another person's notices on a shared device.
 */
export class PushService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listDevices(userId: string): Promise<PushDevice[]> {
    const rows = await this.db
      .select({
        id: pushSubscriptions.id,
        deviceLabel: pushSubscriptions.deviceLabel,
        createdAt: pushSubscriptions.createdAt,
        lastSuccessAt: pushSubscriptions.lastSuccessAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(asc(pushSubscriptions.createdAt), asc(pushSubscriptions.id));
    return rows.map((row) => ({
      id: row.id,
      deviceLabel: row.deviceLabel,
      createdAt: row.createdAt.toISOString(),
      lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    }));
  }

  async subscribe(
    userId: string,
    input: PushSubscriptionRequest,
    context: RequestSecurityContext,
  ): Promise<{ deviceId: string; created: boolean }> {
    const now = this.now();
    return await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint))
        .for("update")
        .limit(1);
      const values = {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        deviceLabel: input.deviceLabel ?? null,
        updatedAt: now,
      };
      let deviceId: string;
      if (existing) {
        await tx.update(pushSubscriptions).set(values).where(eq(pushSubscriptions.id, existing.id));
        deviceId = existing.id;
      } else {
        const [created] = await tx
          .insert(pushSubscriptions)
          .values({ ...values, endpoint: input.endpoint })
          .returning({ id: pushSubscriptions.id });
        deviceId = created!.id;
      }
      // Re-registering one's own device (the browser does it on every visit)
      // is not an event worth auditing; a new device or one changing hands is.
      if (!existing || existing.userId !== userId) {
        await tx.insert(auditEvents).values({
          actorUserId: userId,
          action: "PUSH_DEVICE_ADDED",
          targetType: "USER",
          targetId: userId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          metadata: {
            deviceId,
            deviceLabel: input.deviceLabel ?? null,
            movedFromAnotherUser: Boolean(existing),
          },
        });
      }
      return { deviceId, created: !existing };
    });
  }

  async unsubscribe(
    userId: string,
    endpoint: string,
    context: RequestSecurityContext,
  ): Promise<{ removed: boolean }> {
    return await this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
        .returning({ id: pushSubscriptions.id });
      if (removed) {
        await tx.insert(auditEvents).values({
          actorUserId: userId,
          action: "PUSH_DEVICE_REMOVED",
          targetType: "USER",
          targetId: userId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          metadata: { deviceId: removed.id },
        });
      }
      return { removed: Boolean(removed) };
    });
  }
}
