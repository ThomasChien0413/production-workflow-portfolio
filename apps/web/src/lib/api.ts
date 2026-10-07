import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiRequestError } from "./api-error";
import { apiOrigin } from "./session";

/**
 * Server-side reads against the API.
 *
 * Two modes, and which one a call uses is a statement about the screen:
 *
 * - `apiRequire` is for data the page *means* something with. A failure throws
 *   and the route's error boundary says so. This is the important half: every
 *   one of these used to swallow the failure and return an empty list, so an
 *   API outage rendered as 「尚無生產單」 — a confident lie that would send
 *   someone looking for a sheet that exists.
 * - `apiOptional` is for data that only enriches the page: a roster the reader
 *   may legitimately be forbidden from seeing, a badge count. Those degrade
 *   quietly because their absence is a normal state, not a fault.
 *
 * 404 is not a failure. `apiRequire` returns null for it so the caller can call
 * `notFound()`, which is a different screen from "something went wrong".
 */
export { ApiRequestError } from "./api-error";

async function requestHeaders(): Promise<Record<string, string> | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.toString();
  return cookie === "" ? null : { cookie };
}

/**
 * Data the page depends on. Returns null only for 404.
 *
 * An expired session redirects rather than throwing: the user needs to sign in
 * again, and an error screen would tell them nothing they can act on. The same
 * goes for a permission that has been revoked mid-session.
 */
export async function apiRequire<T>(path: string): Promise<T | null> {
  const headers = await requestHeaders();
  if (!headers) redirect("/login");

  let response: Response;
  try {
    response = await fetch(`${apiOrigin}${path}`, { headers, cache: "no-store" });
  } catch (cause) {
    throw new ApiRequestError(path, null, cause);
  }

  if (response.status === 404) return null;
  if (response.status === 401) redirect("/login");
  if (response.status === 403) redirect("/");
  if (!response.ok) throw new ApiRequestError(path, response.status);
  return (await response.json()) as T;
}

/** Data that only enriches the page. Never throws. */
export async function apiOptional<T>(path: string, fallback: T): Promise<T> {
  const headers = await requestHeaders();
  if (!headers) return fallback;
  try {
    const response = await fetch(`${apiOrigin}${path}`, { headers, cache: "no-store" });
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}
