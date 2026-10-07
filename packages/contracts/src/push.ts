import { z } from "zod";

/**
 * Phone and browser push notifications (the user, 2026-10-04). A browser's
 * PushManager hands back a subscription: the push service's endpoint for this
 * device and the device's keys for encrypting what is sent to it. The app
 * stores one per device a person turns notifications on for.
 */
const base64Url = z.string().regex(/^[A-Za-z0-9_-]+=*$/);

export const pushSubscriptionRequestSchema = z
  .object({
    endpoint: z.string().url().max(2_048).startsWith("https://"),
    keys: z
      .object({
        p256dh: base64Url.min(16).max(255),
        auth: base64Url.min(8).max(255),
      })
      .strict(),
    // What the person will recognise in the list, e.g. "iPhone · Safari".
    deviceLabel: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const pushUnsubscribeRequestSchema = z
  .object({ endpoint: z.string().url().max(2_048).startsWith("https://") })
  .strict();

export const pushDeviceSchema = z
  .object({
    id: z.string().uuid(),
    deviceLabel: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const pushNotificationJobPayloadSchema = z
  .object({ notificationId: z.string().uuid() })
  .strict();

export type PushSubscriptionRequest = z.infer<typeof pushSubscriptionRequestSchema>;
export type PushUnsubscribeRequest = z.infer<typeof pushUnsubscribeRequestSchema>;
export type PushDevice = z.infer<typeof pushDeviceSchema>;
