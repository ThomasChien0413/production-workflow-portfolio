import {
  and,
  eq,
  inArray,
  isNull,
  lt,
} from "drizzle-orm";
import {
  departmentMemberships,
  notifications,
  outboxJobs,
  productionSheets,
  users,
  type Database,
} from "@workflow/database";

const TAIPEI_TIME_ZONE = "Asia/Taipei";
const REMINDER_HOUR = 9;
// Work is not assigned to a person (the user, 2026-09-30), so a sheet waiting
// to start is as overdue as one in production, and the reminder goes to the
// department's 主管, who set the 交期. ASSIGNED is retired but kept here so a
// sheet no migration reached is still reminded about.
const ACTIVE_OVERDUE_STATES = ["READY", "ASSIGNED", "IN_PROGRESS"] as const;

const taipeiFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TAIPEI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

export type TaipeiReminderWindow = {
  dateKey: string;
  cutoffAt: Date;
  due: boolean;
};

export type OverdueReminderCounts = {
  sheetsScanned: number;
  recipientsCreated: number;
  notificationsCreated: number;
};

export type OverdueReminderRun = OverdueReminderCounts & {
  dateKey: string;
  cutoffAt: Date;
  status: "NOT_DUE" | "ALREADY_SCANNED" | "SCANNED";
};

export interface OverdueReminderRepository {
  createForCutoff(
    dateKey: string,
    cutoffAt: Date,
    observedAt: Date,
  ): Promise<OverdueReminderCounts>;
}

