"use client";

import { csrfHeaders } from "@/lib/csrf";

/**
 * Phone and browser push notifications, the browser side (the user,
 * 2026-10-04: push replaced LINE). The service worker is /sw.js; the API
 * stores one subscription per device and the worker sends to each.
 */

/**
 * What this device can do right now:
 * - `insecure`: not served over HTTPS (or localhost), where browsers refuse push;
 * - `unsupported`: the browser has no push at all;
 * - `needs-install`: an iPhone or iPad not opened from the Home Screen, where
 *   iOS allows push only once the site is added there;
 * - `blocked`: the person (or the phone) said no to notifications;
 * - `ready`: notifications can be turned on.
 */
export type PushSupport = "insecure" | "unsupported" | "needs-install" | "blocked" | "ready";

export function isAppleMobile(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch gives it away.
  return /iPhone|iPad|iPod/u.test(ua) || (/Macintosh/u.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return "insecure";
  if (isAppleMobile() && !isStandalone()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  return "ready";
}

/** What the person will recognise in their device list. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/u.test(ua)
    ? "iPhone"
    : /iPad/u.test(ua) || (/Macintosh/u.test(ua) && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/u.test(ua)
        ? "Android"
        : /Windows/u.test(ua)
          ? "Windows"
          : /Macintosh/u.test(ua)
            ? "Mac"
            : "電腦";
  const browser = /EdgA?\//u.test(ua)
    ? "Edge"
    : /SamsungBrowser\//u.test(ua)
      ? "Samsung"
      : /Firefox\/|FxiOS\//u.test(ua)
        ? "Firefox"
        : /CriOS\/|Chrome\//u.test(ua)
          ? "Chrome"
          : /Safari\//u.test(ua)
            ? "Safari"
            : "瀏覽器";
  return `${device} · ${browser}`;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = window.atob(padded.replace(/-/gu, "+").replace(/_/gu, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return await navigator.serviceWorker.ready;
}

/** This device's subscription, if notifications are on here. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ready") return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ? await existing.pushManager.getSubscription() : null;
}

async function send(path: string, body: unknown): Promise<Response> {
  return await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...csrfHeaders() },
    body: JSON.stringify(body),
  });
}

async function register(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const response = await send("/api/push/subscriptions", {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    deviceLabel: deviceLabel(),
  });
  if (!response.ok) throw new Error("無法儲存此裝置，請稍後再試。");
}

/**
 * Turns notifications on for this device. Must run from a tap: browsers only
 * ask for permission in answer to one.
 */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("沒有取得通知權限。");
  const config = await fetch("/api/push/config", { credentials: "same-origin", cache: "no-store" });
  const { publicKey } = (await config.json().catch(() => ({}))) as { publicKey?: string | null };
  if (!config.ok || !publicKey) throw new Error("系統尚未設定推播通知，請聯絡系統管理員。");
  const worker = await registration();
  const subscription =
    (await worker.pushManager.getSubscription()) ??
    (await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey),
    }));
  await register(subscription);
}

/** Turns notifications off for this device, here and on the server. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await send("/api/push/unsubscribe", { endpoint: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}

/**
 * Re-registers this device with whoever is signed in now, quietly. A shared
 * device then notifies its current user, and a renewed subscription is not
 * lost. Does nothing where notifications are not on.
 */
export async function syncPush(): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription) await register(subscription).catch(() => undefined);
}

export async function sendTestPush(): Promise<void> {
  const response = await send("/api/push/test", {});
  if (!response.ok) throw new Error("無法傳送測試通知，請稍後再試。");
}
