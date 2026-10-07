"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field } from "@workflow/ui";
import { PASSWORD_MIN_LENGTH, usernameSchema, type RoleCode } from "@workflow/contracts";
import { csrfHeaders } from "@/lib/csrf";
import { useInteractive } from "@/lib/use-interactive";
import type { AdminDepartment, AdminRole } from "@/lib/admin";
import { AssignmentFields, type MembershipDraft } from "../assignment-fields";

/** Mirrors passwordSchema in @workflow/contracts. */
const MIN_PASSWORD = PASSWORD_MIN_LENGTH;

type ApiError = { message?: string; requestId?: string };
type FormError = { message: string; requestId?: string | undefined };
type FieldErrors = {
  username?: string | undefined;
  displayName?: string | undefined;
  initialPassword?: string | undefined;
  assignment?: string | undefined;
};

export function CreateUserForm({
  roles,
  departments,
}: {
  roles: AdminRole[];
  departments: AdminDepartment[];
}) {
  const router = useRouter();
  const interactive = useInteractive();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<RoleCode[]>([]);
  const [memberships, setMemberships] = useState<MembershipDraft[]>([]);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const loginName = usernameSchema.safeParse(username.trim() ? username : displayName);
    if (!loginName.success) {
      errors[username.trim() ? "username" : "displayName"] = loginName.error.issues[0]?.message ?? "請輸入有效的登入名稱。";
    }
    if (displayName.trim() === "") errors.displayName = "請輸入姓名。";
    if (initialPassword.length < MIN_PASSWORD) {
      errors.initialPassword = `初始密碼至少需要 ${MIN_PASSWORD} 個字元。`;
    }
    if (selectedRoles.length === 0 && memberships.length === 0) {
      errors.assignment = "啟用中的帳號至少需要一個角色或部門身分。";
    }
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    if (Object.values(errors).some((value) => value !== undefined)) return;

    setPending(true);
    setFormError(null);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({
          username: username.trim() || undefined,
          displayName: displayName.trim(),
          initialPassword,
          active: true,
          roles: selectedRoles,
          memberships,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null;
        setFormError({
          message: body?.message ?? "無法建立帳號，請稍後再試。",
          requestId: body?.requestId,
        });
        return;
      }
      router.push("/admin/users");
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
        <Alert tone="danger" title="無法建立帳號" assertive>
          <p>{formError.message}</p>
          {formError.requestId ? (
            <p className="cc-caption" style={{ marginTop: "var(--cc-space-1)" }}>
              錯誤代碼 {formError.requestId}
            </p>
          ) : null}
        </Alert>
      ) : null}

      <div className="cc-form-grid">
        <Field
          label="姓名"
          name="displayName"
          requiredMark
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          error={fieldErrors.displayName}
          disabled={pending || !interactive}
        />
        <Field
          label="登入名稱"
          name="username"
          optionalMark
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          help="留白時使用姓名登入；同名時，請設定不重複的登入名稱。建立後不可變更。"
          error={fieldErrors.username}
          disabled={pending || !interactive}
        />
      </div>

      <Field
        label="初始密碼"
        name="initialPassword"
        type="password"
        autoComplete="new-password"
        requiredMark
        value={initialPassword}
        onChange={(event) => setInitialPassword(event.target.value)}
        help={`至少 ${MIN_PASSWORD} 個字元。請將密碼告知使用者；除系統管理員與總經理外，使用者無法自行變更密碼。`}
        error={fieldErrors.initialPassword}
        disabled={pending || !interactive}
      />

      <AssignmentFields
        roles={roles}
        departments={departments}
        selectedRoles={selectedRoles}
        memberships={memberships}
        disabled={pending || !interactive}
        onRolesChange={setSelectedRoles}
        onMembershipsChange={setMemberships}
      />
      {fieldErrors.assignment ? (
        <p className="cc-error" role="alert">
          {fieldErrors.assignment}
        </p>
      ) : null}

      <div className="cc-row">
        <Button
          type="submit"
          variant="primary"
          disabled={!interactive}
          loading={pending}
          loadingLabel="建立中…"
        >
          建立帳號
        </Button>
      </div>
    </form>
  );
}
