"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field } from "@workflow/ui";
import { PASSWORD_MIN_LENGTH } from "@workflow/contracts";
import { csrfHeaders } from "@/lib/csrf";

/** Mirrors changePasswordRequestSchema in @workflow/contracts. */
const MIN_LENGTH = PASSWORD_MIN_LENGTH;

type ApiError = { error?: string; message?: string; requestId?: string };
type FormError = { message: string; requestId?: string | undefined };
type FieldErrors = {
  currentPassword?: string | undefined;
  newPassword?: string | undefined;
  confirmPassword?: string | undefined;
};

export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (currentPassword === "") {
      errors.currentPassword = "請輸入目前的密碼。";
    }
    if (newPassword.length < MIN_LENGTH) {
      errors.newPassword = `新密碼至少需要 ${MIN_LENGTH} 個字元。`;
    } else if (newPassword === currentPassword) {
      // The API enforces this too; checking here avoids a pointless round trip.
      errors.newPassword = "新密碼不可與目前密碼相同。";
    }
    if (confirmPassword !== newPassword) {
      errors.confirmPassword = "兩次輸入的新密碼不一致。";
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
      const response = await fetch("/api/auth/password", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null;
        setFormError({
          message: body?.message ?? "無法變更密碼，請稍後再試。",
          requestId: body?.requestId,
        });
        return;
      }

      // The API revoked every other session for this user and cleared the
      // default-password warning. Refresh so the server re-reads the session.
      router.replace("/?passwordChanged=1");
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
        <Alert tone="danger" title="無法變更密碼" assertive>
          <p>{formError.message}</p>
          {formError.requestId ? (
            <p className="cc-caption" style={{ marginTop: "var(--cc-space-1)" }}>
              錯誤代碼 {formError.requestId}
            </p>
          ) : null}
        </Alert>
      ) : null}

      <Field
        label="目前密碼"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        requiredMark
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        error={fieldErrors.currentPassword}
        disabled={pending}
      />

      <Field
        label="新密碼"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        requiredMark
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        help={`至少 ${MIN_LENGTH} 個字元，且不可與目前密碼相同。`}
        error={fieldErrors.newPassword}
        disabled={pending}
      />

      <Field
        label="確認新密碼"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        requiredMark
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        error={fieldErrors.confirmPassword}
        disabled={pending}
      />

      <Alert tone="warning" title="變更後將登出其他裝置">
        為了安全，變更密碼會結束您在其他裝置上的所有工作階段。目前使用中的這個工作階段會保留。
      </Alert>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        block
        loading={pending}
        loadingLabel="變更中…"
      >
        變更密碼
      </Button>
    </form>
  );
}
