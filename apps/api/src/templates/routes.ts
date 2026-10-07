import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  publishTemplateVersionRequestSchema,
  saveTemplateVersionRequestSchema,
  templateIdParamsSchema,
  templateVersionParamsSchema,
  updateTemplateActivationRequestSchema,
} from "@workflow/contracts";
import type { ApiConfig } from "../config.js";
import { createAuthGuards } from "../auth/guards.js";
import type { AuthService, RequestSecurityContext } from "../auth/service.js";
import type { TemplateService } from "./service.js";

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

export async function registerTemplateRoutes(
  app: FastifyInstance,
  authService: AuthService,
  templateService: TemplateService,
  config: ApiConfig,
): Promise<void> {
  const guards = createAuthGuards(authService, config);
  const requireAdmin = guards.requireAnyRole("ADMIN");
  const readGuards = [guards.requireSession, requireAdmin];
  const writeGuards = [guards.requireSession, requireAdmin, guards.requireCsrf];

  app.get(
    "/api/admin/templates",
    { preHandler: readGuards },
    async () => ({ templates: await templateService.listForAdministration() }),
  );

  app.get(
    "/api/admin/templates/:templateId",
    { preHandler: readGuards },
    async (request) => {
      const { templateId } = templateIdParamsSchema.parse(request.params);
      return { template: await templateService.getForAdministration(templateId) };
    },
  );

  app.post(
    "/api/admin/templates/:templateId/versions",
    { preHandler: writeGuards },
    async (request, reply) => {
      const auth = request.authSession;
      if (!auth) throw new Error("Authenticated session missing");
      const { templateId } = templateIdParamsSchema.parse(request.params);
      const body = saveTemplateVersionRequestSchema.parse(request.body);
      const result = await templateService.createDraftVersion(
        templateId,
        body,
        auth.user.id,
        securityContext(request),
      );
      return reply.code(201).send({ ...result, requestId: request.id });
    },
  );

  app.put(
    "/api/admin/templates/:templateId/versions/:versionId",
    { preHandler: writeGuards },
    async (request) => {
      const auth = request.authSession;
      if (!auth) throw new Error("Authenticated session missing");
      const { templateId, versionId } = templateVersionParamsSchema.parse(
        request.params,
      );
      const body = saveTemplateVersionRequestSchema.parse(request.body);
      const result = await templateService.replaceDraftVersion(
        templateId,
        versionId,
        body,
        auth.user.id,
        securityContext(request),
      );
      return { ...result, requestId: request.id };
    },
  );

  app.post(
    "/api/admin/templates/:templateId/versions/:versionId/publish",
    { preHandler: writeGuards },
    async (request) => {
      const auth = request.authSession;
      if (!auth) throw new Error("Authenticated session missing");
      const { templateId, versionId } = templateVersionParamsSchema.parse(
        request.params,
      );
      const { active, clientMutationId } =
        publishTemplateVersionRequestSchema.parse(request.body);
      const result = await templateService.publishVersion(
        templateId,
        versionId,
        active,
        clientMutationId,
        auth.user.id,
        securityContext(request),
      );
      return { ...result, requestId: request.id };
    },
  );

  app.patch(
    "/api/admin/templates/:templateId",
    { preHandler: writeGuards },
    async (request) => {
      const auth = request.authSession;
      if (!auth) throw new Error("Authenticated session missing");
      const { templateId } = templateIdParamsSchema.parse(request.params);
      const { active, clientMutationId } =
        updateTemplateActivationRequestSchema.parse(request.body);
      const result = await templateService.setActive(
        templateId,
        active,
        clientMutationId,
        auth.user.id,
        securityContext(request),
      );
      return { ...result, requestId: request.id };
    },
  );
}
