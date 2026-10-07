import type { FastifyReply, FastifyRequest } from "fastify";
import type { RoleCode } from "@workflow/contracts";
import type { ApiConfig } from "../config.js";
import { AuthenticationError, AuthorizationError } from "./errors.js";
import type { AuthService, AuthenticatedSession } from "./service.js";

declare module "fastify" {
  interface FastifyRequest {
    authSession: AuthenticatedSession | null;
  }
}

export function createAuthGuards(authService: AuthService, config: ApiConfig) {
  async function requireSession(request: FastifyRequest): Promise<void> {
    const sessionToken = request.cookies[config.sessionCookieName];
    if (!sessionToken) throw new AuthenticationError("請先登入");
    request.authSession = await authService.authenticate(sessionToken);
  }

  async function requireCsrf(request: FastifyRequest): Promise<void> {
    if (!request.authSession) throw new AuthenticationError("請先登入");
    const cookieToken = request.cookies[config.csrfCookieName];
    const headerToken = request.headers["x-csrf-token"];
    if (
      !cookieToken ||
      typeof headerToken !== "string" ||
      cookieToken !== headerToken
    ) {
      throw new AuthorizationError("安全驗證失敗，請重新整理後再試");
    }
    await authService.verifyCsrf(request.authSession.sessionId, headerToken);
  }

  function requireAnyRole(...roles: RoleCode[]) {
    return async (request: FastifyRequest): Promise<void> => {
      if (!request.authSession) throw new AuthenticationError("請先登入");
      if (!roles.some((role) => request.authSession?.user.roles.includes(role))) {
        throw new AuthorizationError();
      }
    };
  }

  function clearAuthCookies(reply: FastifyReply): void {
    reply.clearCookie(config.sessionCookieName, { path: "/" });
    reply.clearCookie(config.csrfCookieName, { path: "/" });
  }

  return {
    requireSession,
    requireCsrf,
    requireAnyRole,
    clearAuthCookies,
  };
}
