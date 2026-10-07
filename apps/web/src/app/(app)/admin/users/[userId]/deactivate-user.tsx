"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@workflow/ui";
import { csrfHeaders } from "@/lib/csrf";
import type { AdminUser } from "@/lib/admin";

type ApiError = { message?: string; requestId?: string | undefined };

/**
 * Deactivation is the deletion this system has.
 *
 * Accounts are never removed: every approval, edit and handoff records who did
 * it, and deleting the row would leave those histories pointing at nothing.
 * Deactivating disables sign-in, clears roles and department memberships, and
 * ends every open session immediately — the account keeps existing only so the
 * audit trail keeps making sense.
 */
export function DeactivateUser({
  user,
  isSelf,
}: {
  user: AdminUser;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (!user.active) {
    return (
      <p className="cc-body-sm cc-secondary">
        此帳號已停用，無法登入，且沒有任何角色或部門身分。若要重新啟用，請在上方
        「帳號設定」開啟帳號狀態並重新指派角色或部門。
      </p>
    );
  }

  async function deactivate() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        // Roles and memberships must be cleared in the same request: the API
        // refuses a disabled account that still holds either.
        body: JSON.stringify({ active: false, roles: [], memberships: [] }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null;
        setError({
          message: body?.message ?? "無法停用此帳號，請稍後再試。",
          requestId: body?.requestId,
        });
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError({ message: "無法連線到伺服器，請檢查網路後再試一次。" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="cc-stack">
      {error ? (
        <Alert tone="danger" title="無法停用" assertive>
          <p>{error.message}</p>
          {error.requestId ? (
            <p className="cc-caption" style={{ marginTop: "var(--cc-space-1)" }}>
              錯誤代碼 {error.requestId}
            </p>
          ) : null}
        </Alert>
      ) : null}

      <p className="cc-body-sm cc-secondary">
        停用會立即結束 {user.displayName} 的所有工作階段，並移除其角色與部門身分。
        帳號本身會保留，過往的建立、編輯與審核紀錄仍看得到是誰做的。
      </p>

      {isSelf ? (
        <p className="cc-help">
          無法停用目前登入的帳號。請由另一位系統管理員或總經理操作。
        </p>
      ) : confirming ? (
        <Alert tone="warning" title={`確認停用 ${user.displayName}？`}>
          <p className="cc-body-sm">
            對方會立即被登出，且在重新指派角色或部門之前無法再次登入。
          </p>
          <div className="cc-row" style={{ marginTop: "var(--cc-space-3)" }}>
            <Button
              variant="danger"
              loading={pending}
              loadingLabel="停用中…"
              onClick={() => void deactivate()}
            >
              確認停用
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              取消
            </Button>
          </div>
        </Alert>
      ) : (
        <div className="cc-row">
          <Button variant="danger-quiet" onClick={() => setConfirming(true)}>
            停用帳號
          </Button>
        </div>
      )}
    </div>
  );
}
