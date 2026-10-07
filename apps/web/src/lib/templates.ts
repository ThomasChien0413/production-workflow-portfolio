import { apiRequire } from "./api";
import type { AdminTemplate } from "./template-admin-model";

export * from "./template-admin-model";

/**
 * Template administration reads. ADMIN-only at the API; the screens check the
 * same role before rendering so nobody is shown a page that answers 403.
 *
 * Required: publishing decisions are made from what these screens show, and a
 * template list that quietly came back empty would be a dangerous thing to
 * decide from.
 */
export async function listAdminTemplates(): Promise<AdminTemplate[]> {
  const body = await apiRequire<{ templates: AdminTemplate[] }>("/api/admin/templates");
  return body?.templates ?? [];
}

export async function getAdminTemplate(
  templateId: string,
): Promise<AdminTemplate | null> {
  const body = await apiRequire<{ template: AdminTemplate }>(
    `/api/admin/templates/${templateId}`,
  );
  return body?.template ?? null;
}
