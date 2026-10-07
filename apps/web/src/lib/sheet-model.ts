import { describeRow, isFieldEditableInState, isWritableField } from "@workflow/contracts";
import type {
  RoleCode,
  SheetState,
  SheetTemplateDefinition,
  TemplateFieldDefinition as ContractTemplateFieldDefinition,
} from "@workflow/contracts";

/**
 * Client-safe sheet types and helpers.
 *
 * Deliberately separate from lib/sheets.ts: that module imports `next/headers`
 * for server-side fetching, and a client component importing it would pull a
 * server-only API into the browser bundle and fail the build.
 */

export type TemplateFieldDefinition = ContractTemplateFieldDefinition;
export type TemplateDefinition = SheetTemplateDefinition;
export type TemplateSection = SheetTemplateDefinition["sections"][number];

export type AvailableTemplate = {
  id: string;
  displayName: string;
  versionId: string;
  version: number;
  requiresReview: boolean;
  definition: TemplateDefinition;
};

export type SheetSummary = {
  id: string;
  sheetNumber: string;
  /** The form's name, which the lists show in place of the sheet number. */
  templateName: string;
  state: SheetState;
  version: number;
  dueAt: string | null;
  updatedAt: string;
  assignedUserId: string | null;
  currentDepartmentId: string;
  subpageId: string | null;
};

/**
 * One approval step as the API returns it: a flat join of run and step, one row
 * per reviewer, ordered by run then sequence. It is *not* nested — an earlier
 * version of this type assumed `{ runNumber, steps[] }` and the page crashed on
 * the first sheet that had actually been submitted.
 */
/**
 * An employee of a department, from `GET /api/departments/:departmentId/staff`,
 * used to name people in a sheet's history.
 */
export type DepartmentStaffMember = {
  id: string;
  username: string;
  displayName: string;
};

/**
 * One immutable move between departments. The record is never rewritten: a
 * sheet that goes 分條 → CUT → 倉管 has three rows, and `priorAssignment`
 * preserves who held it and until when before each move (DESIGN.md §8).
 */
export type SheetHandoff = {
  id: string;
  sequence: number;
  sourceDepartmentId: string;
  destinationDepartmentId: string;
  sentByUserId: string;
  note: string | null;
  priorAssignment: {
    assignedUserId?: string | null;
    dueAt?: string | null;
    completedAt?: string | null;
  } | null;
  createdAt: string;
};

/** One assignment of the sheet to an employee. `endedAt` closes the row. */
export type SheetAssignment = {
  id: string;
  departmentId: string;
  assignedUserId: string;
  assignedByUserId: string;
  dueAt: string | null;
  endedAt: string | null;
  createdAt: string;
};

/**
 * One accepted value change, from `GET /api/sheets/:id/field-history`.
 *
 * Field keys and versions only — never the values themselves. Anyone who may
 * read the sheet may read this, which is why it carries no content.
 */
export type SheetFieldHistoryEntry = {
  auditEventId: string;
  fieldKey: string;
  actor: { id: string; username: string; displayName: string } | null;
  baseVersion: number;
  newVersion: number;
  approvalInvalidated: boolean;
  createdAt: string;
};

export type SheetApprovalStep = {
  runId: string;
  runNumber: number;
  runStatus: "PENDING" | "APPROVED" | "RETURNED" | "INVALIDATED";
  submittedAt: string | null;
  completedAt: string | null;
  sequence: number;
  requiredRole: string;
  reviewerUserId: string | null;
  decision: "PENDING" | "APPROVED" | "REJECTED";
  comment: string | null;
  decidedAt: string | null;
};

