import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  auditEvents,
  createDatabase,
  notifications,
  outboxJobs,
  pushSubscriptions,
  sessions,
  users,
} from "@workflow/database";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const appOrigin = "http://localhost:3000";

function cookies(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const raw = response.headers["set-cookie"];
  const lines = Array.isArray(raw) ? raw : [typeof raw === "string" ? raw : ""];
  const pairs = lines.flatMap((line) => {
    const pair = line.split(";", 1)[0];
    return pair ? [pair] : [];
  });
  const csrf = pairs.find((pair) => pair.startsWith("workflow_csrf="));
  if (!csrf) throw new Error("CSRF cookie missing");
  return { cookie: pairs.join("; "), csrf: csrf.slice("workflow_csrf=".length) };
}

// Phone and browser push replaced LINE (the user, 2026-10-04).
describe.skipIf(!testDatabaseUrl)("push device routes with PostgreSQL", () => {
  it("registers devices, moves a shared one to whoever signs in, removes them, and tests delivery", async () => {
    const connection = createDatabase(testDatabaseUrl!, 2);
    const suffix = randomUUID().slice(0, 8);
    const password = "push-test-password";
    const userIds: string[] = [];
    const app = await buildApp(
      loadConfig({
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
        APP_ORIGIN: appOrigin,
        WEB_PUSH_VAPID_PUBLIC_KEY: "BPublicVapidKeyForTests",
      }),
    );
    const endpoint = `https://push.example/vitest-${suffix}`;
    const subscription = {
      endpoint,
      keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ", auth: "tBHItJI5svbpez7KI4CCXg" },
      deviceLabel: "Android · Chrome",
    };

    try {
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const inserted = await connection.db
        .insert(users)
        .values(
          ["first", "second"].map((label) => ({
            username: `vitest-push-${label}-${suffix}`,
            displayName: `推播測試 ${label}`,
            passwordHash,
            passwordWarning: false,
          })),
        )
        .returning({ id: users.id, username: users.username });
      userIds.push(...inserted.map((user) => user.id));
      const [first, second] = inserted as [{ id: string; username: string }, { id: string; username: string }];
      const login = async (username: string, secret = password) => {
        const response = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin: appOrigin },
          payload: { username, password: secret },
        });
        expect(response.statusCode).toBe(200);
        return cookies(response);
      };
      const a = await login(first.username);
      const b = await login(second.username);
      const as = (who: { cookie: string; csrf: string }) => ({ origin: appOrigin, cookie: who.cookie, "x-csrf-token": who.csrf });
      const devices = async (who: { cookie: string }) => {
        const response = await app.inject({ method: "GET", url: "/api/push/devices", headers: { cookie: who.cookie } });
        expect(response.statusCode).toBe(200);
        return response.json().devices as Array<Record<string, unknown>>;
      };

      // Signed in, anyone may read the public key; without a session, no.
      const config = await app.inject({ method: "GET", url: "/api/push/config", headers: { cookie: a.cookie } });
      expect(config.json()).toEqual({ publicKey: "BPublicVapidKeyForTests" });
      expect((await app.inject({ method: "GET", url: "/api/push/config" })).statusCode).toBe(401);

      const noCsrf = await app.inject({
        method: "POST",
        url: "/api/push/subscriptions",
        headers: { origin: appOrigin, cookie: a.cookie },
        payload: subscription,
      });
      expect(noCsrf.statusCode).toBe(403);
      const insecure = await app.inject({
        method: "POST",
        url: "/api/push/subscriptions",
        headers: as(a),
        payload: { ...subscription, endpoint: "http://push.example/insecure" },
      });
      expect(insecure.statusCode).toBe(400);

      const added = await app.inject({ method: "POST", url: "/api/push/subscriptions", headers: as(a), payload: subscription });
      expect(added.statusCode).toBe(200);
      expect(added.json()).toMatchObject({ created: true });
      // The browser registers again on every visit: one device, audited once.
      const again = await app.inject({ method: "POST", url: "/api/push/subscriptions", headers: as(a), payload: subscription });
      expect(again.json()).toMatchObject({ created: false, deviceId: added.json().deviceId });
      const listed = await devices(a);
      expect(listed).toEqual([
        expect.objectContaining({ id: added.json().deviceId, deviceLabel: "Android · Chrome", lastSuccessAt: null }),
      ]);
      // The list never hands back the endpoint or keys.
      expect(JSON.stringify(listed)).not.toContain(endpoint);
      expect(JSON.stringify(listed)).not.toContain(subscription.keys.auth);

      // The same browser signed in as someone else now notifies them only.
      const moved = await app.inject({ method: "POST", url: "/api/push/subscriptions", headers: as(b), payload: subscription });
      expect(moved.json()).toMatchObject({ created: false, deviceId: added.json().deviceId });
      expect(await devices(a)).toEqual([]);
      expect(await devices(b)).toHaveLength(1);
      const deviceAudits = await connection.db
        .select({ actor: auditEvents.actorUserId, moved: sql<boolean>`(${auditEvents.metadata} ->> 'movedFromAnotherUser')::boolean` })
        .from(auditEvents)
        .where(and(eq(auditEvents.action, "PUSH_DEVICE_ADDED"), inArray(auditEvents.actorUserId, userIds)));
      expect(deviceAudits.sort((x, y) => Number(x.moved) - Number(y.moved))).toEqual([
        { actor: first.id, moved: false },
        { actor: second.id, moved: true },
      ]);

      // A test push goes to the device only, not into 通知.
      const tested = await app.inject({ method: "POST", url: "/api/push/test", headers: as(b) });
      expect(tested.json()).toEqual({ queued: true });
      const testRows = await connection.db
        .select({ id: notifications.id, channel: notifications.channel, state: notifications.state })
        .from(notifications)
        .where(eq(notifications.recipientUserId, second.id));
      expect(testRows).toEqual([expect.objectContaining({ channel: "PUSH", state: "PENDING" })]);
      const [job] = await connection.db
        .select({ jobType: outboxJobs.jobType })
        .from(outboxJobs)
        .where(sql`${outboxJobs.payload} ->> 'notificationId' = ${testRows[0]!.id}`);
      expect(job).toEqual({ jobType: "PUSH_NOTIFICATION" });

      // Removing is one's own device only.
      const notMine = await app.inject({ method: "POST", url: "/api/push/unsubscribe", headers: as(a), payload: { endpoint } });
      expect(notMine.json()).toEqual({ removed: false });
      const mine = await app.inject({ method: "POST", url: "/api/push/unsubscribe", headers: as(b), payload: { endpoint } });
      expect(mine.json()).toEqual({ removed: true });
      expect(await devices(b)).toEqual([]);

      // Deactivating an account clears its devices.
      await app.inject({ method: "POST", url: "/api/push/subscriptions", headers: as(a), payload: subscription });
      // The seeded admin, with the known bootstrap password.
      const admin = await login("admin", "DemoOnly2026!");
      const deactivated = await app.inject({
        method: "PATCH",
        url: `/api/users/${first.id}`,
        headers: as(admin),
        payload: { active: false, roles: [], memberships: [] },
      });
      expect(deactivated.statusCode).toBe(200);
      expect(
        await connection.db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, first.id)),
      ).toEqual([]);
    } finally {
      await app.close();
      if (userIds.length > 0) {
        const ours = await connection.db
          .select({ id: notifications.id })
          .from(notifications)
          .where(inArray(notifications.recipientUserId, userIds));
        if (ours.length > 0) {
          await connection.db
            .delete(outboxJobs)
            .where(sql`${outboxJobs.payload} ->> 'notificationId' in ${ours.map((row) => row.id)}`);
        }
        await connection.db.delete(auditEvents).where(inArray(auditEvents.targetId, userIds));
        await connection.db.delete(auditEvents).where(inArray(auditEvents.actorUserId, userIds));
        await connection.db.delete(sessions).where(inArray(sessions.userId, userIds));
        await connection.db.delete(users).where(inArray(users.id, userIds));
      }
      await connection.close();
    }
  });
});
