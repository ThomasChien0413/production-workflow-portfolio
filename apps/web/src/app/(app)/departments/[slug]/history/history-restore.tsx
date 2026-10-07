"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@workflow/ui";
import { csrfHeaders } from "@/lib/csrf";
import { newMutationId } from "@/lib/mutation-id";

/**
 * Brings an archived sheet back to its subpage as 已完成 (the user,
 * 2026-10-04). Only the department's 主管 is offered it; the API decides.
 * Archiving it again undoes it, so one press does it.
 */
export function HistoryRestore({
  sheetId,
  label,
}: {
  sheetId: string;
  /** What the button restores, for a screen reader: the form's name. */
  label: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function restore() {
    if (state.kind === "loading") return;
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/sheets/${sheetId}/restore`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ clientMutationId: newMutationId() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "恢復失敗，請稍後再試。");
      }
      setState({ kind: "idle" });
      router.refresh();
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "恢復失敗，請稍後再試。",
      });
    }
  }

  return (
    <span className="cc-stack" style={{ gap: "var(--cc-space-1)" }}>
      <Button
        variant="tertiary"
        loading={state.kind === "loading"}
        loadingLabel="恢復中…"
        onClick={() => void restore()}
      >
        恢復到子分頁
        <span className="cc-sr-only">：{label}</span>
      </Button>
      {state.kind === "error" ? (
        <span className="cc-error" role="alert">
          {state.message}
        </span>
      ) : null}
    </span>
  );
}
