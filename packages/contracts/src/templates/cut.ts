/**
 * CUT's published form definitions. Each is parsed by the schema when
 * this module loads, so a definition that breaks the schema fails at once.
 */
import { sheetTemplateDefinitionSchema } from "../template-schema.js";

/**
 * 加工製令單 — CUT's processing work order.
 *
 * Source supplied by the user on 2026-08-21 as `加工製令單.xls`. One worksheet,
 * `新`, holding a header block of order details and a nine-step process table.
 *
 * The worksheet also carries a company letterhead picture and 641 zero-sized
 * leftover line objects. Neither is form content: the lines have no size and do
 * not print, and the letterhead is stationery whose address predates the 2010
 * 台北縣 → 新北市 rename, so reprinting it from here would put a stale address
 * on every sheet. Both are left out; see DESIGN.md §6.7.
 */
const cutOrderBase = {
  type: "TEXT" as const,
  required: false,
  reviewed: false,
  editableStates: ["DRAFT" as const, "READY" as const, "IN_PROGRESS" as const],
  validationStatus: "CONFIRMED" as const,
  editableBy: ["ORIGIN_MANAGER" as const, "ORIGIN_ORDER_TAKER" as const],
};

export const cutProcessingOrderV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "cut-processing-order",
  displayName: "加工製令單",
  letterhead: {
    asset: "/templates/cut/letterhead.png",
    alt: "永進矽鋼股份有限公司 Yung-Chin Silicon Steel Co., Ltd.，23678台北縣土城市自由街1號，電話 02-80763336，傳真 02-80763338",
  },
  documentLabel: "文件編號:",
  documentCode: "F/P5-05-05",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_ONLY",
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
  ownerDepartmentCode: "CUT",
  allowedCreatorDepartmentCodes: ["CUT"],
  // Confirmed 2026-08-21: 主管 and 訂單人員 create and modify it.
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    // Confirmed 2026-08-21: no review. The paper carries no signature band.
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "CUT",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIELDS",
      key: "order",
      // The paper's own six header rows, in its own irregular widths.
      fieldRows: [4, 4, 4, 2, 1, 3],
      fields: [
        { ...cutOrderBase, key: "customer", label: "客戶" },
        { ...cutOrderBase, key: "customerOrderNo", label: "客戶訂號" },
        { ...cutOrderBase, key: "orderDate", label: "訂貨日" },
        { ...cutOrderBase, key: "deliveryDate", label: "交期" },
        { ...cutOrderBase, key: "coreSize", label: "鐵芯尺寸" },
        { ...cutOrderBase, key: "orderQuantity", label: "訂購數量" },
        { ...cutOrderBase, key: "estimatedUnitWeight", label: "預重單重" },
        // The paper rules `KG` into its own cell after the box, so it is one
        // here too rather than being folded into the label beside it.
        { ...cutOrderBase, key: "unitWeightUnit", label: "KG", printedOnly: true },
        { ...cutOrderBase, key: "material", label: "材質" },
        { ...cutOrderBase, key: "windingPressure", label: "捲繞壓力" },
        { ...cutOrderBase, key: "estimatedTotalWeight", label: "約耗材總重" },
        { ...cutOrderBase, key: "totalWeightUnit", label: "KG", printedOnly: true },
        { ...cutOrderBase, key: "coilNo", label: "鋼捲號" },
        { ...cutOrderBase, key: "issuedWeight", label: "領料重量" },
        { ...cutOrderBase, key: "note", label: "備註", multiline: true },
        { ...cutOrderBase, key: "annealNo", label: "退火編號" },
        // Printed instruction in its own ruled cell, exactly as the paper
        // has it, followed by the 工單號 label and its box.
        {
          ...cutOrderBase,
          key: "productionHandoverNote",
          label: "製令單交給生產部",
          printedOnly: true,
        },
        { ...cutOrderBase, key: "workOrderNo", label: "工單號" },
      ],
    },
    {
      type: "MATRIX",
      key: "process",
      // Printed over the step column; the paper heads the block with nothing
      // else, so this doubles as the block heading.
      label: "工作流程",
      // 工作流程 then the eight recorded columns.
      columnWidthUnits: [6.25, 14.63, 11.5, 9.88, 10.63, 8.75, 9.25, 7.25, 9.75],
      columns: [
        { key: "date", label: "日期" },
        { key: "operator", label: "人員" },
        { key: "quantity", label: "數量" },
        // The paper prints the rule beneath the heading in a smaller face,
        // so it is a second printed line rather than part of the heading.
        { key: "firstArticle", label: "首件檢驗", note: "依據F/Q-08檢驗" },
        { key: "inspector", label: "檢驗者" },
        { key: "defectCause", label: "異常原因" },
        { key: "defectCount", label: "不良數" },
        { key: "disposition", label: "處理方式" },
      ],
      groups: [
        {
          key: "steps",
          label: null,
          rows: [
            ["winding", "捲繞"],
            ["forming", "定型"],
            ["annealing", "退火"],
            ["gluing", "上膠"],
            ["cooling", "退爐"],
            ["cutting", "切割"],
            ["grinding", "研磨"],
            ["packing", "包裝"],
            ["warehousing", "入庫"],
          ].map(([key, label]) => ({ ...cutOrderBase, key, label, standardValue: null })),
        },
      ],
    },
  ],
  source: {
    receivedDate: "2026-08-21",
    imageSha256:
      "8EB87FFE7EBD5C18263561E0373D23A6600A63346CC2536F2F9C72422F203642",
    imageWidth: null,
    imageHeight: null,
    fileName: "加工製令單.xls",
    mediaType: "application/vnd.ms-excel",
  },
  openQuestions: [],
});

/**
 * 加工製令單 version 2 (the user, 2026-10-02): the header on the worksheet's
 * own ten columns, so its labels and boxes line up from row to row as the
 * paper's do. 客戶, 鐵芯尺寸, 材質, 鋼捲號, 備註 and 退火編號 each take columns
 * A–B; 訂購數量, 捲繞壓力 and 領料重量 column F; 預重單重 and 約耗材總重 column
 * H, with KG in J. Widths are the worksheet's column widths. Nothing else
 * changes, and version 1 stays as published for the sheets made from it.
 */
const cutOrderGridSpans: Record<string, { label: number; value: number }> = {
  // Row 4: 客戶 A–B | C, 客戶訂號 D | E–F, 訂貨日 G | H, 交期 I | J.
  customer: { label: 2, value: 1 },
  customerOrderNo: { label: 1, value: 2 },
  orderDate: { label: 1, value: 1 },
  deliveryDate: { label: 1, value: 1 },
  // Row 5: 鐵芯尺寸 A–B | C–E, 訂購數量 F | G, 預重單重 H | I, KG J.
  coreSize: { label: 2, value: 3 },
  orderQuantity: { label: 1, value: 1 },
  estimatedUnitWeight: { label: 1, value: 1 },
  unitWeightUnit: { label: 1, value: 0 },
  // Row 6: 材質 A–B | C–E, 捲繞壓力 F | G, 約耗材總重 H | I, KG J.
  material: { label: 2, value: 3 },
  windingPressure: { label: 1, value: 1 },
  estimatedTotalWeight: { label: 1, value: 1 },
  totalWeightUnit: { label: 1, value: 0 },
  // Row 7: 鋼捲號 A–B | C–E, 領料重量 F | G–J.
  coilNo: { label: 2, value: 3 },
  issuedWeight: { label: 1, value: 4 },
  // Row 8: 備註 A–B | C–J.
  note: { label: 2, value: 8 },
  // Row 9: 退火編號 A–B | C–E, 製令單交給生產部 F–G, 工單號 H | I–J.
  annealNo: { label: 2, value: 3 },
  productionHandoverNote: { label: 2, value: 0 },
  workOrderNo: { label: 1, value: 2 },
};

export const cutProcessingOrderV2 = sheetTemplateDefinitionSchema.parse({
  ...cutProcessingOrderV1,
  sections: cutProcessingOrderV1.sections.map((section) =>
    section.type === "FIELDS" && section.key === "order"
      ? {
          ...section,
          // The worksheet's column widths, A to J.
          fieldGrid: [3.25, 6.25, 14.63, 11.5, 9.88, 10.63, 8.75, 9.25, 7.25, 9.75],
          fields: section.fields.map((field) => ({
            ...field,
            gridSpan: cutOrderGridSpans[field.key],
          })),
        }
      : section,
  ),
});


/**
 * CUT's three customer order registers.
 *
 * Source supplied by the user on 2026-09-17 as `CUT客戶訂購表.xlsx`, whose three
 * worksheets are three different forms rather than one form in three states.
 * The user asked for all three, chosen by the operator when a sheet is created.
 *
 * The workbook's 士電 sheet arrived holding live 士林電機 order data and a
 * weight/total calculator driven by formulas. Only its printed structure is
 * transcribed: no customer data, and no calculator, because a computed column
 * is not something this system stores.
 */
const cutOrderRegisterBase = {
  type: "TEXT" as const,
  required: false,
  reviewed: false,
  editableStates: ["DRAFT" as const, "READY" as const, "IN_PROGRESS" as const],
  validationStatus: "CONFIRMED" as const,
  editableBy: ["ORIGIN_MANAGER" as const, "ORIGIN_ORDER_TAKER" as const],
};

/** The greys and yellow these worksheets fill their own cells with. */
const WORKSHEET_GREY = "#d9d9d9";
const WORKSHEET_YELLOW = "#ffff00";

