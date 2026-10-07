import { describe, expect, it } from "vitest";
import {
  flatShearCuttingRequestV1,
  slittingRequestV2,
  slittingRequestV3,
  type MembershipKind,
  type SessionUser,
} from "@workflow/contracts";
import type { SheetDetail } from "./sheet-model";
import {
  canChangeStatus,
  canSetDueDate,
  canSubmit,
  editorKinds,
  reviewerRole,
} from "./sheet-permissions";

function orderTaker(departmentId = "department-cut"): SessionUser {
  return {
    id: "order-taker",
    username: "order-taker",
    displayName: "訂單人員",
    roles: [],
    memberships: [
      {
        departmentId,
        departmentCode: "CUT",
        departmentName: "CUT",
        kind: "ORDER_TAKER",
      },
    ],
    passwordWarning: false,
  };
}

function submissionSheet(
  definition: SheetDetail["template"]["definition"],
  state: SheetDetail["state"] = "READY",
): SheetDetail {
  return {
    id: "sheet",
    sheetNumber: "TEST-1",
    state,
    version: 0,
    dueAt: null,
    updatedAt: "2026-08-21T00:00:00.000Z",
    assignedUserId: null,
    subpageId: "subpage",
    currentDepartmentId: "department-cut",
    templateVersionId: "template-version",
    originDepartmentId: "department-cut",
    createdByUserId: "order-taker",
    createdAt: "2026-08-21T00:00:00.000Z",
    completedAt: null,
    archivedAt: null,
    template: { id: "template", version: 3, definition },
    values: {},
    approvals: [],
    handoffs: [],
    assignments: [],
    permissions: { canView: true, canEdit: true, canSubmit: true },
    formEnabledInSubpage: true,
    // 分條申請單 written in CUT goes on to 分條, once reviewed.
    releaseDestination: { code: "SLITTING", displayName: "分條" },
    review: { required: true, outstanding: true, stageRole: null },
    signatures: {},
    rowMarks: null,
  };
}

// 分條申請單 is reviewed before it goes on (the user, 2026-10-01); other forms
// are only sent on, once.
describe("sheet submission permission", () => {
  it("offers 送出審核 to its origin 訂單人員 while it waits at 待生產 or comes back 已退回", () => {
    expect(canSubmit(orderTaker(), submissionSheet(slittingRequestV3, "RETURNED"))).toBe(true);
    // 分條 wrote it: nowhere to send it, but the review is still owed.
    expect(canSubmit(orderTaker(), { ...submissionSheet(slittingRequestV3), releaseDestination: null })).toBe(true);
    // Under review, nothing more to send.
    expect(canSubmit(orderTaker(), submissionSheet(slittingRequestV3, "PENDING_SALES"))).toBe(false);
  });

  it("offers 送交分條 to its origin 訂單人員 while it waits at 待生產", () => {
    expect(canSubmit(orderTaker(), submissionSheet(slittingRequestV3))).toBe(true);
    // A sheet from before, still a draft, is sent the same way.
    expect(canSubmit(orderTaker(), submissionSheet(slittingRequestV2, "DRAFT"))).toBe(true);
  });

  it("uses the API subpage permission, and offers nothing once it has gone", () => {
    const denied = submissionSheet(slittingRequestV3);
    denied.permissions.canSubmit = false;
    expect(canSubmit(orderTaker("another-department"), denied)).toBe(false);
    const gone = { ...submissionSheet(slittingRequestV3), releaseDestination: null };
    expect(canSubmit(orderTaker(), { ...gone, review: { required: true, outstanding: false, stageRole: null } })).toBe(false);
    expect(canSubmit(orderTaker(), submissionSheet(slittingRequestV3, "IN_PROGRESS"))).toBe(false);
  });
});

describe("review on 分條申請單", () => {
  const reviewer = (role: "SALES" | "ASSOCIATE" | "GENERAL_MANAGER" | "ADMIN"): SessionUser => ({
    ...orderTaker(),
    id: role,
    roles: [role],
    memberships: [],
  });

  it("is decided by the role whose turn it is, and no one else", () => {
    expect(reviewerRole(reviewer("SALES"), submissionSheet(slittingRequestV3, "PENDING_SALES"))).toBe("SALES");
    expect(reviewerRole(reviewer("ASSOCIATE"), submissionSheet(slittingRequestV3, "PENDING_SALES"))).toBeNull();
    expect(reviewerRole(reviewer("ASSOCIATE"), submissionSheet(slittingRequestV3, "PENDING_ASSOCIATE"))).toBe("ASSOCIATE");
    expect(reviewerRole(reviewer("GENERAL_MANAGER"), submissionSheet(slittingRequestV3, "PENDING_GENERAL_MANAGER"))).toBe("GENERAL_MANAGER");
    // ADMIN sees every stage in 審核 but reviews none.
    expect(reviewerRole(reviewer("ADMIN"), submissionSheet(slittingRequestV3, "PENDING_GENERAL_MANAGER"))).toBeNull();
    expect(reviewerRole(reviewer("SALES"), submissionSheet(slittingRequestV3, "READY"))).toBeNull();
  });

  it("holds the status until it is approved, even where it stays", () => {
    const manager = user(["MANAGER"]);
    const owed = { ...multiIdentitySheet, state: "READY" as const, review: { required: true, outstanding: true, stageRole: null } };
    expect(canChangeStatus(manager, owed)).toBe(false);
    expect(canChangeStatus(manager, { ...owed, review: { required: true, outstanding: false, stageRole: null } })).toBe(true);
  });
});

