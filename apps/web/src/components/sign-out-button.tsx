"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, type ButtonVariant } from "@workflow/ui";
import { csrfHeaders } from "@/lib/csrf";
import { disablePush } from "@/lib/push";

/**
 * `variant` exists because the same action reads differently by context. On
 * /settings it is the one destructive thing on the page and is toned to say so;
 * in the navigation it is a quiet way out.
 *
 * Signing out turns this device's notifications off first (the user,
 * 2026-10-04), so a shared phone stops receiving the previous person's
 * notices. It waits two seconds at most; signing out never hangs on it.
 */
export function SignOutButton({
  variant = "secondary",
}: {
  variant?: ButtonVariant;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await Promise.race([
        disablePush().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: csrfHeaders(),
      });
    } finally {
      // Whether or not the call succeeded, send the user to the sign-in screen
      // and let the server decide what the session actually is.
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <Button
      variant={variant}
      onClick={() => void handleSignOut()}
      loading={pending}
      loadingLabel="登出中…"
    >
      登出
    </Button>
  );
}