function taipeiParts(now: Date) {
  const values = new Map(
    taipeiFormatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = Number(values.get("hour"));
  if (!year || !month || !day || !Number.isInteger(hour)) {
    throw new Error("Unable to resolve the Asia/Taipei reminder window");
  }
  return { year, month, day, hour };
}

export function getTaipeiReminderWindow(now: Date): TaipeiReminderWindow {
  if (Number.isNaN(now.getTime())) throw new Error("Reminder time must be valid");
  const { year, month, day, hour } = taipeiParts(now);
  const dateKey = `${year}-${month}-${day}`;

  // Taiwan has observed UTC+08:00 without daylight-saving changes since 1979.
  // 09:00 Asia/Taipei is therefore 01:00 UTC for all production dates.
  const cutoffAt = new Date(`${dateKey}T01:00:00.000Z`);
  return { dateKey, cutoffAt, due: hour >= REMINDER_HOUR };
}

export class OverdueReminderProducer {
  private lastSuccessfulDate: string | null = null;

  constructor(
    private readonly repository: OverdueReminderRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runIfDue(at: Date = this.now()): Promise<OverdueReminderRun> {
    const window = getTaipeiReminderWindow(at);
    const emptyCounts: OverdueReminderCounts = {
      sheetsScanned: 0,
      recipientsCreated: 0,
      notificationsCreated: 0,
    };

    if (!window.due) {
      return { ...window, ...emptyCounts, status: "NOT_DUE" };
    }
    if (this.lastSuccessfulDate === window.dateKey) {
      return { ...window, ...emptyCounts, status: "ALREADY_SCANNED" };
    }

    const counts = await this.repository.createForCutoff(
      window.dateKey,
      window.cutoffAt,
      at,
    );
    this.lastSuccessfulDate = window.dateKey;
    return { ...window, ...counts, status: "SCANNED" };
  }
}

export class PostgresOverdueReminderRepository
  implements OverdueReminderRepository
{
  constructor(private readonly db: Database) {}

  async createForCutoff(
    dateKey: string,
    cutoffAt: Date,
    observedAt: Date,
  ): Promise<OverdueReminderCounts> {
    const candidates = await this.db
      .select({ id: productionSheets.id })
      .from(productionSheets)
      .where(
        and(
          inArray(productionSheets.state, ACTIVE_OVERDUE_STATES),
          lt(productionSheets.dueAt, cutoffAt),
          isNull(productionSheets.archivedAt),
        ),
      );

    const totals: OverdueReminderCounts = {
      sheetsScanned: candidates.length,
      recipientsCreated: 0,
      notificationsCreated: 0,
    };

    for (const candidate of candidates) {
      const created = await this.db.transaction(async (tx) => {
        const [sheet] = await tx
          .select({
            id: productionSheets.id,
            currentDepartmentId: productionSheets.currentDepartmentId,
            dueAt: productionSheets.dueAt,
            state: productionSheets.state,
            archivedAt: productionSheets.archivedAt,
          })
          .from(productionSheets)
          .where(eq(productionSheets.id, candidate.id))
          .limit(1)
          .for("update");

        if (
          !sheet ||
          !sheet.dueAt ||
          sheet.dueAt >= cutoffAt ||
          sheet.archivedAt ||
          !ACTIVE_OVERDUE_STATES.includes(
            sheet.state as (typeof ACTIVE_OVERDUE_STATES)[number],
          )
        ) {
          return { recipientsCreated: 0, notificationsCreated: 0 };
        }

        const managerRows = await tx
          .select({ id: users.id })
          .from(departmentMemberships)
          .innerJoin(users, eq(users.id, departmentMemberships.userId))
          .where(
            and(
              eq(
                departmentMemberships.departmentId,
                sheet.currentDepartmentId,
              ),
              eq(departmentMemberships.kind, "MANAGER"),
              eq(departmentMemberships.active, true),
              eq(users.active, true),
            ),
          );
        const recipientIds = new Set(managerRows.map((user) => user.id));

        let recipientsCreated = 0;
        let notificationsCreated = 0;
        for (const recipientUserId of recipientIds) {
          const deduplicationBase =
            `SHEET_OVERDUE:${dateKey}:${sheet.id}:${recipientUserId}`;
          const [inApp] = await tx
            .insert(notifications)
            .values({
              recipientUserId,
              sheetId: sheet.id,
              channel: "IN_APP",
              eventType: "SHEET_OVERDUE",
              summary: "生產單已逾期，請確認目前進度。",
              deepLink: `/sheets/${sheet.id}`,
              state: "DELIVERED",
              deduplicationKey: `${deduplicationBase}:IN_APP`,
              deliveredAt: observedAt,
            })
            .onConflictDoNothing({ target: notifications.deduplicationKey })
            .returning({ id: notifications.id });
          // Pushed to the 主管's phones and browsers (the user, 2026-10-04).
          const [insertedPush] = await tx
            .insert(notifications)
            .values({
              recipientUserId,
              sheetId: sheet.id,
              channel: "PUSH",
              eventType: "SHEET_OVERDUE",
              summary: "生產單已逾期，請確認目前進度。",
              deepLink: `/sheets/${sheet.id}`,
              state: "PENDING",
              deduplicationKey: `${deduplicationBase}:PUSH`,
            })
            .onConflictDoNothing({ target: notifications.deduplicationKey })
            .returning({ id: notifications.id });

          const push = insertedPush ?? (
            await tx
              .select({ id: notifications.id })
              .from(notifications)
              .where(
                eq(
                  notifications.deduplicationKey,
                  `${deduplicationBase}:PUSH`,
                ),
              )
              .limit(1)
          )[0];
          if (push) {
            await tx
              .insert(outboxJobs)
              .values({
                jobType: "PUSH_NOTIFICATION",
                payload: { notificationId: push.id },
                deduplicationKey: `${deduplicationBase}:PUSH_JOB`,
              })
              .onConflictDoNothing({ target: outboxJobs.deduplicationKey });
          }

          const createdForRecipient =
            Number(Boolean(inApp)) + Number(Boolean(insertedPush));
          if (createdForRecipient > 0) recipientsCreated += 1;
          notificationsCreated += createdForRecipient;
        }

        return { recipientsCreated, notificationsCreated };
      });
      totals.recipientsCreated += created.recipientsCreated;
      totals.notificationsCreated += created.notificationsCreated;
    }

    return totals;
  }
}
