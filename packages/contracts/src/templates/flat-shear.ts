/**
 * 平板剪's published form definitions. Each is parsed by the schema when
 * this module loads, so a definition that breaks the schema fails at once.
 */
import { sheetTemplateDefinitionSchema } from "../template-schema.js";

/**
 * 裁剪需求表 version 1 — approved.
 *
 * Transcribed from `裁剪需求表.docx`, supplied by the user on 2026-08-15 and
 * fingerprinted below. One table under the company letterhead, then a band of
 * printed core-stacking drawings.
 *
 * Confirmed by the user:
 *
 * - 平板剪's form, created only there, and it needs no review.
 * - 主管 and 訂單人員 create it; 員工 may not start one. The 訂單人員 takes the
 *   customer's order and fills the order side, then the 主管 fills the
 *   production side — expressed per field rather than as a workflow stage, so
 *   the 主管 need not wait for the order-taker to finish.
 * - 員工 may edit every cell. They step in only to correct something wrong, so
 *   splitting the form against them would block the very thing they are there
 *   for.
 * - Nothing is required; every cell may be left blank.
 * - The three 積鐵芯疊法 drawings are reproduced as printed.
 * - 交期 is a date picker bound to the sheet's own deadline. Everything else
 *   stays free text, including 訂購日期, which nothing has to parse.
 */
const cuttingRequestBase = {
  type: "TEXT" as const,
  required: false,
  reviewed: false,
  editableStates: ["DRAFT" as const, "READY" as const, "IN_PROGRESS" as const],
  validationStatus: "CONFIRMED" as const,
};
/** The order side: taken from the customer, and correctable by 主管 and 員工. */
const orderSideEditors = [
  "ORIGIN_ORDER_TAKER" as const,
  "ORIGIN_MANAGER" as const,
  "ORIGIN_STAFF" as const,
];
/** The production side: the 主管 fills it, and 員工 correct it. */
const productionSideEditors = ["ORIGIN_MANAGER" as const, "ORIGIN_STAFF" as const];

export const flatShearCuttingRequestV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "flat-shear-cutting-request",
  displayName: "裁剪需求表",
  documentLabel: "文件編號：",
  documentCode: "F/M1-08-02",
  documentCodePosition: "BELOW_GRID_RIGHT",
  headerLayout: "TITLE_ONLY",
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
  ownerDepartmentCode: "FLAT_SHEAR",
  allowedCreatorDepartmentCodes: ["FLAT_SHEAR"],
  allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
  // 員工 fill in and correct but never start one, which is why the editors are
  // named separately from the creators.
  allowedEditorKinds: ["MANAGER", "ORDER_TAKER", "STAFF"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "FLAT_SHEAR",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIELDS",
      key: "order",
      // The paper's own three header rows: 訂購日期/客戶名稱/交期, then the
      // material line, then the production line.
      fieldRows: [3, 4, 4],
      fields: [
        { ...cuttingRequestBase, key: "orderDate", label: "訂購日期", editableBy: orderSideEditors },
        { ...cuttingRequestBase, key: "customerName", label: "客戶名稱", editableBy: orderSideEditors },
        {
          ...cuttingRequestBase,
          key: "deliveryDate",
          label: "交期",
          // A date the overdue queue and the daily reminder read, so it is
          // picked rather than typed: free text cannot be compared to a clock.
          type: "DATE",
          bindsTo: "DUE_AT",
          editableBy: orderSideEditors,
        },
        { ...cuttingRequestBase, key: "workOrderNo", label: "工單號", editableBy: orderSideEditors },
        { ...cuttingRequestBase, key: "material", label: "材質", editableBy: orderSideEditors },
        // The unit is printed inside the write-on cell rather than in one of
        // its own: the row below rules the same column empty, so this cell is
        // the box and the operator writes the number beside the unit.
        { ...cuttingRequestBase, key: "transformerCapacity", label: "變壓器容量", unit: "KVA", editableBy: orderSideEditors },
        { ...cuttingRequestBase, key: "stackThickness", label: "積厚", unit: "m/m", editableBy: orderSideEditors },
        { ...cuttingRequestBase, key: "bindingLength", label: "綁柱長度", editableBy: orderSideEditors },
        { ...cuttingRequestBase, key: "unitCount", label: "台數", editableBy: orderSideEditors },
        { ...cuttingRequestBase, key: "machine", label: "機台", editableBy: productionSideEditors },
        { ...cuttingRequestBase, key: "operator", label: "作業員", editableBy: productionSideEditors },
      ],
    },
    {
      type: "FIXED_ROWS",
      key: "products",
      label: "產品規格",
      // The paper numbers these ①…⑩ under a 項目 heading rather than 序.
      rowNumberLabel: "項目",
      rowNumberWidthUnits: 1215,
      columnWidthUnits: [1624, 1633, 1633, 1633, 1633, 1652],
      rowCount: 10,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        ["length", "長"],
        ["width", "寬"],
        ["stackThickness", "積厚"],
        ["bundleCount", "把數"],
        ["sheetCount", "片數"],
        ["weight", "重量"],
      ].map(([key, label]) => ({
        ...cuttingRequestBase,
        key,
        label,
        editableBy: productionSideEditors,
      })),
    },
    {
      type: "DIAGRAMS",
      key: "coreStacking",
      label: "積鐵芯疊法",
      items: [
        {
          key: "main-1",
          label: "主鐵芯(一)",
          asset: "/templates/flat-shear/core-stacking-main-1.jpeg",
          alt: "主鐵芯(一) 疊法：上方兩段軛鐵、三支柱腳與一段底軛的排列圖",
        },
        {
          key: "auxiliary",
          label: "副鐵芯",
          asset: "/templates/flat-shear/core-stacking-auxiliary.jpeg",
          alt: "副鐵芯 疊法：上方兩段軛鐵、三支柱腳與一段底軛的排列圖",
        },
        {
          key: "main-2",
          label: "主鐵芯(二)",
          asset: "/templates/flat-shear/core-stacking-main-2.jpeg",
          alt: "主鐵芯(二) 疊法：上方兩段整幅軛鐵與三支柱腳的排列圖",
        },
      ],
    },
  ],
  source: {
    receivedDate: "2026-08-15",
    imageSha256:
      "AC1896205DA368B1AFE9037152089A85ABABEA45CC507E9B6D958D22CD7B01C5",
    imageWidth: null,
    imageHeight: null,
    fileName: "裁剪需求表.docx",
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  openQuestions: [],
});

