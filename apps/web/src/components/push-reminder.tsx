"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert } from "@workflow/ui";
import { currentSubscription, pushSupport, syncPush } from "@/lib/push";

/**
 * Keeps this device registered with whoever is signed in (the user,
 * 2026-10-04): a shared phone then notifies its current user, and a renewed
 * browser subscription is not lost. Renders nothing.
 */
export function PushSync() {
  useEffect(() => {
    void syncPush();
  }, []);
  return null;
}

/**
 * The home page's reminder: shown until notifications are on for this
 * device. Not a gate (the user, 2026-10-04): everything works without it,
 * only the pop-ups are missing. Silent where the device cannot do push at all.
 */
export function PushReminder() {
  const [state, setState] = useState<"hidden" | "off" | "needs-install" | "blocked">("hidden");

  useEffect(() => {
    void (async () => {
      const support = pushSupport();
      if (support === "needs-install" || support === "blocked") setState(support);
      else if (support === "ready") setState((await currentSubscription()) ? "hidden" : "off");
    })();
  }, []);

  if (state === "hidden") return null;
  const action = (
    <Link className="cc-btn cc-btn--secondary" href="/settings#notifications">
      前往設定
    </Link>
  );
  if (state === "blocked") {
    return (
      <Alert tone="warning" title="此裝置封鎖了通知" actions={action}>
        生產單需要你處理或逾期時，此裝置不會跳出提醒。到「設定」查看如何重新允許。
      </Alert>
    );
  }
  return (
    <Alert tone="info" title="開啟通知，才收得到生產單提醒" actions={action}>
      {state === "needs-install"
        ? "iPhone／iPad 需要先把 Workflow Portfolio 加入主畫面，才能像其他 App 一樣跳出通知。「設定」裡有步驟說明。"
        : "此裝置還沒開啟通知。開啟後，生產單需要你處理或逾期時，會像其他 App 一樣跳出提醒。"}
    </Alert>
  );
}
