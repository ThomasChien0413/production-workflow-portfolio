import type { FastifyInstance } from "fastify";
import { auditListQuerySchema } from "@workflow/contracts";
import { createAuthGuards } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import type { ApiConfig } from "../config.js";
import type { AuditService } from "./service.js";

export async function registerAuditRoutes(
  app: FastifyInstance,
  authService: AuthService,
  auditService: AuditService,
  config: ApiConfig,
): Promise<void> {
  const guards = createAuthGuards(authService, config);
  const requireAdmin = guards.requireAnyRole("ADMIN");

  app.get(
    "/api/audit",
    { preHandler: [guards.requireSession, requireAdmin] },
    async (request) =>
      await auditService.list(auditListQuerySchema.parse(request.query)),
  );
}