/** The 訂貨日 column, ruled corner to corner on every printed row. */
const CUT_DIAGONAL_DATE_COLUMNS = ["orderDate"];

/** 大銀.直得 rules all four of its date columns the same way. */
const DA_YIN_DIAGONAL_DATE_COLUMNS = [
  "orderDate",
  "xuDate",
  "shipDate",
  "postedMonth",
];

const cutOrderRegisterPolicy = {
  schemaVersion: 1,
  status: "APPROVED" as const,
  headerLayout: "TITLE_ONLY" as const,
  printLayout: { paperSize: "A4" as const, orientation: "PORTRAIT" as const, marginMm: 8 },
  ownerDepartmentCode: "CUT" as const,
  allowedCreatorDepartmentCodes: ["CUT" as const],
  // Confirmed 2026-09-17: 主管 and 訂單人員 only, on all three.
  allowedCreatorKinds: ["MANAGER" as const, "ORDER_TAKER" as const],
  allowedEditorKinds: ["MANAGER" as const, "ORDER_TAKER" as const],
  staffEditScope: "ANY_IN_DEPARTMENT" as const,
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "CUT" as const,
    avoidSelfHandoff: true,
  },
  source: {
    receivedDate: "2026-09-17",
    imageSha256:
      "2335C6241D8E962C30E69A41059D7160C4D85B02AB148003DEA68F4F872A0D29",
    imageWidth: null,
    imageHeight: null,
    fileName: "CUT客戶訂購表.xlsx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  openQuestions: [],
};

/** The generic register, from the workbook's `CUT` worksheet. */
export const cutCustomerOrderV1 = sheetTemplateDefinitionSchema.parse({
  ...cutOrderRegisterPolicy,
  templateKey: "cut-customer-order",
  displayName: "CUT客戶訂購表",
  documentLabel: "文件編號：",
  documentCode: "F/P5-07-01",
  documentCodePosition: "BELOW_GRID_RIGHT",
  sections: [
    {
      type: "FIXED_ROWS",
      key: "orders",
      label: "客戶訂購明細",
      // 訂貨日 is the first column; the paper numbers nothing.
      rowNumbers: false,
      columnWidthUnits: [8.38, 10.13, 25, 6.25, 7.5, 4.75, 17.75, 19.5],
      rowCount: 25,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        ["orderDate", "訂貨日"],
        ["customer", "客戶"],
        ["specification", "品名/規格"],
        ["quantity", "數量"],
        ["unitPrice", "單價"],
        ["deliveryDate", "交期"],
        ["note", "備註"],
        ["orderNo", "訂號/工單號"],
      ].map(([key, label]) => ({
        ...cutOrderRegisterBase,
        key,
        label,
        // The worksheet rules 訂貨日 corner to corner on every body row.
        diagonalSplit: CUT_DIAGONAL_DATE_COLUMNS.includes(key as string),
      })),
    },
  ],
});

/**
 * 大銀.直得's register. A different form, not a variant: eleven columns, and it
 * prints no document identifier anywhere, which is why one is not invented.
 * Rows 19–27 of the worksheet are hidden, so the printed form is sixteen rows.
 */
export const cutCustomerOrderDaYinV1 = sheetTemplateDefinitionSchema.parse({
  ...cutOrderRegisterPolicy,
  templateKey: "cut-customer-order-da-yin",
  displayName: "客戶訂購表（大銀·直得）",
  documentCodePosition: "BELOW_GRID_RIGHT",
  sections: [
    {
      type: "FIXED_ROWS",
      key: "orders",
      label: "客戶訂購明細",
      rowNumbers: false,
      columnWidthUnits: [6.75, 12.63, 21.13, 20.38, 9.5, 9.5, 10.25, 7.88, 7.88, 7.88, 8.5],
      rowCount: 16,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        ["orderDate", "日期"],
        // The paper stacks these headings on two or three printed lines; the
        // words are kept in their printed order, joined rather than dropped.
        ["purchaseOrderNo", "採購單號/工單號"],
        ["specification", "品號/品名/規格"],
        ["mouldNo", "模具編號/圖號"],
        ["quantity", "數量PCS"],
        ["unitPrice", "單價"],
        ["amount", "總金額"],
        ["xuDate", "旭日期"],
        ["shipDate", "出貨日期"],
        ["postedMonth", "入帳年/月"],
        ["note", "備註"],
      ].map(([key, label]) => ({
        ...cutOrderRegisterBase,
        key,
        label,
        // All four date columns are ruled corner to corner.
        diagonalSplit: DA_YIN_DIAGONAL_DATE_COLUMNS.includes(key as string),
        // The worksheet greys the whole heading row.
        headingFill: WORKSHEET_GREY,
        // …and fills 單價 solid yellow down the page.
        cellFill: key === "unitPrice" ? WORKSHEET_YELLOW : undefined,
      })),
    },
  ],
});

/**
 * 士林電機's register. The worksheet titles it 訂單表 rather than 訂購表 and
 * prints the customer name beside the identifier above the grid.
 */
export const cutCustomerOrderShihlinV1 = sheetTemplateDefinitionSchema.parse({
  ...cutOrderRegisterPolicy,
  templateKey: "cut-customer-order-shihlin",
  displayName: "CUT客戶訂單表（士電）",
  documentLabel: "文件編號：",
  documentCode: "F/P5-07-01",
  // The paper prints it above the grid at the right, not below it.
  documentCodePosition: "TOP_RIGHT",
  headerLayout: "DATE_TITLE_DOCUMENT",
  headerNote: "士林電機",
  sections: [
    {
      type: "FIXED_ROWS",
      key: "orders",
      label: "客戶訂單明細",
      rowNumbers: false,
      // The nine ruled columns, then the worksheet's own narrow gap, then the
      // weight block it prints outside the form.
      columnWidthUnits: [
        3.63, 17.5, 2.13, 27.25, 5.25, 2.5, 4.38, 15.5, 14.25, 2, 6.13, 5,
      ],
      rowCount: 21,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        { ...cutOrderRegisterBase, key: "orderDate", label: "訂日" },
        { ...cutOrderRegisterBase, key: "orderCaseNo", label: "訂購案號" },
        { ...cutOrderRegisterBase, key: "shipDate", label: "出貨日期" },
        { ...cutOrderRegisterBase, key: "productName", label: "品名" },
        { ...cutOrderRegisterBase, key: "quantity", label: "數量" },
        { ...cutOrderRegisterBase, key: "label", label: "標籤" },
        { ...cutOrderRegisterBase, key: "deliveryDate", label: "交期" },
        { ...cutOrderRegisterBase, key: "note", label: "備註" },
        { ...cutOrderRegisterBase, key: "invoiceNo", label: "日期/發票號碼" },
        // Column 12 of the worksheet: a real column, ruled nowhere, which is
        // how the paper holds the weight block off the form.
        {
          ...cutOrderRegisterBase,
          key: "weightGap",
          label: "",
          spacer: true,
        },
        {
          ...cutOrderRegisterBase,
          key: "unitWeight",
          // Printed on two lines in a cell too narrow for one.
          label: "單顆重量",
          headingFill: WORKSHEET_GREY,
        },
        {
          ...cutOrderRegisterBase,
          key: "totalWeight",
          label: "總重",
          headingFill: WORKSHEET_GREY,
          // =ROUNDUP(數量 * 單顆重量, 0) on every row of the worksheet. Rounding
          // up is not incidental: 60 x 2.09 is 125.4 and the paper says 126.
          computed: { kind: "PRODUCT_ROUNDED_UP", factors: ["quantity", "unitWeight"] },
        },
      ],
    },
  ],
});

/**
 * CUT客戶訂單表（士電） version 2 (the user, 2026-10-02): 品名 is one cell
 * written on two lines, as the worksheet's own entries are — `(不含浸) 2.09K`
 * over `(不切) DEMO-PART(38*98) 30W` — so its box takes two lines. Nothing else
 * changes, and version 1 stays as published for the sheets made from it.
 */
export const cutCustomerOrderShihlinV2 = sheetTemplateDefinitionSchema.parse({
  ...cutCustomerOrderShihlinV1,
  sections: cutCustomerOrderShihlinV1.sections.map((section) =>
    section.type === "FIXED_ROWS"
      ? {
          ...section,
          columns: section.columns.map((column) =>
            column.key === "productName" ? { ...column, multiline: true, lines: 2 } : column,
          ),
        }
      : section,
  ),
});

/**
 * CUT's production board, 生產作業看板.
 *
 * Source supplied by the user on 2026-09-24 as `生產作業看板(CUT).xlsx`: one
 * worksheet, empty, A4 landscape fitted to one page. Seven columns over eight
 * unnumbered rows — its first column is 工單號 — closed by a ruled legend
 * giving the nine 工序 codes, and the identifier below the grid at the right.
 *
 * The legend is printed exactly as the worksheet has it, spacing and all: it is
 * what the operator reads to know which number to write in 工序, so it is part
 * of the form rather than a note about it. 工序 itself stays free text, as the
 * paper leaves it.
 */
