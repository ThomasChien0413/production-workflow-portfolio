/**
 * 沖壓's published form definitions. Each is parsed by the schema when
 * this module loads, so a definition that breaks the schema fails at once.
 */
import { sheetTemplateDefinitionSchema } from "../template-schema.js";
import { cutFinishedInspectionV1 } from "./cut.js";

/**
 * EI客戶訂購表 — 沖壓's customer order register.
 *
 * Source supplied by the user on 2026-08-21 as `EI客戶訂購表.xls`. The workbook
 * holds one worksheet, `EI`, and the printed form is the whole of it: a title,
 * one heading row, and twenty-four ruled entry rows.
 *
 * The first column is 訂日, not a serial number, so the form prints no row
 * numbers — the first transcription to need `rowNumbers: false`.
 */
export const stampingEiCustomerOrderV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "stamping-ei-customer-order",
  // The worksheet centres the title with padding spaces — `E I  客 戶 訂 購 表`.
  // That is Excel spacing a cell, not the wording, and the form stylesheet
  // letter-spaces the printed title already, so it is stored unspaced. The same
  // decision was taken for 倉位入庫表 on 2026-08-13.
  displayName: "EI客戶訂購表",
  documentLabel: "文件編號：",
  documentCode: "F/P2-08-01",
  documentCodePosition: "BELOW_GRID_RIGHT",
  // No date in the header: 訂日 and 交期 are both columns, entered per row.
  headerLayout: "TITLE_ONLY",
  // The worksheet is set to A4 portrait, fit to one page wide, and seven
  // columns of about 93 character units across 24 rows sit comfortably in it.
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
  ownerDepartmentCode: "STAMPING",
  allowedCreatorDepartmentCodes: ["STAMPING"],
  // Confirmed 2026-08-21: only 主管 and 訂單人員 open and fill this form.
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  // A shared register rather than one person's sheet: any 訂單人員 in 沖壓
  // maintains any of the department's open registers.
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    // Confirmed 2026-08-21: no review. The paper carries no signature band.
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "STAMPING",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIXED_ROWS",
      key: "orders",
      label: "客戶訂購明細",
      // 訂日 occupies the first column; the paper numbers nothing.
      rowNumbers: false,
      columnWidthUnits: [5, 14.25, 35, 10.25, 8.13, 6, 14.75],
      rowCount: 24,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        ["orderDate", "訂日"],
        ["customer", "客戶"],
        // Printed as `規格 / 材質` across one cell; the padding is Excel
        // centring, as with the title.
        ["specification", "規格/材質"],
        ["quantity", "數量"],
        // Both dates stay free text. Nothing reads them, and neither is the
        // sheet's own deadline the way 交期 is on 裁剪需求表.
        ["deliveryDate", "交期"],
        ["unitPrice", "單價"],
        ["note", "備註"],
      ].map(([key, label]) => ({
        key,
        label,
        type: "TEXT" as const,
        required: false,
        reviewed: false,
        editableBy: ["ORIGIN_MANAGER" as const, "ORIGIN_ORDER_TAKER" as const],
        editableStates: ["DRAFT" as const, "READY" as const, "IN_PROGRESS" as const],
        validationStatus: "CONFIRMED" as const,
      })),
    },
  ],
  source: {
    receivedDate: "2026-08-21",
    imageSha256:
      "DB0AA3A590DAF268AEDB8394DA67EE33BA6D2906C022CDBA01DE0C66465B0841",
    imageWidth: null,
    imageHeight: null,
    fileName: "EI客戶訂購表.xls",
    mediaType: "application/vnd.ms-excel",
  },
  openQuestions: [],
});

/**
 * 待燒入庫表 — what 沖壓 puts into store to wait for firing, handed on to 燒頓
 * (the user, 2026-09-28). No review.
 *
 * Source supplied as `待燒入庫表.xls`. Of its five worksheets, `待燒入庫單` is
 * this form: the title, 序 numbered 1 to 25, four written columns at the
 * worksheet's proportions, A4 portrait, and F/P4-02-01 below the box. The
 * other four — 領料單, 分條日報, 分條-黃, 分條-姚 — are separate forms and
 * are not taken from here. 入庫日 stays text, as every register's dates do.
 */
