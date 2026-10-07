import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createDatabase,
  departmentMemberships,
  departments,
  notifications,
  outboxJobs,
  productionSheets,
  sheetTemplates,
  sheetTemplateVersions,
  users,
} from "@workflow/database";
import { PostgresOverdueReminderRepository } from "./overdue.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("overdue reminders with PostgreSQL", () => {
  it("notifies the department's active managers once per Taipei date, and no employee", async () => {
    const connection = createDatabase(testDatabaseUrl!, 4);
    const suffix = randomUUID().slice(0, 8);
    const userIds: string[] = [];
    const sheetIds: string[] = [];
    let templateId: string | null = null;

    try {
      const [department] = await connection.db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.active, true))
        .limit(1);
      if (!department) throw new Error("Seeded department is required");
      const departmentId = department.id;

      async function createUser(label: string, active = true) {
        const [user] = await connection.db
          .insert(users)
          .values({
            username: `overdue-${label}-${suffix}`,
            displayName: `逾期測試 ${label}`,
            passwordHash: "not-an-authentication-test",
            passwordWarning: false,
            active,
          })
          .returning({ id: users.id });
        if (!user) throw new Error("Failed to create reminder test user");
        userIds.push(user.id);
        return user.id;
      }

      const employeeId = await createUser("staff");
      const managerOneId = await createUser("manager-one");
      const managerTwoId = await createUser("manager-two");
      const inactiveManagerId = await createUser("inactive-manager", false);
      await connection.db.insert(departmentMemberships).values([
        {
          userId: employeeId,
          departmentId,
          kind: "STAFF",
        },
        {
          userId: managerOneId,
          departmentId,
          kind: "MANAGER",
        },
        {
          userId: managerTwoId,
          departmentId,
          kind: "MANAGER",
        },
        {
          userId: inactiveManagerId,
          departmentId,
          kind: "MANAGER",
        },
      ]);
      // Nobody is assigned (the user, 2026-09-30): reminders go to every
      // active 主管 of the department, who set the 交期, and to no employee.
      // A developer's database has 主管 of its own in whichever department
      // this picks, so they are counted in rather than assumed away; on CI's
      // fresh database there are none.
      const ours = new Set([employeeId, managerOneId, managerTwoId, inactiveManagerId]);
      const otherManagerIds = [
        ...new Set(
          (
            await connection.db
              .select({ userId: departmentMemberships.userId })
              .from(departmentMemberships)
              .innerJoin(users, eq(users.id, departmentMemberships.userId))
              .where(
                and(
                  eq(departmentMemberships.departmentId, departmentId),
                  eq(departmentMemberships.kind, "MANAGER"),
                  eq(departmentMemberships.active, true),
                  eq(users.active, true),
                ),
              )
          )
            .map((row) => row.userId)
            .filter((userId) => !ours.has(userId)),
        ),
      ];
      // Per overdue sheet: one recipient each, one IN_APP and one PUSH
      // notification per recipient.
      const recipientsPerSheet = 2 + otherManagerIds.length;

      const [template] = await connection.db
        .insert(sheetTemplates)
        .values({
          departmentId,
          slug: `overdue-test-${suffix}`,
          displayName: "逾期提醒測試範本",
          active: true,
          currentVersionNumber: 1,
        })
        .returning({ id: sheetTemplates.id });
      if (!template) throw new Error("Failed to create reminder test template");
      templateId = template.id;
      const [templateVersion] = await connection.db
        .insert(sheetTemplateVersions)
        .values({
          templateId,
          version: 1,
          definition: {},
          requiresReview: false,
          publishedByUserId: managerOneId,
          publishedAt: new Date("2026-08-01T00:00:00.000Z"),
        })
        .returning({ id: sheetTemplateVersions.id });
      if (!templateVersion) throw new Error("Failed to create template version");
      const templateVersionId = templateVersion.id;

      async function createSheet(
        label: string,
        state: "READY" | "IN_PROGRESS" | "COMPLETED",
        dueAt: Date,
      ) {
        const [sheet] = await connection.db
          .insert(productionSheets)
          .values({
            sheetNumber: `OVERDUE-${label}-${suffix}`,
            templateVersionId,
            originDepartmentId: departmentId,
            currentDepartmentId: departmentId,
            createdByUserId: managerOneId,
            state,
            dueAt,
            completedAt:
              state === "COMPLETED"
                ? new Date("2026-08-09T12:00:00.000Z")
                : null,
          })
          .returning({ id: productionSheets.id });
        if (!sheet) throw new Error("Failed to create reminder test sheet");
        sheetIds.push(sheet.id);
        return sheet;
      }

      // Waiting to start is as overdue as being worked on.
      const overdueSheet = await createSheet(
        "old",
        "READY",
        new Date("2026-08-09T00:00:00.000Z"),
      );
      const afterCutoffSheet = await createSheet(
        "after-cutoff",
        "IN_PROGRESS",
        new Date("2026-08-10T04:00:00.000Z"),
      );
      await createSheet(
        "completed",
        "COMPLETED",
        new Date("2026-08-09T00:00:00.000Z"),
      );

      const repository = new PostgresOverdueReminderRepository(connection.db);
      const firstCutoff = new Date("2026-08-10T01:00:00.000Z");
      const concurrentRuns = await Promise.all([
        repository.createForCutoff(
          "2026-08-10",
          firstCutoff,
          new Date("2026-08-10T01:00:00.000Z"),
        ),
        repository.createForCutoff(
          "2026-08-10",
          firstCutoff,
          new Date("2026-08-10T06:00:00.000Z"),
        ),
      ]);
      expect(
        concurrentRuns.reduce(
          (total, run) => total + run.notificationsCreated,
          0,
        ),
      ).toBe(2 * recipientsPerSheet);
      expect(
        concurrentRuns.reduce((total, run) => total + run.recipientsCreated, 0),
      ).toBe(recipientsPerSheet);

      const firstDayNotifications = await connection.db
        .select({
          recipientUserId: notifications.recipientUserId,
          channel: notifications.channel,
          eventType: notifications.eventType,
          summary: notifications.summary,
          deepLink: notifications.deepLink,
          state: notifications.state,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.sheetId, overdueSheet.id),
            like(notifications.deduplicationKey, "SHEET_OVERDUE:2026-08-10:%"),
          ),
        );
      expect(firstDayNotifications).toHaveLength(2 * recipientsPerSheet);
      expect(
        new Set(firstDayNotifications.map((row) => row.recipientUserId)),
      ).toEqual(new Set([managerOneId, managerTwoId, ...otherManagerIds]));
      expect(
        firstDayNotifications.every(
          (row) =>
            row.eventType === "SHEET_OVERDUE" &&
            row.summary === "生產單已逾期，請確認目前進度。" &&
            row.deepLink === `/sheets/${overdueSheet.id}` &&
            (row.channel === "PUSH"
              ? row.state === "PENDING"
              : row.state === "DELIVERED"),
        ),
      ).toBe(true);
      const firstDayJobs = await connection.db
        .select({ id: outboxJobs.id })
        .from(outboxJobs)
        .where(
          like(
            outboxJobs.deduplicationKey,
            `SHEET_OVERDUE:2026-08-10:${overdueSheet.id}:%`,
          ),
        );
      expect(firstDayJobs).toHaveLength(recipientsPerSheet);

      const repeated = await repository.createForCutoff(
        "2026-08-10",
        firstCutoff,
        new Date("2026-08-10T08:00:00.000Z"),
      );
      expect(repeated).toMatchObject({
        recipientsCreated: 0,
        notificationsCreated: 0,
      });

      const nextDay = await repository.createForCutoff(
        "2026-08-11",
        new Date("2026-08-11T01:00:00.000Z"),
        new Date("2026-08-11T01:00:00.000Z"),
      );
      expect(nextDay).toMatchObject({
        sheetsScanned: 2,
        recipientsCreated: 2 * recipientsPerSheet,
        notificationsCreated: 4 * recipientsPerSheet,
      });
      const secondSheetNotifications = await connection.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(eq(notifications.sheetId, afterCutoffSheet.id));
      expect(secondSheetNotifications).toHaveLength(2 * recipientsPerSheet);
    } finally {
      for (const sheetId of sheetIds) {
        await connection.db
          .delete(outboxJobs)
          .where(
            like(
              outboxJobs.deduplicationKey,
              `SHEET_OVERDUE:%:${sheetId}:%`,
            ),
          );
      }
      if (sheetIds.length > 0) {
        await connection.db
          .delete(productionSheets)
          .where(inArray(productionSheets.id, sheetIds));
      }
      if (templateId) {
        await connection.db
          .delete(sheetTemplateVersions)
          .where(eq(sheetTemplateVersions.templateId, templateId));
        await connection.db
          .delete(sheetTemplates)
          .where(eq(sheetTemplates.id, templateId));
      }
      if (userIds.length > 0) {
        await connection.db.delete(users).where(inArray(users.id, userIds));
      }
      await connection.close();
    }
  });
});