export const cutProductionBoardV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "cut-production-board",
  displayName: "生產作業看板",
  documentLabel: "文件編號：",
  documentCode: "F/P5-01-01",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_ONLY",
  printLayout: { paperSize: "A4", orientation: "LANDSCAPE", marginMm: 8 },
  ownerDepartmentCode: "CUT",
  allowedCreatorDepartmentCodes: ["CUT"],
  // Matches 加工製令單, CUT's other work document. Who may actually open and
  // edit one is set per subpage by the department's 主管.
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "CUT",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIXED_ROWS",
      key: "board",
      label: "生產作業",
      rowNumbers: false,
      columnWidthUnits: [12, 16, 12, 15, 25, 12, 25],
      rowCount: 8,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        { ...cutOrderBase, key: "workOrderNo", label: "工單號" },
        { ...cutOrderBase, key: "specification", label: "規格" },
        { ...cutOrderBase, key: "material", label: "材質" },
        { ...cutOrderBase, key: "quantity", label: "數量" },
        { ...cutOrderBase, key: "process", label: "工序" },
        { ...cutOrderBase, key: "deliveryDate", label: "交期" },
        { ...cutOrderBase, key: "note", label: "備註" },
      ],
      legend:
        "定義： 捲繞 = (1)、油壓定型 = (2)、燒炖 = (3)、退模芯 = (4)、抽真空 = (5)、烘乾 = (6)、切割 = (7)、研磨 = (8)、包裝 = (9)",
    },
  ],
  source: {
    receivedDate: "2026-09-24",
    imageSha256:
      "81E8B8EEA58B7389853A6B7CAC7E989BB32CBDC3DC804CC6A196EAC99365B900",
    imageWidth: null,
    imageHeight: null,
    fileName: "生產作業看板(CUT).xlsx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  openQuestions: [],
});

/**
 * The workbook both CUT daily reports come from, supplied by the user on
 * 2026-09-25 as `生產日報表(CUT).xls`, with no review on either. Its three
 * worksheets are two forms: 個人生產日報表, and 生產日報表 printed over two
 * sheets — people 1–4, then 5–8.
 */
const cutDailyReportSource = {
  receivedDate: "2026-09-25",
  imageSha256:
    "3CB75CF8BC7B7FA59988D717F20191C2B617F33C39030974EE809D2C4A41B782",
  imageWidth: null,
  imageHeight: null,
  fileName: "生產日報表(CUT).xls",
  mediaType: "application/vnd.ms-excel",
};

/**
 * CUT's personal daily report, 個人生產日報表 (worksheet `CUT個人生產日報表`).
 *
 * One person's day: 姓名 and 日期 stacked to the right of the title, six
 * unnumbered rows of 工作代號, 工作內容, 數量, 時間 and 備註 at the worksheet's
 * proportions, and the ten 工作代號 codes printed inside the box beneath them,
 * starting at the left on two lines as the worksheet sets them. 文件編號：
 * F/P5-04-01 prints below the box at the right.
 *
 * The worksheet prints the form twice on one A4 page to be cut in half. A
 * sheet here is one person's day, so it prints once.
 */
export const cutPersonalDailyReportV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "cut-personal-daily-report",
  displayName: "CUT個人生產日報表",
  documentLabel: "文件編號：",
  documentCode: "F/P5-04-01",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_FIELDS_RIGHT",
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
  ownerDepartmentCode: "CUT",
  allowedCreatorDepartmentCodes: ["CUT"],
  // Metadata only: who may open and edit one is set per subpage by the
  // department's 主管 (DESIGN.md §3.2.24).
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "CUT",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIELDS",
      key: "header",
      fields: [
        { ...cutOrderBase, key: "name", label: "姓名" },
        { ...cutOrderBase, key: "reportDate", label: "日期", type: "DATE" },
      ],
    },
    {
      type: "FIXED_ROWS",
      key: "work",
      label: "工作紀錄",
      rowNumbers: false,
      columnWidthUnits: [9, 48.63, 9.75, 9, 20.13],
      rowCount: 6,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        { ...cutOrderBase, key: "workCode", label: "工作代號" },
        { ...cutOrderBase, key: "workContent", label: "工作內容" },
        { ...cutOrderBase, key: "quantity", label: "數量" },
        { ...cutOrderBase, key: "time", label: "時間" },
        { ...cutOrderBase, key: "note", label: "備註" },
      ],
      legend:
        "工作代號:\n1.捲繞 2.油壓定型 3.退模芯 4.抽真空 5.上膠 6.退爐 7.切割 8.研磨 9.包裝 10.其他",
      legendAlign: "START",
    },
  ],
  source: cutDailyReportSource,
  openQuestions: [],
});

/**
 * CUT's team daily report, 生產日報表 (worksheets `CUT生產日報表(1)` and `(2)`).
 *
 * One day for eight people. Each has eight rows of 工作內容, 數量, 時間 and 備註,
 * with their name written once in a cell running down all eight and their
 * number printed outside the box; a heavier rule separates each person. The
 * two worksheets are identical but for the numbers, 1–4 and 5–8, so they are
 * one form here that prints four people to a page. 日期 sits right of the
 * title; 經理 and 組長 sign beneath, as free text, the way 檢驗員 signs
 * 分條製令單. The form prints no document identifier.
 *
 * The worksheet prints eight employees' names in the name cells. Names are
 * written per sheet here, at the user's choice on 2026-09-25: the roster
 * changes, and a person's name is not part of the form.
 */
export const cutDailyReportV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "cut-daily-report",
  displayName: "CUT生產日報表",
  headerLayout: "TITLE_FIELDS_RIGHT",
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 5 },
  ownerDepartmentCode: "CUT",
  allowedCreatorDepartmentCodes: ["CUT"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "CUT",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIELDS",
      key: "header",
      fields: [{ ...cutOrderBase, key: "reportDate", label: "日期", type: "DATE" }],
    },
    {
      type: "FIXED_ROWS",
      key: "entries",
      label: "生產日報",
      rowNumbers: false,
      columnWidthUnits: [9, 60.5, 19.38, 11.25, 11.38],
      rowCount: 64,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      rowGroups: {
        size: 8,
        spanningColumnKey: "name",
        numbered: true,
        numberWidthUnits: 2.25,
        perPage: 4,
      },
      columns: [
        { ...cutOrderBase, key: "name", label: "姓名" },
        { ...cutOrderBase, key: "workContent", label: "工作內容" },
        { ...cutOrderBase, key: "quantity", label: "數量" },
        { ...cutOrderBase, key: "time", label: "時間" },
        { ...cutOrderBase, key: "note", label: "備註" },
      ],
    },
    {
      type: "FIELDS",
      key: "signatures",
      fields: [
        { ...cutOrderBase, key: "manager", label: "經理" },
        { ...cutOrderBase, key: "teamLeader", label: "組長" },
      ],
    },
  ],
  source: cutDailyReportSource,
  openQuestions: [],
});

/**
 * CUT's finished-goods inspection, CUT成品檢查表 (F/P5-02-02).
 *
 * Source supplied by the user on 2026-09-25 as `CUT成品檢查表.doc`, with no
 * review. From the top: the company letterhead, whose address is the current
 * 新北市 one; the title; 工單號 at the left above the box; three ruled rows of
 * particulars, 檢查工具 printed as 游標卡尺 and 判定 as boxes to tick, □OK
 * □NG; the 外觀尺寸 register, in mm; and a closing band of the three core
 * views that say what A to D measure, beside the 公差 table.
 *
 * The register's first cell is ruled corner to corner, 尺寸 over 序號. Read
 * as a diagonal heading reads, the first row takes the nominal size of each
 * dimension and each of the eight rows below it one measured piece, its 序號
 * written in the first column.
 */
