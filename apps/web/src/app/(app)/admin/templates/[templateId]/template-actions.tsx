"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@workflow/ui";
import { csrfHeaders } from "@/lib/csrf";
import type { AdminTemplate, AdminTemplateVersion } from "@/lib/template-admin-model";
import { newMutationId } from "@/lib/mutation-id";

type ApiError = { message?: string; requestId?: string | undefined };

function useTemplateMutation() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function send(
    path: string,
    method: "POST" | "PATCH" | "PUT",
    body: Record<string, unknown>,
    label: string,
  ): Promise<boolean> {
    setPending(label);
    setError(null);
    try {
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ clientMutationId: newMutationId(), ...body }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ApiError | null;
        setError({
          message: payload?.message ?? "操作失敗，請稍後再試。",
          requestId: payload?.requestId,
        });
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError({ message: "無法連線到伺服器，請檢查網路後再試一次。" });
      return false;
    } finally {
      setPending(null);
    }
  }

  return { pending, error, send };
}

function ErrorAlert({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <Alert tone="danger" title="無法完成操作" assertive>
      <p>{error.message}</p>
      {error.requestId ? (
        <p className="cc-caption" style={{ marginTop: "var(--cc-space-1)" }}>
          錯誤代碼 {error.requestId}
        </p>
      ) : null}
    </Alert>
  );
}

/**
 * Activation decides only whether new sheets may be created from this template.
 * It never rewrites a version, and never touches sheets already pinned to one.
 */
export function ActivationControl({ template }: { template: AdminTemplate }) {
  const { pending, error, send } = useTemplateMutation();
  const [confirming, setConfirming] = useState(false);

  const canActivate = template.currentVersionNumber !== null;

  return (
    <div className="cc-stack">
      <ErrorAlert error={error} />
      <p className="cc-body-sm cc-secondary">
        {template.active
          ? "已啟用：主管可以用這個範本建立新的生產單。停用後既有生產單不受影響，仍可繼續處理。"
          : "未啟用：無法用這個範本建立新的生產單。啟用需要一個已發布的版本。"}
      </p>

      {!template.active && !canActivate ? (
        <p className="cc-help">
          這個範本沒有設定目前版本，因此無法啟用
          {template.versions.some((version) => version.publishedAt !== null)
            ? " — 即使已有發布過的版本，也必須有一個被指定為目前版本。發布新版本時會一併指定。"
            : "。請先發布一個版本。"}
        </p>
      ) : confirming ? (
        <Alert
          tone="warning"
          title={template.active ? "確認停用此範本？" : "確認啟用此範本？"}
        >
          <p className="cc-body-sm">
            {template.active
              ? "停用後不能再用它建立新的生產單。已經建立的生產單維持原本的版本，不受影響。"
              : `啟用後，符合條件的主管可立即用第 ${template.currentVersionNumber} 版建立生產單。`}
          </p>
          <div className="cc-row" style={{ marginTop: "var(--cc-space-3)" }}>
            <Button
              variant={template.active ? "danger" : "primary"}
              loading={pending === "activation"}
              loadingLabel="處理中…"
              onClick={() =>
                void send(
                  `/api/admin/templates/${template.id}`,
                  "PATCH",
                  { active: !template.active },
                  "activation",
                ).then((ok) => ok && setConfirming(false))
              }
            >
              {template.active ? "確認停用" : "確認啟用"}
            </Button>
            <Button
              variant="secondary"
              disabled={pending !== null}
              onClick={() => setConfirming(false)}
            >
              取消
            </Button>
          </div>
        </Alert>
      ) : (
        <div className="cc-row">
          <Button
            variant={template.active ? "danger-quiet" : "primary"}
            onClick={() => setConfirming(true)}
          >
            {template.active ? "停用範本" : "啟用範本"}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Publishing is irreversible: definition, source reference, notes, publisher and
 * time become immutable, and a later correction must be a new version. The
 * confirmation says so, and the caller decides in the same action whether the
 * template becomes active.
 */
export function PublishControl({
  template,
  version,
  blockers,
}: {
  template: AdminTemplate;
  version: AdminTemplateVersion;
  blockers: string[];
}) {
  const { pending, error, send } = useTemplateMutation();
  const [confirming, setConfirming] = useState(false);
  const [activate, setActivate] = useState(template.active);

  if (blockers.length > 0) {
    return (
      <div className="cc-stack">
        <p className="cc-body-sm cc-secondary">此版本尚未符合發布條件：</p>
        <ul style={{ margin: 0, paddingInlineStart: 20 }}>
          {blockers.map((blocker) => (
            <li key={blocker} className="cc-body-sm">
              {blocker}
            </li>
          ))}
        </ul>
        <p className="cc-help">
          這些條件由伺服器再次驗證。定義本身必須先經過轉錄確認，不在此畫面編輯。
        </p>
      </div>
    );
  }

  return (
    <div className="cc-stack">
      <ErrorAlert error={error} />
      {confirming ? (
        <Alert tone="warning" title={`確認發布第 ${version.version} 版？`}>
          <p className="cc-body-sm">
            發布無法復原：定義、來源指紋、變更說明、發布者與時間都會固定下來，日後修正必須建立新的版本。
            已建立的生產單仍會維持它們原本的版本。
          </p>
          <label className="cc-choice" style={{ marginTop: "var(--cc-space-3)" }}>
            <input
              type="checkbox"
              checked={activate}
              disabled={pending !== null}
              onChange={(event) => setActivate(event.target.checked)}
            />
            <span className="cc-body-sm">發布後同時啟用此範本，可立即建立生產單</span>
          </label>
          <div className="cc-row" style={{ marginTop: "var(--cc-space-3)" }}>
            <Button
              variant="primary"
              loading={pending === "publish"}
              loadingLabel="發布中…"
              onClick={() =>
                void send(
                  `/api/admin/templates/${template.id}/versions/${version.id}/publish`,
                  "POST",
                  { active: activate },
                  "publish",
                ).then((ok) => ok && setConfirming(false))
              }
            >
              確認發布
            </Button>
            <Button
              variant="secondary"
              disabled={pending !== null}
              onClick={() => setConfirming(false)}
            >
              取消
            </Button>
          </div>
        </Alert>
      ) : (
        <div className="cc-row">
          <Button variant="primary" onClick={() => setConfirming(true)}>
            發布第 {version.version} 版
          </Button>
        </div>
      )}
    </div>
  );
}
