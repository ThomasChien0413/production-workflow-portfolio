/**
 * Client-safe department type.
 *
 * Separate from lib/departments.ts for the same reason lib/sheet-model.ts is
 * separate from lib/sheets.ts: that module imports `next/headers` to fetch, and
 * a client component importing it would pull a server-only API into the browser
 * bundle and fail the build.
 */
export type Department = {
  id: string;
  code: string;
  slug: string;
  displayName: string;
  active: boolean;
};
