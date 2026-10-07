import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createDepartmentSubpageRequestSchema,
  deleteDepartmentSubpageRequestSchema,
  departmentSubpageItemParamsSchema,
  departmentSubpageParamsSchema,
  replaceSubpageIdentityPermissionsRequestSchema,
  replaceSubpageTemplatesRequestSchema,
  updateDepartmentSubpageRequestSchema,
} from "@workflow/contracts";
import type { ApiConfig } from "../config.js";
import { createAuthGuards } from "../auth/guards.js";
import type { AuthService, RequestSecurityContext } from "../auth/service.js";
import type { DepartmentSubpageService } from "./service.js";
import type { SheetRealtimeHub } from "../sheets/realtime.js";

function securityContext(request: FastifyRequest): RequestSecurityContext {
  return { requestId: request.id, ipAddress: request.ip ?? null, userAgent: request.headers["user-agent"] ?? null };
}

export async function registerDepartmentSubpageRoutes(app: FastifyInstance, authService: AuthService, service: DepartmentSubpageService, realtime: SheetRealtimeHub, config: ApiConfig) {
  const guards = createAuthGuards(authService, config);
  const read = [guards.requireSession];
  const write = [guards.requireSession, guards.requireCsrf];
  app.get("/api/departments/:departmentId/subpages", { preHandler: read }, async (request) => {
    const { departmentId } = departmentSubpageParamsSchema.parse(request.params);
    return service.list(request.authSession!.user, departmentId);
  });
  app.post("/api/departments/:departmentId/subpages", { preHandler: write }, async (request, reply) => {
    const { departmentId } = departmentSubpageParamsSchema.parse(request.params);
    const result = await service.create(request.authSession!.user, departmentId, createDepartmentSubpageRequestSchema.parse(request.body), securityContext(request));
    return reply.code(result.replayed ? 200 : 201).send({ result });
  });
  app.patch("/api/departments/:departmentId/subpages/:subpageId", { preHandler: write }, async (request) => {
    const { departmentId, subpageId } = departmentSubpageItemParamsSchema.parse(request.params);
    return { result: await service.update(request.authSession!.user, departmentId, subpageId, updateDepartmentSubpageRequestSchema.parse(request.body), securityContext(request)) };
  });
  app.put("/api/departments/:departmentId/subpages/:subpageId/identities", { preHandler: write }, async (request) => {
    const { departmentId, subpageId } = departmentSubpageItemParamsSchema.parse(request.params);
    const result = await service.replaceIdentityPermissions(request.authSession!.user, departmentId, subpageId, replaceSubpageIdentityPermissionsRequestSchema.parse(request.body), securityContext(request));
    const sheetIds = await service.sheetIds(subpageId);
    await Promise.all(sheetIds.map((sheetId) => realtime.publish(sheetId, "sheet.permission.changed")));
    return { result };
  });
  app.put("/api/departments/:departmentId/subpages/:subpageId/templates", { preHandler: write }, async (request) => {
    const { departmentId, subpageId } = departmentSubpageItemParamsSchema.parse(request.params);
    return { result: await service.replaceTemplates(request.authSession!.user, departmentId, subpageId, replaceSubpageTemplatesRequestSchema.parse(request.body), securityContext(request)) };
  });
  app.delete("/api/departments/:departmentId/subpages/:subpageId", { preHandler: write }, async (request) => {
    const { departmentId, subpageId } = departmentSubpageItemParamsSchema.parse(request.params);
    return { result: await service.remove(request.authSession!.user, departmentId, subpageId, deleteDepartmentSubpageRequestSchema.parse(request.body), securityContext(request)) };
  });
}
