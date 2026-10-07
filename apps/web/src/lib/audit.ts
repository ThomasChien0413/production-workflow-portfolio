import type { AuditEvent } from "@workflow/contracts";
import { apiOptional, apiRequire } from "./api";
import type { SheetFieldHistoryEntry } from "./sheet-model";
import { taipeiDayEnd, taipeiDayStart } from "./taipei";

export type AuditPage = {
  items: AuditEvent[];
  page: number;
  pageSize: number;
  total: number;
};

export type FieldHistoryPage = {
  items: SheetFieldHistoryEntry[];
  page: number;
  pageSize: number;
  total: number;
};

/**
 * Audit search. ADMIN-only at the API, which also sanitises event metadata on
 * the way out, so this reads what it is given rather than filtering again.
 *
 * Required: an investigation that silently returns nothing is worse than one
 * that fails, because "no matching records" is itself a finding.
 */
export async function searchAudit(params: {
  page?: number;
  q?: string | undefined;
  action?: string | undefined;
  targetType?: string | undefined;
  /** Taipei calendar days, inclusive at both ends. */
  from?: string | undefined;
  to?: string | undefined;
}): Promise<AuditPage> {
  const query = new URLSearchParams();
  if (params.page && params.page > 1) query.set("page", String(params.page));
  if (params.q) query.set("q", params.q);
  if (params.action) query.set("action", params.action);
  if (params.targetType) query.set("targetType", params.targetType);
  // The screen speaks in days; the API filters on instants. A day named in the
  // URL is expanded to the whole of that day in Taipei, so 8/11 to 8/11 means
  // everything that happened on the 11th rather than nothing at all.
  if (params.from) query.set("from", taipeiDayStart(params.from));
  if (params.to) query.set("to", taipeiDayEnd(params.to));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const body = await apiRequire<AuditPage>(`/api/audit${suffix}`);
  return body ?? { items: [], page: 1, pageSize: 25, total: 0 };
}

/**
 * Who changed which fields on one sheet. Optional: it is a panel beside the
 * form, and losing it should not take the sheet down with it.
 */
export async function listFieldHistory(
  sheetId: string,
): Promise<FieldHistoryPage> {
  return apiOptional<FieldHistoryPage>(`/api/sheets/${sheetId}/field-history`, {
    items: [],
    page: 1,
    pageSize: 30,
    total: 0,
  });
}
