import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabase,
  auditEvents,
  departments,
  notifications,
  outboxJobs,
  productionSheets,
  sessions,
  sheetTemplates,
  sheetTemplateVersions,
  users,
} from "@workflow/database";
import { buildApp } from "../app.js";
import { hashToken } from "../auth/service.js";
import { loadConfig } from "../config.js";
import { NotificationService } from "./service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const appOrigin = "http://localhost:3000";

async function cleanupNotificationTestUsers(): Promise<void> {
  if (!testDatabaseUrl) return;
  const connection = createDatabase(testDatabaseUrl, 1);
  try {
    const rows = await connection.db
      .select({ id: users.id })
      .from(users)
      .where(like(users.username, "vitest-notify-%"));
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return;
    await connection.db.transaction(async (tx) => {
      await tx
        .delete(auditEvents)
        .where(inArray(auditEvents.actorUserId, ids));
      await tx.delete(users).where(inArray(users.id, ids));
    });
  } finally {
    await connection.close();
  }
}

function authCookies(response: {
  headers: Record<string, string | string[] | number | undefined>;
}) {
  const raw = response.headers["set-cookie"];
  const lines = Array.isArray(raw) ? raw : [typeof raw === "string" ? raw : ""];
  const pairs = lines.flatMap((line) => {
    const pair = line.split(";", 1)[0];
    return pair ? [pair] : [];
  });
  const session = pairs.find((pair) => pair.startsWith("workflow_session="));
  const csrf = pairs.find((pair) => pair.startsWith("workflow_csrf="));
  if (!session || !csrf) throw new Error("Authentication cookies missing");
  return {
    cookie: pairs.join("; "),
    sessionToken: session.slice("workflow_session=".length),
    csrf: csrf.slice("workflow_csrf=".length),
  };
}