export const cutFinishedInspectionV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "cut-finished-inspection",
  displayName: "CUT成品檢查表",
  letterhead: {
    asset: "/templates/cut/finished-inspection-letterhead.png",
    alt: "CUT CORE 永進矽鋼股份有限公司 Yung-Chin Silicon Steel Co., Ltd.，23678新北市土城區自由街1號，電話 02-80763336，傳真 02-80763338",
  },
  documentLabel: "文件編號：",
  documentCode: "F/P5-02-02",
  documentCodePosition: "BELOW_GRID_RIGHT",
  // 工單號 sits at the left, under the title's line and above the box.
  headerLayout: "DATE_TITLE_DOCUMENT",
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
  ownerDepartmentCode: "CUT",
  allowedCreatorDepartmentCodes: ["CUT"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "CUT",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIELDS",
      key: "header",
      fields: [{ ...cutOrderBase, key: "workOrderNo", label: "工單號" }],
    },
    {
      type: "FIELDS",
      key: "particulars",
      fieldRows: [2, 3, 4],
      fields: [
        { ...cutOrderBase, key: "customerName", label: "客戶名" },
        { ...cutOrderBase, key: "specification", label: "規格" },
        { ...cutOrderBase, key: "material", label: "材質" },
        { ...cutOrderBase, key: "quantity", label: "數量" },
        { ...cutOrderBase, key: "inspectionDate", label: "日期", type: "DATE" },
        // 檢查工具 is printed with its answer, 游標卡尺: nothing to write.
        { ...cutOrderBase, key: "toolLabel", label: "檢查工具", printedOnly: true },
        { ...cutOrderBase, key: "tool", label: "游標卡尺", printedOnly: true },
        { ...cutOrderBase, key: "reviewer", label: "審查員" },
        { ...cutOrderBase, key: "verdict", label: "判定", choices: ["OK", "NG"] },
      ],
    },
    {
      type: "FIXED_ROWS",
      key: "dimensions",
      label: "外觀尺寸",
      caption: { text: "外觀尺寸", note: "單位: mm" },
      cornerCell: { across: "尺寸", down: "序號" },
      rowNumbers: false,
      columnWidthUnits: [81, 90, 90, 99, 90, 108],
      rowCount: 9,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        { ...cutOrderBase, key: "item", label: "檢查項次" },
        { ...cutOrderBase, key: "a", label: "A" },
        { ...cutOrderBase, key: "b", label: "B(Di)" },
        { ...cutOrderBase, key: "c", label: "C(Do)" },
        { ...cutOrderBase, key: "d", label: "D" },
        { ...cutOrderBase, key: "note", label: "備註" },
      ],
    },
    {
      type: "REFERENCE_BAND",
      key: "reference",
      label: "尺寸位置與公差",
      drawing: {
        asset: "/templates/cut/finished-inspection-cores.svg",
        alt: "三個鐵芯示意圖。環形鐵芯俯視：A 為積厚，B 為內徑，C 為外徑。側視：D 為高度。方形鐵芯俯視：A 為積厚，B 為窗寬，C 為窗高。",
      },
      table: {
        corner: { across: "公差", down: "mm" },
        columns: [
          { label: "A", note: "積厚" },
          { label: "B", note: "內徑" },
          { label: "C", note: "外徑" },
          { label: "D", note: "高度" },
        ],
        rows: [
          { label: "6~25≦", values: ["±0.5", "±0.5", "±0.5", "+0.4"] },
          { label: "25~50≦", values: ["±0.5", "±0.5", "±0.5", "+0.5"] },
          { label: "50~75≦", values: ["±0.8", "±1.0", "±0.75", "+0.5"] },
          { label: "75~100≦", values: ["±0.8", "±1.0", "±1.0", "+1.0"] },
          { label: "100~150≦", values: ["±1.2", "±1.5", "±1.3", "+1.0"] },
          { label: "150~200≦", values: ["±1.5", "±1.5", "±1.5", "+1.0"] },
          { label: "200 ＞", values: ["±1.5", "±2", "±2", "+1.0"] },
        ],
      },
    },
  ],
  source: {
    receivedDate: "2026-09-25",
    imageSha256:
      "D6018AF484A1C8F4251F36700DE39A581FD3CB401C258538532873BC6C1A3403",
    imageWidth: null,
    imageHeight: null,
    fileName: "CUT成品檢查表.doc",
    mediaType: "application/msword",
  },
  openQuestions: [],
});

/**
 * CUT成品檢查表 version 2 (the user, 2026-10-02): the particulars on the
 * document's own six columns, read from its table (78.5, 110.6, 126, 90,
 * 47.6 and 105.5 pt), so 客戶名, 材質 and 檢查工具 line up with boxes the same
 * size, as do 規格, 數量 and 審查員, and 日期 and 判定. 規格's box runs to the
 * right edge, as the document merges it. Nothing else changes; sheets made
 * from version 1 keep it.
 */
const finishedInspectionSpans: Record<string, { label: number; value: number }> = {
  customerName: { label: 1, value: 1 },
  specification: { label: 1, value: 3 },
  material: { label: 1, value: 1 },
  quantity: { label: 1, value: 1 },
  inspectionDate: { label: 1, value: 1 },
  toolLabel: { label: 1, value: 0 },
  tool: { label: 1, value: 0 },
  reviewer: { label: 1, value: 1 },
  verdict: { label: 1, value: 1 },
};
export const cutFinishedInspectionV2 = sheetTemplateDefinitionSchema.parse({
  ...cutFinishedInspectionV1,
  sections: cutFinishedInspectionV1.sections.map((section) =>
    section.type === "FIELDS" && section.key === "particulars"
      ? {
          ...section,
          // The widths in points, divided by ten to sit inside the schema's range.
          fieldGrid: [7.85, 11.06, 12.6, 9, 4.76, 10.55],
          fields: section.fields.map((field) => ({
            ...field,
            gridSpan: finishedInspectionSpans[field.key],
          })),
        }
      : section,
  ),
});

/**
 * The workbook CUT's characteristic inspections come from, supplied by the
 * user on 2026-09-26 as `特性檢驗表.xls`, with no review on any. Its seven
 * worksheets are four layouts, and at the user's choice each layout is one
 * form: `CUT` and `士電` are one (they differ only in whether 客戶 is filled
 * in), and `崧貿-大`, `崧貿-小` and `崧貿-樣品` are identical.
 */
const characteristicSource = {
  receivedDate: "2026-09-26",
  imageSha256:
    "BCF3EDB75098ADA1B655A531435F1A474E0826E10B74DC8175BF0E837F480BEE",
  imageWidth: null,
  imageHeight: null,
  fileName: "特性檢驗表.xls",
  mediaType: "application/vnd.ms-excel",
};

/**
 * The stationery printed above three of the four, the same 台北縣 letterhead
 * 加工製令單 carries (§6.7), so the same file.
 */
const cutLetterhead = {
  asset: "/templates/cut/letterhead.png",
  alt: "永進矽鋼股份有限公司 Yung-Chin Silicon Steel Co., Ltd.，23678台北縣土城市自由街1號，電話 02-80763336，傳真 02-80763338",
};

const characteristicWorkflow = {
  requiresReview: false,
  approvalRoles: [],
  destinationDepartmentCode: "CUT" as const,
  avoidSelfHandoff: true,
};

/** 出貨數量 and 抽樣數量 under the register, and 檢驗者 at the foot. */
const characteristicFooter = [
  {
    type: "FIELDS" as const,
    key: "quantities",
    fieldRows: [1, 1],
    fields: [
      { ...cutOrderBase, key: "shippedQuantity", label: "出貨數量", unit: "PCS" },
      { ...cutOrderBase, key: "sampledQuantity", label: "抽樣數量", unit: "PCS" },
    ],
  },
  {
    type: "REFERENCE_BAND" as const,
    key: "views",
    label: "A、B、C、D 量測位置",
    drawing: {
      asset: "/templates/cut/characteristic-views.svg",
      alt: "三個鐵芯示意圖。環形鐵芯：A 為積厚，B 為內徑，C 為外徑。方形鐵芯：A 為積厚，B 為窗高，C 為窗寬。側視：D 為高度。",
    },
  },
  {
    type: "FIELDS" as const,
    key: "signature",
    fields: [{ ...cutOrderBase, key: "inspector", label: "檢驗者" }],
  },
];

/**
 * CUT's characteristic inspection, 特性檢驗報告單 (F/P5-03-01), from the
 * `CUT` and `士電` worksheets.
 *
 * Particulars in four lines inside the box — 客戶 and 日期, 工單號, 品名 規格
 * 材質, and 電壓 V 頻率 Hz 匝數 匝 — then the register: A to D, 電流 in mA and
 * 鐵損 in W. Its corner reads 標準值 over 測試值: the standard is written
 * under each heading's letter in the heading's own tall cell (the user's
 * reading, 2026-09-26), and the fifteen rows below are the tests. The `CUT`
 * worksheet prints 士林電機 as 客戶 where `士電` leaves it blank; here 客戶 is
 * written on each sheet.
 */
export const cutCharacteristicInspectionV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "cut-characteristic-inspection",
  displayName: "特性檢驗報告單",
  letterhead: cutLetterhead,
  documentLabel: "文件編號：",
  documentCode: "F/P5-03-01",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_ONLY",
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8, rowHeightMm: 7.5 },
  ownerDepartmentCode: "CUT",
  allowedCreatorDepartmentCodes: ["CUT"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: characteristicWorkflow,
  sections: [
    {
      type: "FIELDS",
      key: "particulars",
      fieldRows: [2, 1, 3, 3],
      fields: [
        { ...cutOrderBase, key: "customer", label: "客戶" },
        { ...cutOrderBase, key: "inspectionDate", label: "日期", type: "DATE" },
        { ...cutOrderBase, key: "workOrderNo", label: "工單號" },
        { ...cutOrderBase, key: "productName", label: "品名" },
        { ...cutOrderBase, key: "specification", label: "規格" },
        { ...cutOrderBase, key: "material", label: "材質" },
        { ...cutOrderBase, key: "voltage", label: "電壓", unit: "V" },
        { ...cutOrderBase, key: "frequency", label: "頻率", unit: "Hz" },
        { ...cutOrderBase, key: "turns", label: "匝數", unit: "匝" },
      ],
    },
    {
      type: "FIXED_ROWS",
      key: "tests",
      label: "特性檢驗",
      rowNumbers: false,
      standardRow: {
        label: "標準值",
        corner: { across: "標準值", down: "測試值" },
        ruled: false,
      },
      columnWidthUnits: [7.88, 16.5, 14.38, 14.38, 13.5, 13.5, 13.88],
      rowCount: 16,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        { ...cutOrderBase, key: "sample", label: "測試值" },
        { ...cutOrderBase, key: "a", label: "A" },
        { ...cutOrderBase, key: "b", label: "B" },
        { ...cutOrderBase, key: "c", label: "C" },
        { ...cutOrderBase, key: "d", label: "D" },
        { ...cutOrderBase, key: "current", label: "電流", unit: "mA" },
        { ...cutOrderBase, key: "ironLoss", label: "鐵損", unit: "W" },
      ],
    },
    ...characteristicFooter,
  ],
  source: characteristicSource,
  openQuestions: [],
});

