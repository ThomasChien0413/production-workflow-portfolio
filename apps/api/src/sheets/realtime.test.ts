import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import type fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@workflow/contracts";
import {
  AuthenticationError,
  AuthorizationError,
} from "../auth/errors.js";
import { SheetRealtimeHub } from "./realtime.js";

const appOrigin = "http://localhost:3000";
const sessionCookieName = "workflow_session";
const sheetId = "10000000-0000-4000-8000-000000000001";
const departmentId = "20000000-0000-4000-8000-000000000001";

function nextEvent(
  socket: fastifyWebsocket.WebSocket,
  type: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", listener);
      reject(new Error(`Timed out waiting for ${type}`));
    }, 2_000);
    const listener = (data: { toString(): string }) => {
      const event = JSON.parse(data.toString()) as Record<string, unknown>;
      if (event.type !== type) return;
      clearTimeout(timeout);
      socket.off("message", listener);
      resolve(event);
    };
    socket.on("message", listener);
  });
}

function nextClose(socket: fastifyWebsocket.WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket close")),
      2_000,
    );
    socket.once("close", (code: number) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

describe("sheet realtime hub", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("authorizes rooms, validates messages, publishes canonical patches, and closes sessions that are no longer valid", async () => {
    const allowedUser: SessionUser = {
      id: "30000000-0000-4000-8000-000000000001",
      username: "manager",
      displayName: "CUT 主管",
      roles: [],
      memberships: [
        {
          departmentId,
          departmentCode: "CUT",
          departmentName: "CUT",
          kind: "MANAGER",
        },
      ],
      passwordWarning: false,
    };
    const deniedUser: SessionUser = {
      ...allowedUser,
      id: "30000000-0000-4000-8000-000000000002",
      username: "other-manager",
      displayName: "其他主管",
    };
    const usersByToken = new Map([
      ["allowed", allowedUser],
      ["denied", deniedUser],
    ]);
    let allowedUserCanRead = true;
    const authService = {
      async authenticate(token: string) {
        const user = usersByToken.get(token);
        if (!user) throw new AuthenticationError();
        return {
          sessionId: "40000000-0000-4000-8000-000000000001",
          user,
        };
      },
    };
    const sheetService = {
      async realtimeSnapshot(
        user: SessionUser,
        requestedSheetId: string,
        changedFields: readonly string[] = [],
      ) {
        if (
          user.id !== allowedUser.id ||
          requestedSheetId !== sheetId ||
          !allowedUserCanRead
        ) {
          throw new AuthorizationError();
        }
        return {
          sheet: {
            id: sheetId,
            version: 2,
            state: "DRAFT" as const,
            currentDepartmentId: departmentId,
            subpageId: "22222222-2222-4222-8222-222222222222",
            assignedUserId: null,
            dueAt: null,
            updatedAt: "2026-08-10T00:00:00.000Z",
          },
          canonicalValues: Object.fromEntries(
            changedFields.map((fieldKey) => [fieldKey, "canonical"]),
          ),
        };
      },
    };

    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(cookie);
    await app.register(websocket);
    const hub = new SheetRealtimeHub(authService, sheetService, {
      appOrigin,
      sessionCookieName,
    });
    hub.register(app);
    await app.ready();

    let deniedReady!: Promise<Record<string, unknown>>;
    const deniedSocket = await app.injectWS(
      "/api/ws",
      { headers: { cookie: `${sessionCookieName}=denied`, origin: appOrigin } },
      {
        onInit(socket) {
          deniedReady = nextEvent(socket, "connection.ready");
        },
      },
    );
    await deniedReady;
    const accessDenied = nextEvent(deniedSocket, "connection.error");
    deniedSocket.send(JSON.stringify({ type: "sheet.join", sheetId }));
    await expect(accessDenied).resolves.toMatchObject({
      code: "ACCESS_DENIED",
      sheetId,
    });
    deniedSocket.close();

    let allowedReady!: Promise<Record<string, unknown>>;
    const allowedSocket = await app.injectWS(
      "/api/ws",
      { headers: { cookie: `${sessionCookieName}=allowed`, origin: appOrigin } },
      {
        onInit(socket) {
          allowedReady = nextEvent(socket, "connection.ready");
        },
      },
    );
    await allowedReady;

    const invalidMessage = nextEvent(allowedSocket, "connection.error");
    allowedSocket.send(JSON.stringify({ type: "presence.update", sheetId }));
    await expect(invalidMessage).resolves.toMatchObject({
      code: "INVALID_MESSAGE",
    });

    const snapshotEvent = nextEvent(allowedSocket, "sheet.snapshot");
    const presenceEvent = nextEvent(allowedSocket, "presence.snapshot");
    allowedSocket.send(
      JSON.stringify({ type: "sheet.join", sheetId, lastKnownVersion: 1 }),
    );
    await expect(snapshotEvent).resolves.toMatchObject({
      sheetId,
      resyncRequired: true,
      sheet: { version: 2 },
    });
    await expect(presenceEvent).resolves.toMatchObject({
      sheetId,
      participants: [{ id: allowedUser.id, displayName: allowedUser.displayName }],
    });

    const patchEvent = nextEvent(allowedSocket, "sheet.patch.applied");
    await hub.publish(sheetId, "sheet.patch.applied", ["requestDate"]);
    await expect(patchEvent).resolves.toMatchObject({
      sheetId,
      changedFields: ["requestDate"],
      canonicalValues: { requestDate: "canonical" },
      sheet: { version: 2 },
    });

    allowedUserCanRead = false;
    const accessRevoked = nextEvent(allowedSocket, "room.access.revoked");
    await hub.publish(sheetId, "sheet.status.changed");
    await expect(accessRevoked).resolves.toMatchObject({ sheetId });

    allowedUserCanRead = true;
    const rejoinSnapshot = nextEvent(allowedSocket, "sheet.snapshot");
    allowedSocket.send(JSON.stringify({ type: "sheet.join", sheetId }));
    await rejoinSnapshot;

    let policyClose!: Promise<number>;
    policyClose = nextClose(allowedSocket);
    // The session ends (signed out, deactivated): the socket is closed.
    usersByToken.delete("allowed");
    await hub.publish(sheetId, "sheet.status.changed");
    await expect(policyClose).resolves.toBe(1008);
  });
});
