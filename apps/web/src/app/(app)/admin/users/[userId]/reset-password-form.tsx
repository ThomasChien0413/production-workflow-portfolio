"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field } from "@workflow/ui";
import { PASSWORD_MIN_LENGTH } from "@workflow/contracts";
import { csrfHeaders } from "@/lib/csrf";

const MIN_PASSWORD = PASSWORD_MIN_LENGTH;

type ApiError = { message?: string; requestId?: string };

export function ResetPasswordForm({
  userId,
  displayName,
}: {
  userId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < MIN_PASSWORD) {
      setError(`密碼至少需要 ${MIN_PASSWORD} 個字元。`);
      return;
    }

    setPending(true);
    setError(null);
    setDone(false);
    try {
      const response = await fetch(`/api/users/${userId}/password-reset`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ newPassword }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null;
        setError(body?.message ?? "無法重設密碼，請稍後再試。");
        return;
      }
      setNewPassword("");
      setDone(true);
      router.refresh();
    } catch {
      setError("無法連線到伺服器，請檢查網路後再試一次。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="cc-stack" onSubmit={handleSubmit} noValidate>
      {done ? (
        <Alert tone="success" title="密碼已重設">
          {displayName} 的所有工作階段已結束，下次登入需使用新密碼。
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title="無法重設密碼" assertive>
          {error}
        </Alert>
      ) : null}

      <Field
        label="新密碼"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        requiredMark
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        help={`至少 ${MIN_PASSWORD} 個字元。請透過安全管道告知使用者，不要以純文字留存。`}
        disabled={pending}
      />

      <div className="cc-row">
        <Button
          type="submit"
          variant="danger-quiet"
          loading={pending}
          loadingLabel="重設中…"
        >
          重設密碼
        </Button>
      </div>
    </form>
  );
}
