import { apiRequire } from "./api";
import type { Department } from "./department-model";

/**
 * The six departments are company-wide navigation, not administration data, so
 * this lives outside lib/admin.ts and only needs a signed-in session. Anything
 * about the *people* in a department stays in lib/admin.ts behind the
 * account-manager guard.
 *
 * Required, not optional: the home screen is a department launcher, and an
 * empty launcher would read as "this company has no departments".
 */
export type { Department } from "./department-model";

export async function listDepartments(): Promise<Department[]> {
  const body = await apiRequire<{ departments: Department[] }>("/api/departments");
  return body?.departments ?? [];
}

export async function getDepartmentBySlug(
  slug: string,
): Promise<Department | null> {
  const departments = await listDepartments();
  return departments.find((department) => department.slug === slug) ?? null;
}