describe.skipIf(!testDatabaseUrl)("notification routes with PostgreSQL", () => {
  beforeAll(cleanupNotificationTestUsers);
  afterAll(cleanupNotificationTestUsers);

  it("deduplicates creation and enforces notification ownership and ADMIN health access", async () => {
    const connection = createDatabase(testDatabaseUrl!, 2);
    const suffix = randomUUID();
    const deduplicationKey = `vitest-notification-${suffix}`;
    const staffUsername = `vitest-notify-${suffix.slice(0, 8)}`;
    const staffPassword = "notification-test-password";
    let staffId: string | null = null;
    let adminSessionHash: string | null = null;
    const app = await buildApp(
      loadConfig({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
        APP_ORIGIN: appOrigin,
      }),
    );

    try {
      const [admin] = await connection.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, "admin"))
        .limit(1);
      if (!admin) throw new Error("Seeded admin is required");

      const [staff] = await connection.db
        .insert(users)
        .values({
          username: staffUsername,
          displayName: "通知測試員工",
          passwordHash: await argon2.hash(staffPassword, { type: argon2.argon2id }),
          passwordWarning: false,
        })
        .returning({ id: users.id });
      staffId = staff!.id;

      const service = new NotificationService(connection.db);
      const first = await service.enqueueEvent({
        recipientUserId: admin.id,
        eventType: "TEST_NOTIFICATION",
        summary: "通知整合測試",
        deepLink: "/notifications",
        deduplicationKey,
      });
      const duplicate = await service.enqueueEvent({
        recipientUserId: admin.id,
        eventType: "TEST_NOTIFICATION",
        summary: "通知整合測試",
        deepLink: "/notifications",
        deduplicationKey,
      });
      expect(first).toMatchObject({ created: true });
      expect(duplicate).toEqual({
        created: false,
        inAppNotificationId: null,
        pushNotificationId: null,
      });

      const adminLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username: "admin", password: "DemoOnly2026!" },
      });
      expect(adminLogin.statusCode).toBe(200);
      const adminAuth = authCookies(adminLogin);
      adminSessionHash = hashToken(adminAuth.sessionToken);

      const history = await app.inject({
        method: "GET",
        url: "/api/notifications?unreadOnly=true",
        headers: { cookie: adminAuth.cookie },
      });
      expect(history.statusCode).toBe(200);
      expect(history.json().items).toContainEqual(
        expect.objectContaining({
          id: first.inAppNotificationId,
          summary: "通知整合測試",
          readAt: null,
        }),
      );

      const deniedRead = await app.inject({
        method: "PATCH",
        url: `/api/notifications/${first.inAppNotificationId}/read`,
        headers: { origin: appOrigin, cookie: adminAuth.cookie },
      });
      expect(deniedRead.statusCode).toBe(403);

      const markedRead = await app.inject({
        method: "PATCH",
        url: `/api/notifications/${first.inAppNotificationId}/read`,
        headers: {
          origin: appOrigin,
          cookie: adminAuth.cookie,
          "x-csrf-token": adminAuth.csrf,
        },
      });
      expect(markedRead.statusCode).toBe(200);
      expect(markedRead.json().notification.readAt).toBeTruthy();

      const adminHealth = await app.inject({
        method: "GET",
        url: "/api/admin/notifications/health?limit=10",
        headers: { cookie: adminAuth.cookie },
      });
      expect(adminHealth.statusCode).toBe(200);
      expect(adminHealth.json()).toMatchObject({
        pushDevices: expect.objectContaining({ activeUsers: expect.any(Number), usersWithDevice: expect.any(Number), devices: expect.any(Number) }),
        pushDeliveries: expect.any(Object),
        outbox: expect.any(Object),
        recentFailures: expect.any(Array),
      });

      const staffLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username: staffUsername, password: staffPassword },
      });
      expect(staffLogin.statusCode).toBe(200);
      const staffAuth = authCookies(staffLogin);
      const deniedHealth = await app.inject({
        method: "GET",
        url: "/api/admin/notifications/health",
        headers: { cookie: staffAuth.cookie },
      });
      expect(deniedHealth.statusCode).toBe(403);

      const staffHistory = await app.inject({
        method: "GET",
        url: "/api/notifications",
        headers: { cookie: staffAuth.cookie },
      });
      expect(staffHistory.statusCode).toBe(200);
      expect(staffHistory.json().items).not.toContainEqual(
        expect.objectContaining({ id: first.inAppNotificationId }),
      );
    } finally {
      await app.close();
      await connection.db
        .delete(outboxJobs)
        .where(like(outboxJobs.deduplicationKey, `${deduplicationKey}%`));
      await connection.db
        .delete(notifications)
        .where(like(notifications.deduplicationKey, `${deduplicationKey}%`));
      if (adminSessionHash) {
        await connection.db
          .delete(sessions)
          .where(eq(sessions.tokenHash, adminSessionHash));
      }
      if (staffId) {
        await connection.db
          .delete(auditEvents)
          .where(eq(auditEvents.actorUserId, staffId));
        await connection.db.delete(users).where(eq(users.id, staffId));
      }
      await connection.close();
    }
  });

  // Opening a sheet reads its notifications (the user, 2026-10-04).
  it("marks only the reader's own unread notifications about a sheet as read", async () => {
    const connection = createDatabase(testDatabaseUrl!, 2);
    const suffix = randomUUID();
    const deduplicationKey = `vitest-notification-sheet-${suffix}`;
    const staffUsername = `vitest-notify-${suffix.slice(0, 8)}`;
    const staffPassword = "notification-test-password";
    const sheetId = randomUUID();
    let staffId: string | null = null;
    let sheetCreated = false;
    const app = await buildApp(
      loadConfig({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
        APP_ORIGIN: appOrigin,
      }),
    );

    try {
      const [admin] = await connection.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, "admin"))
        .limit(1);
      if (!admin) throw new Error("Seeded admin is required");
      const [warehouse] = await connection.db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.code, "WAREHOUSE"))
        .limit(1);
      const [template] = await connection.db
        .select({ versionId: sheetTemplateVersions.id })
        .from(sheetTemplates)
        .innerJoin(
          sheetTemplateVersions,
          and(
            eq(sheetTemplateVersions.templateId, sheetTemplates.id),
            eq(sheetTemplateVersions.version, sheetTemplates.currentVersionNumber),
          ),
        )
        .where(eq(sheetTemplates.slug, "warehouse-location-intake"))
        .limit(1);
      if (!warehouse || !template) throw new Error("Seeded WAREHOUSE template is required");

      const [staff] = await connection.db
        .insert(users)
        .values({
          username: staffUsername,
          displayName: "通知測試員工",
          passwordHash: await argon2.hash(staffPassword, { type: argon2.argon2id }),
          passwordWarning: false,
        })
        .returning({ id: users.id });
      staffId = staff!.id;
      await connection.db.insert(productionSheets).values({
        id: sheetId,
        sheetNumber: sheetId,
        templateVersionId: template.versionId,
        originDepartmentId: warehouse.id,
        currentDepartmentId: warehouse.id,
        createdByUserId: admin.id,
        state: "READY",
      });
      sheetCreated = true;

      const service = new NotificationService(connection.db);
      const enqueue = (key: string, recipientUserId: string, onSheet: boolean) =>
        service.enqueueEvent({
          recipientUserId,
          sheetId: onSheet ? sheetId : null,
          eventType: "TEST_NOTIFICATION",
          summary: "通知整合測試",
          deepLink: onSheet ? `/sheets/${sheetId}` : "/notifications",
          deduplicationKey: `${deduplicationKey}:${key}`,
        });
      const first = await enqueue("first", staffId, true);
      const second = await enqueue("second", staffId, true);
      const otherSheet = await enqueue("other", staffId, false);
      const someoneElse = await enqueue("admin", admin.id, true);

      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: appOrigin },
        payload: { username: staffUsername, password: staffPassword },
      });
      expect(login.statusCode).toBe(200);
      const auth = authCookies(login);

      const withoutCsrf = await app.inject({
        method: "POST",
        url: `/api/notifications/sheets/${sheetId}/read`,
        headers: { origin: appOrigin, cookie: auth.cookie },
      });
      expect(withoutCsrf.statusCode).toBe(403);
      const malformed = await app.inject({
        method: "POST",
        url: "/api/notifications/sheets/not-a-sheet/read",
        headers: { origin: appOrigin, cookie: auth.cookie, "x-csrf-token": auth.csrf },
      });
      expect(malformed.statusCode).toBe(400);

      const marked = await app.inject({
        method: "POST",
        url: `/api/notifications/sheets/${sheetId}/read`,
        headers: { origin: appOrigin, cookie: auth.cookie, "x-csrf-token": auth.csrf },
      });
      expect(marked.statusCode).toBe(200);
      expect(marked.json().updated).toBe(2);
      // Opening it again finds nothing left to read.
      const again = await app.inject({
        method: "POST",
        url: `/api/notifications/sheets/${sheetId}/read`,
        headers: { origin: appOrigin, cookie: auth.cookie, "x-csrf-token": auth.csrf },
      });
      expect(again.json().updated).toBe(0);

      const unread = await connection.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            like(notifications.deduplicationKey, `${deduplicationKey}%`),
            eq(notifications.channel, "IN_APP"),
            isNull(notifications.readAt),
          ),
        );
      expect(unread.map((row) => row.id).sort()).toEqual(
        [otherSheet.inAppNotificationId, someoneElse.inAppNotificationId].sort(),
      );
      expect(unread.map((row) => row.id)).not.toContain(first.inAppNotificationId);
      expect(unread.map((row) => row.id)).not.toContain(second.inAppNotificationId);
      await connection.db
        .delete(sessions)
        .where(eq(sessions.tokenHash, hashToken(auth.sessionToken)));
    } finally {
      await app.close();
      await connection.db
        .delete(outboxJobs)
        .where(like(outboxJobs.deduplicationKey, `${deduplicationKey}%`));
      await connection.db
        .delete(notifications)
        .where(like(notifications.deduplicationKey, `${deduplicationKey}%`));
      if (sheetCreated) {
        await connection.db.delete(productionSheets).where(eq(productionSheets.id, sheetId));
      }
      if (staffId) {
        await connection.db
          .delete(auditEvents)
          .where(eq(auditEvents.actorUserId, staffId));
        await connection.db.delete(users).where(eq(users.id, staffId));
      }
      await connection.close();
    }
  });
});
