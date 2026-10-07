import type { DepartmentCode, RoleCode, SheetState } from "@workflow/contracts";

/**
 * Review was retired for every form on 2026-09-30 and restored for one on
 * 2026-10-01 (the user): 分條申請單, the only form whose definition still
 * requires review. Its department sends it for review; 業務, 協理 and 總經理
 * approve it in turn, each one's stage a sheet state; any of them may return
 * it with a reason; and only after 總經理 approves does it go on to 分條.
 */
const approvalRoleForState: Partial<Record<SheetState, RoleCode>> = {
  PENDING_SALES: "SALES",
  PENDING_ASSOCIATE: "ASSOCIATE",
  PENDING_GENERAL_MANAGER: "GENERAL_MANAGER",
};

const nextApprovalState: Partial<Record<SheetState, SheetState>> = {
  PENDING_SALES: "PENDING_ASSOCIATE",
  PENDING_ASSOCIATE: "PENDING_GENERAL_MANAGER",
  PENDING_GENERAL_MANAGER: "READY",
};

/** The first review stage. */
export const FIRST_REVIEW_STATE: SheetState = "PENDING_SALES";

/** Whose turn it is, or null when the sheet is not under review. */
export function requiredApprovalRole(state: SheetState): RoleCode | null {
  return approvalRoleForState[state] ?? null;
}

export function isUnderReview(state: SheetState): boolean {
  return requiredApprovalRole(state) !== null;
}

/** The next stage, or READY once 總經理 has approved. */
export function approveCurrentStage(state: SheetState): SheetState {
  const next = nextApprovalState[state];
  if (!next) throw new Error(`Sheet state ${state} is not awaiting approval`);
  return next;
}

/** 退回: back to the department that wrote it, with a reason. */
export function rejectCurrentStage(state: SheetState, comment: string): SheetState {
  if (!requiredApprovalRole(state)) {
    throw new Error(`Sheet state ${state} is not awaiting approval`);
  }
  if (comment.trim().length === 0) {
    throw new Error("A rejection requires a comment");
  }
  return "RETURNED";
}

export function postApprovalDestination(
  originDepartmentCode: DepartmentCode,
  destinationDepartmentCode: DepartmentCode,
  avoidSelfHandoff: boolean,
): DepartmentCode | null {
  if (avoidSelfHandoff && originDepartmentCode === destinationDepartmentCode) {
    return null;
  }
  return destinationDepartmentCode;
}

const PRODUCTION_STATUSES: readonly SheetState[] = ["READY", "IN_PROGRESS", "COMPLETED"];

/**
 * A sheet's status is set by hand (the user, 2026-09-30): 待生產, 生產中 and
 * 已完成, in any order, until it is handed on or archived. Nobody is assigned,
 * there is no draft, and there is no review. ASSIGNED and the review states
 * are retired; migrations 0010 and 0011 moved their sheets to READY.
 */
export function changeProductionStatus(from: SheetState, to: SheetState): SheetState {
  if (!PRODUCTION_STATUSES.includes(from)) {
    throw new Error(`Sheet state ${from} has no production status to change`);
  }
  if (!PRODUCTION_STATUSES.includes(to)) {
    throw new Error(`${to} is not a production status`);
  }
  if (from === to) throw new Error(`Sheet is already ${to}`);
  return to;
}

/** A 交期 means something only while the work is still to be done. */
export function canSetDueDate(state: SheetState): boolean {
  return state !== "COMPLETED" && state !== "ARCHIVED";
}

export function archiveCompletedWork(state: SheetState): SheetState {
  if (state !== "COMPLETED") {
    throw new Error(`Sheet state ${state} cannot be archived`);
  }
  return "ARCHIVED";
}

/**
 * A finished sheet is archived, not handed on (the user, 2026-10-04), and its
 * department's 主管 may bring an archived one back from 完工紀錄. It returns
 * to its subpage as 已完成.
 */
export function restoreArchivedWork(state: SheetState): SheetState {
  if (state !== "ARCHIVED") {
    throw new Error(`Sheet state ${state} cannot be restored`);
  }
  return "COMPLETED";
}
