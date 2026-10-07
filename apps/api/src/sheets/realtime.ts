import { randomUUID } from "node:crypto";
import type fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  sheetRealtimeClientMessageSchema,
  sheetRealtimeServerEventSchema,
  type SessionUser,
  type SheetRealtimeClientMessage,
} from "@workflow/contracts";
import {
  AuthenticationError,
  AuthorizationError,
  ResourceNotFoundError,
} from "../auth/errors.js";
import type { AuthService } from "../auth/service.js";
import type { ApiConfig } from "../config.js";
import type { SheetService } from "./service.js";

const MAX_CLIENT_MESSAGE_BYTES = 8 * 1024;

type RealtimeSocket = fastifyWebsocket.WebSocket;

type SheetMutationEventType =
  | "sheet.patch.applied"
  | "sheet.status.changed"
  | "sheet.assignment.changed"
  | "sheet.approval.changed"
  | "sheet.subpage.changed"
  | "sheet.permission.changed"
  | "sheet.attachment.changed";

type Connection = {
  id: string;
  socket: RealtimeSocket;
  sessionToken: string;
  user: SessionUser | null;
  rooms: Set<string>;
  logError: (error: unknown, message: string) => void;
};

export class SheetRealtimeHub {
  private readonly rooms = new Map<string, Map<string, Connection>>();

  constructor(
    private readonly authService: Pick<AuthService, "authenticate">,
    private readonly sheetService: Pick<SheetService, "realtimeSnapshot">,
    private readonly config: Pick<
      ApiConfig,
      "appOrigin" | "sessionCookieName"
    >,
  ) {}

  register(app: FastifyInstance): void {
    app.get("/api/ws", { websocket: true }, (socket, request) => {
      this.accept(socket, request);
    });
  }

  async publish(
    sheetId: string,
    type: SheetMutationEventType,
    changedFields: readonly string[] = [],
  ): Promise<void> {
    const connections = [...(this.rooms.get(sheetId)?.values() ?? [])];
    await Promise.all(
      connections.map(async (connection) => {
        try {
          const user = await this.reauthenticate(connection);
          const snapshot = await this.sheetService.realtimeSnapshot(
            user,
            sheetId,
            type === "sheet.patch.applied" ? changedFields : [],
          );
          if (type === "sheet.patch.applied") {
            this.send(connection, {
              type,
              sheetId,
              sheet: snapshot.sheet,
              changedFields: [...changedFields],
              canonicalValues: snapshot.canonicalValues,
            });
          } else {
            this.send(connection, {
              type,
              sheetId,
              sheet: snapshot.sheet,
            });
          }
        } catch (error) {
          this.handleOutboundAccessFailure(connection, sheetId, error);
        }
      }),
    );
  }

  private accept(socket: RealtimeSocket, request: FastifyRequest): void {
    const origin = request.headers.origin?.replace(/\/$/, "");
    if (origin && origin !== this.config.appOrigin) {
      socket.close(1008, "Origin not allowed");
      return;
    }

    const sessionToken = request.cookies[this.config.sessionCookieName];
    if (!sessionToken) {
      socket.close(1008, "Authentication required");
      return;
    }

    const connection: Connection = {
      id: randomUUID(),
      socket,
      sessionToken,
      user: null,
      rooms: new Set(),
      logError: (error, message) => request.log.error({ err: error }, message),
    };

    socket.on("message", (data: { toString(): string }) => {
      void this.handleMessage(connection, data.toString());
    });
    socket.once("close", () => this.disconnect(connection));
    socket.on("error", (error: Error) => {
      connection.logError(error, "Sheet WebSocket error");
    });

    void this.initialize(connection);
  }

  private async initialize(connection: Connection): Promise<void> {
    try {
      await this.reauthenticate(connection);
      this.send(connection, { type: "connection.ready" });
    } catch {
      this.closeForPolicy(connection, "Authentication required");
    }
  }

  private async handleMessage(
    connection: Connection,
    rawMessage: string,
  ): Promise<void> {
    if (Buffer.byteLength(rawMessage, "utf8") > MAX_CLIENT_MESSAGE_BYTES) {
      this.sendError(
        connection,
        "INVALID_MESSAGE",
        "即時連線訊息超過 8 KiB 限制。",
      );
      return;
    }
    if (!connection.user) {
      this.sendError(connection, "NOT_READY", "即時連線尚未完成驗證。");
      return;
    }

    let input: unknown;
    try {
      input = JSON.parse(rawMessage);
    } catch {
      this.sendError(connection, "INVALID_MESSAGE", "即時連線訊息不是有效 JSON。");
      return;
    }
    const parsed = sheetRealtimeClientMessageSchema.safeParse(input);
    if (!parsed.success) {
      this.sendError(connection, "INVALID_MESSAGE", "即時連線訊息格式不正確。");
      return;
    }

    try {
      const user = await this.reauthenticate(connection);
      if (parsed.data.type === "sheet.join") {
        await this.join(connection, user, parsed.data);
      } else {
        this.leaveRequested(connection, parsed.data.sheetId);
      }
    } catch (error) {
      if (error instanceof AuthenticationError) {
        this.closeForPolicy(connection, "Authentication required");
        return;
      }
      if (
        error instanceof AuthorizationError ||
        error instanceof ResourceNotFoundError
      ) {
        this.sendError(
          connection,
          "ACCESS_DENIED",
          "沒有權限加入此生產單的即時連線。",
          parsed.data.sheetId,
        );
        return;
      }
      connection.logError(error, "Failed to process sheet WebSocket message");
      this.sendError(connection, "INTERNAL_ERROR", "即時連線暫時無法處理要求。");
    }
  }

