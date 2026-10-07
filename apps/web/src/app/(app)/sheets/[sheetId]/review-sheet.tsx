"use client";

import { useState } from "react";
import { Alert, Button } from "@workflow/ui";
import { roleLabels, type RoleCode } from "@workflow/contracts";
import { csrfHeaders } from "@/lib/csrf";
import type { SheetDetail } from "@/lib/sheet-model";
import { useSheetRefresh } from "@/lib/sheet-refresh-provider";
import { useInteractive } from "@/lib/use-interactive";
import { newMutationId } from "@/lib/mutation-id";

type Decision = "APPROVE" | "REJECT";
type ApiError = { message?: string; requestId?: string | undefined };

/**
 * The reviewer's two decisions on 分條申請單, the one reviewed form (the
 * user, 2026-10-01).
 *
 * 核准 passes the sheet to the next of 業務, 協理 and 總經理; after 總經理 it
 * goes to 分條. 退回 returns it to the department that wrote it, unlocked, and
 * sending it again starts from 業務. A 退回 always carries a reason — the API
 * requires one, and without it the department fixing the sheet has nothing to
 * act on.
 */
export function ReviewSheet({
  sheet,
  requiredRole,
}: {
  sheet: SheetDetail;
  /** The role this stage is waiting on. The caller has already checked it. */
  requiredRole: RoleCode;
}) {
  const scheduleSheetRefresh = useSheetRefresh();
  // A decision pressed before hydration sends nothing at all — see
  // use-interactive.ts for the trace that finally showed this.
  const interactive = useInteractive();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const rejecting = decision === "REJECT";
  const commentMissing = rejecting && comment.trim().length === 0;

  async function decide(action: Decision) {
    if (action === "REJECT" && comment.trim().length === 0) return;
    setPending(true);
    setError(null);
    try {
      const path = action === "APPROVE" ? "approve" : "reject";
      const trimmed = comment.trim();
      const response = await fetch(`/api/sheets/${sheet.id}/${path}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({
          clientMutationId: newMutationId(),
          // Approval comments are optional; sending an empty string would fail
          // the contract's min-length check on the reject path and add noise on
          // the approve path.
          ...(trimmed.length > 0 ? { comment: trimmed } : {}),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null;
        setError({
          message:
            body?.message ??
            (action === "APPROVE" ? "無法核准，請稍後再試。" : "無法退回，請稍後再試。"),
          requestId: body?.requestId,
        });
        setPending(false);
        return;
      }
      setDecision(null);
      setComment("");
      // Coalesce this mutation's refresh with the matching real-time event.
      setPending(false);
      scheduleSheetRefresh();
    } catch {
      setError({ message: "無法連線到伺服器，請檢查網路後再試一次。" });
      setPending(false);
    }
  }

  return (
    <div className="cc-stack">
      {error ? (
        <Alert tone="danger" title="無法完成審核" assertive>
          <p>{error.message}</p>
          {error.requestId ? (
            <p className="cc-caption" style={{ marginTop: "var(--cc-space-1)" }}>
              錯誤代碼 {error.requestId}
            </p>
          ) : null}
        </Alert>
      ) : null}

      <p className="cc-body-sm cc-secondary">
        目前輪到你以 <strong>{roleLabels[requiredRole]}</strong> 身分審核這張生產單。
        核准後進入下一個審核階段，總經理核准後送至分條；退回後由撰寫部門修改並重新送出，屆時從業務重新審核。
      </p>

      <div className="cc-field">
        <label className="cc-label" htmlFor="review-comment">
          審核意見
          {rejecting ? (
            <span className="cc-label__required" aria-hidden="true">
              *
            </span>
          ) : (
            <span className="cc-label__optional">選填</span>
          )}
        </label>
        <textarea
          id="review-comment"
          className="cc-textarea"
          value={comment}
          maxLength={1000}
          disabled={pending}
          aria-describedby="review-comment-help"
          aria-invalid={commentMissing ? true : undefined}
          onChange={(event) => setComment(event.target.value)}
        />
        <p className="cc-help" id="review-comment-help">
          {rejecting
            ? "退回必須說明原因，撰寫部門會看到這段文字。"
            : "核准可以留下意見，也可以留空。退回則必須填寫原因。"}
        </p>
      </div>

      {decision === null ? (
        <div className="cc-row">
          {/* Approval is one tap: it moves the sheet forward and the next
              reviewer still sees it. Rejection confirms, because it voids every
              approval already given. */}
          <Button
            variant="primary"
            disabled={!interactive}
            loading={pending}
            loadingLabel="核准中…"
            onClick={() => void decide("APPROVE")}
          >
            核准
          </Button>
          <Button
            variant="danger-quiet"
            disabled={pending || !interactive}
            onClick={() => setDecision("REJECT")}
          >
            退回
          </Button>
        </div>
      ) : (
        <Alert tone="warning" title="確認退回？">
          <p className="cc-body-sm">
            退回後這張生產單回到撰寫部門並可再修改，這一輪的核准全部作廢，重新送出時從業務開始重新審核。
          </p>
          {commentMissing ? (
            <p className="cc-error" style={{ marginTop: "var(--cc-space-2)" }}>
              請先填寫退回原因。
            </p>
          ) : null}
          <div className="cc-row" style={{ marginTop: "var(--cc-space-3)" }}>
            <Button
              variant="danger"
              loading={pending}
              loadingLabel="退回中…"
              disabled={commentMissing}
              onClick={() => void decide("REJECT")}
            >
              確認退回
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => setDecision(null)}
            >
              取消
            </Button>
          </div>
        </Alert>
      )}
    </div>
  );
}