/**
 * 裁剪需求表 version 2 (the user, 2026-10-02): the header on the document's
 * own columns, read from its Word table, so labels and boxes line up and
 * keep the document's sizes. Rows 2 and 3 share their columns (工單號/綁柱長度,
 * 材質/台數, 變壓器容量/機台, 積厚/作業員); row 1's three pairs divide the
 * same width, its 交期 on the same edges as 變壓器容量's box. The ten
 * columns are every edge any row draws, in points: 61.7, 92, 29.5, 20.7,
 * 42, 42.9, 70.7, 64.3, 56.5 and 71.1.
 *
 * The table's fifth row, `產品規格` ruled across the full width above 項目
 * and its headings, was missing from version 1; it is the register's caption
 * here (the user, 2026-10-02). Nothing else changes; sheets made from
 * version 1 keep it.
 */
const cuttingRequestSpans: Record<string, { label: number; value: number }> = {
  orderDate: { label: 1, value: 2 },
  customerName: { label: 2, value: 2 },
  deliveryDate: { label: 1, value: 2 },
  workOrderNo: { label: 1, value: 1 },
  material: { label: 2, value: 2 },
  transformerCapacity: { label: 1, value: 1 },
  stackThickness: { label: 1, value: 1 },
  bindingLength: { label: 1, value: 1 },
  unitCount: { label: 2, value: 2 },
  machine: { label: 1, value: 1 },
  operator: { label: 1, value: 1 },
};
export const flatShearCuttingRequestV2 = sheetTemplateDefinitionSchema.parse({
  ...flatShearCuttingRequestV1,
  sections: flatShearCuttingRequestV1.sections.map((section) =>
    section.type === "FIELDS" && section.key === "order"
      ? {
          ...section,
          fieldGrid: [61.7, 92, 29.5, 20.7, 42, 42.9, 70.7, 64.3, 56.5, 71.1],
          fields: section.fields.map((field) => ({
            ...field,
            gridSpan: cuttingRequestSpans[field.key],
          })),
        }
      : section.type === "FIXED_ROWS" && section.key === "products"
        ? { ...section, caption: { text: "產品規格" } }
        : section,
  ),
});
