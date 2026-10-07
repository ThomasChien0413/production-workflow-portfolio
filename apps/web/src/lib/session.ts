import { cookies } from "next/headers";
import { ApiRequestError } from "./api-error";
import type { SessionUser } from "@workflow/contracts";

/**
 * Server components talk to the API directly rather than through the rewrite
 * proxy — there is no browser in the loop, so they must forward the cookie
 * header themselves.
 */
export const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:3001";

/**
 * The signed-in user, or null when there is genuinely no session.
 *
 * Null means *signed out* and nothing else. An unreachable API used to return
 * null too, which sent every signed-in user to /login during an outage — a
 * login screen that then could not log them in either, and a lie about what
 * had happened. A transport failure or a 5xx now throws, so the error boundary
 * says the system is unavailable, and the session cookie survives.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  if (cookieHeader === "") return null;

  let response: Response;
  try {
    response = await fetch(`${apiOrigin}/api/auth/session`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
  } catch (cause) {
    throw new ApiRequestError("/api/auth/session", null, cause);
  }

  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    throw new ApiRequestError("/api/auth/session", response.status);
  }
  const body = (await response.json()) as { user?: SessionUser };
  return body.user ?? null;
}
