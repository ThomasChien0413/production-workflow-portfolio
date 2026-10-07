import { z } from "zod";

const positiveIntegerQuery = z.coerce.number().int().positive();
const optionalSearchText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .optional()
    .transform((value) => value || undefined);

export const auditListQuerySchema = z
  .object({
    page: positiveIntegerQuery.max(10_000).default(1),
    pageSize: positiveIntegerQuery.max(100).default(25),
    q: optionalSearchText(128),
    action: optionalSearchText(128),
    targetType: optionalSearchText(64),
    targetId: optionalSearchText(128),
    actorUserId: z.string().uuid().optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) {
      context.addIssue({
        code: "custom",
        message: "開始時間不可晚於結束時間",
        path: ["from"],
      });
    }
  });

export const auditActorSchema = z
  .object({
    id: z.string().uuid(),
    username: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();

export const auditEventSchema = z
  .object({
    id: z.string().uuid(),
    actor: auditActorSchema.nullable(),
    action: z.string().min(1).max(128),
    targetType: z.string().min(1).max(64),
    targetId: z.string().max(128).nullable(),
    requestId: z.string().max(64).nullable(),
    ipAddress: z.string().max(64).nullable(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
