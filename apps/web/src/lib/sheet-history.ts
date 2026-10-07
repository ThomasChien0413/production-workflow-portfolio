import type { DepartmentSheetHistoryPage } from "@workflow/contracts";
import { apiRequire } from "./api";
import { taipeiDayEnd, taipeiDayStart } from "./taipei";
import type { HistoryDirection, HistorySort } from "./sheet-history-model";

export type DepartmentHistoryFilters = {
  q?: string | undefined;
  templateId?: string | undefined;
  subpageId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
  sort: HistorySort["key"];
  direction: HistoryDirection;
};

export async function listDepartmentSheetHistory(
  departmentId: string,
  filters: DepartmentHistoryFilters,
): Promise<DepartmentSheetHistoryPage> {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.templateId) query.set("templateId", filters.templateId);
  if (filters.subpageId) query.set("subpageId", filters.subpageId);
  if (filters.from) query.set("from", taipeiDayStart(filters.from));
  if (filters.to) query.set("to", taipeiDayEnd(filters.to));
  if (filters.sort !== "completedAt") query.set("sort", filters.sort);
  if (filters.direction !== "desc" || filters.sort !== "completedAt") {
    query.set("direction", filters.direction);
  }
  if (filters.page > 1) query.set("page", String(filters.page));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const body = await apiRequire<DepartmentSheetHistoryPage>(
    `/api/departments/${departmentId}/sheet-history${suffix}`,
  );
  return (
    body ?? {
      items: [],
      filterOptions: { templates: [], subpages: [] },
      page: 1,
      pageSize: 25,
      total: 0,
    }
  );
}