export const stampingFiringIntakeV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "stamping-firing-intake",
  // The worksheet is named 待燒入庫單; the form prints 待燒入庫表.
  displayName: "待燒入庫表",
  documentLabel: "文件編號：",
  documentCode: "F/P4-02-01",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_ONLY",
  // Twenty-five rows fill a portrait page, so they sit a little tighter than
  // the default 10mm.
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8, rowHeightMm: 9.5 },
  ownerDepartmentCode: "STAMPING",
  allowedCreatorDepartmentCodes: ["STAMPING"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    // Handing it on sends it to 燒頓 (the user, 2026-09-28).
    destinationDepartmentCode: "SHAO_DUN",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIXED_ROWS",
      key: "items",
      label: "待燒入庫明細",
      rowNumberLabel: "序",
      rowNumberWidthUnits: 4,
      columnWidthUnits: [9.38, 20, 35, 25],
      rowCount: 25,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        ["intakeDate", "入庫日"],
        ["specification", "規格/材質"],
        ["weightCartons", "重量/箱數"],
        ["locationNote", "倉位/備註"],
      ].map(([key, label]) => ({
        key,
        label,
        type: "TEXT" as const,
        required: false,
        reviewed: false,
        editableBy: ["ORIGIN_MANAGER" as const, "ORIGIN_ORDER_TAKER" as const],
        editableStates: ["DRAFT" as const, "READY" as const, "IN_PROGRESS" as const],
        validationStatus: "CONFIRMED" as const,
      })),
    },
  ],
  source: {
    receivedDate: "2026-09-28",
    imageSha256:
      "F8A6E55CC2B05A0D2C1EDBDEF1B5EDA0B71D8444C1989DE99CD22C089A7A6966",
    imageWidth: null,
    imageHeight: null,
    fileName: "待燒入庫表.xls",
    mediaType: "application/vnd.ms-excel",
  },
  openQuestions: [],
});

/**
 * 產品需求表 — 沖壓's product demand register (the user, 2026-09-28). No
 * review; handing it on keeps it in 沖壓 for assignment.
 *
 * Source supplied as `產品需求表.xls`. `Sheet1` is the blank form; `涵宇` is
 * the user's worked example (成田, 2018.02.08, five rows and a red note) and
 * none of it is seeded. The form: the current 新北市 letterhead, the title,
 * six printed headings over twenty-two unnumbered rows at the worksheet's
 * proportions, A4 portrait, and F/M1-03-01 below the box.
 *
 * 交期 prints `□庫存□其他：＿＿` in every row: the delivery comes from stock,
 * or from somewhere else written on the line. That is one cell holding a
 * ticked box, and for 其他 what was written after it (`choiceWriteIn`).
 */
export const stampingProductDemandV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "stamping-product-demand",
  displayName: "產品需求表",
  letterhead: cutFinishedInspectionV1.letterhead,
  documentLabel: "文件編號：",
  documentCode: "F/M1-03-01",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_ONLY",
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
  ownerDepartmentCode: "STAMPING",
  allowedCreatorDepartmentCodes: ["STAMPING"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "STAMPING",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIXED_ROWS",
      key: "demands",
      label: "產品需求明細",
      rowNumbers: false,
      columnWidthUnits: [11.13, 20, 12, 12, 25, 10.13],
      rowCount: 22,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        // Printed with its colon, as a label to write after.
        { key: "orderNo", label: "製令NO：", accessibleLabel: "製令NO" },
        { key: "specification", label: "規格" },
        { key: "material", label: "材質" },
        { key: "quantity", label: "數量" },
        {
          key: "delivery",
          label: "交期",
          choices: ["庫存", "其他"],
          // Printed `□庫存□其他：`, the boxes set against each other.
          choicesSeparator: "",
          choiceWriteIn: "其他",
        },
        { key: "note", label: "備註" },
      ].map((column) => ({
        ...column,
        type: "TEXT" as const,
        required: false,
        reviewed: false,
        editableBy: ["ORIGIN_MANAGER" as const, "ORIGIN_ORDER_TAKER" as const],
        editableStates: ["DRAFT" as const, "READY" as const, "IN_PROGRESS" as const],
        validationStatus: "CONFIRMED" as const,
      })),
    },
  ],
  source: {
    receivedDate: "2026-09-28",
    imageSha256:
      "41DBEADE51F7CE393FE75584933E214F101E630C7A875571CA87A19C8AA0A20F",
    imageWidth: null,
    imageHeight: null,
    fileName: "產品需求表.xls",
    mediaType: "application/vnd.ms-excel",
  },
  openQuestions: [],
});