// The detail carries its whole definition, so it names the form from that.
export type SheetDetail = Omit<SheetSummary, "templateName"> & {
  templateVersionId: string;
  originDepartmentId: string;
  createdByUserId: string;
  createdAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  template: { id: string; version: number; definition: TemplateDefinition };
  values: Record<string, unknown>;
  approvals: SheetApprovalStep[];
  handoffs: SheetHandoff[];
  assignments: SheetAssignment[];
  permissions: { canView: boolean; canEdit: boolean; canSubmit: boolean };
  /**
   * False when the sheet's subpage no longer ticks its form. Everyone who may
   * view it still can, but only the department 主管 may change it until it is
   * moved somewhere that allows the form or the tick is restored.
   */
  formEnabledInSubpage: boolean;
  /**
   * Where handing the sheet on sends it, for a form with no review whose
   * workflow leads to another department — 燒頓 for 退火明細表. Null when it
   * stays in its own department's 待生產.
   */
  releaseDestination: { code: string; displayName: string } | null;
  /**
   * 分條申請單 is reviewed by 業務, 協理 and 總經理 in turn before it goes on
   * (the user, 2026-10-01). `outstanding` while it still owes that review;
   * `stageRole` is whose turn it is while it is under review.
   */
  review: { required: boolean; outstanding: boolean; stageRole: RoleCode | null };
  /**
   * The names in the printed signature boxes (the user, 2026-10-01): 申請單位
   * is the department it came from, and 業務, 協理 and 總經理 whoever approved
   * their stage, each with the Taipei time. Empty again after 退回.
   */
  signatures: Partial<Record<SignatureSlot, SheetSignature>>;
  /**
   * The rows the receiving department has ticked off (the user, 2026-10-03):
   * 分條申請單's rows once it is in 分條 with its review done, ticked by
   * 分條's 主管. Null where the form takes no ticks or they do not apply yet.
   */
  rowMarks: { sectionKey: string; marked: number[]; canMark: boolean } | null;
};

export type SignatureSlot = "ORIGIN_MANAGER" | "SALES" | "ASSOCIATE" | "GENERAL_MANAGER";
export type SheetSignature = { displayName: string; decidedAt: string | null };

/**
 * Lifecycle labels. The English state codes are settled (DESIGN.md §7.1); this
 * wording is the proposal in §3.2.6 and is still awaiting user confirmation.
 */
export const SHEET_STATE_LABEL: Record<SheetState, string> = {
  DRAFT: "草稿",
  PENDING_SALES: "待業務審核",
  PENDING_ASSOCIATE: "待協理審核",
  PENDING_GENERAL_MANAGER: "待總經理審核",
  // A sheet starts here and its status is set by hand to 待生產, 生產中 or
  // 已完成 (the user, 2026-09-30). ASSIGNED and the draft and review states
  // are retired; migrations 0010 and 0011 moved their sheets to READY.
  READY: "待生產",
  ASSIGNED: "已指派",
  IN_PROGRESS: "生產中",
  COMPLETED: "已完成",
  RETURNED: "已退回",
  ARCHIVED: "已封存",
};

/**
 * What sending a sheet on is called: 送交燒頓 for 退火明細表, 送交分條 for
 * 分條申請單 once reviewed, and 送出審核 while 分條申請單 still owes its review
 * (the user, 2026-10-01). One helper, so the button, its confirmation and the
 * help around it cannot disagree.
 */
export function submitActionLabel(
  releaseDestination: { displayName: string } | null = null,
  reviewOutstanding = false,
): string {
  if (reviewOutstanding) return "送出審核";
  return releaseDestination ? `送交${releaseDestination.displayName}` : "送交";
}

export const SHEET_STATE_TONE: Record<
  SheetState,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  DRAFT: "neutral",
  PENDING_SALES: "warning",
  PENDING_ASSOCIATE: "warning",
  PENDING_GENERAL_MANAGER: "warning",
  READY: "info",
  ASSIGNED: "info",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  RETURNED: "danger",
  ARCHIVED: "neutral",
};

/**
 * Whether the template has any field at all that may be changed in this state.
 *
 * A sheet in 待生產 or 生產中 is still owned by a manager who may edit it later,
 * so asking "is this user the owner?" is not enough to decide whether to show a
 * save control — in those states there is nothing to save, and a permanently
 * disabled 儲存 reads as a broken screen rather than as a closed one.
 */
