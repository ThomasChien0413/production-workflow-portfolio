"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button } from "@workflow/ui";
import type { PushDevice } from "@workflow/contracts";
import {
  currentSubscription,
  disablePush,
  enablePush,
  isAppleMobile,
  pushSupport,
  sendTestPush,
  type PushSupport,
} from "@/lib/push";

function taipei(value: string | null): string {
  if (!value) return "尚未收到";
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

type Status =
  | { kind: "checking" }
  | { kind: "unavailable"; support: Exclude<PushSupport, "ready"> }
  | { kind: "off" }
  | { kind: "on" };

/**
 * 通知 in 設定 (the user, 2026-10-04: phone and browser push replaced LINE).
 * Each phone or computer is turned on separately; this card says what this
 * one needs and lists the ones already on.
 */
export function PushSettings() {
  const [status, setStatus] = useState<Status>({ kind: "checking" });
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [busy, setBusy] = useState<"enable" | "disable" | "test" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const support = pushSupport();
    if (support !== "ready") setStatus({ kind: "unavailable", support });
    else setStatus((await currentSubscription()) ? { kind: "on" } : { kind: "off" });
    try {
      const response = await fetch("/api/push/devices", { credentials: "same-origin", cache: "no-store" });
      if (response.ok) setDevices(((await response.json()) as { devices: PushDevice[] }).devices);
    } catch {
      setDevices(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: "enable" | "disable" | "test") {
    setBusy(action);
    setNotice(null);
    try {
      if (action === "enable") await enablePush();
      if (action === "disable") await disablePush();
      if (action === "test") await sendTestPush();
      setNotice({
        tone: "success",
        text:
          action === "enable"
            ? "此裝置已開啟通知。可以傳送一則測試通知確認。"
            : action === "disable"
              ? "此裝置已關閉通知。"
              : "測試通知已送出，幾秒內應會在此裝置跳出。",
      });
    } catch (error) {
      setNotice({ tone: "danger", text: error instanceof Error ? error.message : "操作失敗，請稍後再試。" });
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  return (
    <div className="cc-stack">
      <p className="cc-body-sm cc-secondary">
        生產單需要你處理、已逾期或狀態改變時，會在你的手機或電腦上跳出通知。每一台裝置需要各自開啟一次。
      </p>

      {notice ? (
        <Alert tone={notice.tone} title={notice.tone === "success" ? "完成" : "無法完成"} assertive={notice.tone === "danger"}>
          {notice.text}
        </Alert>
      ) : null}

      {status.kind === "checking" ? (
        <p className="cc-body-sm cc-muted" role="status">
          正在檢查此裝置…
        </p>
      ) : null}

      {status.kind === "unavailable" && status.support === "needs-install" ? (
        <Alert tone="info" title="iPhone／iPad 需要先加入主畫面">
          <ol style={{ margin: 0, paddingInlineStart: "1.25em" }}>
            <li>點瀏覽器的「分享」按鈕（Safari 在畫面下方，Chrome 在網址列右側）。</li>
            <li>選擇「加入主畫面」，再點「新增」。</li>
            <li>回到手機主畫面，從「Workflow Portfolio」圖示開啟。</li>
            <li>再到「設定」，點「在此裝置開啟通知」並選擇「允許」。</li>
          </ol>
          <p className="cc-caption" style={{ marginTop: "var(--cc-space-2)" }}>需要 iOS 16.4 或更新版本。</p>
        </Alert>
      ) : null}
      {status.kind === "unavailable" && status.support === "blocked" ? (
        <Alert tone="warning" title="此裝置已封鎖 Workflow Portfolio 的通知">
          {isAppleMobile()
            ? "請到 iPhone 的「設定」→「通知」→「Workflow Portfolio」，開啟「允許通知」，然後重新開啟 Workflow Portfolio。"
            : "請點網址列左側的網站設定圖示，將「通知」改為「允許」，然後重新整理此頁。"}
        </Alert>
      ) : null}
      {status.kind === "unavailable" && status.support === "unsupported" ? (
        <Alert tone="warning" title="此瀏覽器無法接收通知">
          請改用最新版的 Chrome、Edge、Firefox 或 Safari。
        </Alert>
      ) : null}
      {status.kind === "unavailable" && status.support === "insecure" ? (
        <Alert tone="warning" title="需要安全連線才能開啟通知">
          通知只能在 https:// 開頭的網址使用。正式網址上線後即可開啟。
        </Alert>
      ) : null}

      {status.kind === "off" ? (
        <div className="cc-row">
          <Button variant="primary" loading={busy === "enable"} loadingLabel="開啟中…" onClick={() => void run("enable")}>
            在此裝置開啟通知
          </Button>
        </div>
      ) : null}
      {status.kind === "on" ? (
        <>
          <p className="cc-body-sm">
            <strong>此裝置已開啟通知。</strong>
          </p>
          <div className="cc-row">
            <Button variant="secondary" loading={busy === "test"} loadingLabel="傳送中…" onClick={() => void run("test")}>
              傳送測試通知
            </Button>
            <Button
              variant="tertiary"
              disabled={busy !== null}
              loading={busy === "disable"}
              loadingLabel="關閉中…"
              onClick={() => void run("disable")}
            >
              關閉此裝置的通知
            </Button>
          </div>
        </>
      ) : null}

      {devices ? (
        <div>
          <p className="cc-overline">已開啟通知的裝置</p>
          {devices.length === 0 ? (
            <p className="cc-body-sm cc-muted">還沒有任何裝置。你目前收不到手機或電腦通知，只能在「通知」頁面查看。</p>
          ) : (
            <ul className="cc-stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: "var(--cc-space-1)" }}>
              {devices.map((device) => (
                <li key={device.id} className="cc-body-sm">
                  {device.deviceLabel ?? "未命名裝置"}
                  <span className="cc-caption cc-muted">　最近收到：{taipei(device.lastSuccessAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
