"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field } from "@workflow/ui";
import type { RoleCode } from "@workflow/contracts";
import { csrfHeaders } from "@/lib/csrf";
import { useInteractive } from "@/lib/use-interactive";
import type { AdminDepartment, AdminRole, AdminUser } from "@/lib/admin";
import { AssignmentFields, type MembershipDraft } from "../assignment-fields";

type ApiError = { message?: string; requestId?: string };
type FormError = { message: string; requestId?: string | undefined };

export function EditUserForm({
  user,
  roles,
  departments,
  isSelf,
}: {
  user: AdminUser;
  roles: AdminRole[];
  departments: AdminDepartment[];
  /**
   * The signed-in account manager cannot deactivate themselves or drop their
   * own account-management role — that would lock everyone out of this screen.
   */
  isSelf: boolean;
}) {
  const router = useRouter();
  const interactive = useInteractive();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [active, setActive] = useState(user.active);
  const [selectedRoles, setSelectedRoles] = useState<RoleCode[]>(user.roles);
  const [memberships, setMemberships] = useState<MembershipDraft[]>(
    user.memberships.map((membership) => ({
      departmentId: membership.departmentId,
      kind: membership.kind,
    })),
  );
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [saved, setSaved] = useState(false);

  const deactivating = user.active && !active;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (active && selectedRoles.length === 0 && memberships.length === 0) {
      setFormError({ message: "啟用中的帳號至少需要一個角色或部門身分。" });
      return;
    }

    setPending(true);
    setFormError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({
          displayName: displayName.trim(),
          active,
          // Deactivating clears assignments; the API rejects a disabled account
          // that still holds roles or memberships.
          roles: active ? selectedRoles : [],
          memberships: active ? memberships : [],
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null;
        setFormError({
          message: body?.message ?? "無法儲存變更，請稍後再試。",
          requestId: body?.requestId,
        });
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setFormError({ message: "無法連線到伺服器，請檢查網路後再試一次。" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="cc-stack" onSubmit={handleSubmit} noValidate>
      {formError ? (
        <Alert tone="danger" title="無法儲存" assertive>
          <p>{formError.message}</p>
          {formError.requestId ? (
            <p className="cc-caption" style={{ marginTop: "var(--cc-space-1)" }}>
              錯誤代碼 {formError.requestId}
            </p>
          ) : null}
        </Alert>
      ) : null}

      {saved ? (
        <Alert tone="success" title="已儲存">
          權限或狀態變更會結束該使用者目前的工作階段，需要重新登入。
        </Alert>
      ) : null}

      <Field
        label="姓名"
        name="displayName"
        requiredMark
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        help="變更姓名不會變更原本的登入名稱。"
        disabled={pending || !interactive}
      />

      <div className="cc-field">
        <span className="cc-label">帳號狀態</span>
        <label className="cc-switch">
          <input
            type="checkbox"
            checked={active}
            disabled={pending || !interactive || isSelf}
            onChange={(event) => setActive(event.target.checked)}
            aria-describedby={isSelf ? "self-lock" : undefined}
          />
          <span className="cc-switch__track" />
          <span className="cc-body-sm">{active ? "啟用中" : "已停用"}</span>
        </label>
        {isSelf ? (
          <p className="cc-help" id="self-lock">
            無法停用目前登入的帳號，也不能移除自己的帳號管理權限。請由另一位系統管理員或總經理操作。
          </p>
        ) : null}
      </div>

      {deactivating ? (
        <Alert tone="warning" title="停用將清除所有角色與部門身分">
          停用後此帳號的角色與部門身分會一併移除，且所有工作階段立即結束。重新啟用時需重新指派。
        </Alert>
      ) : null}

      {active ? (
        <AssignmentFields
          roles={roles}
          departments={departments}
          selectedRoles={selectedRoles}
          memberships={memberships}
          disabled={pending || !interactive}
          onRolesChange={setSelectedRoles}
          onMembershipsChange={setMemberships}
        />
      ) : null}

      <div className="cc-row">
        <Button
          type="submit"
          variant="primary"
          disabled={!interactive}
          loading={pending}
          loadingLabel="儲存中…"
        >
          儲存變更
        </Button>
      </div>
    </form>
  );
}
