"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@workflow/ui";
import { csrfHeaders } from "@/lib/csrf";

/**
 * Marking notifications read.
 *
 * Read state is per user and lives on the server, because the same person uses
 * this on a phone on the shop floor and on a desktop in the office — a local
 * flag would leave the two disagreeing about what they had already seen.
 */
export function MarkAllRead({ unread }: { unread: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function markAll() {
    setPending(true);
    try {
      await fetch("/api/notifications/read-all", {
        method: "POST",
        credentials: "same-origin",
        headers: csrfHeaders(),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="secondary"
      disabled={unread === 0}
      loading={pending}
      loadingLabel="處理中…"
      onClick={() => void markAll()}
    >
      全部標示為已讀
    </Button>
  );
}

export function MarkRead({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function markRead() {
    setPending(true);
    try {
      await fetch(`/api/notifications/${notificationId}/read`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: csrfHeaders(),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="tertiary"
      loading={pending}
      loadingLabel="處理中…"
      onClick={() => void markRead()}
    >
      標示為已讀
    </Button>
  );
}
