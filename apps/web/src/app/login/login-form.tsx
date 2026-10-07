"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field } from "@workflow/ui";

type ApiError = { error?: string; message?: string; requestId?: string };

type FormError = { message: string; requestId?: string | undefined };
type FieldErrors = { username?: string | undefined; password?: string | undefined };

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Client-side checks are a convenience only. The API validates every field
    // again — see AGENTS.md section 6.
    const nextErrors: FieldErrors = {};
    if (username.trim() === "") nextErrors.username = "請輸入姓名或登入名稱。";
    if (password === "") nextErrors.password = "請輸入密碼。";
    setFieldErrors(nextErrors);
    if (nextErrors.username !== undefined || nextErrors.password !== undefined) {
      return;
    }

    setPending(true);
    setFormError(null);

    try {
      // Same-origin: next.config.ts rewrites /api to the Fastify service, which
      // keeps the SameSite=strict session cookie working.
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null;
        setFormError({
          // The API already returns Traditional Chinese messages, including the
          // lockout and rate-limit wording. Prefer them over inventing our own.
          message: body?.message ?? "登入失敗，請稍後再試。",
          requestId: body?.requestId,
        });
        return;
      }

      router.replace("/");
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
        <Alert tone="danger" title="無法登入" assertive>
          <p>{formError.message}</p>
          {formError.requestId ? (
            <p className="cc-caption" style={{ marginTop: "var(--cc-space-1)" }}>
              錯誤代碼 {formError.requestId}
            </p>
          ) : null}
        </Alert>
      ) : null}

      <Field
        label="姓名或登入名稱"
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        requiredMark
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        error={fieldErrors.username}
        disabled={pending}
      />

      <Field
        label="密碼"
        name="password"
        type="password"
        autoComplete="current-password"
        requiredMark
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
        disabled={pending}
      />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        block
        loading={pending}
        loadingLabel="登入中…"
      >
        登入
      </Button>

      <p className="cc-caption">
        連續登入失敗多次後，帳號會被暫時鎖定。請聯絡系統管理者詢問密碼。
      </p>
    </form>
  );
}
