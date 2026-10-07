import webpush from "web-push";

/**
 * Sends one notification to one phone or browser (the user, 2026-10-04: push
 * replaced LINE). The payload is encrypted for the device with its own keys
 * and signed with the server's VAPID key, so the push service (Google, Apple,
 * Mozilla) relays it without reading it.
 */
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/** What the service worker shows: never sheet contents, only the notice. */
export type PushMessage = { title: string; body: string; url: string; tag: string };

export class PushSendError extends Error {
  constructor(
    message: string,
    /** Worth trying again later: rate limited, a server error, no connection. */
    readonly retryable: boolean,
    readonly statusCode: number | null = null,
    /** The push service no longer knows this device: forget it. */
    readonly gone = false,
  ) {
    super(message);
    this.name = "PushSendError";
  }
}

export interface PushClient {
  send(target: PushTarget, message: PushMessage): Promise<void>;
}

export type VapidSettings = { publicKey: string; privateKey: string; subject: string };

export function classifyPushFailure(statusCode: number | null): PushSendError {
  if (statusCode === null) return new PushSendError("Push request failed", true);
  if (statusCode === 404 || statusCode === 410) {
    return new PushSendError(`Push service returned HTTP ${statusCode}`, false, statusCode, true);
  }
  return new PushSendError(
    `Push service returned HTTP ${statusCode}`,
    statusCode === 429 || statusCode >= 500,
    statusCode,
  );
}

export class WebPushClient implements PushClient {
  constructor(private readonly vapid: VapidSettings) {}

  async send(target: PushTarget, message: PushMessage): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        {
          vapidDetails: this.vapid,
          // A notice older than a day is stale; the in-app list still has it.
          TTL: 24 * 60 * 60,
          urgency: "high",
          timeout: 10_000,
        },
      );
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
          ? error.statusCode
          : null;
      throw classifyPushFailure(statusCode);
    }
  }
}
