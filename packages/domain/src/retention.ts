/**
 * An archived sheet is kept for one year after 封存 and then permanently
 * deleted with its attachments (the user, 2026-10-01). Active sheets are
 * never deleted.
 *
 * One calendar year, as PostgreSQL's `interval '1 year'` counts it: the same
 * month, day and time a year later, with 29 February falling back to
 * 28 February. The worker selects with that interval, so the date shown on
 * the sheet is never later than the deletion.
 */
export const ARCHIVED_SHEET_RETENTION_YEARS = 1;

export function archivedSheetDeletionAt(archivedAt: Date): Date {
  const year = archivedAt.getUTCFullYear() + ARCHIVED_SHEET_RETENTION_YEARS;
  const month = archivedAt.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(archivedAt.getUTCDate(), lastDay),
      archivedAt.getUTCHours(),
      archivedAt.getUTCMinutes(),
      archivedAt.getUTCSeconds(),
      archivedAt.getUTCMilliseconds(),
    ),
  );
}
