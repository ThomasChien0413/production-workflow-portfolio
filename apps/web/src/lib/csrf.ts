/**
 * The session cookie is httpOnly, but the CSRF cookie is deliberately readable
 * so the browser can echo it back in the x-csrf-token header that the API
 * compares against. See apps/api/src/auth/guards.ts.
 *
 * Browser-only — there is no document in a server component.
 */
export function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;

  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    if (trimmed.slice(0, separator) === "workflow_csrf") {
      return decodeURIComponent(trimmed.slice(separator + 1));
    }
  }
  return null;
}

/** Header bag for a mutating request, empty when no token is present. */
export function csrfHeaders(): Record<string, string> {
  const token = readCsrfToken();
  return token === null ? {} : { "x-csrf-token": token };
}
