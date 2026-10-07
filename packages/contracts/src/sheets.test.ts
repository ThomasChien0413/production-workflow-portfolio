import { describe, expect, it } from "vitest";
import {
  createSheetRequestSchema,
  departmentSheetHistoryPageSchema,
  departmentSheetHistoryQuerySchema,
  departmentStaffMemberSchema,
  departmentStaffParamsSchema,
  isFieldEditableInState,
  sheetApproveRequestSchema,
  sheetRejectRequestSchema,
  sheetDueDateRequestSchema,
  sheetStatusRequestSchema,
  sheetPatchRequestSchema,
  sheetRealtimeClientMessageSchema,
  sheetRealtimeServerEventSchema,
} from "./sheets.js";

describe("production sheet contracts", () => {
  it("validates the manager-scoped department staff directory", () => {
    expect(
      departmentStaffParamsSchema.parse({
        departmentId: "9c9856c9-7fe6-453a-a015-2bcd60ce85d2",
      }),
    ).toBeTruthy();
    expect(
      departmentStaffMemberSchema.parse({
        id: "71f9caf8-a186-46c0-82f1-789a65cb423d",
        username: "cut-staff-01",
        displayName: "CUT 員工 01",
      }),
    ).toBeTruthy();
  });

  it("defaults department history pagination and stable completion sorting", () => {
    expect(departmentSheetHistoryQuerySchema.parse({})).toEqual({
      sort: "completedAt",
      direction: "desc",
      page: 1,
      pageSize: 25,
    });
    expect(
      departmentSheetHistoryQuerySchema.safeParse({
        state: "IN_PROGRESS",
      }).success,
    ).toBe(false);
    expect(
      departmentSheetHistoryQuerySchema.safeParse({
        from: "2026-08-13T23:59:59.999+08:00",
        to: "2026-08-13T00:00:00.000+08:00",
      }).success,
    ).toBe(false);
  });

  it("validates history metadata without matched production-value excerpts", () => {
    const page = departmentSheetHistoryPageSchema.parse({
      items: [
        {
          id: "71f9caf8-a186-46c0-82f1-789a65cb423d",
          sheetNumber: "F-001",
          state: "COMPLETED",
          subpage: {
            id: "11111111-1111-4111-8111-111111111111",
            name: "大分條",
          },
          template: {
            id: "9c9856c9-7fe6-453a-a015-2bcd60ce85d2",
            displayName: "分條排刀單",
          },
          completedAt: "2026-08-13T08:00:00.000Z",
          archivedAt: null,
        },
      ],
      filterOptions: {
        templates: [
          {
            id: "9c9856c9-7fe6-453a-a015-2bcd60ce85d2",
            displayName: "分條排刀單",
          },
        ],
        subpages: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            displayName: "大分條",
          },
        ],
      },
      page: 1,
      pageSize: 25,
      total: 1,
    });
    expect(page.items[0]).not.toHaveProperty("matchExcerpt");
  });

  it("validates realtime joins, reconnect cursors, and canonical patch events", () => {
    expect(
      sheetRealtimeClientMessageSchema.parse({
        type: "sheet.join",
        sheetId: "71f9caf8-a186-46c0-82f1-789a65cb423d",
        lastKnownVersion: 4,
        lastKnownUpdatedAt: "2026-08-10T08:00:00+08:00",
      }),
    ).toBeTruthy();
    expect(
      sheetRealtimeClientMessageSchema.safeParse({
        type: "presence.update",
        sheetId: "71f9caf8-a186-46c0-82f1-789a65cb423d",
      }).success,
    ).toBe(false);
    expect(
      sheetRealtimeServerEventSchema.parse({
        schemaVersion: 1,
        eventId: "c5aa98ce-4e90-42c0-aad2-36d2fd7fce0b",
        serverTimestamp: "2026-08-10T00:00:01.000Z",
        type: "sheet.patch.applied",
        sheetId: "71f9caf8-a186-46c0-82f1-789a65cb423d",
        sheet: {
          id: "71f9caf8-a186-46c0-82f1-789a65cb423d",
          version: 5,
          state: "DRAFT",
          currentDepartmentId: "9c9856c9-7fe6-453a-a015-2bcd60ce85d2",
          subpageId: "11111111-1111-4111-8111-111111111111",
          assignedUserId: null,
          dueAt: null,
          updatedAt: "2026-08-10T00:00:00.000Z",
        },
        changedFields: ["requestDate"],
        canonicalValues: { requestDate: "2026-08-10" },
      }),
    ).toBeTruthy();
  });

  it("accepts an idempotent sheet creation request", () => {
    expect(
      createSheetRequestSchema.parse({
        clientMutationId: "c5aa98ce-4e90-42c0-aad2-36d2fd7fce0b",
        templateId: "71f9caf8-a186-46c0-82f1-789a65cb423d",
        originDepartmentId: "9c9856c9-7fe6-453a-a015-2bcd60ce85d2",
        subpageId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBeTruthy();
  });

  it("rejects duplicate field keys in one autosave patch", () => {
    expect(
      sheetPatchRequestSchema.safeParse({
        baseVersion: 0,
        clientMutationId: "c5aa98ce-4e90-42c0-aad2-36d2fd7fce0b",
        changes: [
          { fieldKey: "requestDate", value: "2026-08-08" },
          { fieldKey: "requestDate", value: "2026-08-09" },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires an offset-aware 交期, or null to clear it", () => {
    const request = {
      clientMutationId: "c5aa98ce-4e90-42c0-aad2-36d2fd7fce0b",
      baseVersion: 3,
    };
    expect(
      sheetDueDateRequestSchema.safeParse({
        ...request,
        dueAt: "2026-08-09T17:00:00+08:00",
      }).success,
    ).toBe(true);
    expect(sheetDueDateRequestSchema.safeParse({ ...request, dueAt: null }).success).toBe(true);
    expect(
      sheetDueDateRequestSchema.safeParse({
        ...request,
        dueAt: "2026-08-09T17:00:00",
      }).success,
    ).toBe(false);
    // Nobody is assigned any more; the field is refused rather than ignored.
    expect(
      sheetDueDateRequestSchema.safeParse({
        ...request,
        dueAt: null,
        assignedUserId: "71f9caf8-a186-46c0-82f1-789a65cb423d",
      }).success,
    ).toBe(false);
  });
});

// No draft and no review (the user, 2026-09-30).
describe("production status", () => {
  it("accepts only 待生產, 生產中 and 已完成", () => {
    const request = { clientMutationId: "c5aa98ce-4e90-42c0-aad2-36d2fd7fce0b", baseVersion: 2 };
    for (const state of ["READY", "IN_PROGRESS", "COMPLETED"]) {
      expect(sheetStatusRequestSchema.safeParse({ ...request, state }).success).toBe(true);
    }
    for (const state of ["DRAFT", "ARCHIVED", "PENDING_SALES"]) {
      expect(sheetStatusRequestSchema.safeParse({ ...request, state }).success).toBe(false);
    }
  });

  it("opens a field allowed in 草稿 in 待生產 and 生產中, and nowhere else new", () => {
    const draftOnly = ["DRAFT", "RETURNED"];
    expect(isFieldEditableInState(draftOnly, "READY")).toBe(true);
    expect(isFieldEditableInState(draftOnly, "IN_PROGRESS")).toBe(true);
    expect(isFieldEditableInState(draftOnly, "COMPLETED")).toBe(false);
    expect(isFieldEditableInState(["IN_PROGRESS"], "READY")).toBe(false);
    expect(isFieldEditableInState(["IN_PROGRESS"], "IN_PROGRESS")).toBe(true);
  });
});

describe("review requests", () => {
  const clientMutationId = "00000000-0000-4000-8000-000000000001";

  it("approves with or without a comment", () => {
    expect(sheetApproveRequestSchema.parse({ clientMutationId })).toEqual({ clientMutationId });
    expect(sheetApproveRequestSchema.parse({ clientMutationId, comment: " 可 " }).comment).toBe("可");
  });

  it("returns only with a reason", () => {
    expect(sheetRejectRequestSchema.safeParse({ clientMutationId }).success).toBe(false);
    expect(sheetRejectRequestSchema.safeParse({ clientMutationId, comment: "   " }).success).toBe(false);
    expect(sheetRejectRequestSchema.parse({ clientMutationId, comment: "數量不對" }).comment).toBe("數量不對");
  });
});
