import type { FastifyInstance } from "fastify";
import {
  notificationHealthQuerySchema,
  notificationIdParamsSchema,
  notificationListQuerySchema,
  notificationSheetParamsSchema,
} from "@workflow/contracts";
import type { ApiConfig } from "../config.js";
import { createAuthGuards } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import type { NotificationService } from "./service.js";

export async function registerNotificationRoutes(
  app: FastifyInstance,
  authService: AuthService,
  notificationService: NotificationService,
  config: ApiConfig,
): Promise<void> {
  const guards = createAuthGuards(authService, config);
  const requireAdmin = guards.requireAnyRole("ADMIN");

  app.get(
    "/api/notifications",
    { preHandler: [guards.requireSession] },
    async (request) => {
      const auth = request.authSession;
      if (!auth) throw new Error("Authenticated session missing");
      const query = notificationListQuerySchema.parse(request.query);
      return await notificationService.listForUser(auth.user.id, query);
    },
  );

  app.patch(
    "/api/notifications/:notificationId/read",
    { preHandler: [guards.requireSession, guards.requireCsrf] },
    async (request) => {
      const auth = request.authSession;
      if (!auth) throw new Error("Authenticated session missing");
      const { notificationId } = notificationIdParamsSchema.parse(request.params);
      return {
        notification: await notificationService.markRead(
          auth.user.id,
          notificationId,
        ),
        requestId: request.id,
      };
    },
  );

  app.post(
    "/api/notifications/read-all",
    { preHandler: [guards.requireSession, guards.requireCsrf] },
    async (request) => {
      const auth = request.authSession;
      if (!auth) throw new Error("Authenticated session missing");
      return {
        ...(await notificationService.markAllRead(auth.user.id)),
        requestId: request.id,
      };
    },
  );

  app.post(
    "/api/notifications/sheets/:sheetId/read",
    { preHandler: [guards.requireSession, guards.requireCsrf] },
    async (request) => {
      const auth = request.authSession;
      if (!auth) throw new Error("Authenticated session missing");
      const { sheetId } = notificationSheetParamsSchema.parse(request.params);
      return {
        ...(await notificationService.markSheetRead(auth.user.id, sheetId)),
        requestId: request.id,
      };
    },
  );

  app.get(
    "/api/admin/notifications/health",
    { preHandler: [guards.requireSession, requireAdmin] },
    async (request) => {
      const query = notificationHealthQuerySchema.parse(request.query);
      return await notificationService.getAdminHealth(query.limit);
    },
  );
}