export function anyFieldEditable(
  definition: TemplateDefinition,
  state: SheetState,
  editors: readonly (
    | "ORIGIN_MANAGER"
    | "ORIGIN_ORDER_TAKER"
    | "ORIGIN_STAFF"
  )[],
): boolean {
  // Printed text, a computed cell or a spacer is never anyone's to change.
  const open = (field: TemplateFieldDefinition) =>
    isWritableField(field) &&
    editors.some((editor) => field.editableBy.includes(editor)) &&
    isFieldEditableInState(field.editableStates, state);
  return definition.sections.some((section) => {
    switch (section.type) {
      case "FIELDS":
        return section.fields.some(open);
      case "FIXED_ROWS":
        return section.columns.some(open);
      case "MATRIX":
        return (
          section.groups.some((group) => group.rows.some(open)) ||
          (section.headingEntry ? open(section.headingEntry.field) : false) ||
          (section.aside ? open(section.aside.field) : false)
        );
      case "NUMBERED_GRID":
        return open(section.cell);
      case "NUMBERED_BLANKS":
        return open(section.entry);
      // The space written in beside a reference table, 鋼捲號.
      case "REFERENCE_BAND":
        return section.entry ? open(section.entry) : false;
      case "APPROVAL_STATUS":
      case "DIAGRAMS":
        return false;
    }
  });
}

/** Field key format used by PATCH /api/sheets/:id/values. */
export function rowFieldKey(
  sectionKey: string,
  rowIndex: number,
  columnKey: string,
): string {
  return `${sectionKey}.${rowIndex}.${columnKey}`;
}

/**
 * Turn a validation key returned by the submit endpoint into something an
 * operator can find on the form.
 *
 * The API answers with storage paths (`rows.2.width`), which are precise but
 * meaningless on paper. This maps them back to the printed labels — 「第 3 列
 * 寬度」 — and falls back to the raw key rather than guessing when a template
 * changes shape underneath us.
 */
export function describeFieldKey(
  definition: TemplateDefinition,
  key: string,
): string {
  for (const section of definition.sections) {
    if (section.type !== "FIELDS") continue;
    const field = section.fields.find((candidate) => candidate.key === key);
    if (field) return field.label;
  }
  // Values kept at the top level beside a matrix or a reference table:
  // 首件檢驗's 類型, the 鋼捲號 written beside the 公差 table.
  for (const section of definition.sections) {
    if (section.type === "MATRIX" && section.aside?.field.key === key) {
      return section.aside.field.label;
    }
    if (section.type === "REFERENCE_BAND" && section.entry?.key === key) {
      return section.entry.label;
    }
  }

  const [sectionKey, ...rest] = key.split(".");
  const section = definition.sections.find(
    (candidate) => "key" in candidate && candidate.key === sectionKey,
  );
  if (!section) return key;

  switch (section.type) {
    case "FIXED_ROWS": {
      if (rest[0] === "minimumCompletedRows") {
        return `${section.label}：至少需要 ${section.minimumCompletedRows} 列完整資料`;
      }
      const column = section.columns.find((candidate) => candidate.key === rest[1]);
      const label = column?.accessibleLabel ?? column?.label ?? rest[1] ?? "";
      const rowIndex = Number(rest[0]);
      // A form of people, 生產日報表, names a person's name by the person
      // alone: it is one cell for their whole block.
      const groups = section.rowGroups;
      if (groups && rest[1] === groups.spanningColumnKey) {
        return `第 ${Math.floor(rowIndex / groups.size) + 1} 位 ${label}`.trim();
      }
      // 第 3 列, 第 2 位 第 3 列, or the row a corner names: 尺寸, 標準值.
      return `${describeRow(section, rowIndex)} ${label}`.trim();
    }
    case "MATRIX": {
      // A written-in heading: 製程檢驗 第1次 檢驗時間 日.
      const entry = section.headingEntry;
      if (entry && rest[0] === entry.field.key) {
        const column = section.columns.find((candidate) => candidate.key === rest[1]);
        const part = entry.parts.find((candidate) => candidate.key === rest[2]);
        return `${section.label} ${column?.label ?? rest[1] ?? ""} ${entry.field.label} ${part?.unit ?? rest[2] ?? ""}`.trim();
      }
      const row = section.groups
        .flatMap((group) => group.rows)
        .find((candidate) => candidate.key === rest[0]);
      const column = section.columns.find((candidate) => candidate.key === rest[1]);
      return `${section.label} ${row?.label ?? rest[0] ?? ""} ${column?.label ?? rest[1] ?? ""}`.trim();
    }
    case "NUMBERED_GRID":
      return `${section.label} 第 ${Number(rest[1]) + 1} 格 第 ${Number(rest[0]) + 1} 列`;
    case "NUMBERED_BLANKS":
      return `${section.label} ${Number(rest[0]) + 1}`;
    default:
      return key;
  }
}
