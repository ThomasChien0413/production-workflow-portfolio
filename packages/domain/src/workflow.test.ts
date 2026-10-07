import { describe, expect, it } from "vitest";
import {
  approveCurrentStage,
  archiveCompletedWork,
  FIRST_REVIEW_STATE,
  isUnderReview,
  rejectCurrentStage,
  requiredApprovalRole,
  canSetDueDate,
  changeProductionStatus,
  postApprovalDestination,
  restoreArchivedWork,
} from "./workflow.js";

describe("sheet workflow", () => {
  it("sends a sheet on to 分條 without a self-handoff", () => {
    expect(postApprovalDestination("CUT", "SLITTING", true)).toBe("SLITTING");
    expect(postApprovalDestination("SLITTING", "SLITTING", true)).toBeNull();
  });

  it("sets 待生產, 生產中 and 已完成 by hand, in any order", () => {
    expect(changeProductionStatus("READY", "IN_PROGRESS")).toBe("IN_PROGRESS");
    expect(changeProductionStatus("IN_PROGRESS", "COMPLETED")).toBe("COMPLETED");
    expect(changeProductionStatus("COMPLETED", "IN_PROGRESS")).toBe("IN_PROGRESS");
    expect(changeProductionStatus("READY", "COMPLETED")).toBe("COMPLETED");
    expect(() => changeProductionStatus("READY", "READY")).toThrow();
    expect(() => changeProductionStatus("ARCHIVED", "READY")).toThrow();
    expect(() => changeProductionStatus("DRAFT", "IN_PROGRESS")).toThrow();
    expect(() => changeProductionStatus("READY", "ARCHIVED")).toThrow();
  });

  it("lets a 交期 be set until the work is done", () => {
    for (const state of ["DRAFT", "PENDING_SALES", "READY", "IN_PROGRESS"] as const) {
      expect(canSetDueDate(state)).toBe(true);
    }
    expect(canSetDueDate("COMPLETED")).toBe(false);
    expect(canSetDueDate("ARCHIVED")).toBe(false);
  });

  it("archives only completed work", () => {
    expect(archiveCompletedWork("COMPLETED")).toBe("ARCHIVED");
    expect(() => archiveCompletedWork("IN_PROGRESS")).toThrow();
    expect(() => archiveCompletedWork("ARCHIVED")).toThrow();
  });

  it("restores only archived work, as 已完成", () => {
    expect(restoreArchivedWork("ARCHIVED")).toBe("COMPLETED");
    expect(() => restoreArchivedWork("COMPLETED")).toThrow();
    expect(() => restoreArchivedWork("IN_PROGRESS")).toThrow();
  });
});

// 分條申請單 is reviewed by 業務, 協理 and 總經理 in turn (the user, 2026-10-01).
describe("分條申請單 review", () => {
  it("passes 業務, 協理 and 總經理 in turn, then is ready", () => {
    expect(FIRST_REVIEW_STATE).toBe("PENDING_SALES");
    expect(requiredApprovalRole("PENDING_SALES")).toBe("SALES");
    expect(approveCurrentStage("PENDING_SALES")).toBe("PENDING_ASSOCIATE");
    expect(requiredApprovalRole("PENDING_ASSOCIATE")).toBe("ASSOCIATE");
    expect(approveCurrentStage("PENDING_ASSOCIATE")).toBe("PENDING_GENERAL_MANAGER");
    expect(requiredApprovalRole("PENDING_GENERAL_MANAGER")).toBe("GENERAL_MANAGER");
    expect(approveCurrentStage("PENDING_GENERAL_MANAGER")).toBe("READY");
  });

  it("is under review only at those three stages", () => {
    for (const state of ["READY", "IN_PROGRESS", "COMPLETED", "RETURNED", "ARCHIVED"] as const) {
      expect(isUnderReview(state)).toBe(false);
      expect(requiredApprovalRole(state)).toBeNull();
      expect(() => approveCurrentStage(state)).toThrow();
    }
  });

  it("returns at any stage, but only with a reason", () => {
    for (const state of ["PENDING_SALES", "PENDING_ASSOCIATE", "PENDING_GENERAL_MANAGER"] as const) {
      expect(rejectCurrentStage(state, "數量不對")).toBe("RETURNED");
      expect(() => rejectCurrentStage(state, "   ")).toThrow();
    }
    expect(() => rejectCurrentStage("READY", "數量不對")).toThrow();
  });
});
