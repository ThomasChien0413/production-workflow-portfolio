import { z } from "zod";
import { departmentCodeSchema } from "./roles.js";

export const sheetStates = [
  "DRAFT",
  "PENDING_SALES",
  "PENDING_ASSOCIATE",
  "PENDING_GENERAL_MANAGER",
  "READY",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "RETURNED",
  "ARCHIVED",
] as const;

export const sheetStateSchema = z.enum(sheetStates);
export type SheetState = z.infer<typeof sheetStateSchema>;

export const sheetPatchRequestSchema = z.object({
  baseVersion: z.number().int().nonnegative(),
  clientMutationId: z.string().uuid(),
  changes: z
    .array(
      z.object({
        fieldKey: z.string().min(1).max(128),
        value: z.unknown(),
      }),
    )
    .min(1)
    .max(100),
}).strict().superRefine((request, context) => {
  const seen = new Set<string>();
  request.changes.forEach((change, index) => {
    if (seen.has(change.fieldKey)) {
      context.addIssue({
        code: "custom",
        message: "同一次儲存不可重複更新相同欄位",
        path: ["changes", index, "fieldKey"],
      });
    }
    seen.add(change.fieldKey);
  });
});

export const sheetIdParamsSchema = z
  .object({ sheetId: z.string().uuid() })
  .strict();

export const departmentStaffParamsSchema = z
  .object({ departmentId: z.string().uuid() })
  .strict();

export const departmentStaffMemberSchema = z
  .object({
    id: z.string().uuid(),
    username: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();

export const sheetRealtimeClientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("sheet.join"),
      sheetId: z.string().uuid(),
      lastKnownVersion: z.number().int().nonnegative().optional(),
      lastKnownUpdatedAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("sheet.leave"),
      sheetId: z.string().uuid(),
    })
    .strict(),
]);

export const realtimeSheetSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
    state: sheetStateSchema,
    currentDepartmentId: z.string().uuid(),
    subpageId: z.string().uuid().nullable(),
    assignedUserId: z.string().uuid().nullable(),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const realtimePresenceUserSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string().min(1),
  })
  .strict();

const realtimeEventBase = {
  schemaVersion: z.literal(1),
  eventId: z.string().uuid(),
  serverTimestamp: z.iso.datetime({ offset: true }),
};

const realtimeSheetEventBase = {
  ...realtimeEventBase,
  sheetId: z.string().uuid(),
};

export const sheetRealtimeServerEventSchema = z.discriminatedUnion("type", [
  z.object({ ...realtimeEventBase, type: z.literal("connection.ready") }).strict(),
  z
    .object({
      ...realtimeEventBase,
      type: z.literal("connection.error"),
      code: z.enum([
        "NOT_READY",
        "INVALID_MESSAGE",
        "ACCESS_DENIED",
        "NOT_IN_ROOM",
        "INTERNAL_ERROR",
      ]),
      message: z.string().min(1),
      sheetId: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      ...realtimeSheetEventBase,
      type: z.literal("room.access.revoked"),
    })
    .strict(),
  z
    .object({
      ...realtimeSheetEventBase,
      type: z.literal("sheet.snapshot"),
      sheet: realtimeSheetSnapshotSchema,
      resyncRequired: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...realtimeSheetEventBase,
      type: z.literal("presence.snapshot"),
      participants: z.array(realtimePresenceUserSchema),
    })
    .strict(),
  z
    .object({
      ...realtimeSheetEventBase,
      type: z.literal("presence.changed"),
      action: z.enum(["JOINED", "LEFT"]),
      user: realtimePresenceUserSchema,
      participants: z.array(realtimePresenceUserSchema),
    })
    .strict(),
  z
    .object({
      ...realtimeSheetEventBase,
      type: z.literal("sheet.patch.applied"),
      sheet: realtimeSheetSnapshotSchema,
      changedFields: z.array(z.string().min(1)),
      canonicalValues: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      ...realtimeSheetEventBase,
      type: z.literal("sheet.status.changed"),
      sheet: realtimeSheetSnapshotSchema,
    })
    .strict(),
  z
    .object({
      ...realtimeSheetEventBase,
      type: z.literal("sheet.assignment.changed"),
      sheet: realtimeSheetSnapshotSchema,
    })
    .strict(),
  z
    .object({
      ...realtimeSheetEventBase,
      type: z.literal("sheet.approval.changed"),
      sheet: realtimeSheetSnapshotSchema,
    })
    .strict(),
  z
    .object({
      ...realtimeSheetEventBase,
      type: z.literal("sheet.subpage.changed"),
      sheet: realtimeSheetSnapshotSchema,
    })
    .strict(),
  z
    .object({
      ...realtimeSheetEventBase,
      type: z.literal("sheet.permission.changed"),
      sheet: realtimeSheetSnapshotSchema,
    })
    .strict(),
  z
    .object({
      ...realtimeSheetEventBase,
      type: z.literal("sheet.attachment.changed"),
      sheet: realtimeSheetSnapshotSchema,
    })
    .strict(),
]);