/**
 * 崧貿's characteristic inspection (F/P5-03-01), from the identical
 * `崧貿-大`, `崧貿-小` and `崧貿-樣品` worksheets.
 *
 * As 特性檢驗報告單, but 客戶 is printed as 崧貿, 頻率 carries no unit, and the
 * register rules its standard off as a row of its own: the corner reads 位置
 * over 標準值, the standard row prints MA and W, and the fifteen tests are
 * numbered 1 to 15.
 */
export const cutCharacteristicInspectionSongmaoV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "cut-characteristic-inspection-songmao",
  displayName: "特性檢驗報告單（崧貿）",
  letterhead: cutLetterhead,
  documentLabel: "文件編號：",
  documentCode: "F/P5-03-01",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_ONLY",
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8, rowHeightMm: 7.5 },
  ownerDepartmentCode: "CUT",
  allowedCreatorDepartmentCodes: ["CUT"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: characteristicWorkflow,
  sections: [
    {
      type: "FIELDS",
      key: "particulars",
      fieldRows: [3, 1, 3, 3],
      fields: [
        { ...cutOrderBase, key: "customerLabel", label: "客戶", printedOnly: true },
        { ...cutOrderBase, key: "customer", label: "崧貿", printedOnly: true },
        { ...cutOrderBase, key: "inspectionDate", label: "日期", type: "DATE" },
        { ...cutOrderBase, key: "workOrderNo", label: "工單號" },
        { ...cutOrderBase, key: "productName", label: "品名" },
        { ...cutOrderBase, key: "specification", label: "規格" },
        { ...cutOrderBase, key: "material", label: "材質" },
        { ...cutOrderBase, key: "voltage", label: "電壓", unit: "V" },
        { ...cutOrderBase, key: "frequency", label: "頻率" },
        { ...cutOrderBase, key: "turns", label: "匝數", unit: "匝" },
      ],
    },
    {
      type: "FIXED_ROWS",
      key: "tests",
      label: "特性檢驗",
      rowNumbers: true,
      rowNumberWidthUnits: 7.88,
      standardRow: {
        label: "標準值",
        corner: { across: "位置", down: "標準值" },
        ruled: true,
      },
      columnWidthUnits: [16.5, 14.38, 14.38, 13.5, 13.5, 13.88],
      rowCount: 16,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        { ...cutOrderBase, key: "a", label: "A" },
        { ...cutOrderBase, key: "b", label: "B" },
        { ...cutOrderBase, key: "c", label: "C" },
        { ...cutOrderBase, key: "d", label: "D" },
        { ...cutOrderBase, key: "current", label: "電流", unit: "MA" },
        { ...cutOrderBase, key: "ironLoss", label: "鐵損", unit: "W" },
      ],
    },
    ...characteristicFooter,
  ],
  source: characteristicSource,
  openQuestions: [],
});

/**
 * 巧力's outgoing inspection, 出廠檢驗單, from the `巧力D5-10015` worksheet.
 *
 * Addressed to 巧力工業's 採購部 with that office's telephone and fax, under
 * the company name rather than a letterhead, with no document identifier.
 * 電壓 V, 頻率 HZ and 品名 on one line, 匝數 匝 and 訂號 on the next, then ten
 * 激磁電流 readings in mA, 序 1–5 beside 6–10.
 */
export const cutFactoryInspectionChiaoliV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "cut-factory-inspection-chiaoli",
  displayName: "出廠檢驗單（巧力）",
  headerLines: [
    { text: "TO: 採購部　Tel:(03)346-6655　fax:(03)346-7835", placement: "ABOVE", align: "START" },
    { text: "永進矽鋼(股)公司", placement: "ABOVE", align: "CENTER" },
    { text: "客戶: 巧力工業股份有限公司", placement: "BELOW", align: "CENTER" },
  ],
  headerLayout: "TITLE_ONLY",
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
  ownerDepartmentCode: "CUT",
  allowedCreatorDepartmentCodes: ["CUT"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: characteristicWorkflow,
  sections: [
    {
      type: "FIELDS",
      key: "particulars",
      fieldRows: [3, 2],
      fields: [
        { ...cutOrderBase, key: "voltage", label: "1.電壓", unit: "V" },
        { ...cutOrderBase, key: "frequency", label: "頻率", unit: "HZ" },
        { ...cutOrderBase, key: "productName", label: "品名" },
        { ...cutOrderBase, key: "turns", label: "匝數", unit: "匝" },
        { ...cutOrderBase, key: "orderNo", label: "訂號" },
      ],
    },
    {
      type: "FIXED_ROWS",
      key: "excitation",
      label: "激磁電流",
      rowNumbers: true,
      rowNumberLabel: "序",
      rowNumberWidthUnits: 7.25,
      columnWidthUnits: [28.5],
      blocks: { count: 2, gapUnits: 6.13 },
      rowCount: 10,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        { ...cutOrderBase, key: "excitationCurrent", label: "激磁電流", unit: "mA" },
      ],
    },
  ],
  source: characteristicSource,
  openQuestions: [],
});

/**
 * 信太's characteristic inspection, version 2.0 of the form (F/P5-03-01),
 * from the `信太版本 2.0` worksheet.
 *
 * 客戶 is printed as 信太 and 品名 as 環型鐵心. 客戶單號 prints its leading B;
 * 電壓 and 電流(1)'s maximum and minimum are each two readings, the second
 * printed after a slash, beside the note on which voltage gives which
 * current. Fifteen rows of A(積厚) to D(寬度), 電流(1) and 電流(2) in mA, and
 * a tick for 合格 or 不合格. Beneath: 出貨/檢驗數量, the 尺寸容許差 in red,
 * 檢驗者, 備註, and the toroid's views; `VER 2.0` in red at the foot.
 */
export const cutCharacteristicInspectionShintaiV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "cut-characteristic-inspection-shintai",
  displayName: "特性檢驗報告單（信太）",
  letterhead: cutLetterhead,
  documentLabel: "文件編號：",
  documentCode: "F/P5-03-01",
  documentCodePosition: "BELOW_GRID_RIGHT",
  footerNote: { text: "VER 2.0", color: "#ff0000" },
  headerLayout: "TITLE_ONLY",
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8, rowHeightMm: 7.5 },
  ownerDepartmentCode: "CUT",
  allowedCreatorDepartmentCodes: ["CUT"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: characteristicWorkflow,
  sections: [
    {
      type: "FIELDS",
      key: "particulars",
      fieldRows: [4, 4, 3, 5],
      fields: [
        { ...cutOrderBase, key: "customerLabel", label: "客戶", printedOnly: true },
        { ...cutOrderBase, key: "customer", label: "信太", printedOnly: true },
        { ...cutOrderBase, key: "purchaseOrderNo", label: "訂購單號" },
        {
          ...cutOrderBase,
          key: "inspectionDate",
          label: "檢驗日期",
          type: "DATE",
          labelColor: "#ff0000",
        },
        { ...cutOrderBase, key: "productLabel", label: "品名", printedOnly: true },
        { ...cutOrderBase, key: "product", label: "環型鐵心", printedOnly: true },
        { ...cutOrderBase, key: "specification", label: "規格" },
        { ...cutOrderBase, key: "material", label: "材質" },
        { ...cutOrderBase, key: "frequency", label: "頻率", unit: "Hz" },
        { ...cutOrderBase, key: "turns", label: "匝數", unit: "匝" },
        { ...cutOrderBase, key: "customerOrderNo", label: "客戶單號", prefix: "B" },
        {
          ...cutOrderBase,
          key: "voltage1",
          label: "電壓",
          unit: "V",
          accessibleLabel: "電壓(1)",
        },
        {
          ...cutOrderBase,
          key: "voltage2",
          label: "/",
          unit: "V",
          accessibleLabel: "電壓(2)",
        },
        {
          ...cutOrderBase,
          key: "voltageNote",
          label: "＊在2V下，所對應為電流(1)\n其他飽合電壓(V)下對應為電流(2)",
          printedOnly: true,
        },
        {
          ...cutOrderBase,
          key: "currentMax",
          label: "電流(1)最大/小值",
          accessibleLabel: "電流(1)最大值",
        },
        {
          ...cutOrderBase,
          key: "currentMin",
          label: "/",
          unit: "mA",
          accessibleLabel: "電流(1)最小值",
        },
      ],
    },
    {
      type: "FIXED_ROWS",
      key: "tests",
      label: "特性檢驗",
      rowNumbers: false,
      columnWidthUnits: [7, 12, 12.63, 13.38, 16.25, 13.5, 13.5, 26],
      rowCount: 15,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        { ...cutOrderBase, key: "serial", label: "編號" },
        { ...cutOrderBase, key: "a", label: "A(積厚)" },
        { ...cutOrderBase, key: "b", label: "B(內徑)" },
        { ...cutOrderBase, key: "c", label: "C(外徑)" },
        { ...cutOrderBase, key: "d", label: "D(寬度)" },
        { ...cutOrderBase, key: "current1", label: "電流(1)", unit: "mA" },
        { ...cutOrderBase, key: "current2", label: "電流(2)", unit: "mA" },
        {
          ...cutOrderBase,
          key: "check",
          label: "尺寸/外觀檢查",
          choices: ["合格", "不合格"],
          choicesSeparator: " / ",
        },
      ],
    },
    {
      type: "FIELDS",
      key: "closing",
      fieldRows: [2, 1, 1],
      fields: [
        { ...cutOrderBase, key: "shippedQuantity", label: "出貨/檢驗數量", unit: "PCS" },
        {
          ...cutOrderBase,
          key: "tolerance",
          label: "尺寸容許差:C±1.0mm / B±1.0mm / D±0.5mm",
          printedOnly: true,
          labelColor: "#ff0000",
        },
        { ...cutOrderBase, key: "inspector", label: "檢驗者" },
        { ...cutOrderBase, key: "remarks", label: "備註", multiline: true },
      ],
    },
    {
      type: "REFERENCE_BAND",
      key: "views",
      label: "A、B、C、D 量測位置",
      drawing: {
        asset: "/templates/cut/characteristic-views-toroid.svg",
        alt: "環形鐵芯示意圖：A 為積厚，B 為內徑，C 為外徑；側視 D 為寬度。",
      },
    },
  ],
  source: characteristicSource,
  openQuestions: [],
});

