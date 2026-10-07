/*
 * Workflow Portfolio's service worker: shows phone and browser push notifications and
 * opens the right page when one is tapped (the user, 2026-10-04: push
 * replaced LINE). It caches nothing; the app is used online.
 *
 * A push carries only { title, body, url, tag } — the notice, never sheet
 * contents — because it shows on a lock screen.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Workflow Portfolio";
  const body = typeof data.body === "string" && data.body ? data.body : "你有一則新的通知。";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: typeof data.tag === "string" ? data.tag : undefined,
      lang: "zh-Hant",
      icon: "/icons/icon-192.png",
      data: { url: typeof data.url === "string" ? data.url : "/notifications" },
    }),
  );
});

/** Only pages of this site are ever opened from a notification. */
function targetUrl(raw) {
  try {
    const url = new URL(raw || "/notifications", self.location.origin);
    return url.origin === self.location.origin ? url.href : new URL("/notifications", self.location.origin).href;
  } catch {
    return new URL("/notifications", self.location.origin).href;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = targetUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