/**
 * 沖壓's production board, 生產作業看板 (the user, 2026-09-28). No review;
 * handing it on keeps it in 沖壓 for assignment.
 *
 * Source supplied as `生產作業看板(沖壓).xlsx`: one worksheet, empty, A4
 * landscape fitted to one page. 編號 numbers twelve rows beside what is on the
 * press — 規格材質, 日期, 預計產量 — and what waits for it — 待沖規格, 材質,
 * 預計產量, 安裝日期 — then 備註, with the identifier below the grid at the
 * right.
 *
 * The worksheet prints no title. As with CUT's board from
 * `生產作業看板(CUT).xlsx`, the name comes from the file, without the
 * department, which every list already shows beside it.
 */
export const stampingProductionBoardV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "stamping-production-board",
  displayName: "生產作業看板",
  documentLabel: "文件編號：",
  documentCode: "F/P2-09-01",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_ONLY",
  printLayout: { paperSize: "A4", orientation: "LANDSCAPE", marginMm: 8 },
  ownerDepartmentCode: "STAMPING",
  allowedCreatorDepartmentCodes: ["STAMPING"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "STAMPING",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIXED_ROWS",
      key: "presses",
      label: "生產作業",
      rowNumberLabel: "編號",
      rowNumberWidthUnits: 8.38,
      columnWidthUnits: [16, 8.38, 12, 8.38, 8.38, 8.38, 8.38, 20],
      rowCount: 12,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        { key: "specification", label: "規格材質" },
        { key: "date", label: "日期" },
        { key: "plannedOutput", label: "預計產量" },
        { key: "pendingSpecification", label: "待沖規格" },
        { key: "pendingMaterial", label: "材質" },
        // The paper prints 預計產量 twice; the second is the waiting job's,
        // and a screen reader needs to tell the two apart.
        { key: "pendingPlannedOutput", label: "預計產量", accessibleLabel: "待沖預計產量" },
        { key: "installDate", label: "安裝日期" },
        { key: "note", label: "備註" },
      ].map((column) => ({
        ...column,
        type: "TEXT" as const,
        required: false,
        reviewed: false,
        editableBy: ["ORIGIN_MANAGER" as const, "ORIGIN_ORDER_TAKER" as const],
        editableStates: ["DRAFT" as const, "READY" as const, "IN_PROGRESS" as const],
        validationStatus: "CONFIRMED" as const,
      })),
    },
  ],
  source: {
    receivedDate: "2026-09-28",
    imageSha256:
      "F89FACBB61EF4F55D7EE5406D4A7A13863853A5ADB5110A0A0C14EBC8579C93C",
    imageWidth: null,
    imageHeight: null,
    fileName: "生產作業看板(沖壓).xlsx",
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  openQuestions: [],
});

/** A write-on box 沖壓's 主管 and 訂單人員 fill while the sheet is open. */
const stampingWriteOn = {
  type: "TEXT" as const,
  required: false,
  reviewed: false,
  editableBy: ["ORIGIN_MANAGER" as const, "ORIGIN_ORDER_TAKER" as const],
  editableStates: ["DRAFT" as const, "READY" as const, "IN_PROGRESS" as const],
  validationStatus: "CONFIRMED" as const,
};

