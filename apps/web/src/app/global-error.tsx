"use client";

import { useEffect } from "react";

/**
 * The last resort: an error in the root layout itself, before the shell or any
 * page has rendered.
 *
 * It replaces the whole document, so it must supply its own `html` and `body` —
 * and it cannot rely on the design system's stylesheet having loaded, which is
 * why the little styling here is inline. Everything else in the app is caught
 * by the boundary inside the signed-in group.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-Hant-TW">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "32px",
          color: "#1B2534",
          background: "#F4F7FB",
        }}
      >
        <main style={{ maxWidth: "640px", margin: "0 auto" }}>
          <h1 style={{ fontSize: "24px", marginBottom: "8px" }}>系統暫時無法使用</h1>
          <p style={{ lineHeight: 1.7 }}>
            請稍後重試。若持續發生，請聯絡系統管理員
            {error.digest ? `，並提供錯誤代碼 ${error.digest}` : ""}。
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "16px",
              minHeight: "44px",
              padding: "0 24px",
              fontSize: "16px",
              color: "#FFFFFF",
              background: "#1D4ED8",
              border: 0,
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            重試
          </button>
        </main>
      </body>
    </html>
  );
}
