/**
 * 分條's published form definitions. Each is parsed by the schema when
 * this module loads, so a definition that breaks the schema fails at once.
 */
import { sheetTemplateDefinitionSchema, type MatrixRowInput } from "../template-schema.js";

/**
 * 分條申請單 version 1.
 *
 * Transcribed from the image supplied on 2026-08-08 and confirmed by the user
 * on the same day. The five questions raised by the draft are answered:
 *
 * 1. The printed `總經` is 總經理, and 總經理 is used everywhere in the system.
 * 2. The date and the row fields are required — see rowRequirement below for
 *    what "required" means on a fixed-row form.
 * 3. 需求量 is free text; no unit or decimal rule applies.
 * 4. 分類 is free text, not a fixed option list.
 * 5. A sheet created by 分條 stays in 分條 after review and records no
 *    self-handoff.
 */
export const slittingRequestV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "slitting-request",
  displayName: "分條申請單",
  documentLabel: "文件編號：",
  documentCode: "F/P2-07-01",
  ownerDepartmentCode: "SLITTING",
  allowedCreatorDepartmentCodes: [
    "SLITTING",
    "CUT",
    "STAMPING",
    "FLAT_SHEAR",
    "WAREHOUSE",
  ],
  workflow: {
    requiresReview: true,
    approvalRoles: ["SALES", "ASSOCIATE", "GENERAL_MANAGER"],
    destinationDepartmentCode: "SLITTING",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIELDS",
      key: "header",
      fields: [
        {
          key: "requestDate",
          label: "日期",
          type: "DATE",
          required: true,
          reviewed: true,
          editableBy: ["ORIGIN_MANAGER"],
          editableStates: ["DRAFT", "RETURNED"],
          validationStatus: "CONFIRMED",
        },
      ],
    },
    {
      type: "FIXED_ROWS",
      key: "items",
      label: "分條申請明細",
      rowCount: 8,
      // A row may be left blank, but a started row must be finished, and at
      // least one row must be completed before the sheet can be submitted.
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 1,
      columns: [
        ["specification", "規格"],
        ["material", "材質"],
        ["category", "分類"],
        ["requiredQuantity", "需求量"],
        ["notes", "備註"],
      ].map(([key, label]) => ({
        key,
        label,
        // 需求量 and 分類 are both confirmed as free text: no unit, decimal or
        // option-list rule applies to either.
        type: "TEXT" as const,
        required: true,
        reviewed: true,
        editableBy: ["ORIGIN_MANAGER" as const],
        editableStates: ["DRAFT" as const, "RETURNED" as const],
        validationStatus: "CONFIRMED" as const,
      })),
    },
    {
      type: "APPROVAL_STATUS",
      key: "approvals",
      blocks: [
        {
          // The printed form abbreviates this to 總經. The user confirmed it
          // means 總經理 and asked for 總經理 to be used consistently, so the
          // full role name is what the system displays.
          visibleLabel: "總經理",
          mappedTo: "GENERAL_MANAGER",
          transcriptionStatus: "CONFIRMED",
        },
        {
          visibleLabel: "協理",
          mappedTo: "ASSOCIATE",
          transcriptionStatus: "CONFIRMED",
        },
        {
          visibleLabel: "業務單位",
          mappedTo: "SALES",
          transcriptionStatus: "CONFIRMED",
        },
        {
          visibleLabel: "申請單位",
          mappedTo: "ORIGIN_MANAGER",
          transcriptionStatus: "CONFIRMED",
        },
      ],
    },
  ],
  source: {
    receivedDate: "2026-08-08",
    imageSha256:
      "CC7046978DF5796DA884D94D921D39927948446171ECBC79384919EE75F93C40",
    imageWidth: 792,
    imageHeight: 544,
  },
  openQuestions: [],
});

/**
 * 分條申請單 version 2.
 *
 * Version 1 stays immutable and existing sheets remain pinned to it. Version
 * 2 records the user-approved PDF settings explicitly for new sheets.
 */