/**
 * 沖壓's 生產日報表 (the user, 2026-09-29). No review; handing it on keeps it
 * in 沖壓 for assignment.
 *
 * Source supplied as `生產日報表(沖壓).xlsx`, printed on both sides. `正面`,
 * A4 landscape: the current 新北市 letterhead, the title, 日期 and 上班 on one
 * line, eight rows under two-row headings, the PS note and F/P2-10-01 below.
 * `背面`, A4 portrait: twelve numbered spaces, 1–6 down the left and 7–12
 * down the right, for the material labels torn off the coils. The user asked
 * for the back to show below the front on screen.
 *
 * E and I are the two lamination pieces. 箱重/箱數 prints `E: ＿K* ＿箱` and
 * `I: ＿K* ＿箱` — box weight times box count — each pair in one cell; C級 and
 * D級 print `E: ＿K` over `I: ＿K`. The worksheet's first row prints `E` with
 * no colon, the other seven `E:`; the reproduction prints `E:` throughout.
 */
export const stampingDailyReportV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "stamping-daily-report",
  displayName: "生產日報表",
  letterhead: cutFinishedInspectionV1.letterhead,
  documentLabel: "文件編號：",
  documentCode: "F/P2-10-01",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_ONLY",
  footerNote: { text: "PS.請將撕下之材料標纖貼在日報表背面，於下班後交回，謝謝大家的合作。" },
  printLayout: { paperSize: "A4", orientation: "LANDSCAPE", marginMm: 6, rowHeightMm: 12 },
  ownerDepartmentCode: "STAMPING",
  allowedCreatorDepartmentCodes: ["STAMPING"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "STAMPING",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIELDS",
      key: "day",
      // One printed line, named so its cells size to their words.
      fieldRows: [2],
      fields: [
        { ...stampingWriteOn, key: "workDate", label: "日期", type: "DATE" },
        {
          ...stampingWriteOn,
          key: "shift",
          label: "上班",
          choices: ["未加班", "有加班", "假日加班3小時", "假日加班6小時", "請假"],
          // `□請假 ＿H`: the hours written after it.
          choiceWriteIn: "請假",
          choiceWriteInSeparator: " ",
          choiceWriteInUnit: "H",
        },
      ],
    },
    {
      type: "FIXED_ROWS",
      key: "jobs",
      label: "生產紀錄",
      rowNumbers: false,
      // One width per printed cell: 箱重/箱數's E and I cells each hold two
      // values, and C級 and D級 two stacked.
      columnWidthUnits: [14.88, 15, 13, 11, 21.75, 21.75, 6, 6, 8.38, 8.38, 8.38, 8.38, 8.38, 8.38],
      rowCount: 8,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      headingGroups: [
        {
          label: "箱重/箱數",
          columnKeys: ["eBoxWeight", "eBoxCount", "iBoxWeight", "iBoxCount"],
          subheadings: false,
        },
        {
          label: "不良品",
          columnKeys: ["cGradeE", "cGradeI", "dGradeE", "dGradeI", "scrap"],
          subheadings: true,
        },
      ],
      columns: [
        { key: "workOrderNo", label: "工單號" },
        { key: "period", label: "起訖時間" },
        { key: "specification", label: "規格/\n材質", accessibleLabel: "規格/材質" },
        { key: "materialWeight", label: "材料\n重量", accessibleLabel: "材料重量" },
        { key: "eBoxWeight", label: "E 箱重", prefix: "E:", unit: "K*", joinNext: "INLINE" as const },
        { key: "eBoxCount", label: "E 箱數", unit: "箱" },
        { key: "iBoxWeight", label: "I 箱重", prefix: "I:", unit: "K*", joinNext: "INLINE" as const },
        { key: "iBoxCount", label: "I 箱數", unit: "箱" },
        { key: "nGrade", label: "N品" },
        { key: "awaitingFiring", label: "待燒" },
        { key: "sunDay", label: "太陽日" },
        { key: "nextDayWeight", label: "次日續\n沖重量", accessibleLabel: "次日續沖重量" },
        {
          key: "cGradeE",
          label: "C級",
          accessibleLabel: "C級 E",
          prefix: "E:",
          unit: "K",
          joinNext: "STACKED" as const,
        },
        { key: "cGradeI", label: "C級 I", prefix: "I:", unit: "K" },
        {
          key: "dGradeE",
          label: "D級",
          accessibleLabel: "D級 E",
          prefix: "E:",
          unit: "K",
          joinNext: "STACKED" as const,
        },
        { key: "dGradeI", label: "D級 I", prefix: "I:", unit: "K" },
        { key: "scrap", label: "報廢", unit: "K" },
        { key: "remarks", label: "異常原\n因備註", accessibleLabel: "異常原因備註" },
      ].map((column) => ({ ...stampingWriteOn, ...column })),
    },
    {
      type: "NUMBERED_BLANKS",
      key: "labels",
      label: "背面",
      count: 12,
      columns: 2,
      rows: 6,
      order: "DOWN",
      printedOnBack: true,
      entry: { ...stampingWriteOn, key: "label", label: "背面" },
    },
  ],
  source: {
    receivedDate: "2026-09-29",
    imageSha256:
      "B086B0C269A73B2DADB06666091F474F259C512ACA5BA283D86087B9141D9320",
    imageWidth: null,
    imageHeight: null,
    fileName: "生產日報表(沖壓).xlsx",
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  openQuestions: [],
});

