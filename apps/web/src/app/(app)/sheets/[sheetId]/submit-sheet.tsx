"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Alert, Button } from "@workflow/ui";
import type { SessionUser } from "@workflow/contracts";
import { csrfHeaders } from "@/lib/csrf";
import { useInteractive } from "@/lib/use-interactive";
import {
  describeFieldKey,
  submitActionLabel,
  type SheetDetail,
} from "@/lib/sheet-model";
import { canSubmit } from "@/lib/sheet-permissions";
import { useSheetRefresh } from "@/lib/sheet-refresh-provider";
import { newMutationId } from "@/lib/mutation-id";

/**
 * Submitting is a second, deliberate step — not a side effect of saving.
 *
 * Saving writes the operator's edits and can be repeated freely. Submitting
 * fingerprints the values and opens the approval run (DESIGN.md §7.2), so it
 * asks for confirmation first and refuses to run while edits are still sitting
 * unsaved in the browser: those values would not be part of what gets reviewed.
 */
type SubmitState =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "sending" }
  // Handed on to another department, which this reader may no longer see.
  | { kind: "routed"; destination: string }
  // Sent for review: it stays here, locked, until 業務, 協理 and 總經理 approve.
  | { kind: "reviewing" }
  | { kind: "error"; message: string; issues: string[] };

type SubmitErrorBody = {
  message?: string;
  details?: { validationIssues?: string[]; missingRoles?: string[] };
};

export function useSheetSubmit(sheet: SheetDetail, user: SessionUser) {
  const scheduleSheetRefresh = useSheetRefresh();
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  const submit = useCallback(async () => {
    setState({ kind: "sending" });
    try {
      const response = await fetch(`/api/sheets/${sheet.id}/submit`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ clientMutationId: newMutationId() }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as SubmitErrorBody | null;
        const missing = body?.details?.validationIssues ?? [];
        const roles = body?.details?.missingRoles ?? [];
        setState({
          kind: "error",
          message: body?.message ?? "送出失敗，請重試。",
          issues: [
            ...missing.map((key) => describeFieldKey(sheet.template.definition, key)),
            ...roles.map((role) => `尚未指派審核角色：${role}`),
          ],
        });
        return;
      }

      if (sheet.review.outstanding) {
        setState({ kind: "reviewing" });
        scheduleSheetRefresh();
        return;
      }
      // Sent to another department: this reader may no longer be able to open
      // it, so the page says where it went rather than refreshing into a
      // refusal.
      if (sheet.releaseDestination) {
        setState({ kind: "routed", destination: sheet.releaseDestination.displayName });
        return;
      }
      setState({ kind: "idle" });
      // The server owns the new state, the approval run and the version, so the
      // page is re-fetched rather than patched from the response.
      scheduleSheetRefresh();
    } catch {
      setState({
        kind: "error",
        message: "無法連線到伺服器，表單尚未送出。",
        issues: [],
      });
    }
  }, [scheduleSheetRefresh, sheet.id, sheet.releaseDestination, sheet.review.outstanding, sheet.template.definition]);

  return {
    state,
    // The pinned template version decides which origin-department identities
    // may submit. Reviewers remain excluded unless that immutable policy says
    // otherwise.
    submittable: canSubmit(user, sheet),
    confirm: () => setState({ kind: "confirming" }),
    cancel: () => setState({ kind: "idle" }),
    submit,
  };
}

export function SubmitNotice({
  sheet,
  state,
  unsavedCount,
  onCancel,
  onSubmit,
  departmentHref,
}: {
  sheet: SheetDetail;
  state: SubmitState;
  departmentHref: string;
  unsavedCount: number;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const interactive = useInteractive();
  const label = submitActionLabel(sheet.releaseDestination, sheet.review.outstanding);
  if (state.kind === "reviewing") {
    return (
      <Alert tone="success" title="已送出審核" assertive>
        <p className="cc-body-sm">
          這張生產單已送出審核，由業務、協理、總經理依序核准。審核期間無法修改；若被退回，會回到本部門並附上原因。
        </p>
      </Alert>
    );
  }
  if (state.kind === "routed") {
    return (
      <Alert tone="success" title={`已送交${state.destination}`} assertive>
        <p className="cc-body-sm">
          這張生產單已移至{state.destination}的待分派，由{state.destination}主管放入子分頁。本部門將無法再檢視它。
        </p>
        <p className="cc-body-sm" style={{ marginTop: "var(--cc-space-2)" }}>
          <Link href={departmentHref}>返回部門</Link>
        </p>
      </Alert>
    );
  }
  if (state.kind === "error") {
    return (
      <Alert tone="danger" title={`無法${label}`} assertive>
        <p>{state.message}</p>
        {state.issues.length > 0 ? (
          <>
            <p style={{ marginTop: "var(--cc-space-2)" }}>請補齊下列項目後再{label}：</p>
            <ul style={{ margin: "var(--cc-space-1) 0 0", paddingInlineStart: "20px" }}>
              {state.issues.map((issue) => (
                <li key={issue} className="cc-body-sm">
                  {issue}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Alert>
    );
  }

  if (state.kind !== "confirming" && state.kind !== "sending") return null;

  return (
    <Alert tone="warning" title={`確認${label}？`}>
      <p className="cc-body-sm">
        {sheet.review.outstanding
          ? `送出後由業務、協理、總經理依序審核，審核期間無法修改。全部核准後${
              sheet.releaseDestination
                ? `會移至${sheet.releaseDestination.displayName}的待分派，由${sheet.releaseDestination.displayName}主管放入子分頁。`
                : "留在本部門，即可更新生產狀態。"
            }`
          : sheet.releaseDestination
          ? `送交後會移至${sheet.releaseDestination.displayName}的待分派，由${sheet.releaseDestination.displayName}主管放入子分頁，再由${sheet.releaseDestination.displayName}更新生產狀態。送交後本部門將無法再檢視這張生產單。`
          : null}
      </p>
      <div className="cc-row" style={{ marginTop: "var(--cc-space-3)" }}>
        <Button
          variant="primary"
          loading={state.kind === "sending"}
          loadingLabel={sheet.review.outstanding ? "送出中…" : "送交中…"}
          disabled={unsavedCount > 0 || !interactive}
          onClick={onSubmit}
        >
          {sheet.review.outstanding ? "確認送出審核" : "確認送交"}
        </Button>
        <Button
          variant="secondary"
          disabled={state.kind === "sending" || !interactive}
          onClick={onCancel}
        >
          取消
        </Button>
      </div>
    </Alert>
  );
}
