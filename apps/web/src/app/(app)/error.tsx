"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button } from "@workflow/ui";

/**
 * The signed-in error boundary.
 *
 * Two things it deliberately does not do. It does not show `error.message`:
 * Next replaces server messages with an opaque digest in production, so the
 * only honest thing to print is that digest, and a half-message that sometimes
 * appears in development and never in production trains people to ignore it.
 * And it does not claim to know what went wrong — the API being unreachable
 * and a bug on the page look identical from here.
 *
 * `reset` re-renders the segment, which is the right first move: most of these
 * are a request that failed once.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    // The server already logged it; this is for whoever has the console open.
    console.error(error);
  }, [error]);

  /** `reset()` re-renders the same failed payload; the refresh re-fetches it. */
  function retry() {
    setRetrying(true);
    router.refresh();
    reset();
  }

  return (
    <main className="cc-page cc-stack" style={{ margin: "0 auto" }}>
      <Alert tone="danger" title="這個畫面暫時無法顯示" assertive>
        <p>
          可能是網路中斷，或系統暫時無法回應。你已經儲存的內容不受影響。
          請重試；若持續發生，請將下方的錯誤代碼提供給系統管理員。
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
        <Link className="cc-btn cc-btn--secondary" href="/">
          回到首頁
        </Link>
      </div>
    </main>
  );
}
