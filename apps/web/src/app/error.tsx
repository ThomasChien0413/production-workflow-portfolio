"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button } from "@workflow/ui";

/**
 * The outermost boundary, and it catches more than /login.
 *
 * An error thrown in a *layout* is caught by the parent boundary, not by the
 * `error.tsx` beside it — so the signed-in group's session check lands here,
 * not in `(app)/error.tsx`. That means this text is read both by someone who
 * has not signed in and by someone who has, and it must be true for both: it
 * says the server is unreachable and offers a retry, and does not tell a
 * signed-in operator to log in again.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    console.error(error);
  }, [error]);

  /**
   * `reset()` alone re-renders the boundary with the same failed server
   * payload, so on a server-render failure the screen never changes — a retry
   * button that does not retry. `router.refresh()` is what actually re-runs
   * the request; reset then clears the boundary once fresh data arrives.
   */
  function retry() {
    setRetrying(true);
    router.refresh();
    reset();
  }

  return (
    <main className="cc-page cc-stack" style={{ margin: "0 auto", maxWidth: "640px" }}>
      <Alert tone="danger" title="系統暫時無法回應" assertive>
        <p>
          目前無法連線到伺服器。你已經儲存的內容不受影響，也不需要重新登入。
          這通常是暫時的，請稍後重試；若持續發生，請聯絡系統管理員。
        </p>
        {error.digest ? (
          <p className="cc-caption cc-tnum" style={{ marginTop: "var(--cc-space-2)" }}>
            錯誤代碼 {error.digest}
          </p>
        ) : null}
      </Alert>
      <div className="cc-row">
        <Button
          variant="primary"
          loading={retrying}
          loadingLabel="重試中…"
          onClick={retry}
        >
          重試
        </Button>
      </div>
    </main>
  );
}
