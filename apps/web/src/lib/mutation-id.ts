/**
 * A random version-4 UUID for a write's idempotency key, so a repeated click
 * or a retried request is applied once.
 *
 * `crypto.randomUUID` exists only on secure pages — HTTPS, or localhost. On
 * `http://<this computer's address>:3000`, as a phone on the same network
 * opens the dev server, it is missing and creating a sheet failed (the user,
 * 2026-10-03). `crypto.getRandomValues` exists on every page, so the UUID is
 * built from it there.
 */
export function newMutationId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Version 4, RFC 9562 variant.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