/**
 * Version 2 of the four (the user, 2026-10-02): each header laid on its
 * worksheet's own columns, so labels and boxes line up from row to row as on
 * the other forms. Spans follow where the worksheet prints each label; where
 * the worksheet writes two labels in one cell (CUT's `頻率: Hz` beside
 * `匝數: 匝`, 巧力's `電壓 … 頻率`), the box goes where it lines up with the
 * rows above. Fields and rules are unchanged, except that 信太's paired
 * 電壓 and 電流(1) readings share one box each (`joinNext`), as the
 * worksheet writes `V / V` and `/ mA` in one cell. Sheets made from version 1
 * keep it.
 */
type GridSpan = { label: number; value: number };
const particularsOnGrid = (
  definition: typeof cutCharacteristicInspectionV1,
  fieldGrid: number[],
  spans: Record<string, GridSpan>,
  changes: Record<string, object> = {},
) =>
  sheetTemplateDefinitionSchema.parse({
    ...definition,
    sections: definition.sections.map((section) =>
      section.type === "FIELDS" && section.key === "particulars"
        ? {
            ...section,
            fieldGrid,
            fields: section.fields.map((field) => ({
              ...field,
              ...changes[field.key],
              gridSpan: spans[field.key],
            })),
          }
        : section,
    ),
  });

/** CUT and 士電's columns A–G; 崧貿 prints the same header on the same sheet. */
const characteristicColumns = [7.88, 16.5, 14.38, 14.38, 13.5, 13.5, 13.88];
const characteristicSpans: Record<string, GridSpan> = {
  // 客戶 A, written across B–D; 日期 E, written across F–G.
  customer: { label: 1, value: 3 },
  inspectionDate: { label: 1, value: 2 },
  workOrderNo: { label: 1, value: 6 },
  // 品名 A, 規格 C, 材質 F; 電壓 A, 頻率 C, 匝數 F, so each pair lines up.
  productName: { label: 1, value: 1 },
  specification: { label: 1, value: 2 },
  material: { label: 1, value: 1 },
  voltage: { label: 1, value: 1 },
  frequency: { label: 1, value: 2 },
  turns: { label: 1, value: 1 },
};

/**
 * Below the register (the user, 2026-10-02). The worksheet writes 出貨數量
 * and 抽樣數量 as `出貨數量: ＿＿ PCS`, ten spaces to write in, about column
 * A's width; it draws the A–D views to their right and below, with 檢驗者 at
 * the bottom left. So one band holds all three: the labels take column A,
 * the boxes and PCS about as much again, and the views take the rest of the
 * width beside them, larger than the band of their own they had.
 */
const closingBesideViews = (definition: typeof cutCharacteristicInspectionV1) => {
  const fieldsOf = (key: string) => {
    const section = definition.sections.find((s) => s.key === key);
    if (section?.type !== "FIELDS") throw new Error(`${key} band`);
    return section.fields;
  };
  const views = definition.sections.find((s) => s.key === "views");
  if (views?.type !== "REFERENCE_BAND" || !views.drawing) throw new Error("views band");
  const closing = {
    type: "FIELDS" as const,
    key: "closing",
    fieldRows: [1, 1, 1],
    fieldGrid: [7.88, 12.5, 73.64],
    fields: [...fieldsOf("quantities"), ...fieldsOf("signature")].map((field) => ({
      ...field,
      gridSpan: { label: 1, value: 1 },
    })),
    asideDrawing: { ...views.drawing, columns: 1 },
  };
  return sheetTemplateDefinitionSchema.parse({
    ...definition,
    sections: definition.sections.flatMap<object>((section) =>
      section.key === "quantities"
        ? [closing]
        : section.key === "views" || section.key === "signature"
          ? []
          : [section],
    ),
  });
};

export const cutCharacteristicInspectionV2 = closingBesideViews(
  particularsOnGrid(cutCharacteristicInspectionV1, characteristicColumns, characteristicSpans),
);

export const cutCharacteristicInspectionSongmaoV2 = closingBesideViews(
  particularsOnGrid(cutCharacteristicInspectionSongmaoV1, characteristicColumns, {
    ...characteristicSpans,
    // 客戶 A, 崧貿 printed across B–D.
    customerLabel: { label: 1, value: 0 },
    customer: { label: 3, value: 0 },
  }),
);

/**
 * 巧力's columns A–E, with B divided where its one cell holds 電壓 V and 頻率
 * HZ: 電壓 and 匝數 line up at A, 品名 and 訂號 at C.
 */
export const cutFactoryInspectionChiaoliV2 = particularsOnGrid(
  cutFactoryInspectionChiaoliV1,
  [7.25, 12.5, 6, 10, 6.13, 7.25, 28.5],
  {
    voltage: { label: 1, value: 1 },
    frequency: { label: 1, value: 1 },
    productName: { label: 1, value: 2 },
    turns: { label: 1, value: 3 },
    orderNo: { label: 1, value: 2 },
  },
);

/**
 * 信太's columns A–H: 客戶, 品名, 頻率 and 電壓 at A; 訂購單號, 規格 and 匝數 at
 * C, written across D–F; 檢驗日期, 材質 and 客戶單號 at G, written in H. The
 * voltage note sits in D–E and 電流(1) at F, as printed.
 *
 * Below the register, as the worksheet sets it (the user, 2026-10-02):
 * 出貨/檢驗數量 across A–D beside the red 尺寸容許差 across E–H, then 檢驗者
 * and 備註 on the left with the toroid's views beside them in F–H, larger
 * than the band of their own they had.
 */
const shintaiParticularsOnGrid = particularsOnGrid(
  cutCharacteristicInspectionShintaiV1,
  [7, 12, 12.63, 13.38, 16.25, 13.5, 13.5, 26],
  {
    customerLabel: { label: 1, value: 0 },
    customer: { label: 1, value: 0 },
    purchaseOrderNo: { label: 1, value: 3 },
    inspectionDate: { label: 1, value: 1 },
    productLabel: { label: 1, value: 0 },
    product: { label: 1, value: 0 },
    specification: { label: 1, value: 3 },
    material: { label: 1, value: 1 },
    frequency: { label: 1, value: 1 },
    turns: { label: 1, value: 3 },
    customerOrderNo: { label: 1, value: 1 },
    voltage1: { label: 1, value: 2 },
    voltageNote: { label: 2, value: 0 },
    currentMax: { label: 1, value: 2 },
  },
  {
    // `V / V` and `/ mA`: the second reading of each pair is written in the
    // first one's box, after its printed slash.
    voltage1: { joinNext: "INLINE" },
    voltage2: { label: "電壓(2)", prefix: "/" },
    currentMax: { joinNext: "INLINE" },
    currentMin: { label: "電流(1)最小值", prefix: "/" },
  },
);
const shintaiClosingSpans: Record<string, GridSpan> = {
  shippedQuantity: { label: 2, value: 2 },
  tolerance: { label: 4, value: 0 },
  inspector: { label: 1, value: 4 },
  remarks: { label: 1, value: 4 },
};
export const cutCharacteristicInspectionShintaiV2 = (() => {
  const views = shintaiParticularsOnGrid.sections.find((s) => s.key === "views");
  if (views?.type !== "REFERENCE_BAND" || !views.drawing) throw new Error("views band");
  const drawing = views.drawing;
  return sheetTemplateDefinitionSchema.parse({
    ...shintaiParticularsOnGrid,
    sections: shintaiParticularsOnGrid.sections.flatMap<object>((section) =>
      section.key === "views"
        ? []
        : section.type === "FIELDS" && section.key === "closing"
          ? [
              {
                ...section,
                fieldGrid: [7, 12, 12.63, 13.38, 16.25, 13.5, 13.5, 26],
                fields: section.fields.map((field) => ({
                  ...field,
                  gridSpan: shintaiClosingSpans[field.key],
                })),
                asideDrawing: { ...drawing, columns: 3, startRow: 2 },
              },
            ]
          : [section],
    ),
  });
})();

/**
 * CUT's monthly defect-rate register, 月份不良率統計表 (F/P5-09-02).
 *
 * Source supplied by the user on 2026-09-26 as `不良率統計表(空白).xlsx`,
 * with no review. Its blank worksheet is the form: the letterhead, then the
 * title at the left with 文件編號 at the right, over twenty-one ruled rows of
 * 工單號, 訂單數, 成品數, 不良數, 單顆重量, 良品總重 and 不良重量. The second
 * worksheet is the user's worked example — June, 工單號 900001 onward, the
 * month written before 月份 — so 月份 is the header's one field and no
 * example value is carried. The blank carries no formulas, so 良品總重 and
 * 不良重量 are written, not worked out.
 */