export const slittingRequestV2 = sheetTemplateDefinitionSchema.parse({
  ...slittingRequestV1,
  headerLayout: "DATE_TITLE_DOCUMENT",
  printLayout: { paperSize: "A4", orientation: "LANDSCAPE", marginMm: 8 },
});

/**
 * 分條申請單 version 3.
 *
 * Versions 1 and 2 stay immutable. Version 3 adds the user-approved
 * 訂單人員 creation/editing/submission policy for new sheets without changing
 * the source fields, print layout, review chain, allowed origin departments,
 * or routing.
 */
export const slittingRequestV3 = sheetTemplateDefinitionSchema.parse({
  ...slittingRequestV2,
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedSubmitterKinds: ["MANAGER", "ORDER_TAKER"],
  // Any active 訂單人員 in the creating department may maintain its open
  // requests. 員工 are not admitted by allowedEditorKinds.
  staffEditScope: "ANY_IN_DEPARTMENT",
  sections: slittingRequestV2.sections.map((section) => {
    if (section.type === "FIELDS") {
      return {
        ...section,
        fields: section.fields.map((field) => ({
          ...field,
          editableBy: ["ORIGIN_MANAGER" as const, "ORIGIN_ORDER_TAKER" as const],
        })),
      };
    }
    if (section.type === "FIXED_ROWS") {
      return {
        ...section,
        columns: section.columns.map((field) => ({
          ...field,
          editableBy: ["ORIGIN_MANAGER" as const, "ORIGIN_ORDER_TAKER" as const],
        })),
      };
    }
    return section;
  }),
});

/**
 * 分條排刀單 version 1 — approved.
 *
 * Transcribed from the XLSX supplied on 2026-08-11. Sheet1 is the only
 * non-empty worksheet. The visible labels, ten fixed rows, relative Excel
 * column widths, title/date arrangement and below-grid document number are
 * recorded directly rather than inferred from another 分條 form.
 */
export const slittingKnifeLayoutV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "slitting-knife-layout",
  displayName: "分條排刀單",
  documentLabel: "文件編號：",
  documentCode: "F/P1-01-01",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_LEFT_DATE_RIGHT",
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
  ownerDepartmentCode: "SLITTING",
  allowedCreatorDepartmentCodes: ["SLITTING"],
  allowedCreatorKinds: ["MANAGER", "STAFF"],
  staffEditScope: "OWN_OR_ASSIGNED",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "SLITTING",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIELDS",
      key: "header",
      fields: [
        {
          key: "knifeDate",
          label: "日期",
          type: "DATE",
          required: true,
          reviewed: false,
          editableBy: ["ORIGIN_MANAGER", "ORIGIN_STAFF"],
          editableStates: ["DRAFT", "READY", "IN_PROGRESS"],
          validationStatus: "CONFIRMED",
        },
      ],
    },
    {
      type: "FIXED_ROWS",
      key: "items",
      label: "分條排刀明細",
      rowNumberLabel: "序",
      rowNumberWidthUnits: 5.625,
      columnWidthUnits: [12.625, 26.625, 12.625, 12.625, 26.625],
      rowCount: 10,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 1,
      columns: [
        ["steelMill", "鋼廠"],
        // This is the exact workbook label. Do not silently change it to 材質.
        ["material", "質材"],
        ["specification", "規格"],
        ["quantity", "數量"],
        ["totalWidthAndStripCount", "總寬 & 分條件數"],
      ].map(([key, label]) => ({
        key,
        label,
        type: "TEXT" as const,
        required: true,
        reviewed: false,
        editableBy: ["ORIGIN_MANAGER" as const, "ORIGIN_STAFF" as const],
        editableStates: [
          "DRAFT" as const,
          "READY" as const,
          "IN_PROGRESS" as const,
        ],
        validationStatus: "CONFIRMED" as const,
      })),
    },
  ],
  source: {
    receivedDate: "2026-08-11",
    imageSha256:
      "A44CD98D46521C34E008AA16F4D7EC83F6ED0F63F55F6376F2A9D0012F138A04",
    imageWidth: null,
    imageHeight: null,
    fileName: "分條排刀單.xlsx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  openQuestions: [],
});

