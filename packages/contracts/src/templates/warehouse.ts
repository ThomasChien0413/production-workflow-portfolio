/**
 * 倉管's published form definitions. Each is parsed by the schema when
 * this module loads, so a definition that breaks the schema fails at once.
 */
import { sheetTemplateDefinitionSchema } from "../template-schema.js";

/**
 * 倉位入庫表 version 1 — approved.
 *
 * Transcribed from `倉位入庫表.xls`, supplied by the user on 2026-08-13 and
 * fingerprinted below. The file is a legacy Excel workbook of twelve
 * worksheets — 領料單, 分條日報, 盤點表, 待燒入庫單, 倉位圖 and others — and
 * only `倉位入庫`, the sheet the file is named for, is transcribed here. The
 * rest are not 倉管 production sheets until the user says they are, and none
 * of their fields appear in this definition.
 *
 * Confirmed by the user on 2026-08-13:
 *
 * - This is the only production sheet 倉管 has, and it is created only there.
 * - Both of the department's employees — 倉管員工 and 生管員工 — may read and
 *   modify any of its sheets, hence `ANY_IN_DEPARTMENT` rather than the usual
 *   own-or-assigned scope.
 * - It needs no review. The printed form has no signature band at all, and the
 *   user confirmed the warehouse completes it alone.
 * - Every column may be left blank.
 * - The document number is written `文件编号` in the 2011 source; the user
 *   asked for the traditional `文件編號` the other three forms use.
 *
 * Labels are the workbook's own, with the padding spaces removed: the source
 * writes `規    格` and `箱 數` to centre text inside a cell, and the title as
 * `倉 位 入 庫 表`. That spacing is Excel's layout, not the wording, and the
 * form stylesheet already letter-spaces the title.
 */
export const warehouseLocationIntakeV1 = sheetTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  status: "APPROVED",
  templateKey: "warehouse-location-intake",
  displayName: "倉位入庫表",
  documentLabel: "文件編號：",
  documentCode: "F/A5-04-01",
  documentCodePosition: "BELOW_GRID_RIGHT",
  // The source has no date anywhere in the header — 太陽日 is a column of the
  // grid, filled per row, not once for the sheet.
  headerLayout: "TITLE_ONLY",
  // Six columns of about 89 character units, 28 rows tall: portrait fits with
  // room to spare, where landscape would leave most of the page empty.
  printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
  ownerDepartmentCode: "WAREHOUSE",
  allowedCreatorDepartmentCodes: ["WAREHOUSE"],
  allowedCreatorKinds: ["MANAGER", "STAFF"],
  staffEditScope: "ANY_IN_DEPARTMENT",
  workflow: {
    requiresReview: false,
    approvalRoles: [],
    destinationDepartmentCode: "WAREHOUSE",
    avoidSelfHandoff: true,
  },
  sections: [
    {
      type: "FIXED_ROWS",
      key: "items",
      label: "倉位入庫明細",
      rowNumberLabel: "序",
      rowNumberWidthUnits: 4,
      columnWidthUnits: [10.5, 11.63, 31.13, 15.13, 16.75],
      rowCount: 28,
      // Nothing is required, so nothing is enforced: a row may be started and
      // left part-filled, and a sheet may be saved with no rows at all.
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 0,
      columns: [
        ["location", "倉位"],
        // A shop-floor production-day marker, not a calendar date. It is free
        // text on the paper and stays free text here.
        ["solarDay", "太陽日"],
        ["specification", "規格"],
        ["cartonCount", "箱數"],
        ["note", "備註"],
      ].map(([key, label]) => ({
        key,
        label,
        type: "TEXT" as const,
        // Confirmed 2026-08-13: every column may be left blank.
        required: false,
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
    receivedDate: "2026-08-13",
    imageSha256:
      "19208C8211BBB956AC4EE3A3C581B52A839A47E5436F65E5A4E6251733F7D2C8",
    imageWidth: null,
    imageHeight: null,
    fileName: "倉位入庫表.xls",
    mediaType: "application/vnd.ms-excel",
  },
  openQuestions: [],
});