export const cutDefectRateV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "cut-defect-rate",
  displayName: "不良率統計表",
  letterhead: cutLetterhead,
  documentLabel: "文件編號：",
  documentCode: "F/P5-09-02",
  documentCodePosition: "TOP_RIGHT",
  headerLayout: "DATE_TITLE_DOCUMENT",
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8, rowHeightMm: 11 },
  ownerDepartmentCode: "CUT",
  allowedCreatorDepartmentCodes: ["CUT"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "CUT",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIELDS",
      key: "header",
      fields: [{ ...cutOrderBase, key: "month", label: "月份" }],
    },
    {
      type: "FIXED_ROWS",
      key: "orders",
      label: "不良率統計",
      rowNumbers: false,
      columnWidthUnits: [16, 12, 12, 12, 12, 16, 12],
      rowCount: 21,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        { ...cutOrderBase, key: "workOrderNo", label: "工單號" },
        { ...cutOrderBase, key: "orderQuantity", label: "訂單數" },
        { ...cutOrderBase, key: "finishedQuantity", label: "成品數" },
        { ...cutOrderBase, key: "defectQuantity", label: "不良數" },
        { ...cutOrderBase, key: "unitWeight", label: "單顆重量" },
        { ...cutOrderBase, key: "goodWeight", label: "良品總重" },
        { ...cutOrderBase, key: "defectWeight", label: "不良重量" },
      ],
    },
  ],
  source: {
    receivedDate: "2026-09-26",
    imageSha256:
      "44249A28F12105F56EA3F1C77692A8B3736904CF29A134AE27B6ED62326F17BB",
    imageWidth: null,
    imageHeight: null,
    fileName: "不良率統計表(空白).xlsx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  openQuestions: [],
});

/**
 * The annealing list, 退火明細表 (F/P5-06-03), written in CUT and sent to 燒頓.
 *
 * Source supplied by the user on 2026-09-27 as `退火明細表.xlsx` (worksheet
 * `20260306版`), with no review. CUT creates it, lists the work orders to be
 * annealed, and hands it on; handing it on sends it straight to 燒頓's
 * 待分派, where 燒頓 records the firing — 退火日期, 爐號, 溫度, the program, the
 * times and the appearance check — and signs it.
 *
 * Landscape: the current letterhead, the title, three rows of particulars,
 * then two side-by-side blocks of 工單號, 規格, 材質, 數量 and 重量, nine rows
 * each, set edge to edge; 燒炖者 and 填表人 beneath, and the identifier at
 * the right. 燒炖者 keeps the worksheet's spelling.
 */
export const cutAnnealingListV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "cut-annealing-list",
  displayName: "退火明細表",
  // The same 新北市 stationery 成品檢查表 carries.
  letterhead: cutFinishedInspectionV1.letterhead,
  documentLabel: "文件編號：",
  documentCode: "F/P5-06-03",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_ONLY",
  printLayout: { paperSize: "A4", orientation: "LANDSCAPE", marginMm: 8, rowHeightMm: 10 },
  ownerDepartmentCode: "CUT",
  allowedCreatorDepartmentCodes: ["CUT"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    // Handing it on sends it to 燒頓 (the user, 2026-09-27).
    destinationDepartmentCode: "SHAO_DUN",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIELDS",
      key: "firing",
      fieldRows: [3, 3, 3],
      fields: [
        { ...cutOrderBase, key: "scheduledDate", label: "待燒日期", type: "DATE" },
        { ...cutOrderBase, key: "batchNo", label: "編號" },
        { ...cutOrderBase, key: "startTime", label: "起始時間" },
        { ...cutOrderBase, key: "annealDate", label: "退火日期", type: "DATE" },
        { ...cutOrderBase, key: "furnaceNo", label: "爐號" },
        { ...cutOrderBase, key: "temperature", label: "溫度" },
        { ...cutOrderBase, key: "completionDate", label: "完程日期", type: "DATE" },
        { ...cutOrderBase, key: "programNo", label: "程式編號", prefix: "第", unit: "程式" },
        { ...cutOrderBase, key: "appearance", label: "外觀檢驗", choices: ["合格", "不合格"] },
      ],
    },
    {
      type: "FIXED_ROWS",
      key: "orders",
      label: "退火明細",
      rowNumbers: false,
      columnWidthUnits: [2, 3, 2, 1, 1],
      blocks: { count: 2 },
      rowCount: 18,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        { ...cutOrderBase, key: "workOrderNo", label: "工單號" },
        { ...cutOrderBase, key: "specification", label: "規格" },
        { ...cutOrderBase, key: "material", label: "材質" },
        { ...cutOrderBase, key: "quantity", label: "數量" },
        { ...cutOrderBase, key: "weight", label: "重量" },
      ],
    },
    {
      type: "FIELDS",
      key: "signatures",
      fields: [
        { ...cutOrderBase, key: "annealer", label: "燒炖者" },
        { ...cutOrderBase, key: "preparer", label: "填表人" },
      ],
    },
  ],
  source: {
    receivedDate: "2026-09-27",
    imageSha256:
      "6D3469A8DA4366D979D8CA1C3B47088782538301BFAA7A2C2A209452501576C8",
    imageWidth: null,
    imageHeight: null,
    fileName: "退火明細表.xlsx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  openQuestions: [],
});

/**
 * 退火明細表 version 2 (the user, 2026-10-02). The particulars sit on three
 * equal columns of label and box, so 編號, 爐號 and 程式編號 line up with
 * boxes the same size, as do 起始時間, 溫度 and 外觀檢驗. 程式編號 takes a box
 * before 第 and after 程式 as well as between them: three values written in
 * one box, the middle one still `programNo`. Nothing else changes; sheets made
 * from version 1 keep it.
 */
const annealingSpan = { label: 1, value: 1 };
export const cutAnnealingListV2 = sheetTemplateDefinitionSchema.parse({
  ...cutAnnealingListV1,
  sections: cutAnnealingListV1.sections.map((section) =>
    section.type === "FIELDS" && section.key === "firing"
      ? {
          ...section,
          fieldRows: [3, 3, 5],
          fieldGrid: [8, 25, 8, 25, 8, 26],
          fields: section.fields.flatMap<object>((field) =>
            field.key === "programNo"
              ? [
                  {
                    ...cutOrderBase,
                    key: "programBefore",
                    label: "程式編號",
                    accessibleLabel: "程式編號（第之前）",
                    gridSpan: annealingSpan,
                    joinNext: "INLINE",
                  },
                  {
                    ...cutOrderBase,
                    key: "programNo",
                    label: "程式編號（第幾程式）",
                    prefix: "第",
                    unit: "程式",
                    joinNext: "INLINE",
                  },
                  { ...cutOrderBase, key: "programAfter", label: "程式編號（程式之後）" },
                ]
              : [{ ...field, gridSpan: annealingSpan }],
          ),
        }
      : section,
  ),
});

/**
 * 燒炖質量記錄表: one line per firing, written where the cores are made — CUT
 * or 沖壓 — and handed on to 燒頓 (the user, 2026-09-28). No review.
 *
 * Twelve printed headings over ten unnumbered rows at the worksheet's
 * proportions, A4 landscape, with F/P4-01-02 below the box. The narrow
 * headings print on two lines, broken where the paper breaks them — 爐號/
 * over 胆號, not inside 胆號 — each with its unbroken name for a screen
 * reader. 日期 and 裝箱日/時間 stay text, as every register's date columns
 * do: a date picker does not fit a column this narrow, and 裝箱日/時間 holds
 * a time as well.
 */
export const cutFiringQualityRecordV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "cut-firing-quality-record",
  displayName: "燒炖質量記錄表",
  documentLabel: "文件編號：",
  documentCode: "F/P4-01-02",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_ONLY",
  printLayout: { paperSize: "A4", orientation: "LANDSCAPE", marginMm: 8, rowHeightMm: 14 },
  ownerDepartmentCode: "CUT",
  allowedCreatorDepartmentCodes: ["CUT", "STAMPING"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "SHAO_DUN",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIXED_ROWS",
      key: "firings",
      label: "燒炖質量記錄",
      rowNumbers: false,
      columnWidthUnits: [12, 8, 10, 18, 32, 8, 8, 8, 8, 8, 8, 8.38],
      rowCount: 10,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        { ...cutOrderBase, key: "workOrderNo", label: "工單號" },
        { ...cutOrderBase, key: "date", label: "日期" },
        {
          ...cutOrderBase,
          key: "customerShortName",
          label: "客戶\n簡稱",
          accessibleLabel: "客戶簡稱",
        },
        { ...cutOrderBase, key: "specification", label: "規格/材質" },
        { ...cutOrderBase, key: "quantity", label: "數量" },
        // Printed 胆號, as the worksheet has it.
        {
          ...cutOrderBase,
          key: "furnaceNo",
          label: "爐號/\n胆號",
          accessibleLabel: "爐號/胆號",
        },
        {
          ...cutOrderBase,
          key: "firingTime",
          label: "燒炖\n時間",
          accessibleLabel: "燒炖時間",
        },
        {
          ...cutOrderBase,
          key: "firingTemperature",
          label: "燒炖\n溫度",
          accessibleLabel: "燒炖溫度",
        },
        {
          ...cutOrderBase,
          key: "lidTemperature",
          label: "掀蓋\n溫度",
          accessibleLabel: "掀蓋溫度",
        },
        {
          ...cutOrderBase,
          key: "appearance",
          label: "外觀\n色澤",
          accessibleLabel: "外觀色澤",
        },
        { ...cutOrderBase, key: "remarks", label: "備註" },
        {
          ...cutOrderBase,
          key: "packedAt",
          label: "裝箱日/\n時間",
          accessibleLabel: "裝箱日/時間",
          // Printed at 12pt beside the others' 14pt.
          headingSmall: true,
        },
      ],
    },
  ],
  source: {
    receivedDate: "2026-09-28",
    imageSha256:
      "04A94424DBA5ABF5EC61DFBFE2C7B1049FA3247E676FA204A8F0A9B3ECCF46C2",
    imageWidth: null,
    imageHeight: null,
    fileName: "燒炖質量記錄表.xls",
    mediaType: "application/vnd.ms-excel",
  },
  openQuestions: [],
});

