import type { RoleCode, SessionUser } from "@workflow/contracts";
import {
  canRouteWork,
  requiredApprovalRole,
  type ActorSnapshot,
} from "@workflow/domain";
import type { SheetDetail } from "./sheet-model";

/**
 * What this user may do with this sheet, decided by the same domain functions
 * the API uses.
 *
 * Hiding a control is not authorization — the API checks every one of these
 * again. The point is not to offer an action the server is going to refuse:
 * a reviewer was being shown 送出審核 on a returned sheet they had no right to
 * submit, and the only feedback was a 403 after the fact.
 */
export function actorOf(user: SessionUser): ActorSnapshot {
  return {
    userId: user.id,
    roles: user.roles,
    memberships: user.memberships.map((membership) => ({
      departmentId: membership.departmentId,
      kind: membership.kind,
    })),
  };
}

/**
 * Every field-editor identity this user may exercise on this sheet. An empty
 * array means the user may not patch values at all.
 */
export type SheetEditorKind =
  | "ORIGIN_MANAGER"
  | "ORIGIN_ORDER_TAKER"
  | "ORIGIN_STAFF";

export function editorKinds(
  user: SessionUser,
  sheet: SheetDetail,
): SheetEditorKind[] {
  void user;
  return sheet.permissions.canEdit
    ? ["ORIGIN_MANAGER", "ORIGIN_ORDER_TAKER", "ORIGIN_STAFF"]
    : [];
}

/**
 * Sending a sheet on to the department its workflow leads to — 退火明細表 to
 * 燒頓 — once, while it waits at 待生產 where it was written. There is no
 * draft and no review (the user, 2026-09-30), so this is all that is left of
 * submitting; `releaseDestination` is null once it has gone.
 */
export function canSubmit(user: SessionUser, sheet: SheetDetail): boolean {
  void user;
  return (
    sheet.permissions.canSubmit &&
    (sheet.review.outstanding || sheet.releaseDestination !== null) &&
    ["DRAFT", "RETURNED", "READY"].includes(sheet.state)
  );
}

/**
 * The review stage waiting on this user: 業務, 協理 or 總經理 on 分條申請單
 * (the user, 2026-10-01). Asked of the same domain function the API asks, so
 * the page cannot offer a decision the server will refuse.
 */
export function reviewerRole(user: SessionUser, sheet: SheetDetail): RoleCode | null {
  const required = requiredApprovalRole(sheet.state);
  if (!required) return null;
  return user.roles.includes(required) ? required : null;
}

/**
 * Manager of the department the sheet is in *now* — not where it started.
 * After 送交 the receiving department's manager places it in a subpage, sets
 * its 交期, and archives or restores it; the sender does not.
 */
export function managesCurrentDepartment(
  user: SessionUser,
  sheet: SheetDetail,
): boolean {
  return canRouteWork(actorOf(user), sheet.currentDepartmentId);
}

/** The 交期, set by the department's 主管 until the work is done. */
export function canSetDueDate(user: SessionUser, sheet: SheetDetail): boolean {
  return (
    managesCurrentDepartment(user, sheet) &&
    sheet.state !== "COMPLETED" &&
    sheet.state !== "ARCHIVED"
  );
}

/**
 * Setting the production status — 待生產, 生產中, 已完成, in any order — by
 * whoever may modify the sheet in its subpage (the user, 2026-09-30).
 * `permissions.canEdit` is the API's answer, form tick included, and every
 * 主管 holds it. A sheet waiting in 待分派 has no subpage yet; one still to be
 * sent on shows 待生產 until the department it goes to sets it.
 */
export function canChangeStatus(user: SessionUser, sheet: SheetDetail): boolean {
  void user;
  return (
    ["READY", "IN_PROGRESS", "COMPLETED"].includes(sheet.state) &&
    sheet.subpageId !== null &&
    sheet.releaseDestination === null &&
    !sheet.review.outstanding &&
    sheet.permissions.canEdit
  );
}

export function canArchive(user: SessionUser, sheet: SheetDetail): boolean {
  return sheet.state === "COMPLETED" && managesCurrentDepartment(user, sheet);
}

/** An archived sheet goes back to its subpage at its 主管's word (the user, 2026-10-04). */
export function canRestore(user: SessionUser, sheet: SheetDetail): boolean {
  return sheet.state === "ARCHIVED" && managesCurrentDepartment(user, sheet);
}

/** Any production action at all — what decides whether the section exists. */
export function hasProductionAction(
  user: SessionUser,
  sheet: SheetDetail,
): boolean {
  return (
    canSetDueDate(user, sheet) ||
    canChangeStatus(user, sheet) ||
    canArchive(user, sheet) ||
    canRestore(user, sheet)
  );
}
