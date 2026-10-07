import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  changePasswordRequestSchema,
  loginRequestSchema,
} from "@workflow/contracts";
import type { ApiConfig } from "../config.js";
import { createAuthGuards } from "./guards.js";
import type { AuthService, RequestSecurityContext } from "./service.js";

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

export async function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  config: ApiConfig,
): Promise<void> {
  const guards = createAuthGuards(authService, config);
  const cookieOptions = {
    path: "/",
    sameSite: "strict" as const,
    secure: config.secureCookies,
  };

  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "15 minutes" },
      },
    },
    async (request, reply) => {
      const body = loginRequestSchema.parse(request.body);
      const result = await authService.login(
        body.username,
        body.password,
        securityContext(request),
      );

      const maxAge = Math.floor(config.sessionTtlMs / 1000);
      reply.setCookie(config.sessionCookieName, result.sessionToken, {
        ...cookieOptions,
        httpOnly: true,
        maxAge,
      });
      reply.setCookie(config.csrfCookieName, result.csrfToken, {
        ...cookieOptions,
        httpOnly: false,
        maxAge,
      });

      return {
        user: result.user,
        expiresAt: result.expiresAt.toISOString(),
      };
    },
  );

  app.get(
    "/api/auth/session",
    { preHandler: [guards.requireSession] },
    async (request) => ({ user: request.authSession?.user }),
  );

  app.post(
    "/api/auth/logout",
    { preHandler: [guards.requireSession, guards.requireCsrf] },
    async (request, reply) => {
      const auth = request.authSession;
      if (auth) {
        await authService.logout(
          auth.sessionId,
          auth.user.id,
          securityContext(request),
        );
      }
      guards.clearAuthCookies(reply);
      return reply.code(204).send();
    },
  );

  app.patch(
    "/api/auth/password",
    { preHandler: [guards.requireSession, guards.requireCsrf] },
    async (request) => {
      const auth = request.authSession;
      if (!auth) throw new Error("Authenticated session missing");
      const body = changePasswordRequestSchema.parse(request.body);
      const user = await authService.changePassword(
        auth.sessionId,
        auth.user.id,
        body.currentPassword,
        body.newPassword,
        securityContext(request),
      );
      return { user };
    },
  );
}
