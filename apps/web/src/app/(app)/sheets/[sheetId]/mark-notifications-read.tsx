"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { csrfHeaders } from "@/lib/csrf";

/**
 * Opening a sheet reads the reader's notifications about it (the user,
 * 2026-10-04): 通知 and its count in the navigation stop calling them 未讀.
 * It renders nothing; a failure leaves them unread, to be marked by hand.
 */
export function MarkNotificationsRead({ sheetId }: { sheetId: string }) {
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/notifications/sheets/${sheetId}/read`, {
          method: "POST",
          credentials: "same-origin",
          headers: csrfHeaders(),
        });
        if (!response.ok) return;
        const body = (await response.json()) as { updated?: number };
        // Only a change needs the count beside 通知 redrawn.
        if ((body.updated ?? 0) > 0) router.refresh();
      } catch {
        // Offline or signed out: the notifications simply stay unread.
      }
    })();
  }, [sheetId, router]);

  return null;
}
