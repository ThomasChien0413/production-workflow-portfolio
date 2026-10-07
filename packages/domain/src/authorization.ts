import { MembershipKind, RoleCode } from "@workflow/contracts";

export type DepartmentMembershipSnapshot = {
  departmentId: string;
  kind: MembershipKind;
};

export type ActorSnapshot = {
  userId: string;
  roles: readonly RoleCode[];
  memberships: readonly DepartmentMembershipSnapshot[];
};

/**
 * Roles that hold a 主管's authority in every department and subpage (the
 * user, 2026-09-30): creating, editing, submitting, assigning, moving,
 * starting and routing, still within every template, state and approval rule.
 * 協理 and 業務 read everything but manage nothing.
 */
export const COMPANY_MANAGER_ROLES = ["ADMIN", "GENERAL_MANAGER"] as const;

export function isCompanyManager(actor: Pick<ActorSnapshot, "roles">): boolean {
  return actor.roles.some((role) =>
    (COMPANY_MANAGER_ROLES as readonly RoleCode[]).includes(role),
  );
}

/**
 * Passwords are set by ADMIN and 總經理 (the user, 2026-10-04): they alone may
 * change their own, and they set or reset everyone else's. Nobody else is
 * shown the default-password warning, since they could not act on it.
 */
export function changesOwnPassword(actor: Pick<ActorSnapshot, "roles">): boolean {
  return isCompanyManager(actor);
}

/**
 * Roles that read every department's sheets. They alone have the
 * company-wide 審核 list (the user, 2026-10-01); everyone else checks,
 * creates and changes sheets in their own department pages.
 */
export const COMPANY_READER_ROLES = ["ADMIN", "GENERAL_MANAGER", "ASSOCIATE", "SALES"] as const;

export function isCompanyReader(actor: Pick<ActorSnapshot, "roles">): boolean {
  return actor.roles.some((role) =>
    (COMPANY_READER_ROLES as readonly RoleCode[]).includes(role),
  );
}

export function managesDepartment(
  actor: ActorSnapshot,
  departmentId: string,
): boolean {
  if (isCompanyManager(actor)) return true;
  return actor.memberships.some(
    (membership) =>
      membership.departmentId === departmentId && membership.kind === "MANAGER",
  );
}

export function canRouteWork(
  actor: ActorSnapshot,
  currentDepartmentId: string,
): boolean {
  return managesDepartment(actor, currentDepartmentId);
}