const tick = (key: string, label: string, choices: string[], extra: Record<string, unknown> = {}) => ({
  ...cutOrderBase,
  key,
  label,
  standardValue: null,
  choices,
  // Printed `有□   無□` across 標準 and the three 檢測值.
  spanColumns: ["standard", "reading1", "reading2", "reading3"],
  ...extra,
});
const reading = (key: string, label: string) => ({ ...cutOrderBase, key, label, standardValue: null });
const roundTick = (key: string, label: string, choices: string[]) => ({
  ...cutOrderBase,
  key,
  label,
  standardValue: null,
  choices,
});

/**
 * CUT's 首件/巡迴檢驗單 (the user, 2026-09-29). No review; handing it on keeps
 * it in CUT for assignment.
 *
 * Source supplied as `CUT-首件巡迴檢驗單.xlsx`: one worksheet, `20260716改`,
 * A4 portrait, with the older 台北縣 stationery 加工製令單 also carries. Under
 * the title, who and when, then the order, then two blocks:
 *
 * - 首件檢驗: 捲繞 A–D and 切割 E each take a 標準 and three 檢測值, and
 *   龜裂, 研磨有無, 變形, 油壓 (大於90PSI), 浸漆 and 烘箱 are ticked once
 *   across those four cells; every row takes a 判定, ✓ or ✗. Beside them the
 *   C型 and 環型 core views, 類型 ticked, and the note the worksheet's text
 *   box holds in full: `※環形只檢驗:捲繞.尺寸及有無變形` (the printed box
 *   cuts it off after 有).
 * - 製程檢驗: six rounds, each headed with when it was checked, `＿日 ＿時
 *   ＿分`, under a corner of 檢驗時間 over 品質特性; the same measurements,
 *   有/無 for 龜裂 研磨 變形, and NG or OK per round.
 *
 * Then the 公差 table beside 鋼捲號, `單位：mm` and the ✓/✗ key, 備註 and 審核,
 * and F/Q1-08-07.
 */
export const cutPatrolInspectionV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "cut-patrol-inspection",
  displayName: "首件/巡迴檢驗單",
  letterhead: cutProcessingOrderV1.letterhead,
  documentLabel: "文件編號：",
  documentCode: "F/Q1-08-07",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_ONLY",
  headerLines: [
    { text: "單位：mm", placement: "BOTTOM", align: "START" },
    { text: "判定: ✓合格 ✗不合格", placement: "BOTTOM", align: "END" },
  ],
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 6, rowHeightMm: 5.2 },
  ownerDepartmentCode: "CUT",
  allowedCreatorDepartmentCodes: ["CUT"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "CUT",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIELDS",
      key: "job",
      fieldRows: [3, 3],
      fields: [
        { ...cutOrderBase, key: "productionDateShift", label: "生產日期/班次" },
        { ...cutOrderBase, key: "inspector", label: "品管員" },
        { ...cutOrderBase, key: "operator", label: "作業人員" },
        { ...cutOrderBase, key: "orderNo", label: "製令單號" },
        { ...cutOrderBase, key: "specification", label: "規格/材質" },
        { ...cutOrderBase, key: "machine", label: "機床" },
      ],
    },
    {
      type: "MATRIX",
      key: "firstPiece",
      label: "首件檢驗",
      sideLabel: "首件檢驗",
      rowLabelHeading: "品質特性",
      // Side label, group, row label, 標準, three 檢測值, 判定, the drawing.
      columnWidthUnits: [5.38, 6, 6.25, 5.25, 6, 5.25, 5.25, 5.25, 37.63],
      columns: [
        { key: "standard", label: "標準" },
        { key: "reading1", label: "檢測值 1", heading: "檢測值", headingSpan: 3 },
        { key: "reading2", label: "檢測值 2" },
        { key: "reading3", label: "檢測值 3" },
        // Marked ✓ or ✗, as the key under the form says; printed as marked.
        { key: "verdict", label: "判定", choices: ["✓", "✗"], choicesPrint: "CHOSEN" },
      ],
      groups: [
        {
          key: "winding",
          label: "捲繞",
          rows: [
            reading("a", "A"),
            reading("b1", "B1"),
            reading("b2", "B2"),
            reading("c1", "C1"),
            reading("c2", "C2"),
            reading("d", "D"),
          ],
        },
        {
          key: "cutting",
          label: "切割",
          rows: [reading("e", "E"), tick("crack", "龜裂", ["有", "無"])],
        },
        { key: "grinding", label: "研磨", rows: [tick("ground", "有無", ["有", "無"])] },
        {
          key: "appearance",
          label: "外觀",
          rows: [
            tick("deformation", "變形", ["有", "無"]),
            tick("hydraulic", "油壓", ["有", "無"], { prefix: "大於90PSI" }),
            tick("varnish", "浸漆", ["有", "無"]),
            tick("oven", "烘箱", ["是", "否"]),
          ],
        },
      ],
      aside: {
        field: { ...cutOrderBase, key: "coreType", label: "類型", choices: ["C型", "環型"] },
        drawing: {
          asset: "/templates/cut/patrol-inspection-cores.svg",
          alt: "C型鐵心俯視與側視，標示 E、B、A、C、D；環型鐵心俯視與側視，標示 C1、B1、A、D、B2、C2",
        },
        note: "※環形只檢驗:捲繞.尺寸及有無變形",
      },
    },
    {
      type: "MATRIX",
      key: "rounds",
      label: "製程檢驗",
      sideLabel: "製程檢驗",
      cornerCell: { across: "檢驗時間", down: "品質特性" },
      // Side label, group, row label, then the six rounds.
      columnWidthUnits: [5.38, 6, 6.25, 11.25, 10.5, 10.5, 10.5, 10.5, 11.38],
      headingEntry: {
        field: { ...cutOrderBase, key: "checkedAt", label: "檢驗時間" },
        parts: [
          { key: "day", unit: "日" },
          { key: "hour", unit: "時" },
          { key: "minute", unit: "分" },
        ],
      },
      columns: [1, 2, 3, 4, 5, 6].map((round) => ({
        key: `round${round}`,
        label: `第${round}次`,
      })),
      groups: [
        {
          key: "winding",
          label: "捲繞",
          rows: [
            reading("a", "A"),
            reading("b1", "B1"),
            reading("b2", "B2"),
            reading("c1", "C1"),
            reading("c2", "C2"),
            reading("d", "D"),
          ],
        },
        {
          key: "cutting",
          label: "切割",
          rows: [reading("e", "E"), roundTick("crack", "龜裂", ["有", "無"])],
        },
        { key: "grinding", label: "研磨", rows: [roundTick("ground", "有無", ["有", "無"])] },
        { key: "appearance", label: "外觀", rows: [roundTick("deformation", "變形", ["有", "無"])] },
        // Printed `判  定` across both label columns, NG or OK per round.
        { key: "result", label: null, rows: [roundTick("verdict", "判定", ["NG", "OK"])] },
      ],
    },
    {
      type: "REFERENCE_BAND",
      key: "tolerance",
      label: "公差表與鋼捲號",
      table: {
        corner: { across: "公差", down: "mm" },
        columns: [
          { label: "A", note: "積厚" },
          { label: "B", note: "內徑" },
          { label: "C", note: "外徑" },
          { label: "D", note: "高度" },
        ],
        rows: [
          { label: "6～25≦", values: ["±0.5", "±0.5", "±0.5", "±0.4"] },
          { label: "25～50≦", values: ["±0.5", "±0.5", "±0.5", "±0.5"] },
          { label: "50～75≦", values: ["±0.8", "±1.0", "±0.75", "±0.5"] },
          { label: "75～100≦", values: ["±0.8", "±1.0", "±1.0", "±1.0"] },
          { label: "100～150≦", values: ["±1.2", "±1.5", "±1.3", "±1.0"] },
          { label: "150～200≦", values: ["±1.5", "±1.5", "±1.5", "±1.0"] },
          { label: "200＞", values: ["±1.5", "±2", "±2", "±1.0"] },
        ],
      },
      entry: { ...cutOrderBase, key: "coilNumbers", label: "鋼捲號", multiline: true },
    },
    {
      type: "FIELDS",
      key: "closing",
      fieldRows: [2],
      fields: [
        { ...cutOrderBase, key: "remarks", label: "備註" },
        { ...cutOrderBase, key: "reviewer", label: "審核" },
      ],
    },
  ],
  source: {
    receivedDate: "2026-09-29",
    imageSha256:
      "4BB1FDB5B7491A25A472A69A7D37879F7036B4F524CAC2E6B5E8923507B84E4F",
    imageWidth: null,
    imageHeight: null,
    fileName: "CUT-首件巡迴檢驗單.xlsx",
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  openQuestions: [],
});
