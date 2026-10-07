import { archivedSheetDeletionAt } from "@workflow/domain";

/**
 * When an archived sheet is permanently deleted: one year after 封存 (the
 * user, 2026-10-01). The worker deletes within the hour after this instant.
 */
export function sheetDeletionAt(archivedAt: string | null): string | null {
  return archivedAt ? archivedSheetDeletionAt(new Date(archivedAt)).toISOString() : null;
}
