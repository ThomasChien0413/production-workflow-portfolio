import { z } from "zod";

const positiveIntegerQuery = z.coerce.number().int().positive();

export const notificationListQuerySchema = z
  .object({
    page: positiveIntegerQuery.max(10_000).default(1),
    pageSize: positiveIntegerQuery.max(100).default(30),
    unreadOnly: z.enum(["true", "false"]).optional(),
  })
  .strict()
  .transform((value) => ({
    page: value.page,
    pageSize: value.pageSize,
    unreadOnly: value.unreadOnly === "true",
  }));

export const notificationIdParamsSchema = z
  .object({ notificationId: z.string().uuid() })
  .strict();

/** Opening a sheet reads its notifications (the user, 2026-10-04). */
export const notificationSheetParamsSchema = z
  .object({ sheetId: z.string().uuid() })
  .strict();

export const notificationHealthQuerySchema = z
  .object({ limit: positiveIntegerQuery.max(100).default(25) })
  .strict();

export const notificationEventInputSchema = z
  .object({
    recipientUserId: z.string().uuid(),
    sheetId: z.string().uuid().nullable().optional(),
    eventType: z.string().trim().min(1).max(96),
    summary: z.string().trim().min(1).max(500),
    deepLink: z.string().trim().max(2_048).nullable().optional(),
    deduplicationKey: z.string().trim().min(1).max(240),
  })
  .strict();

export type NotificationListQuery = z.infer<
  typeof notificationListQuerySchema
>;
export type NotificationEventInput = z.infer<
  typeof notificationEventInputSchema
>;
