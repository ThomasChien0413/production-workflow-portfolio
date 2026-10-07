"use client";

import {
  membershipKindLabels,
  membershipKinds,
  type MembershipKind,
  type RoleCode,
} from "@workflow/contracts";
import type { AdminDepartment, AdminRole } from "@/lib/admin";

export type MembershipDraft = { departmentId: string; kind: MembershipKind };

/**
 * Roles and department identities, shared by the create and edit screens.
 *
 * Department identities are independent. Checking more than one identity in
 * one row gives the user the union of those template-scoped permissions.
 */
export function AssignmentFields({
  roles,
  departments,
  selectedRoles,
  memberships,
  disabled = false,
  onRolesChange,
  onMembershipsChange,
}: {
  roles: AdminRole[];
  departments: AdminDepartment[];
  selectedRoles: RoleCode[];
  memberships: MembershipDraft[];
  disabled?: boolean;
  onRolesChange: (roles: RoleCode[]) => void;
  onMembershipsChange: (memberships: MembershipDraft[]) => void;
}) {
  function toggleRole(role: RoleCode, checked: boolean) {
    onRolesChange(
      checked
        ? [...selectedRoles, role]
        : selectedRoles.filter((entry) => entry !== role),
    );
  }

  function toggleMembership(
    departmentId: string,
    kind: MembershipKind,
    checked: boolean,
  ) {
    const rest = memberships.filter(
      (membership) =>
        membership.departmentId !== departmentId || membership.kind !== kind,
    );
    onMembershipsChange(
      checked ? [...rest, { departmentId, kind }] : rest,
    );
  }

  return (
    <>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="cc-label" style={{ padding: 0 }}>
          系統角色
        </legend>
        <p className="cc-help" style={{ marginBottom: "var(--cc-space-2)" }}>
          業務、協理、總經理全系統同時只能有一位啟用中的使用者。
        </p>
        {roles.map((role) => (
          <label className="cc-choice" key={role.code}>
            <input
              type="checkbox"
              checked={selectedRoles.includes(role.code)}
              disabled={disabled}
              onChange={(event) => toggleRole(role.code, event.target.checked)}
            />
            <span>
              {role.label}
              {role.singleton ? (
                <span className="cc-caption cc-muted">（唯一）</span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="cc-label" style={{ padding: 0 }}>
          部門身分
        </legend>
        <p className="cc-help" style={{ marginBottom: "var(--cc-space-2)" }}>
          每個部門可同時勾選多個身分；權限會合併，但仍受表單與流程規則限制。
        </p>
        <div className="cc-membership-matrix">
          <div className="cc-membership-matrix__header" aria-hidden="true">
            <span>部門</span>
            {membershipKinds.map((kind) => (
              <span key={kind}>{membershipKindLabels[kind]}</span>
            ))}
          </div>
          {departments.map((department) => {
            const labelId = `department-${department.id}-label`;
            return (
              <div
                className="cc-membership-matrix__row"
                key={department.id}
                role="group"
                aria-labelledby={labelId}
              >
                <span className="cc-membership-matrix__department" id={labelId}>
                  {department.displayName}
                </span>
                {membershipKinds.map((kind) => (
                  <label className="cc-choice" key={kind}>
                    <input
                      type="checkbox"
                      checked={memberships.some(
                        (membership) =>
                          membership.departmentId === department.id &&
                          membership.kind === kind,
                      )}
                      disabled={disabled}
                      aria-label={`${department.displayName}・${membershipKindLabels[kind]}`}
                      onChange={(event) =>
                        toggleMembership(
                          department.id,
                          kind,
                          event.target.checked,
                        )
                      }
                    />
                    <span className="cc-membership-matrix__mobile-label">
                      {membershipKindLabels[kind]}
                    </span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </fieldset>
    </>
  );
}