export const createSheetRequestSchema = z
  .object({
    clientMutationId: z.string().uuid(),
    templateId: z.string().uuid(),
    originDepartmentId: z.string().uuid(),
    subpageId: z.string().uuid(),
  })
  .strict();

export const sheetListQuerySchema = z
  .object({
    state: sheetStateSchema.optional(),
    departmentId: z.string().uuid().optional(),
    subpageId: z.string().uuid().optional(),
  })
  .strict();

export const departmentSheetHistorySortFields = [
  "completedAt",
  "sheetNumber",
  "template",
] as const;

export const departmentSheetHistoryQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(128).optional(),
    templateId: z.string().uuid().optional(),
    subpageId: z.string().uuid().optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    sort: z.enum(departmentSheetHistorySortFields).default("completedAt"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().positive().max(10_000).default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(25),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
      context.addIssue({
        code: "custom",
        message: "完成日期起日不可晚於迄日",
        path: ["to"],
      });
    }
  });

export const departmentSheetHistoryItemSchema = z
  .object({
    id: z.string().uuid(),
    sheetNumber: z.string().min(1),
    state: z.enum(["COMPLETED", "ARCHIVED"]),
    subpage: z.object({ id: z.string().uuid(), name: z.string().min(1) }).strict(),
    template: z
      .object({
        id: z.string().uuid(),
        displayName: z.string().min(1),
      })
      .strict(),
    completedAt: z.iso.datetime({ offset: true }),
    archivedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

const departmentSheetHistoryFilterOptionSchema = z
  .object({ id: z.string().uuid(), displayName: z.string().min(1) })
  .strict();

export const departmentSheetHistoryPageSchema = z
  .object({
    items: z.array(departmentSheetHistoryItemSchema),
    filterOptions: z
      .object({
        templates: z.array(departmentSheetHistoryFilterOptionSchema),
        subpages: z.array(departmentSheetHistoryFilterOptionSchema),
      })
      .strict(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const sheetFieldHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().max(10_000).default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(30),
    fieldKey: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional(),
  })
  .strict();

export const sheetFieldHistoryEntrySchema = z
  .object({
    auditEventId: z.string().uuid(),
    fieldKey: z.string().min(1).max(128),
    actor: z
      .object({
        id: z.string().uuid(),
        username: z.string().min(1),
        displayName: z.string().min(1),
      })
      .strict()
      .nullable(),
    baseVersion: z.number().int().nonnegative(),
    newVersion: z.number().int().positive(),
    approvalInvalidated: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const sheetSubmitRequestSchema = z
  .object({ clientMutationId: z.string().uuid() })
  .strict();

/**
 * 核准 and 退回 on a form that is reviewed. Only 分條申請單 is, by 業務 →
 * 協理 → 總經理 in turn, after its department sends it for review (the user,
 * 2026-10-01). 退回 needs a reason.
 */
export const sheetApproveRequestSchema = z
  .object({
    clientMutationId: z.string().uuid(),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();

export const sheetRejectRequestSchema = z
  .object({
    clientMutationId: z.string().uuid(),
    comment: z.string().trim().min(1).max(1000),
  })
  .strict();

export const sheetDueDateRequestSchema = z
  .object({
    clientMutationId: z.string().uuid(),
    baseVersion: z.number().int().nonnegative(),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

/**
 * Forms whose rows the receiving department ticks off on screen (the user,
 * 2026-10-03): 分條申請單's rows, by 分條's 主管, once the sheet is in 分條 with
 * its review done. A tick paints its row green. It is the department's own
 * mark rather than part of the paper form, so it lives outside the template
 * definition, every version of the form takes it, and it is not printed.
 */
export const ROW_MARK_FORMS: Readonly<
  Record<string, { departmentCode: z.infer<typeof departmentCodeSchema>; sectionKey: string }>
> = {
  "slitting-request": { departmentCode: "SLITTING", sectionKey: "items" },
};

export function rowMarksFor(templateKey: string) {
  return ROW_MARK_FORMS[templateKey] ?? null;
}

/** Tick or untick one row of a sheet whose form takes row marks. */
export const sheetRowMarkRequestSchema = z
  .object({
    clientMutationId: z.string().uuid(),
    sectionKey: z.string().trim().min(1).max(64),
    rowIndex: z.number().int().nonnegative().max(199),
    marked: z.boolean(),
  })
  .strict();

export const sheetMoveSubpageRequestSchema = z
  .object({
    clientMutationId: z.string().uuid(),
    baseVersion: z.number().int().nonnegative(),
    subpageId: z.string().uuid(),
  })
  .strict();

export const sheetLifecycleRequestSchema = z
  .object({ clientMutationId: z.string().uuid() })
  .strict();

/**
 * The three production statuses a sheet is set to by hand (the user,
 * 2026-09-30): 待生產, 生產中, 已完成, in any order. There is no draft and no
 * review any more; a sheet starts at 待生產.
 */
export const productionStatuses = ["READY", "IN_PROGRESS", "COMPLETED"] as const;
export type ProductionStatus = (typeof productionStatuses)[number];

export const sheetStatusRequestSchema = z
  .object({
    clientMutationId: z.string().uuid(),
    baseVersion: z.number().int().nonnegative(),
    state: z.enum(productionStatuses),
  })
  .strict();

/**
 * Whether a field may be changed in a state. 草稿 and review were retired
 * (the user, 2026-09-30), so a sheet starts at 待生產: a field its pinned
 * definition allows in 草稿 is allowed in 待生產 and 生產中 as well. The
 * definitions themselves are immutable and unchanged.
 */
export function isFieldEditableInState(
  editableStates: readonly string[],
  state: SheetState,
): boolean {
  if (editableStates.includes(state)) return true;
  return editableStates.includes("DRAFT") && (state === "READY" || state === "IN_PROGRESS");
}

export const sheetAttachmentIdParamsSchema = z
  .object({
    sheetId: z.string().uuid(),
    attachmentId: z.string().uuid(),
  })
  .strict();

export const sheetAttachmentListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().max(10_000).default(1),
  })
  .strict();

export const sheetAttachmentContentQuerySchema = z
  .object({
    disposition: z.enum(["inline", "attachment"]).default("inline"),
  })
  .strict();

export const sheetAttachmentMetadataSchema = z
  .object({
    id: z.string().uuid(),
    filename: z.string().min(1).max(255),
    // Preserve reads of attachments accepted before the 95 MB upload cap.
    sizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
    uploader: z
      .object({
        id: z.string().uuid(),
        displayName: z.string().min(1),
      })
      .strict(),
    uploadedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const sheetAttachmentPageSchema = z
  .object({
    items: z.array(sheetAttachmentMetadataSchema),
    page: z.number().int().positive(),
    pageSize: z.literal(25),
    total: z.number().int().nonnegative(),
    canModify: z.boolean(),
  })
  .strict();

export const attachmentIdempotencyKeySchema = z.string().uuid();

export type SheetPatchRequest = z.infer<typeof sheetPatchRequestSchema>;
export type DepartmentStaffMember = z.infer<
  typeof departmentStaffMemberSchema
>;
export type SheetRealtimeClientMessage = z.infer<
  typeof sheetRealtimeClientMessageSchema
>;
export type RealtimeSheetSnapshot = z.infer<
  typeof realtimeSheetSnapshotSchema
>;
export type CreateSheetRequest = z.infer<typeof createSheetRequestSchema>;
export type DepartmentSheetHistoryQuery = z.infer<
  typeof departmentSheetHistoryQuerySchema
>;
export type DepartmentSheetHistoryPage = z.infer<
  typeof departmentSheetHistoryPageSchema
>;
export type DepartmentSheetHistorySort = z.infer<
  typeof departmentSheetHistoryQuerySchema
>["sort"];
export type SheetFieldHistoryQuery = z.infer<
  typeof sheetFieldHistoryQuerySchema
>;
export type SheetFieldHistoryEntry = z.infer<
  typeof sheetFieldHistoryEntrySchema
>;
export type SheetSubmitRequest = z.infer<typeof sheetSubmitRequestSchema>;
export type SheetApproveRequest = z.infer<typeof sheetApproveRequestSchema>;
export type SheetRejectRequest = z.infer<typeof sheetRejectRequestSchema>;
export type SheetDueDateRequest = z.infer<typeof sheetDueDateRequestSchema>;
export type SheetRowMarkRequest = z.infer<typeof sheetRowMarkRequestSchema>;
export type SheetMoveSubpageRequest = z.infer<typeof sheetMoveSubpageRequestSchema>;
export type SheetLifecycleRequest = z.infer<
  typeof sheetLifecycleRequestSchema
>;
export type SheetStatusRequest = z.infer<typeof sheetStatusRequestSchema>;
export type SheetAttachmentMetadata = z.infer<
  typeof sheetAttachmentMetadataSchema
>;
export type SheetAttachmentPage = z.infer<typeof sheetAttachmentPageSchema>;
