import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  adminRoleCatalog,
  adminUserIdParamsSchema,
  adminUserListQuerySchema,
  createAdminUserRequestSchema,
  resetAdminUserPasswordRequestSchema,
  updateAdminUserRequestSchema,
} from "@workflow/contracts";
import type { ApiConfig } from "../config.js";
import { createAuthGuards } from "../auth/guards.js";
import type { AuthService, RequestSecurityContext } from "../auth/service.js";
import type { AdminUserService } from "./service.js";

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

export async function registerAdminRoutes(
  app: FastifyInstance,
  authService: AuthService,
  adminUserService: AdminUserService,
  config: ApiConfig,
): Promise<void> {
  const guards = createAuthGuards(authService, config);
  /**
   * Account management is available to ADMIN and 總經理.
   *
   * `AGENTS.md` §5 originally reserved it to ADMIN alone; the user extended it
   * to 總經理 on 2026-08-08. Everything else stays as it was — the singleton
   * role rules, session revocation on permission change, and the protections
   * that stop an account manager disabling themselves.
   */
  const requireAccountManager = guards.requireAnyRole("ADMIN", "GENERAL_MANAGER");
  const readGuards = [guards.requireSession, requireAccountManager];
  const writeGuards = [
    guards.requireSession,
    requireAccountManager,
    guards.requireCsrf,
  ];

  app.get("/api/users", { preHandler: readGuards }, async (request) => {
    const query = adminUserListQuerySchema.parse(request.query);
    return { users: await adminUserService.listUsers(query) };
  });

  app.get("/api/users/:userId", { preHandler: readGuards }, async (request) => {
    const { userId } = adminUserIdParamsSchema.parse(request.params);
    return { user: await adminUserService.getUser(userId) };
  });

  app.get("/api/roles", { preHandler: readGuards }, async () => ({
    roles: adminRoleCatalog,
  }));

  /**
   * The six department names are company-wide navigation, not privileged data —
   * they are seeded constants listed in AGENTS.md §2. Any signed-in user needs
   * them for the home screen, so this requires only a session. Everything about
   * *people* in a department stays behind the account-manager guard above.
   */
  app.get(
    "/api/departments",
    { preHandler: [guards.requireSession] },
    async () => ({ departments: await adminUserService.listDepartments() }),
  );

  app.post("/api/users", { preHandler: writeGuards }, async (request, reply) => {
    const auth = request.authSession;
    if (!auth) throw new Error("Authenticated session missing");
    const body = createAdminUserRequestSchema.parse(request.body);
    const user = await adminUserService.createUser(
      body,
      auth.user.id,
      securityContext(request),
    );
    return reply.code(201).send({ user, requestId: request.id });
  });

  app.patch(
    "/api/users/:userId",
    { preHandler: writeGuards },
    async (request) => {
      const auth = request.authSession;
      if (!auth) throw new Error("Authenticated session missing");
      const { userId } = adminUserIdParamsSchema.parse(request.params);
      const body = updateAdminUserRequestSchema.parse(request.body);
      const user = await adminUserService.updateUser(
        userId,
        body,
        auth.user.id,
        securityContext(request),
      );
      return { user, requestId: request.id };
    },
  );

  app.post(
    "/api/users/:userId/password-reset",
    { preHandler: writeGuards },
    async (request) => {
      const auth = request.authSession;
      if (!auth) throw new Error("Authenticated session missing");
      const { userId } = adminUserIdParamsSchema.parse(request.params);
      const body = resetAdminUserPasswordRequestSchema.parse(request.body);
      await adminUserService.resetPassword(
        userId,
        body.newPassword,
        auth.user.id,
        securityContext(request),
      );
      return { requestId: request.id };
    },
  );
}