const patrolBase = {
  type: "TEXT" as const,
  required: false,
  reviewed: false,
  editableStates: ["DRAFT" as const, "READY" as const, "IN_PROGRESS" as const],
  validationStatus: "CONFIRMED" as const,
  editableBy: ["ORIGIN_MANAGER" as const, "ORIGIN_ORDER_TAKER" as const],
};
/** A 首件 reading row: 標準 written, 公差 printed. */
const patrolReading = (key: string, label: string, tolerance: string | null) => ({
  ...patrolBase,
  key,
  label,
  standardValue: tolerance,
});
/** One cell across 標準, 公差 and both 檢測值, as 毛刺 板形 料厚 and 外觀 print it. */
const FIRST_PIECE_SPAN = ["standard", "tolerance", "reading1", "reading2"];
const PATROL_ROUNDS = ["round1", "round2", "round3", "round4", "round5", "round6"];
const APPEARANCE: [string, string][] = [
  ["scratch", "劃傷"],
  ["dent", "壓印"],
  ["rust", "鏽斑"],
];

/**
 * 首件/巡迴檢驗單 for 沖壓 and 平板剪 (the user, 2026-09-30): one form both
 * departments write and each keeps; no review.
 *
 * Source supplied as `EI+平板剪-首件巡迴檢驗單.xlsx`: one worksheet,
 * `EI+平板剪(1150924改)`, A4 portrait, under the black-and-white 台北縣
 * letterhead picture. Beside CUT's form of the same name it measures a
 * sheared strip (剪片) or an EI lamination rather than a core:
 *
 * - 首件檢驗: 尺寸 A K D N and 積厚 (標準 written in mm), a blank line, and
 *   孔徑∮Ho, each with a written 標準, a printed 公差, two 檢測值 and a
 *   判定; 毛刺≦0.02mm, 板形 and 料厚 written once across the four; 外觀
 *   劃傷 壓印 鏽斑 角度 ticked 有 or 無 across them. Beside them the 剪片 and
 *   EI views, 類型 ticked, and 尺寸公差：±0.1mm.
 * - 製程檢驗: each round's 製令單號 and 規格, then its time `＿日 ＿時 ＿分`
 *   under a corner of 檢驗時間 over 質量特性; the same measurements, 積厚 in
 *   mm, 有/無 for the 外觀 and NG or OK per round.
 *
 * Then 重量 標識 包裝外觀, the 異常描述 of 材料 and 成品 beside 主管裁示,
 * 品質判定 合格 or 不合格, 備註 審核 and 單位：mm, and F/Q1-01-03. The paper
 * prints 異常描述 down the side of 材料 and 成品; the fields carry it in
 * their names instead.
 */
