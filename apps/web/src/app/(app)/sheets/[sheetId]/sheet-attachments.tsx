"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SHEET_ATTACHMENT_MAX_UPLOAD_BYTES, type SheetAttachmentPage } from "@workflow/contracts";
import { Alert, Button, ScrollRegion } from "@workflow/ui";
import { csrfHeaders } from "@/lib/csrf";
import { formatTaipeiDateTime } from "@/lib/taipei";
import { newMutationId } from "@/lib/mutation-id";

function fileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string") return body.message;
  } catch {
    // Proxies may return HTML; the status fallback remains actionable.
  }
  return `附件操作失敗（${response.status}）`;
}

export function SheetAttachments({
  sheetId,
  initialPage,
}: {
  sheetId: string;
  initialPage: SheetAttachmentPage;
}) {
  const [page, setPage] = useState(initialPage);
  const [selected, setSelected] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  busyRef.current = uploading || removingId !== null || confirmId !== null;

  const loadPage = useCallback(
    async (nextPage: number) => {
      setRefreshing(true);
      try {
        const response = await fetch(
          `/api/sheets/${sheetId}/attachments?page=${nextPage}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(await responseMessage(response));
        setPage((await response.json()) as SheetAttachmentPage);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "附件清單暫時無法更新");
      } finally {
        setRefreshing(false);
      }
    },
    [sheetId],
  );

  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ sheetId?: string }>).detail;
      if (detail?.sheetId !== sheetId) return;
      if (busyRef.current) {
        pendingRefreshRef.current = true;
        return;
      }
      void loadPage(page.page);
    };
    window.addEventListener("workflow:sheet-attachment-changed", changed);
    return () => window.removeEventListener("workflow:sheet-attachment-changed", changed);
  }, [loadPage, page.page, sheetId]);

  useEffect(() => {
    if (busyRef.current || !pendingRefreshRef.current) return;
    pendingRefreshRef.current = false;
    void loadPage(page.page);
  }, [confirmId, loadPage, page.page, removingId, uploading]);

  const chooseFile = (file: File | null) => {
    setMessage(null);
    setError(null);
    if (!file) {
      setSelected(null);
      return;
    }
    if (!/\.pdf$/iu.test(file.name)) {
      setSelected(null);
      setError("請選擇副檔名為 .pdf 的檔案。");
      return;
    }
    if (
      file.type !== "" &&
      file.type !== "application/pdf" &&
      file.type !== "application/octet-stream"
    ) {
      setSelected(null);
      setError("選取的檔案內容類型不是 PDF。");
      return;
    }
    if (file.size === 0) {
      setSelected(null);
      setError("附件不可為空白檔案。");
      return;
    }
    if (file.size > SHEET_ATTACHMENT_MAX_UPLOAD_BYTES) {
      setSelected(null);
      setError("附件不可超過 95 MB。");
      return;
    }
    setSelected(file);
  };

  const upload = () => {
    if (!selected || uploading) return;
    setUploading(true);
    setProgress(0);
    setError(null);
    setMessage(null);
    const body = new FormData();
    body.append("file", selected);
    const request = new XMLHttpRequest();
    request.open("POST", `/api/sheets/${sheetId}/attachments`);
    for (const [name, value] of Object.entries(csrfHeaders())) {
      request.setRequestHeader(name, value);
    }
    request.setRequestHeader("Idempotency-Key", newMutationId());
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        setProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    });
    request.addEventListener("load", () => {
      setUploading(false);
      if (request.status >= 200 && request.status < 300) {
        setProgress(100);
        setSelected(null);
        if (fileInput.current) fileInput.current.value = "";
        setMessage("附件已上傳。");
        void loadPage(1);
        return;
      }
      try {
        const body = JSON.parse(request.responseText) as { message?: unknown };
        setError(
          typeof body.message === "string"
            ? body.message
            : `附件上傳失敗（${request.status}）`,
        );
      } catch {
        setError(`附件上傳失敗（${request.status}）`);
      }
    });
    request.addEventListener("error", () => {
      setUploading(false);
      setError("網路中斷，附件尚未上傳。可保留檔案後重試。");
    });
    request.addEventListener("abort", () => {
      setUploading(false);
      setError("附件上傳已中止。");
    });
    request.send(body);
  };

  const remove = async (attachmentId: string) => {
    if (removingId) return;
    setRemovingId(attachmentId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/sheets/${sheetId}/attachments/${attachmentId}`,
        {
          method: "DELETE",
          headers: { ...csrfHeaders(), "Idempotency-Key": newMutationId() },
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      setConfirmId(null);
      setMessage("附件已永久移除。");
      const target = page.items.length === 1 && page.page > 1 ? page.page - 1 : page.page;
      await loadPage(target);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "附件暫時無法移除");
    } finally {
      setRemovingId(null);
    }
  };

  const actions = (attachment: SheetAttachmentPage["items"][number]) => (
    <div className="cc-row cc-attachment-actions">
      <a
        className="cc-btn cc-btn--secondary"
        href={`/api/sheets/${sheetId}/attachments/${attachment.id}/content?disposition=inline`}
        target="_blank"
        rel="noopener noreferrer"
      >
        預覽<span className="cc-sr-only">（在新分頁開啟 {attachment.filename}）</span>
      </a>
      <a
        className="cc-btn cc-btn--secondary"
        href={`/api/sheets/${sheetId}/attachments/${attachment.id}/content?disposition=attachment`}
        download
      >
        下載<span className="cc-sr-only"> {attachment.filename}</span>
      </a>
      {page.canModify ? (
        <Button
          variant="danger-quiet"
          type="button"
          onClick={() => setConfirmId(attachment.id)}
          disabled={removingId !== null}
        >
          移除
        </Button>
      ) : null}
    </div>
  );

  const confirmation = (attachment: SheetAttachmentPage["items"][number]) => (
    <div className="cc-attachment-confirm" role="group" aria-label={`移除 ${attachment.filename}`}>
      <p>確定永久移除此附件？此動作無法復原。</p>
      <div className="cc-row">
        <Button
          variant="danger"
          type="button"
          loading={removingId === attachment.id}
          loadingLabel="正在移除…"
          onClick={() => void remove(attachment.id)}
        >
          確定移除
        </Button>
        <Button type="button" onClick={() => setConfirmId(null)} disabled={removingId !== null}>
          取消
        </Button>
      </div>
    </div>
  );

  return (
    <section className="cc-card" aria-labelledby="sheet-attachments-title">
      <div className="cc-card__header">
        <div>
          <h2 className="cc-h3" id="sheet-attachments-title">附件</h2>
          <p className="cc-body-sm cc-muted">PDF 支援文件，不會併入生產單 PDF。</p>
        </div>
        <span className="cc-caption cc-muted" aria-live="polite">
          {refreshing ? "正在更新附件…" : `共 ${page.total} 個附件`}
        </span>
      </div>
      <div className="cc-card__body cc-stack">
        {page.canModify ? (
          <div className="cc-attachment-upload">
            <label className="cc-label" htmlFor="sheet-attachment-file">選擇 PDF 附件</label>
            <input
              ref={fileInput}
              className="cc-sr-only"
              id="sheet-attachment-file"
              type="file"
              accept=".pdf,application/pdf,application/octet-stream"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              disabled={uploading}
              aria-describedby="sheet-attachment-help"
            />
            <label className="cc-btn cc-btn--secondary" htmlFor="sheet-attachment-file">
              選擇檔案
            </label>
            <p className="cc-caption cc-muted" id="sheet-attachment-help">
              一次一個 PDF，每個檔案上限 95 MB。
            </p>
            {selected ? (
              <p className="cc-body-sm cc-attachment-filename">
                已選擇：{selected.name}（{fileSize(selected.size)}）
              </p>
            ) : null}
            {uploading ? (
              <div aria-live="polite">
                <progress value={progress} max={100} aria-label="附件上傳進度" />
                <span className="cc-body-sm"> 正在上傳附件… {progress}%</span>
              </div>
            ) : null}
            <Button
              type="button"
              variant="primary"
              onClick={upload}
              disabled={!selected || uploading}
              loading={uploading}
              loadingLabel="正在上傳附件…"
            >
              {error && selected ? "重試上傳" : "上傳附件"}
            </Button>
          </div>
        ) : null}

        {error ? <Alert tone="danger" title="附件操作失敗" assertive>{error}</Alert> : null}
        {message ? <Alert tone="success" title={message} /> : null}

        {page.items.length === 0 ? (
          <div className="cc-empty">
            <p className="cc-empty__title">尚無附件</p>
            <p className="cc-empty__text">此生產單目前沒有 PDF 附件。</p>
          </div>
        ) : (
          <>
            <ScrollRegion label="生產單附件清單" className="cc-only-wide">
              <table className="cc-table">
                <thead>
                  <tr><th>檔名</th><th>大小</th><th>上傳者</th><th>上傳時間</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {page.items.map((attachment) => (
                    <tr key={attachment.id}>
                      <td className="cc-attachment-filename">{attachment.filename}</td>
                      <td>{fileSize(attachment.sizeBytes)}</td>
                      <td>{attachment.uploader.displayName}</td>
                      <td className="cc-tnum">{formatTaipeiDateTime(attachment.uploadedAt)}</td>
                      <td>{confirmId === attachment.id ? confirmation(attachment) : actions(attachment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>

            <div className="cc-only-narrow cc-stack" aria-label="生產單附件清單">
              {page.items.map((attachment) => (
                <article className="cc-sheet-card cc-attachment-card" key={attachment.id}>
                  <h3 className="cc-sheet-card__title cc-attachment-filename">{attachment.filename}</h3>
                  <dl className="cc-sheet-card__meta">
                    <dt>大小</dt><dd>{fileSize(attachment.sizeBytes)}</dd>
                    <dt>上傳者</dt><dd>{attachment.uploader.displayName}</dd>
                    <dt>上傳時間</dt><dd className="cc-tnum">{formatTaipeiDateTime(attachment.uploadedAt)}</dd>
                  </dl>
                  {confirmId === attachment.id ? confirmation(attachment) : actions(attachment)}
                </article>
              ))}
            </div>
          </>
        )}

        {page.total > page.pageSize ? (
          <nav className="cc-row" aria-label="附件分頁">
            <Button type="button" onClick={() => void loadPage(page.page - 1)} disabled={page.page <= 1 || refreshing}>上一頁</Button>
            <span className="cc-body-sm cc-muted">第 {page.page} 頁</span>
            <Button type="button" onClick={() => void loadPage(page.page + 1)} disabled={page.page * page.pageSize >= page.total || refreshing}>下一頁</Button>
          </nav>
        ) : null}
      </div>
    </section>
  );
}