  private async join(
    connection: Connection,
    user: SessionUser,
    message: Extract<SheetRealtimeClientMessage, { type: "sheet.join" }>,
  ): Promise<void> {
    const snapshot = await this.sheetService.realtimeSnapshot(
      user,
      message.sheetId,
    );
    let room = this.rooms.get(message.sheetId);
    if (!room) {
      room = new Map();
      this.rooms.set(message.sheetId, room);
    }
    const alreadyJoined = room.has(connection.id);
    const userWasPresent = this.hasUser(room, user.id);
    room.set(connection.id, connection);
    connection.rooms.add(message.sheetId);

    const resyncRequired =
      (message.lastKnownVersion !== undefined &&
        message.lastKnownVersion !== snapshot.sheet.version) ||
      (message.lastKnownUpdatedAt !== undefined &&
        message.lastKnownUpdatedAt !== snapshot.sheet.updatedAt);
    this.send(connection, {
      type: "sheet.snapshot",
      sheetId: message.sheetId,
      sheet: snapshot.sheet,
      resyncRequired,
    });
    this.send(connection, {
      type: "presence.snapshot",
      sheetId: message.sheetId,
      participants: this.participants(room),
    });

    if (!alreadyJoined && !userWasPresent) {
      this.broadcastPresenceChanged(message.sheetId, "JOINED", user);
    }
  }

  private leaveRequested(connection: Connection, sheetId: string): void {
    if (!connection.rooms.has(sheetId)) {
      this.sendError(
        connection,
        "NOT_IN_ROOM",
        "此連線尚未加入指定的生產單。",
        sheetId,
      );
      return;
    }
    this.removeFromRoom(connection, sheetId);
  }

  private disconnect(connection: Connection): void {
    // removeFromRoom deletes from connection.rooms, so iterate a copy.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const sheetId of [...connection.rooms]) {
      this.removeFromRoom(connection, sheetId);
    }
  }

  private removeFromRoom(connection: Connection, sheetId: string): void {
    const room = this.rooms.get(sheetId);
    if (!room) {
      connection.rooms.delete(sheetId);
      return;
    }
    const user = connection.user;
    room.delete(connection.id);
    connection.rooms.delete(sheetId);
    if (room.size === 0) {
      this.rooms.delete(sheetId);
      return;
    }
    if (user && !this.hasUser(room, user.id)) {
      this.broadcastPresenceChanged(sheetId, "LEFT", user);
    }
  }

  private broadcastPresenceChanged(
    sheetId: string,
    action: "JOINED" | "LEFT",
    user: SessionUser,
  ): void {
    const room = this.rooms.get(sheetId);
    if (!room) return;
    const event = {
      type: "presence.changed",
      sheetId,
      action,
      user: { id: user.id, displayName: user.displayName },
      participants: this.participants(room),
    } as const;
    for (const connection of room.values()) this.send(connection, event);
  }

  private participants(room: Map<string, Connection>) {
    const byUserId = new Map<string, { id: string; displayName: string }>();
    for (const connection of room.values()) {
      if (!connection.user) continue;
      byUserId.set(connection.user.id, {
        id: connection.user.id,
        displayName: connection.user.displayName,
      });
    }
    return [...byUserId.values()].sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName, "zh-Hant") ||
        left.id.localeCompare(right.id),
    );
  }

  private hasUser(room: Map<string, Connection>, userId: string): boolean {
    return [...room.values()].some(
      (connection) => connection.user?.id === userId,
    );
  }

  private async reauthenticate(connection: Connection): Promise<SessionUser> {
    const auth = await this.authService.authenticate(connection.sessionToken);
    connection.user = auth.user;
    return auth.user;
  }

  private handleOutboundAccessFailure(
    connection: Connection,
    sheetId: string,
    error: unknown,
  ): void {
    if (error instanceof AuthenticationError) {
      this.closeForPolicy(connection, "Authentication required");
      return;
    }
    if (
      error instanceof AuthorizationError ||
      error instanceof ResourceNotFoundError
    ) {
      this.send(connection, { type: "room.access.revoked", sheetId });
      this.removeFromRoom(connection, sheetId);
      return;
    }
    connection.logError(error, "Failed to publish sheet WebSocket event");
    this.sendError(connection, "INTERNAL_ERROR", "即時更新暫時傳送失敗。", sheetId);
  }

  private closeForPolicy(connection: Connection, reason: string): void {
    if (connection.socket.readyState <= 1) {
      connection.socket.close(1008, reason);
    } else {
      this.disconnect(connection);
    }
  }

  private sendError(
    connection: Connection,
    code:
      | "NOT_READY"
      | "INVALID_MESSAGE"
      | "ACCESS_DENIED"
      | "NOT_IN_ROOM"
      | "INTERNAL_ERROR",
    message: string,
    sheetId?: string,
  ): void {
    this.send(connection, {
      type: "connection.error",
      code,
      message,
      ...(sheetId ? { sheetId } : {}),
    });
  }

  private send(
    connection: Connection,
    event: Record<string, unknown>,
  ): void {
    if (connection.socket.readyState !== 1) return;
    const payload = sheetRealtimeServerEventSchema.parse({
      schemaVersion: 1,
      eventId: randomUUID(),
      serverTimestamp: new Date().toISOString(),
      ...event,
    });
    connection.socket.send(JSON.stringify(payload));
  }
}
