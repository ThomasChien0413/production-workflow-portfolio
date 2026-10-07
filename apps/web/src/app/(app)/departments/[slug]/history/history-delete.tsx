"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@workflow/ui";
import { csrfHeaders } from "@/lib/csrf";
import { newMutationId } from "@/lib/mutation-id";

/**
 * Deletes an archived sheet now rather than a year after 封存 (the user,
 * 2026-10-04). It cannot be undone, so it confirms beside the button, as 封存
 * does. Only the department's 主管 and ADMIN/總經理 are offered it; the API
 * decides.
 */
export function HistoryDelete({
  sheetId,
  label,
}: {
  sheetId: string;
  /** What the button deletes, for a screen reader: the form's name. */
  label: string;
}) {
  const router = useRouter();
  // One mutation id per confirmation, so a repeated press replays.
  const [mutationId, setMutationId] = useState<string | null>(null);
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function remove() {
    if (state.kind === "loading" || !mutationId) return;
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/sheets/${sheetId}/delete`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ clientMutationId: mutationId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "刪除失敗，請稍後再試。");
      }
      setMutationId(null);
      setState({ kind: "idle" });
      router.refresh();
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "刪除失敗，請稍後再試。",
      });
    }
  }

  if (!mutationId) {
    return (
      <Button variant="danger-quiet" onClick={() => setMutationId(newMutationId())}>
        刪除
        <span className="cc-sr-only">：{label}</span>
      </Button>
    );
  }
  return (
    <span className="cc-stack" style={{ gap: "var(--cc-space-1)" }} role="group" aria-label={`確認刪除 ${label}`}>
      <span className="cc-caption">永久刪除這張生產單與附件？此操作無法復原。</span>
      <span className="cc-row" style={{ flexWrap: "nowrap" }}>
        <Button
          variant="danger"
          loading={state.kind === "loading"}
          loadingLabel="刪除中…"
          onClick={() => void remove()}
        >
          確認刪除
        </Button>
        <Button
          variant="secondary"
          disabled={state.kind === "loading"}
          onClick={() => {
            setMutationId(null);
            setState({ kind: "idle" });
          }}
        >
          取消
        </Button>
      </span>
      {state.kind === "error" ? (
        <span className="cc-error" role="alert">
          {state.message}
        </span>
      ) : null}
    </span>
  );
}