const productionOrderFieldBase = {
  type: "TEXT" as const,
  // Confirmed 2026-08-11: only 日期, 材料寬度 and 材料材質 must be filled in;
  // every other cell on this form may be left blank.
  required: false,
  reviewed: false,
  // Confirmed 2026-08-08: 分條 staff as well as managers create and fill this
  // form. Scope is limited by staffEditScope below.
  editableBy: ["ORIGIN_MANAGER" as const, "ORIGIN_STAFF" as const],
  editableStates: ["DRAFT" as const, "READY" as const, "IN_PROGRESS" as const],
  validationStatus: "CONFIRMED" as const,
};

function inspectionRow(
  key: string,
  label: string,
  standardValue: string,
  // The *input* type: `multiline` has a default, so it is optional going in
  // and guaranteed coming out of `parse`.
): MatrixRowInput {
  return { ...productionOrderFieldBase, key, label, standardValue };
}

/**
 * 分條製令單 version 1 — approved.
 *
 * Transcribed from the Word document the form is printed from, supplied by the
 * user on 2026-08-11 and fingerprinted below. The ten open questions raised
 * against the earlier image transcription were answered the same day; each
 * answer is recorded beside the structure it settled.
 *
 * The document is a single 48-column table under a centred title, so the
 * rendering follows it row for row rather than grouping into cards.
 */