export const stampingPatrolInspectionV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "stamping-patrol-inspection",
  displayName: "首件/巡迴檢驗單",
  letterhead: {
    asset: "/templates/stamping/patrol-inspection-letterhead.png",
    alt: "CUT CORE 永進矽鋼股份有限公司 Yung-Chin Silicon Steel Co., Ltd.，23678台北縣土城市自由街1號，電話 02-80763336，傳真 02-80763338",
  },
  documentLabel: "文件編號：",
  documentCode: "F/Q1-01-03",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_ONLY",
  headerLines: [{ text: "單位：mm", placement: "BOTTOM", align: "END" }],
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 6, rowHeightMm: 5.2 },
  ownerDepartmentCode: "STAMPING",
  allowedCreatorDepartmentCodes: ["STAMPING", "FLAT_SHEAR"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "STAMPING",
    avoidSelfHandoff: true,
    // 沖壓's stay in 沖壓 and 平板剪's in 平板剪.
    staysInOrigin: true,
  },
  sections: [
    {
      type: "FIELDS",
      key: "job",
      fieldRows: [3, 3],
      fields: [
        { ...patrolBase, key: "productionDateShift", label: "生產日期/班次" },
        { ...patrolBase, key: "inspector", label: "品管員" },
        { ...patrolBase, key: "operator", label: "作業人員" },
        { ...patrolBase, key: "orderNo", label: "製令單號" },
        { ...patrolBase, key: "specification", label: "規格/材質" },
        { ...patrolBase, key: "machine", label: "機床/模具" },
      ],
    },
    {
      type: "MATRIX",
      key: "firstPiece",
      label: "首件檢驗",
      sideLabel: "首件檢驗",
      rowLabelHeading: "品質特性",
      // Side label, group, row label, 標準, 公差, two 檢測值, 判定, the drawings.
      columnWidthUnits: [4.38, 6.25, 5.5, 6.38, 5.25, 5.25, 5.25, 5.25, 36.88],
      columns: [
        { key: "standard", label: "標準" },
        { key: "tolerance", label: "公差", printsStandard: true },
        { key: "reading1", label: "檢測值 1", heading: "檢測值", headingSpan: 2 },
        { key: "reading2", label: "檢測值 2" },
        { key: "verdict", label: "判定" },
      ],
      groups: [
        {
          key: "size",
          label: "尺寸",
          rows: [
            patrolReading("a", "A", "≦0.1"),
            patrolReading("k", "K", "±0.1"),
            patrolReading("d", "D", "±0.1"),
            patrolReading("n", "N", "±0.1"),
            { ...patrolReading("stack", "積厚", "±1"), cellUnits: { standard: "mm" } },
            // A printed blank line for a size the form did not name.
            patrolReading("extra", "", null),
          ],
        },
        {
          key: "checks",
          label: null,
          rows: [
            patrolReading("hole", "孔徑∮Ho", "±0.1"),
            { ...patrolReading("burr", "毛刺≦0.02mm", null), spanColumns: FIRST_PIECE_SPAN },
            { ...patrolReading("flatness", "板形", null), spanColumns: FIRST_PIECE_SPAN },
            { ...patrolReading("thickness", "料厚", null), spanColumns: FIRST_PIECE_SPAN },
          ],
        },
        {
          key: "appearance",
          label: "外觀",
          rows: [...APPEARANCE, ["angle", "角度"] as [string, string]].map(([key, label]) => ({
            ...patrolReading(key, label, null),
            choices: ["有", "無"],
            spanColumns: FIRST_PIECE_SPAN,
          })),
        },
      ],
      aside: {
        field: { ...patrolBase, key: "partType", label: "類型", choices: ["剪片", "EI"] },
        drawing: {
          asset: "/templates/stamping/patrol-inspection-parts.svg",
          alt: "剪片：長條，三個孔，標示 A、N、D、K 與孔徑 ∮Ho；EI片：兩個窗口，四個孔，標示 A、K、D、N 與孔徑 ∮Ho",
        },
        note: "尺寸公差：±0.1mm",
      },
    },
    {
      type: "MATRIX",
      key: "rounds",
      label: "製程檢驗",
      sideLabel: "製程檢驗",
      cornerCell: { across: "檢驗時間", down: "質量特性" },
      // Side label, group, row label, then the six rounds.
      columnWidthUnits: [4.38, 6.25, 5.5, 11.63, 10.5, 10.5, 10.5, 10.5, 10.63],
      headingEntry: {
        field: { ...patrolBase, key: "checkedAt", label: "檢驗時間" },
        parts: [
          { key: "day", unit: "日" },
          { key: "hour", unit: "時" },
          { key: "minute", unit: "分" },
        ],
      },
      columns: PATROL_ROUNDS.map((key, index) => ({ key, label: `第${index + 1}次` })),
      groups: [
        // Written above the time of each round, as the paper does.
        {
          key: "order",
          label: null,
          aboveHeading: true,
          rows: [
            patrolReading("orderNo", "製令單號", null),
            patrolReading("specification", "規格", null),
          ],
        },
        {
          key: "size",
          label: "尺寸",
          rows: [
            patrolReading("a", "A", null),
            patrolReading("k", "K", null),
            patrolReading("d", "D", null),
            patrolReading("n", "N", null),
            {
              ...patrolReading("stack", "積厚", null),
              cellUnits: Object.fromEntries(PATROL_ROUNDS.map((key) => [key, "mm"])),
            },
            patrolReading("extra", "", null),
          ],
        },
        {
          key: "checks",
          label: null,
          rows: [
            patrolReading("burr", "毛刺", null),
            patrolReading("flatness", "板形", null),
            patrolReading("thickness", "料厚", null),
          ],
        },
        {
          key: "appearance",
          label: "外觀",
          rows: APPEARANCE.map(([key, label]) => ({
            ...patrolReading(key, label, null),
            choices: ["有", "無"],
          })),
        },
        {
          key: "result",
          label: null,
          rows: [{ ...patrolReading("verdict", "判定", null), choices: ["NG", "OK"] }],
        },
      ],
    },
    {
      type: "FIELDS",
      key: "packing",
      fieldRows: [3],
      fields: [
        { ...patrolBase, key: "weight", label: "重量" },
        { ...patrolBase, key: "marking", label: "標識" },
        { ...patrolBase, key: "packagingAppearance", label: "包裝外觀" },
      ],
    },
    {
      type: "FIELDS",
      key: "abnormal",
      fieldRows: [3],
      fields: [
        { ...patrolBase, key: "material", label: "異常描述－材料", multiline: true },
        { ...patrolBase, key: "product", label: "異常描述－成品", multiline: true },
        { ...patrolBase, key: "supervisorInstruction", label: "主管裁示", multiline: true },
      ],
    },
    {
      type: "FIELDS",
      key: "judgement",
      fields: [
        { ...patrolBase, key: "qualityVerdict", label: "品質判定", choices: ["合格", "不合格"] },
      ],
    },
    {
      type: "FIELDS",
      key: "closing",
      fieldRows: [2],
      fields: [
        { ...patrolBase, key: "remarks", label: "備註" },
        { ...patrolBase, key: "reviewer", label: "審核" },
      ],
    },
  ],
  source: {
    receivedDate: "2026-09-30",
    imageSha256: "6236C96AFDF3E2EF06E8E545230BC16068542E1788C90E9BF006747D2739F8D8",
    imageWidth: null,
    imageHeight: null,
    fileName: "EI+平板剪-首件巡迴檢驗單.xlsx",
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  openQuestions: [],
});
