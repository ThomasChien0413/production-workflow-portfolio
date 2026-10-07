import { describe, expect, it } from "vitest";
import type { ApiConfig } from "../config.js";
import { AuthenticationError, AuthorizationError } from "./errors.js";
import { createAuthGuards } from "./guards.js";

const guards = createAuthGuards(
  {} as never,
  { sessionCookieName: "workflow_session", csrfCookieName: "workflow_csrf" } as ApiConfig,
);

// No LINE gate any more (the user, 2026-10-04): a session and its roles decide.
describe("role guard", () => {
  it("admits a session holding one of the roles", async () => {
    await expect(
      guards.requireAnyRole("ADMIN", "GENERAL_MANAGER")({ authSession: { user: { roles: ["GENERAL_MANAGER"] } } } as never),
    ).resolves.toBeUndefined();
  });

  it("refuses a session without them, and a request without a session", async () => {
    await expect(
      guards.requireAnyRole("ADMIN")({ authSession: { user: { roles: ["SALES"] } } } as never),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(guards.requireAnyRole("ADMIN")({ authSession: null } as never)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });
});
