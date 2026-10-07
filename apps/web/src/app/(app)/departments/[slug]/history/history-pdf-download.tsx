"use client";

import { useState } from "react";
import { Button } from "@workflow/ui";

export function HistoryPdfDownload({
  sheetId,
  label,
}: {
  sheetId: string;
  /** What the button downloads, for a screen reader: the form's name. */
  label: string;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function download() {
    if (state.kind === "loading") return;
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/sheets/${sheetId}/pdf`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(body?.message ?? "PDF 產生失敗，請稍後再試。");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const filename = encodedName ? decodeURIComponent(encodedName) : "sheet.pdf";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setState({ kind: "success" });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "PDF 產生失敗，請稍後再試。",
      });
    }
  }

  return (
    <span className="cc-stack" style={{ gap: "var(--cc-space-1)" }}>
      <Button
        variant="tertiary"
        loading={state.kind === "loading"}
        loadingLabel="正在產生 PDF…"
        onClick={() => void download()}
      >
        下載 PDF
        <span className="cc-sr-only">：{label}</span>
      </Button>
      {state.kind === "error" ? (
        <span className="cc-error" role="alert">
          {state.message}
        </span>
      ) : (
        <span className="cc-sr-only" role="status">
          {state.kind === "success" ? "PDF 已開始下載。" : ""}
        </span>
      )}
    </span>
  );
}
