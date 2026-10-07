import { apiRequire } from "./api";
import type { MembershipKind, RoleCode } from "@workflow/contracts";


export type AdminMembership = {
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  kind: MembershipKind;
};

/** Phones and browsers with notifications on (the user, 2026-10-04). */
export type AdminPushDevices = {
  count: number;
  lastSuccessAt: string | null;
};

export type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  active: boolean;
  passwordWarning: boolean;
  createdAt: string;
  updatedAt: string;
  roles: RoleCode[];
  memberships: AdminMembership[];
  pushDevices: AdminPushDevices;
};

/**
 * Departments are readable by any signed-in user, so the fetch itself lives in
 * lib/departments.ts. Re-exported here under the admin-facing names the account
 * screens already use.
 */
export type { Department as AdminDepartment } from "./departments";
export { listDepartments as listAdminDepartments } from "./departments";

export type AdminRole = {
  code: RoleCode;
  label: string;
  /** Only one active user may hold this role at a time. */
  singleton: boolean;
};

export async function listAdminUsers(params: {
  q?: string | undefined;
  active?: string | undefined;
}): Promise<AdminUser[]> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.active === "true" || params.active === "false") {
    query.set("active", params.active);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const body = await apiRequire<{ users: AdminUser[] }>(`/api/users${suffix}`);
  return body?.users ?? [];
}

/** Null means no such account; a failure throws to the error boundary. */
export async function getAdminUser(userId: string): Promise<AdminUser | null> {
  const body = await apiRequire<{ user: AdminUser }>(`/api/users/${userId}`);
  return body?.user ?? null;
}

export async function listAdminRoles(): Promise<AdminRole[]> {
  const body = await apiRequire<{ roles: AdminRole[] }>("/api/roles");
  return body?.roles ?? [];
}

/** Role display label, falling back to the code for `ADMIN`. */
export function roleLabel(role: RoleCode, catalog: AdminRole[]): string {
  return catalog.find((entry) => entry.code === role)?.label ?? role;
}
