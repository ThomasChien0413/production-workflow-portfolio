import { describe, expect, it } from "vitest";
import {
  pushNotificationJobPayloadSchema,
  pushSubscriptionRequestSchema,
  pushUnsubscribeRequestSchema,
} from "./push.js";

// Phone and browser push replaced LINE (the user, 2026-10-04).
describe("push subscription contracts", () => {
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: {
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      auth: "tBHItJI5svbpez7KI4CCXg",
    },
  };

  it("accepts a browser subscription, with or without a device label", () => {
    expect(pushSubscriptionRequestSchema.parse(subscription)).toEqual(subscription);
    expect(pushSubscriptionRequestSchema.parse({ ...subscription, deviceLabel: "iPhone · Safari" }).deviceLabel).toBe(
      "iPhone · Safari",
    );
  });

  it("refuses an endpoint that is not HTTPS, malformed keys, or extra fields", () => {
    expect(pushSubscriptionRequestSchema.safeParse({ ...subscription, endpoint: "http://push.example/abc" }).success).toBe(false);
    expect(
      pushSubscriptionRequestSchema.safeParse({ ...subscription, keys: { ...subscription.keys, auth: "not base64!" } }).success,
    ).toBe(false);
    expect(pushSubscriptionRequestSchema.safeParse({ ...subscription, userId: "someone" }).success).toBe(false);
    expect(pushUnsubscribeRequestSchema.safeParse({ endpoint: "javascript:alert(1)" }).success).toBe(false);
  });

  it("carries only a notification id in the delivery job", () => {
    expect(pushNotificationJobPayloadSchema.safeParse({ notificationId: "71f9caf8-a186-46c0-82f1-789a65cb423d" }).success).toBe(true);
    expect(pushNotificationJobPayloadSchema.safeParse({ notificationId: "x", summary: "y" }).success).toBe(false);
  });
});