export const slittingProductionOrderV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "slitting-production-order",
  displayName: "分條製令單",
  documentLabel: "文件編號：",
  documentCode: "F/P1-02-03",
  // The document prints its number in the last row beside 檢驗員, not beside
  // the title.
  documentCodePosition: "BOTTOM_RIGHT",
  ownerDepartmentCode: "SLITTING",
  allowedCreatorDepartmentCodes: ["SLITTING"],
  allowedCreatorKinds: ["MANAGER", "STAFF"],
  staffEditScope: "OWN_OR_ASSIGNED",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "SLITTING",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      // Row 1: three label/value pairs across one printed row.
      type: "FIELDS",
      key: "header",
      fields: [
        {
          ...productionOrderFieldBase,
          key: "orderDate",
          label: "日期",
          type: "DATE",
          required: true,
        },
        // Confirmed: one cell each, and where coils differ the user adds a
        // line rather than the form gaining columns.
        {
          ...productionOrderFieldBase,
          key: "materialWidth",
          label: "材料寬度",
          required: true,
          multiline: true,
        },
        {
          ...productionOrderFieldBase,
          key: "materialGrade",
          label: "材料材質",
          required: true,
          multiline: true,
        },
      ],
    },
    {
      // Rows 2–6: 捲號 第1捲…第10捲 with four recorded values each. Confirmed
      // that ten here against nine in 檢驗紀錄 is the form as printed.
      type: "MATRIX",
      key: "coils",
      label: "捲號",
      columns: Array.from({ length: 10 }, (_, index) => ({
        key: `coil${index + 1}`,
        label: `第${index + 1}捲`,
      })),
      groups: [
        {
          key: "coilChecks",
          label: null,
          rows: [
            inspectionRow("unpackInspection", "拆包檢驗", ""),
            inspectionRow("ironLoss", "鐵損值", ""),
            inspectionRow("cutSize", "開料尺寸", ""),
            inspectionRow("cutQuantity", "開料數量", ""),
          ],
        },
      ],
    },
    {
      // Rows 7–24: 序 / 檢驗項目 / 標準值 against nine coils. The document
      // prints 卷 for the first five columns and 捲 for the rest; confirmed
      // that 捲 is correct throughout, so the inconsistency is not reproduced.
      type: "MATRIX",
      key: "inspectionRecord",
      label: "檢驗紀錄",
      groupHeading: "序",
      rowLabelHeading: "檢驗項目",
      columns: Array.from({ length: 9 }, (_, index) => ({
        key: `record${index + 1}`,
        label: `第${index + 1}捲`,
      })),
      groups: [
        {
          key: "firstArticle",
          label: "首件檢驗",
          rows: [
            // Confirmed: the tolerances are in mm, and the cells stay free
            // text — an inspector writes what they measured, not a number the
            // system parses.
            inspectionRow("thickness", "厚度", "≦0.01"),
            inspectionRow("burr", "毛刺", "≦0.03"),
            inspectionRow("sBend", "S彎", "無"),
            inspectionRow("twist", "扭曲", "無"),
            // Confirmed complete as printed: 輕微≦ is the whole standard.
            inspectionRow("edgeWave", "邊料波紋", "輕微≦"),
            inspectionRow("rust", "生鏽", "無"),
          ],
        },
        {
          key: "patrol",
          label: "巡迴檢驗",
          rows: [
            inspectionRow("patrolTwist", "扭曲", "無"),
            inspectionRow("patrolEdgeWave", "邊料波紋", "輕微≦"),
            inspectionRow("patrolDeformation", "變形", "無"),
            inspectionRow("patrolCoating", "塗層", "良"),
            inspectionRow("patrolRust", "生鏽", "無"),
            inspectionRow("patrolFold", "料折", "無"),
          ],
        },
        {
          key: "warehouse",
          label: "入庫檢驗",
          rows: [
            inspectionRow("endsSecured", "頭尾固定", "有"),
            inspectionRow("tailMarking", "尾端標識", "有"),
            inspectionRow("warehouseDeformation", "變形", "無"),
            // The document ends this group with a printed blank line.
            inspectionRow("warehouseSpare", "", ""),
          ],
        },
      ],
    },
    {
      // Rows 25–28: 排刀情況 headed 1–20 with two write-on rows. Confirmed the
      // cells take numbers but stay free text.
      type: "NUMBERED_GRID",
      key: "knifeArrangement",
      label: "排刀情況",
      columnCount: 20,
      rowCount: 2,
      cell: { ...productionOrderFieldBase, key: "knifeCell", label: "排刀" },
    },
    {
      // Rows 29–33: 領料鋼捲號 １–９ across three columns, plus the unnumbered
      // fourth row the document prints for continuation.
      type: "NUMBERED_BLANKS",
      key: "issuedCoilNumbers",
      label: "領料鋼捲號",
      count: 9,
      columns: 3,
      rows: 4,
      entry: { ...productionOrderFieldBase, key: "issuedCoil", label: "鋼捲號" },
    },
    {
      // Rows 34–35: 條料入庫 headed （1）…（9). Confirmed that each asterisk
      // printed under （1） is a row, so the block is nine columns by nine.
      type: "NUMBERED_GRID",
      key: "stripWarehousing",
      label: "條料入庫",
      columnCount: 9,
      rowCount: 9,
      columnLabels: Array.from({ length: 9 }, (_, index) => `（${index + 1}）`),
      cell: { ...productionOrderFieldBase, key: "stripCell", label: "條料入庫" },
    },
    {
      // Row 36: 檢驗員 beside the document number. Confirmed as a free-text
      // signature rather than a link to a system user.
      type: "FIELDS",
      key: "footer",
      fields: [
        { ...productionOrderFieldBase, key: "inspector", label: "檢驗員" },
      ],
    },
  ],
  source: {
    receivedDate: "2026-08-11",
    imageSha256:
      "4488FA67CE4B3F548025EAF668CA5719DCF47B343BA3CEF0935313AF45CF52D2",
    imageWidth: null,
    imageHeight: null,
    fileName: "分條製令單.docx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  openQuestions: [],
});

/**
 * 分條製令單 version 2.
 *
 * The source-backed version 1 definition is not rewritten. The explicit title
 * and paper layout are a new immutable version used only by new sheets.
 */
export const slittingProductionOrderV2 = sheetTemplateDefinitionSchema.parse({
  ...slittingProductionOrderV1,
  headerLayout: "TITLE_ONLY",
  printLayout: { paperSize: "A4", orientation: "LANDSCAPE", marginMm: 8 },
});
