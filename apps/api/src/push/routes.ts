import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  pushSubscriptionRequestSchema,
  pushUnsubscribeRequestSchema,
} from "@workflow/contracts";
import type { ApiConfig } from "../config.js";
import { createAuthGuards } from "../auth/guards.js";
import type { AuthService, RequestSecurityContext } from "../auth/service.js";
import type { NotificationService } from "../notifications/service.js";
import type { PushService } from "./service.js";

function securityContext(request: FastifyRequest): RequestSecurityContext {
  return {
    ipAddress: request.ip ?? null,
    userAgent:
      typeof request.headers["user-agent"] === "string"
        ? request.headers["user-agent"]
        : null,
    requestId: request.id,
  };
}

/** Phone and browser push (the user, 2026-10-04). */
export async function registerPushRoutes(
  app: FastifyInstance,
  authService: AuthService,
  pushService: PushService,
  notificationService: NotificationService,
  config: ApiConfig,
): Promise<void> {
  const guards = createAuthGuards(authService, config);
  const write = [guards.requireSession, guards.requireCsrf];

  // The browser needs the server's public key to subscribe. It is public by
  // design; asking for it still takes a session, like everything else here.
  app.get("/api/push/config", { preHandler: [guards.requireSession] }, async () => ({
    publicKey: config.webPushVapidPublicKey,
  }));

  app.get("/api/push/devices", { preHandler: [guards.requireSession] }, async (request) => ({
    devices: await pushService.listDevices(request.authSession!.user.id),
  }));

  app.post("/api/push/subscriptions", { preHandler: write }, async (request) => {
    const body = pushSubscriptionRequestSchema.parse(request.body);
    return await pushService.subscribe(request.authSession!.user.id, body, securityContext(request));
  });

  app.post("/api/push/unsubscribe", { preHandler: write }, async (request) => {
    const { endpoint } = pushUnsubscribeRequestSchema.parse(request.body);
    return await pushService.unsubscribe(request.authSession!.user.id, endpoint, securityContext(request));
  });

  // A pop-up to check this device works. Push only: it does not belong in 通知.
  app.post(
    "/api/push/test",
    { preHandler: write, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request) => {
      const result = await notificationService.enqueueEvent(
        {
          recipientUserId: request.authSession!.user.id,
          eventType: "PUSH_TEST",
          summary: "這是一則測試通知。看到這則訊息，代表此裝置可以收到 Workflow Portfolio 的通知。",
          deepLink: "/settings",
          deduplicationKey: `push-test:${randomUUID()}`,
        },
        { inApp: false },
      );
      return { queued: result.pushNotificationId !== null };
    },
  );
}