const departmentId = "00000000-0000-4000-8000-000000000010";

function user(kinds: MembershipKind[]): SessionUser {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    username: "multi-role",
    displayName: "多重身分",
    roles: [],
    memberships: kinds.map((kind) => ({
      departmentId,
      departmentCode: "FLAT_SHEAR",
      departmentName: "平板剪",
      kind,
    })),
    passwordWarning: false,
  };
}

const multiIdentitySheet = {
  id: "00000000-0000-4000-8000-000000000030",
  sheetNumber: "test-sheet",
  state: "DRAFT",
  version: 1,
  dueAt: null,
  updatedAt: "2026-09-02T00:00:00.000Z",
  assignedUserId: null,
  subpageId: "00000000-0000-4000-8000-000000000060",
  currentDepartmentId: departmentId,
  templateVersionId: "00000000-0000-4000-8000-000000000040",
  originDepartmentId: departmentId,
  createdByUserId: "00000000-0000-4000-8000-000000000099",
  createdAt: "2026-09-02T00:00:00.000Z",
  completedAt: null,
  archivedAt: null,
  template: {
    id: "00000000-0000-4000-8000-000000000050",
    version: 1,
    definition: flatShearCuttingRequestV1,
  },
  values: {},
  approvals: [],
  handoffs: [],
  assignments: [],
  permissions: { canView: true, canEdit: true, canSubmit: true },
  formEnabledInSubpage: true,
  releaseDestination: null,
  review: { required: false, outstanding: false, stageRole: null },
  signatures: {},
    rowMarks: null,
} satisfies SheetDetail;

describe("sheet editor identity unions", () => {
  it("keeps every admitted identity in the same department", () => {
    expect(
      editorKinds(
        user(["MANAGER", "ORDER_TAKER", "STAFF"]),
        multiIdentitySheet,
      ),
    ).toEqual(["ORIGIN_MANAGER", "ORIGIN_ORDER_TAKER", "ORIGIN_STAFF"]);
  });

  it("uses the subpage edit grant instead of legacy identity allowlists", () => {
    expect(
      editorKinds(user(["MANAGER", "STAFF"]), multiIdentitySheet),
    ).toEqual(["ORIGIN_MANAGER", "ORIGIN_ORDER_TAKER", "ORIGIN_STAFF"]);
  });
});

// Nobody is assigned (the user, 2026-09-30): whoever may modify the sheet in
// its subpage starts and completes it, and the 主管 set its 交期.
describe("production without assignment", () => {
  const editable = { canView: true, canEdit: true, canSubmit: true };
  const readOnly = { canView: true, canEdit: false, canSubmit: false };
  const staff = user(["STAFF"]);

  it("lets anyone who may modify the sheet set 待生產, 生產中 or 已完成", () => {
    for (const state of ["READY", "IN_PROGRESS", "COMPLETED"] as const) {
      expect(canChangeStatus(staff, { ...multiIdentitySheet, state, permissions: editable })).toBe(true);
      expect(canChangeStatus(staff, { ...multiIdentitySheet, state, permissions: readOnly })).toBe(false);
    }
    expect(canChangeStatus(staff, { ...multiIdentitySheet, state: "ARCHIVED" })).toBe(false);
  });

  it("leaves the status alone while waiting in 待分派 or still to be sent on", () => {
    expect(canChangeStatus(user(["MANAGER"]), { ...multiIdentitySheet, state: "READY", subpageId: null })).toBe(false);
    // Still to be sent to 燒頓: 燒頓 sets it once it arrives.
    expect(
      canChangeStatus(user(["MANAGER"]), {
        ...multiIdentitySheet,
        state: "READY",
        releaseDestination: { code: "SHAO_DUN", displayName: "燒頓" },
      }),
    ).toBe(false);
  });

  it("leaves the 交期 to the 主管, until the work is done", () => {
    expect(canSetDueDate(user(["MANAGER"]), { ...multiIdentitySheet, state: "READY" })).toBe(true);
    expect(canSetDueDate(user(["MANAGER"]), { ...multiIdentitySheet, state: "DRAFT" })).toBe(true);
    expect(canSetDueDate(staff, { ...multiIdentitySheet, state: "READY" })).toBe(false);
    expect(canSetDueDate(user(["MANAGER"]), { ...multiIdentitySheet, state: "COMPLETED" })).toBe(false);
  });
});
