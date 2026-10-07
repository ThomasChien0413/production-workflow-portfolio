import type { SheetAttachmentPage } from "@workflow/contracts";
import { apiOptional, apiRequire } from "./api";
import type {
  AvailableTemplate,
  DepartmentStaffMember,
  SheetDetail,
  SheetSummary,
} from "./sheet-model";

/**
 * Server-only sheet reads. Types, labels and key helpers live in
 * ./sheet-model so client components can use them without dragging
 * `next/headers` into the browser bundle.
 */
export * from "./sheet-model";

/** The list is the screen. An outage must not read as an empty department. */
export async function listSheets(
  filters: { departmentId?: string; subpageId?: string } = {},
): Promise<SheetSummary[]> {
  const query = new URLSearchParams();
  if (filters.departmentId) query.set("departmentId", filters.departmentId);
  if (filters.subpageId) query.set("subpageId", filters.subpageId);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const body = await apiRequire<{ sheets: SheetSummary[] }>(`/api/sheets${suffix}`);
  return body?.sheets ?? [];
}

/** Templates decide what can be created; a silent empty list looks like none. */
export async function listAvailableTemplates(): Promise<AvailableTemplate[]> {
  const body = await apiRequire<{ templates: AvailableTemplate[] }>("/api/templates");
  return body?.templates ?? [];
}

/** Null means the sheet does not exist. Anything else throws. */
export async function getSheet(sheetId: string): Promise<SheetDetail | null> {
  const body = await apiRequire<{ sheet: SheetDetail }>(`/api/sheets/${sheetId}`);
  return body?.sheet ?? null;
}

/**
 * Assignable employees of a department.
 *
 * Optional: the API restricts it to that department's manager, so a 403 is the
 * normal answer for everyone else and an empty list is the correct rendering.
 */
export async function listDepartmentStaff(
  departmentId: string,
): Promise<DepartmentStaffMember[]> {
  const body = await apiOptional<{ staff: DepartmentStaffMember[] }>(
    `/api/departments/${departmentId}/staff`,
    { staff: [] },
  );
  return body.staff ?? [];
}

/** Attachments are part of the readable sheet; failure must not look empty. */
export async function listSheetAttachments(
  sheetId: string,
  page = 1,
): Promise<SheetAttachmentPage> {
  const body = await apiRequire<SheetAttachmentPage>(
    `/api/sheets/${sheetId}/attachments?page=${page}`,
  );
  return (
    body ?? {
      items: [],
      page,
      pageSize: 25,
      total: 0,
      canModify: false,
    }
  );
}
