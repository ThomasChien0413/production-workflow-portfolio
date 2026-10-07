import { describe, expect, it } from "vitest";
import {
  resolveComputedValue,
  resolveDocumentIdentifier,
  cutCustomerOrderDaYinV1,
  cutCustomerOrderShihlinV1,
  cutCustomerOrderShihlinV2,
  cutCustomerOrderV1,
  cutProcessingOrderV1,
  cutProcessingOrderV2,
  cutCharacteristicInspectionShintaiV1,
  cutCharacteristicInspectionShintaiV2,
  cutCharacteristicInspectionSongmaoV1,
  cutCharacteristicInspectionSongmaoV2,
  cutCharacteristicInspectionV1,
  cutCharacteristicInspectionV2,
  cutAnnealingListV1,
  cutAnnealingListV2,
  cutDailyReportV1,
  cutDefectRateV1,
  cutFiringQualityRecordV1,
  cutPatrolInspectionV1,
  stampingPatrolInspectionV1,
  cutFactoryInspectionChiaoliV1,
  cutFactoryInspectionChiaoliV2,
  describeRow,
  printedRowNumber,
  cutFinishedInspectionV1,
  cutFinishedInspectionV2,
  formatChoices,
  headingRows,
  isPrintedMatrix,
  matrixWidthSlots,
  matrixCellChoices,
  matrixRowCells,
  matrixWrittenColumns,
  printedCells,
  isChoiceValue,
  isWritableField,
  readChoice,
  isWrittenRowCell,
  resolveFieldRows,
  fieldBoxes,
  cutPersonalDailyReportV1,
  cutProductionBoardV1,
  isRowGroupContinuation,
  flatShearCuttingRequestV1,
  flatShearCuttingRequestV2,
  resolveTemplateHeaderLayout,
  resolveTemplatePrintLayout,
  sectionFields,
  saveTemplateVersionRequestSchema,
  sheetTemplateDefinitionSchema,
  slittingKnifeLayoutV1,
  slittingProductionOrderV1,
  slittingProductionOrderV2,
  slittingRequestV1,
  slittingRequestV2,
  slittingRequestV3,
  stampingEiCustomerOrderV1,
  stampingFiringIntakeV1,
  stampingProductDemandV1,
  stampingProductionBoardV1,
  stampingDailyReportV1,
  warehouseLocationIntakeV1,
} from "./templates.js";

describe("template administration contracts", () => {
  it("normalizes omitted optional version metadata to null", () => {
    expect(
      saveTemplateVersionRequestSchema.parse({
        clientMutationId: "00000000-0000-4000-8000-000000000001",
        definition: slittingRequestV1,
      }),
    ).toMatchObject({
      definition: slittingRequestV1,
      sourceReference: null,
      changeNotes: null,
    });
  });

  it("rejects unknown version mutation properties", () => {
    expect(() =>
      saveTemplateVersionRequestSchema.parse({
        clientMutationId: "00000000-0000-4000-8000-000000000001",
        definition: slittingRequestV1,
        active: true,
      }),
    ).toThrow();
  });
});

describe("分條申請單 version 1", () => {
  it("preserves the image-backed fields, row count, and routing rules", () => {
    expect(slittingRequestV1).toMatchObject({
      status: "APPROVED",
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
        // Confirmed: a sheet created by 分條 stays in 分條 after review and
        // records no self-handoff.
        avoidSelfHandoff: true,
      },
    });

    const rows = slittingRequestV1.sections.find(
      (section) => section.type === "FIXED_ROWS",
    );
    expect(rows).toMatchObject({
      rowCount: 8,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 1,
      columns: [
        { label: "規格" },
        { label: "材質" },
        { label: "分類" },
        { label: "需求量" },
        { label: "備註" },
      ],
    });
  });

  it("records every field as required and confirmed", () => {
    for (const section of slittingRequestV1.sections) {
      if (section.type === "APPROVAL_STATUS") continue;
      for (const field of sectionFields(section)) {
        expect(field.required, `${field.key} required`).toBe(true);
        expect(field.validationStatus, `${field.key} status`).toBe("CONFIRMED");
      }
    }
  });

  it("uses the full role name 總經理 rather than the printed abbreviation", () => {
    const approvals = slittingRequestV1.sections.find(
      (section) => section.type === "APPROVAL_STATUS",
    );
    const generalManager =
      approvals?.type === "APPROVAL_STATUS"
        ? approvals.blocks.find((block) => block.mappedTo === "GENERAL_MANAGER")
        : undefined;
    expect(generalManager?.visibleLabel).toBe("總經理");
    expect(generalManager?.transcriptionStatus).toBe("CONFIRMED");
  });

  it("carries no unresolved questions", () => {
    expect(slittingRequestV1.openQuestions).toEqual([]);
  });

  it("keeps published v1 free of later print metadata and resolves frozen legacy behavior", () => {
    expect(slittingRequestV1).not.toHaveProperty("printLayout");
    expect(slittingRequestV1).not.toHaveProperty("headerLayout");
    expect(resolveTemplateHeaderLayout(slittingRequestV1)).toBe(
      "DATE_TITLE_DOCUMENT",
    );
    expect(resolveTemplatePrintLayout(slittingRequestV1)).toEqual({
      paperSize: "A4",
      orientation: "LANDSCAPE",
      marginMm: 8,
    });
  });

  it("records the approved print settings only in version 2", () => {
    expect(slittingRequestV2).toMatchObject({
      headerLayout: "DATE_TITLE_DOCUMENT",
      printLayout: { paperSize: "A4", orientation: "LANDSCAPE", marginMm: 8 },
    });
  });

  it("adds the 訂單人員 policy only in version 3", () => {
    expect(slittingRequestV1.allowedCreatorKinds).toEqual(["MANAGER"]);
    expect(slittingRequestV2.allowedCreatorKinds).toEqual(["MANAGER"]);
    expect(slittingRequestV3).toMatchObject({
      allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
      allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
      allowedSubmitterKinds: ["MANAGER", "ORDER_TAKER"],
      staffEditScope: "ANY_IN_DEPARTMENT",
      allowedCreatorDepartmentCodes: [
        "SLITTING",
        "CUT",
        "STAMPING",
        "FLAT_SHEAR",
        "WAREHOUSE",
      ],
      workflow: slittingRequestV2.workflow,
      headerLayout: "DATE_TITLE_DOCUMENT",
      printLayout: { paperSize: "A4", orientation: "LANDSCAPE", marginMm: 8 },
    });
    for (const section of slittingRequestV3.sections) {
      if (section.type === "APPROVAL_STATUS") continue;
      for (const field of sectionFields(section)) {
        expect(field.editableBy).toEqual([
          "ORIGIN_MANAGER",
          "ORIGIN_ORDER_TAKER",
        ]);
        expect(field.editableStates).toEqual(["DRAFT", "RETURNED"]);
      }
    }
  });

  it("still refuses approval when a transcription rule is unresolved", () => {
    // The guard must keep working for the templates that come next, not just
    // pass because this one happens to be complete now.
    expect(() =>
      sheetTemplateDefinitionSchema.parse({
        ...slittingRequestV1,
        openQuestions: ["請確認欄位單位。"],
      }),
    ).toThrow(/unresolved transcription rules/);
  });

  it("defaults pre-existing definitions to manager-only creation", () => {
    // Definitions stored before 2026-08-08 carry neither field. They must keep
    // the AGENTS.md §5 behaviour rather than silently gaining staff creation.
    expect(slittingRequestV1.allowedCreatorKinds).toEqual(["MANAGER"]);
    expect(slittingRequestV1.allowedSubmitterKinds).toEqual(["MANAGER"]);
    expect(slittingRequestV1.staffEditScope).toBe("OWN_OR_ASSIGNED");
  });

  it("rejects a row section demanding more completed rows than exist", () => {
    const rows = slittingRequestV1.sections.find(
      (section) => section.type === "FIXED_ROWS",
    );
    expect(() =>
      sheetTemplateDefinitionSchema.parse({
        ...slittingRequestV1,
        sections: slittingRequestV1.sections.map((section) =>
          section === rows
            ? { ...section, minimumCompletedRows: 99 }
            : section,
        ),
      }),
    ).toThrow(/minimumCompletedRows/);
  });
});

describe("分條排刀單 transcription", () => {
  const form = slittingKnifeLayoutV1;

  it("is active-ready, fingerprinted against the XLSX, and staff-creatable", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "分條排刀單",
      documentCode: "F/P1-01-01",
      documentCodePosition: "BELOW_GRID_RIGHT",
      headerLayout: "TITLE_LEFT_DATE_RIGHT",
      allowedCreatorDepartmentCodes: ["SLITTING"],
      allowedCreatorKinds: ["MANAGER", "STAFF"],
      staffEditScope: "OWN_OR_ASSIGNED",
      printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
      workflow: { requiresReview: false, approvalRoles: [] },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "A44CD98D46521C34E008AA16F4D7EC83F6ED0F63F55F6376F2A9D0012F138A04",
      fileName: "分條排刀單.xlsx",
    });
    expect(form.openQuestions).toEqual([]);
  });

  it("preserves the exact visible labels, ten rows, and XLSX proportions", () => {
    const rows = form.sections.find((section) => section.type === "FIXED_ROWS");
    expect(rows).toMatchObject({
      rowNumberLabel: "序",
      rowNumberWidthUnits: 5.625,
      columnWidthUnits: [12.625, 26.625, 12.625, 12.625, 26.625],
      rowCount: 10,
      rowRequirement: "COMPLETE_IF_STARTED",
      minimumCompletedRows: 1,
    });
    expect(rows?.type === "FIXED_ROWS" ? rows.columns.map((field) => field.label) : []).toEqual([
      "鋼廠",
      "質材",
      "規格",
      "數量",
      "總寬 & 分條件數",
    ]);
  });

  it("rejects incomplete fixed-row width metadata", () => {
    const rowsIndex = form.sections.findIndex((section) => section.type === "FIXED_ROWS");
    expect(() =>
      sheetTemplateDefinitionSchema.parse({
        ...form,
        sections: form.sections.map((section, index) =>
          index === rowsIndex && section.type === "FIXED_ROWS"
            ? { ...section, columnWidthUnits: [1, 2] }
            : section,
        ),
      }),
    ).toThrow(/columnWidthUnits/);
  });
});

describe("倉位入庫表 transcription", () => {
  const form = warehouseLocationIntakeV1;

  it("is 倉管-owned, review-free, and editable by either employee", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "倉位入庫表",
      // Traditional, on the user's instruction: the 2011 source writes 编号.
      documentLabel: "文件編號：",
      documentCode: "F/A5-04-01",
      documentCodePosition: "BELOW_GRID_RIGHT",
      // The form has no header date at all; 太陽日 is a column.
      headerLayout: "TITLE_ONLY",
      ownerDepartmentCode: "WAREHOUSE",
      allowedCreatorDepartmentCodes: ["WAREHOUSE"],
      allowedCreatorKinds: ["MANAGER", "STAFF"],
      // Confirmed 2026-08-13: both 倉管員工 and 生管員工 may modify any of the
      // department's sheets, not only their own.
      staffEditScope: "ANY_IN_DEPARTMENT",
      printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
      workflow: { requiresReview: false, approvalRoles: [] },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "19208C8211BBB956AC4EE3A3C581B52A839A47E5436F65E5A4E6251733F7D2C8",
      fileName: "倉位入庫表.xls",
    });
    expect(form.openQuestions).toEqual([]);
  });

  it("preserves the workbook labels, twenty-eight rows, and proportions", () => {
    const rows = form.sections.find((section) => section.type === "FIXED_ROWS");
    expect(rows).toMatchObject({
      rowNumberLabel: "序",
      rowNumberWidthUnits: 4,
      columnWidthUnits: [10.5, 11.63, 31.13, 15.13, 16.75],
      rowCount: 28,
    });
    expect(
      rows?.type === "FIXED_ROWS" ? rows.columns.map((field) => field.label) : [],
    ).toEqual(["倉位", "太陽日", "規格", "箱數", "備註"]);
  });

  it("requires nothing, because the user said every column may be blank", () => {
    const rows = form.sections.find((section) => section.type === "FIXED_ROWS");
    expect(rows?.type === "FIXED_ROWS" ? rows.minimumCompletedRows : -1).toBe(0);
    expect(
      rows?.type === "FIXED_ROWS" ? rows.columns.every((field) => !field.required) : false,
    ).toBe(true);
  });

  it("carries no field from the other worksheets in the same workbook", () => {
    // The source file also holds 領料單, 分條日報, 盤點表, 待燒入庫單 and 倉位圖.
    // None of them has been confirmed as a 倉管 production sheet, so none of
    // their columns may appear here.
    const labels = form.sections.flatMap((section) =>
      section.type === "FIXED_ROWS" ? section.columns.map((field) => field.label) : [],
    );
    for (const foreign of ["廠商", "淨重", "材料編號", "沖壓人員", "重量"]) {
      expect(labels).not.toContain(foreign);
    }
  });
});


describe("裁剪需求表 transcription", () => {
  const form = flatShearCuttingRequestV1;

  it("is 平板剪-owned, review-free, and opened by 主管 or 訂單人員", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "裁剪需求表",
      documentLabel: "文件編號：",
      documentCode: "F/M1-08-02",
      documentCodePosition: "BELOW_GRID_RIGHT",
      headerLayout: "TITLE_ONLY",
      ownerDepartmentCode: "FLAT_SHEAR",
      allowedCreatorDepartmentCodes: ["FLAT_SHEAR"],
      // Confirmed 2026-08-15: 訂單人員 take the order and open the sheet, the
      // 主管 finishes it, and 員工 correct it without ever starting one.
      allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
      allowedEditorKinds: ["MANAGER", "ORDER_TAKER", "STAFF"],
      staffEditScope: "ANY_IN_DEPARTMENT",
      printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
      workflow: { requiresReview: false, approvalRoles: [] },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "AC1896205DA368B1AFE9037152089A85ABABEA45CC507E9B6D958D22CD7B01C5",
      fileName: "裁剪需求表.docx",
    });
    expect(form.openQuestions).toEqual([]);
  });

  it("binds 交期 to the sheet deadline and leaves everything else free text", () => {
    const fields = form.sections.find((section) => section.type === "FIELDS");
    const delivery =
      fields?.type === "FIELDS"
        ? fields.fields.find((field) => field.key === "deliveryDate")
        : undefined;
    expect(delivery).toMatchObject({ label: "交期", type: "DATE", bindsTo: "DUE_AT" });
    // The paper prints KVA and m/m inside the write-on cells themselves —
    // the row below rules the same columns empty — so the unit is recorded
    // as a unit rather than folded into the label or ruled its own cell.
    const unitOf = (key: string) =>
      fields?.type === "FIELDS"
        ? fields.fields.find((field) => field.key === key)
        : undefined;
    expect(unitOf("transformerCapacity")).toMatchObject({
      label: "變壓器容量",
      unit: "KVA",
    });
    expect(unitOf("stackThickness")).toMatchObject({ label: "積厚", unit: "m/m" });
    expect(
      fields?.type === "FIELDS"
        ? fields.fields.some((field) => field.printedOnly)
        : true,
    ).toBe(false);
    // 訂購日期 is written on the paper and read by people, so nothing has to
    // parse it — it stays text rather than acquiring a second date picker.
    const others =
      fields?.type === "FIELDS"
        ? fields.fields.filter((field) => field.key !== "deliveryDate")
        : [];
    expect(others.every((field) => field.type === "TEXT")).toBe(true);
    expect(others.some((field) => field.bindsTo)).toBe(false);
  });

  it("requires nothing, because the user said every cell may be blank", () => {
    const required = form.sections.flatMap((section) =>
      sectionFields(section).filter((field) => field.required),
    );
    expect(required).toEqual([]);
    const rows = form.sections.find((section) => section.type === "FIXED_ROWS");
    expect(rows?.type === "FIXED_ROWS" ? rows.minimumCompletedRows : -1).toBe(0);
  });

  it("splits the order side from the production side without shutting 員工 out", () => {
    const fields = form.sections.find((section) => section.type === "FIELDS");
    const editors = (key: string) =>
      fields?.type === "FIELDS"
        ? fields.fields.find((field) => field.key === key)?.editableBy
        : undefined;
    // 訂單人員 fill what the customer says; 機台 and 作業員 are decided in the
    // department after the order arrives.
    expect(editors("customerName")).toContain("ORIGIN_ORDER_TAKER");
    expect(editors("machine")).not.toContain("ORIGIN_ORDER_TAKER");
    // 員工 step in wherever something is wrong, so every cell admits them.
    for (const field of form.sections.flatMap(sectionFields)) {
      expect(field.editableBy).toContain("ORIGIN_STAFF");
    }
  });

  it("prints the three 積鐵芯疊法 drawings and no field with them", () => {
    const diagrams = form.sections.find((section) => section.type === "DIAGRAMS");
    expect(diagrams?.type === "DIAGRAMS" ? diagrams.label : "").toBe("積鐵芯疊法");
    expect(
      diagrams?.type === "DIAGRAMS" ? diagrams.items.map((item) => item.label) : [],
    ).toEqual(["主鐵芯(一)", "副鐵芯", "主鐵芯(二)"]);
    // Every drawing carries a description, because a picture no one can see is
    // the whole content of this band for a screen-reader user.
    expect(
      diagrams?.type === "DIAGRAMS" ? diagrams.items.every((item) => item.alt.length > 0) : false,
    ).toBe(true);
    expect(diagrams ? sectionFields(diagrams) : ["not empty"]).toEqual([]);
  });

  it("keeps the printed 產品規格 grid at ten rows with the paper's proportions", () => {
    const rows = form.sections.find((section) => section.type === "FIXED_ROWS");
    expect(rows).toMatchObject({
      rowNumberLabel: "項目",
      rowCount: 10,
      rowNumberWidthUnits: 1215,
      columnWidthUnits: [1624, 1633, 1633, 1633, 1633, 1652],
    });
    expect(
      rows?.type === "FIXED_ROWS" ? rows.columns.map((field) => field.label) : [],
    ).toEqual(["長", "寬", "積厚", "把數", "片數", "重量"]);
  });
});

describe("EI客戶訂購表 transcription", () => {
  const form = stampingEiCustomerOrderV1;

  it("is 沖壓-owned, review-free, and opened only by 主管 or 訂單人員", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "EI客戶訂購表",
      documentLabel: "文件編號：",
      documentCode: "F/P2-08-01",
      documentCodePosition: "BELOW_GRID_RIGHT",
      headerLayout: "TITLE_ONLY",
      ownerDepartmentCode: "STAMPING",
      allowedCreatorDepartmentCodes: ["STAMPING"],
      // Confirmed 2026-08-21: 員工 neither open nor fill this register.
      allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
      allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
      staffEditScope: "ANY_IN_DEPARTMENT",
      printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
      workflow: { requiresReview: false, approvalRoles: [] },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "DB0AA3A590DAF268AEDB8394DA67EE33BA6D2906C022CDBA01DE0C66465B0841",
      fileName: "EI客戶訂購表.xls",
    });
    expect(form.openQuestions).toEqual([]);
  });

  it("prints no row-number column, because the paper numbers nothing", () => {
    const rows = form.sections.find((section) => section.type === "FIXED_ROWS");
    expect(rows).toMatchObject({
      rowNumbers: false,
      rowCount: 24,
      columnWidthUnits: [5, 14.25, 35, 10.25, 8.13, 6, 14.75],
    });
    // Widths are supplied together only when there is a number column to size.
    expect(rows?.type === "FIXED_ROWS" ? rows.rowNumberWidthUnits : 0).toBeUndefined();
    expect(
      rows?.type === "FIXED_ROWS" ? rows.columns.map((field) => field.label) : [],
    ).toEqual(["訂日", "客戶", "規格/材質", "數量", "交期", "單價", "備註"]);
  });

  it("keeps every other transcription numbered", () => {
    // The option defaults to the behaviour every earlier form was drawn with.
    for (const definition of [warehouseLocationIntakeV1, flatShearCuttingRequestV1]) {
      const rows = definition.sections.find(
        (section) => section.type === "FIXED_ROWS",
      );
      expect(rows?.type === "FIXED_ROWS" ? rows.rowNumbers : false).toBe(true);
    }
  });

  it("requires nothing and stays free text throughout", () => {
    const fields = form.sections.flatMap(sectionFields);
    expect(fields.every((field) => field.required === false)).toBe(true);
    expect(fields.every((field) => field.type === "TEXT")).toBe(true);
    // 訂單人員 fill this alongside the 主管, so both appear on every cell.
    expect(
      fields.every(
        (field) =>
          field.editableBy.includes("ORIGIN_ORDER_TAKER") &&
          field.editableBy.includes("ORIGIN_MANAGER"),
      ),
    ).toBe(true);
    expect(fields.some((field) => field.editableBy.includes("ORIGIN_STAFF"))).toBe(
      false,
    );
  });

  it("carries no field from the other workbooks in the same folder", () => {
    // The folder also holds 待燒入庫表 and two 沖壓 production boards. None has
    // been confirmed, so none of their columns may appear here.
    const labels = form.sections.flatMap((section) =>
      sectionFields(section).map((field) => field.label),
    );
    for (const foreign of ["爐號", "入庫日", "機台", "生產量", "不良"]) {
      expect(labels).not.toContain(foreign);
    }
  });
});

describe("加工製令單 transcription", () => {
  const form = cutProcessingOrderV1;

  it("is CUT-owned, review-free, and opened only by 主管 or 訂單人員", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "加工製令單",
      documentCode: "F/P5-05-05",
      documentCodePosition: "BELOW_GRID_RIGHT",
      headerLayout: "TITLE_ONLY",
      ownerDepartmentCode: "CUT",
      allowedCreatorDepartmentCodes: ["CUT"],
      allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
      allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
      staffEditScope: "ANY_IN_DEPARTMENT",
      printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
      workflow: { requiresReview: false, approvalRoles: [] },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "8EB87FFE7EBD5C18263561E0373D23A6600A63346CC2536F2F9C72422F203642",
      fileName: "加工製令單.xls",
    });
    expect(form.openQuestions).toEqual([]);
  });

  it("keeps every printed label exactly as the paper prints it", () => {
    const header = form.sections.find((section) => section.type === "FIELDS");
    expect(header?.type === "FIELDS" ? header.fieldRows : []).toEqual([4, 4, 4, 2, 1, 3]);
    expect(
      header?.type === "FIELDS" ? header.fields.map((field) => field.label) : [],
    ).toEqual([
      "客戶",
      "客戶訂號",
      "訂貨日",
      "交期",
      "鐵芯尺寸",
      "訂購數量",
      "預重單重",
      // The paper rules the unit into its own cell, so it is one here too
      // rather than being run together with the label beside it.
      "KG",
      "材質",
      "捲繞壓力",
      "約耗材總重",
      "KG",
      "鋼捲號",
      "領料重量",
      "備註",
      "退火編號",
      "製令單交給生產部",
      "工單號",
    ]);
    // The three printed cells are exactly the ones the paper never leaves
    // blank for anyone to fill.
    const printed =
      header?.type === "FIELDS"
        ? header.fields.filter((field) => field.printedOnly).map((field) => field.label)
        : [];
    expect(printed).toEqual(["KG", "KG", "製令單交給生產部"]);
  });

  it("records the nine process steps against the eight recorded columns", () => {
    const process = form.sections.find((section) => section.type === "MATRIX");
    expect(process?.type === "MATRIX" ? process.label : "").toBe("工作流程");
    expect(
      process?.type === "MATRIX" ? process.columns.map((column) => column.label) : [],
    ).toEqual([
      "日期",
      "人員",
      "數量",
      "首件檢驗",
      "檢驗者",
      "異常原因",
      "不良數",
      "處理方式",
    ]);
    expect(
      process?.type === "MATRIX"
        ? process.groups.flatMap((group) => group.rows.map((row) => row.label))
        : [],
    ).toEqual(["捲繞", "定型", "退火", "上膠", "退爐", "切割", "研磨", "包裝", "入庫"]);
    // The printed rule beneath 首件檢驗 is a second line, not part of it.
    expect(
      process?.type === "MATRIX" ? process.columns[3]?.note : undefined,
    ).toBe("依據F/Q-08檢驗");
    // Row labels plus one per column, in the worksheet's proportions.
    expect(
      process?.type === "MATRIX" ? process.columnWidthUnits?.length : 0,
    ).toBe(9);
    // No group column and no 標準值 column, so the widths line up as written.
    expect(
      process?.type === "MATRIX" ? process.groups.every((group) => group.label === null) : false,
    ).toBe(true);
    expect(
      process?.type === "MATRIX"
        ? process.groups.every((group) => group.rows.every((row) => row.standardValue === null))
        : false,
    ).toBe(true);
  });

  it("reproduces the printed letterhead", () => {
    // Stationery rather than a section: nothing is filled in on it, and the
    // PDF inlines the same file because it may not fetch anything.
    expect(form.letterhead?.asset).toBe("/templates/cut/letterhead.png");
    expect(form.letterhead?.alt).toContain("永進矽鋼");
    // No other transcription carries one.
    expect(warehouseLocationIntakeV1.letterhead).toBeUndefined();
  });

  it("requires nothing, stays free text, and admits no 員工", () => {
    const fields = form.sections.flatMap(sectionFields);
    expect(fields.every((field) => field.required === false)).toBe(true);
    expect(fields.every((field) => field.type === "TEXT")).toBe(true);
    expect(
      fields.every((field) => field.editableBy.includes("ORIGIN_ORDER_TAKER")),
    ).toBe(true);
    expect(fields.some((field) => field.editableBy.includes("ORIGIN_STAFF"))).toBe(
      false,
    );
  });

  it("rejects matrix widths that do not cover the row labels", () => {
    const process = form.sections.find((section) => section.type === "MATRIX");
    expect(() =>
      sheetTemplateDefinitionSchema.parse({
        ...form,
        sections: form.sections.map((section) =>
          section === process
            ? { ...section, columnWidthUnits: [1, 2, 3] }
            : section,
        ),
      }),
    ).toThrow(/columnWidthUnits/);
  });

  it("carries no field from the other CUT workbooks in the same folder", () => {
    // The folder also holds CUT客戶訂購表, CUT成品檢查表, two 生產日報表 and a
    // 首件巡迴檢驗單. None is confirmed, so none of their columns appear here.
    const labels = form.sections.flatMap((section) =>
      sectionFields(section).map((field) => field.label),
    );
    for (const foreign of ["巡迴", "外觀", "毛邊", "班別", "生產量"]) {
      expect(labels.some((label) => label.includes(foreign))).toBe(false);
    }
  });
});

describe("分條製令單 transcription", () => {
  const order = slittingProductionOrderV1;

  it("is approved, fingerprinted against the supplied document, and question-free", () => {
    expect(order).toMatchObject({
      status: "APPROVED",
      displayName: "分條製令單",
      documentCode: "F/P1-02-03",
      documentCodePosition: "BOTTOM_RIGHT",
      allowedCreatorKinds: ["MANAGER", "STAFF"],
      staffEditScope: "OWN_OR_ASSIGNED",
      workflow: { requiresReview: false, approvalRoles: [] },
    });
    expect(order.openQuestions).toEqual([]);
    expect(order.source.imageSha256).toMatch(/^[A-F0-9]{64}$/);
    expect(order.source.fileName).toBe("分條製令單.docx");
  });

  it("preserves version 1 and records explicit print metadata in version 2", () => {
    expect(order).not.toHaveProperty("printLayout");
    expect(order).not.toHaveProperty("headerLayout");
    expect(resolveTemplateHeaderLayout(order)).toBe("TITLE_ONLY");
    expect(resolveTemplatePrintLayout(order).orientation).toBe("LANDSCAPE");
    expect(slittingProductionOrderV2).toMatchObject({
      headerLayout: "TITLE_ONLY",
      printLayout: { paperSize: "A4", orientation: "LANDSCAPE", marginMm: 8 },
    });
  });

  it("uses 捲 throughout the record block, as confirmed", () => {
    const record = order.sections.find(
      (section) => section.type === "MATRIX" && section.key === "inspectionRecord",
    );
    const labels =
      record?.type === "MATRIX" ? record.columns.map((column) => column.label) : [];
    // The document prints 卷 for the first five columns; the user confirmed
    // 捲 is correct throughout, so the inconsistency is not reproduced.
    expect(labels).toEqual([
      "第1捲",
      "第2捲",
      "第3捲",
      "第4捲",
      "第5捲",
      "第6捲",
      "第7捲",
      "第8捲",
      "第9捲",
    ]);
  });

  it("keeps ten coils above and nine record columns, which is the form as printed", () => {
    const coils = order.sections.find(
      (section) => section.type === "MATRIX" && section.key === "coils",
    );
    const record = order.sections.find(
      (section) => section.type === "MATRIX" && section.key === "inspectionRecord",
    );
    expect(coils?.type === "MATRIX" ? coils.columns.length : 0).toBe(10);
    expect(record?.type === "MATRIX" ? record.columns.length : 0).toBe(9);
  });

  it("ends 入庫檢驗 with the printed blank line", () => {
    const record = order.sections.find(
      (section) => section.type === "MATRIX" && section.key === "inspectionRecord",
    );
    const warehouse =
      record?.type === "MATRIX"
        ? record.groups.find((group) => group.key === "warehouse")
        : undefined;
    expect(warehouse?.rows.at(-1)).toMatchObject({ label: "", standardValue: "" });
  });

  it("requires only 日期, 材料寬度 and 材料材質", () => {
    const required = order.sections
      .flatMap((section) => sectionFields(section))
      .filter((field) => field.required)
      .map((field) => field.key);
    expect(required.sort()).toEqual(["materialGrade", "materialWidth", "orderDate"]);
  });

  it("marks the two material cells as multi-line and leaves the rest single", () => {
    const multiline = order.sections
      .flatMap((section) => sectionFields(section))
      .filter((field) => field.multiline)
      .map((field) => field.key);
    expect(multiline.sort()).toEqual(["materialGrade", "materialWidth"]);
  });

  it("lays out 領料鋼捲號 as nine numbered blanks in a printed 3×4 grid", () => {
    const blanks = order.sections.find((section) => section.type === "NUMBERED_BLANKS");
    expect(blanks).toMatchObject({ count: 9, columns: 3, rows: 4 });
  });

  it("lays out 條料入庫 as nine parenthesised columns by nine rows", () => {
    const strip = order.sections.find(
      (section) => section.type === "NUMBERED_GRID" && section.key === "stripWarehousing",
    );
    expect(strip).toMatchObject({ columnCount: 9, rowCount: 9 });
    expect(strip?.type === "NUMBERED_GRID" ? strip.columnLabels?.[0] : null).toBe("（1）");
  });
});

describe("CUT 客戶訂購表 transcriptions", () => {
  const forms = [
    cutCustomerOrderV1,
    cutCustomerOrderDaYinV1,
    cutCustomerOrderShihlinV1,
  ];

  it.each(forms)(
    "$displayName is CUT-owned, review-free, and opened only by 主管 or 訂單人員",
    (form) => {
      expect(form).toMatchObject({
        status: "APPROVED",
        ownerDepartmentCode: "CUT",
        allowedCreatorDepartmentCodes: ["CUT"],
        allowedCreatorKinds: ["MANAGER", "ORDER_TAKER"],
        allowedEditorKinds: ["MANAGER", "ORDER_TAKER"],
        staffEditScope: "ANY_IN_DEPARTMENT",
        printLayout: { paperSize: "A4", orientation: "PORTRAIT", marginMm: 8 },
        workflow: { requiresReview: false, approvalRoles: [] },
      });
      expect(form.source).toMatchObject({
        imageSha256:
          "2335C6241D8E962C30E69A41059D7160C4D85B02AB148003DEA68F4F872A0D29",
        fileName: "CUT客戶訂購表.xlsx",
      });
      expect(form.openQuestions).toEqual([]);
    },
  );

  it("gives the three forms names the picker can tell apart", () => {
    const names = forms.map((form) => form.displayName);
    expect(names).toEqual([
      "CUT客戶訂購表",
      "客戶訂購表（大銀·直得）",
      "CUT客戶訂單表（士電）",
    ]);
    expect(new Set(names).size).toBe(3);
    expect(new Set(forms.map((form) => form.templateKey)).size).toBe(3);
  });

  it("leaves every cell optional, because these are registers filled row by row", () => {
    for (const form of forms) {
      const rows = form.sections[0];
      expect(rows?.type).toBe("FIXED_ROWS");
      if (rows?.type !== "FIXED_ROWS") return;
      expect(rows.rowRequirement).toBe("COMPLETE_IF_STARTED");
      expect(rows.minimumCompletedRows).toBe(0);
      // The paper numbers no rows on any of the three; the first printed
      // column is the form's own, so no number gutter is drawn.
      expect(rows.rowNumbers).toBe(false);
      expect(rows.columns.every((column) => !column.required)).toBe(true);
      expect(rows.columns.every((column) => !column.reviewed)).toBe(true);
      expect(rows.columns.every((column) => column.type === "TEXT")).toBe(true);
      expect(rows.columnWidthUnits).toHaveLength(rows.columns.length);
    }
  });

  it("keeps each worksheet's own headings, row count and column proportions", () => {
    const generic = cutCustomerOrderV1.sections[0];
    expect(generic?.type === "FIXED_ROWS" ? generic.rowCount : 0).toBe(25);
    expect(
      generic?.type === "FIXED_ROWS"
        ? generic.columns.map((column) => column.label)
        : [],
    ).toEqual([
      "訂貨日",
      "客戶",
      "品名/規格",
      "數量",
      "單價",
      "交期",
      "備註",
      "訂號/工單號",
    ]);
    expect(
      generic?.type === "FIXED_ROWS" ? generic.columnWidthUnits : [],
    ).toEqual([8.38, 10.13, 25, 6.25, 7.5, 4.75, 17.75, 19.5]);

    const daYin = cutCustomerOrderDaYinV1.sections[0];
    // The worksheet hides rows 19–27; the printed form is sixteen rows.
    expect(daYin?.type === "FIXED_ROWS" ? daYin.rowCount : 0).toBe(16);
    expect(
      daYin?.type === "FIXED_ROWS"
        ? daYin.columns.map((column) => column.label)
        : [],
    ).toEqual([
      "日期",
      "採購單號/工單號",
      "品號/品名/規格",
      "模具編號/圖號",
      "數量PCS",
      "單價",
      "總金額",
      "旭日期",
      "出貨日期",
      "入帳年/月",
      "備註",
    ]);
    expect(daYin?.type === "FIXED_ROWS" ? daYin.columnWidthUnits : []).toEqual([
      6.75, 12.63, 21.13, 20.38, 9.5, 9.5, 10.25, 7.88, 7.88, 7.88, 8.5,
    ]);

    const shihlin = cutCustomerOrderShihlinV1.sections[0];
    expect(shihlin?.type === "FIXED_ROWS" ? shihlin.rowCount : 0).toBe(21);
    expect(
      shihlin?.type === "FIXED_ROWS"
        ? shihlin.columns.map((column) => column.label)
        : [],
    ).toEqual([
      "訂日",
      "訂購案號",
      "出貨日期",
      "品名",
      "數量",
      "標籤",
      "交期",
      "備註",
      "日期/發票號碼",
      // The worksheet's own gap, then the weight block beyond the form.
      "",
      "單顆重量",
      "總重",
    ]);
    expect(
      shihlin?.type === "FIXED_ROWS" ? shihlin.columnWidthUnits : [],
    ).toEqual([
      3.63, 17.5, 2.13, 27.25, 5.25, 2.5, 4.38, 15.5, 14.25, 2, 6.13, 5,
    ]);
  });

  it("prints each form's own identifier, and none where the paper prints none", () => {
    expect(resolveDocumentIdentifier(cutCustomerOrderV1)).toBe(
      "文件編號：F/P5-07-01",
    );
    // 大銀.直得 carries no document code. Borrowing a neighbour's would print
    // a claim the form does not make.
    expect(cutCustomerOrderDaYinV1.documentLabel).toBeUndefined();
    expect(cutCustomerOrderDaYinV1.documentCode).toBeUndefined();
    expect(resolveDocumentIdentifier(cutCustomerOrderDaYinV1)).toBeNull();
    // 士電 prints its identifier above the grid rather than below it.
    expect(cutCustomerOrderShihlinV1.documentCodePosition).toBe("TOP_RIGHT");
    expect(cutCustomerOrderShihlinV1.headerLayout).toBe("DATE_TITLE_DOCUMENT");
    expect(resolveDocumentIdentifier(cutCustomerOrderShihlinV1)).toBe(
      "文件編號：F/P5-07-01",
    );
  });

  it("rules the date cells the paper rules corner to corner", () => {
    const diagonal = (form: (typeof forms)[number]) => {
      const rows = form.sections[0];
      return rows?.type === "FIXED_ROWS"
        ? rows.columns.filter((column) => column.diagonalSplit).map((c) => c.label)
        : [];
    };
    expect(diagonal(cutCustomerOrderV1)).toEqual(["訂貨日"]);
    expect(diagonal(cutCustomerOrderDaYinV1)).toEqual([
      "日期",
      "旭日期",
      "出貨日期",
      "入帳年/月",
    ]);
    // 士電 rules none of its cells this way.
    expect(diagonal(cutCustomerOrderShihlinV1)).toEqual([]);
  });

  it("prints 士電's customer name where the paper prints it", () => {
    expect(cutCustomerOrderShihlinV1.headerNote).toBe("士林電機");
    // The register belongs to one customer and says so on its face; the
    // other two are general and print no such mark.
    expect(cutCustomerOrderV1.headerNote).toBeUndefined();
    expect(cutCustomerOrderDaYinV1.headerNote).toBeUndefined();
  });

  it("fills the cells the worksheets fill, in the worksheets' own colours", () => {
    const daYin = cutCustomerOrderDaYinV1.sections[0];
    if (daYin?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    // The whole heading row is grey, and 單價 alone is yellow down the page.
    expect(daYin.columns.every((column) => column.headingFill === "#d9d9d9")).toBe(true);
    expect(
      daYin.columns.filter((c) => c.cellFill).map((c) => [c.label, c.cellFill]),
    ).toEqual([["單價", "#ffff00"]]);

    const shihlin = cutCustomerOrderShihlinV1.sections[0];
    if (shihlin?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    expect(
      shihlin.columns.filter((c) => c.headingFill).map((c) => c.label),
    ).toEqual(["單顆重量", "總重"]);

    // CUT fills nothing.
    const generic = cutCustomerOrderV1.sections[0];
    if (generic?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    expect(generic.columns.some((c) => c.headingFill || c.cellFill)).toBe(false);
  });

  it("prints 士電's weight block outside the form, past a ruled gap", () => {
    const rows = cutCustomerOrderShihlinV1.sections[0];
    if (rows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    const spacers = rows.columns.filter((column) => column.spacer);
    expect(spacers).toHaveLength(1);
    // A spacer prints nothing and holds nothing.
    expect(spacers[0]?.label).toBe("");
    expect(spacers[0]?.computed).toBeUndefined();
    // It sits between the nine ruled columns and the two weight ones.
    expect(rows.columns.map((column) => column.spacer)).toEqual([
      ...Array.from({ length: 9 }, () => false),
      true,
      false,
      false,
    ]);
    expect(rows.columnWidthUnits).toHaveLength(rows.columns.length);
  });

  it("works 總重 out from the row rather than asking for it", () => {
    const rows = cutCustomerOrderShihlinV1.sections[0];
    if (rows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    const total = rows.columns.find((column) => column.label === "總重");
    expect(total?.computed).toEqual({
      kind: "PRODUCT_ROUNDED_UP",
      factors: ["quantity", "unitWeight"],
    });

    const of = (row: Record<string, string>) =>
      resolveComputedValue(total!.computed!, (key) => row[key]);
    // The worksheet's own first row: 60 x 2.09 is 125.4, and it prints 126.
    expect(of({ quantity: "60", unitWeight: "2.09" })).toBe("126");
    expect(of({ quantity: "10", unitWeight: "2" })).toBe("20");
    // Excel treats a blank factor as zero, and so does this.
    expect(of({ unitWeight: "3.35" })).toBe("0");
    // An untouched row stays blank: the worksheet only shows 0 the length of
    // the page because the formula was dragged down it.
    expect(of({})).toBe("");
    expect(of({ quantity: "abc", unitWeight: "2" })).toBe("");
  });

  it("refuses a computed cell that names a column the section has not got", () => {
    const rows = cutCustomerOrderShihlinV1.sections[0];
    if (rows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    expect(() =>
      sheetTemplateDefinitionSchema.parse({
        ...cutCustomerOrderShihlinV1,
        sections: [
          {
            ...rows,
            columns: rows.columns.map((column) =>
              column.computed
                ? {
                    ...column,
                    computed: { ...column.computed, factors: ["quantity", "nope"] },
                  }
                : column,
            ),
          },
        ],
      }),
    ).toThrow(/computed factor nope/u);
  });

  it("carries none of the supplied workbook's live customer data", () => {
    // The 士電 worksheet arrived holding real 士林電機 orders. Only the
    // printed structure was transcribed, so none of it may appear here.
    const serialised = JSON.stringify(forms);
    // 士林電機 is not among them: the paper prints the customer's name on its
    // face, so reproducing it is transcription, not data.
    // 單顆重量 and 總重 are not among them either: the paper prints both as
    // headings of the weight block, so reproducing them is transcription.
    for (const leaked of ["DEMO-ORDER-A", "DEMO-PART-A", "DEMO-ORDER-B", "DEMO-PART-B"]) {
      expect(serialised).not.toContain(leaked);
    }
  });
});

describe("生產作業看板 transcription", () => {
  const form = cutProductionBoardV1;
  const rows = form.sections[0];

  it("is CUT-owned, review-free and fingerprinted to the supplied workbook", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "生產作業看板",
      ownerDepartmentCode: "CUT",
      allowedCreatorDepartmentCodes: ["CUT"],
      workflow: { requiresReview: false, approvalRoles: [] },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "81E8B8EEA58B7389853A6B7CAC7E989BB32CBDC3DC804CC6A196EAC99365B900",
      fileName: "生產作業看板(CUT).xlsx",
    });
    expect(form.openQuestions).toEqual([]);
  });

  it("prints on A4 landscape with its identifier below the grid", () => {
    // The worksheet is set to landscape and fitted to one page wide.
    expect(form.printLayout).toEqual({
      paperSize: "A4",
      orientation: "LANDSCAPE",
      marginMm: 8,
    });
    expect(resolveDocumentIdentifier(form)).toBe("文件編號：F/P5-01-01");
    expect(form.documentCodePosition).toBe("BELOW_GRID_RIGHT");
  });

  it("keeps the worksheet's seven headings, eight rows and proportions", () => {
    if (rows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    expect(rows.columns.map((column) => column.label)).toEqual([
      "工單號",
      "規格",
      "材質",
      "數量",
      "工序",
      "交期",
      "備註",
    ]);
    expect(rows.rowCount).toBe(8);
    // Its first column is 工單號, so it numbers nothing.
    expect(rows.rowNumbers).toBe(false);
    expect(rows.columnWidthUnits).toEqual([12, 16, 12, 15, 25, 12, 25]);
    expect(rows.columns.every((column) => !column.required)).toBe(true);
  });

  it("closes on the 工序 legend exactly as the worksheet prints it", () => {
    if (rows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    expect(rows.legend).toBe(
      "定義： 捲繞 = (1)、油壓定型 = (2)、燒炖 = (3)、退模芯 = (4)、抽真空 = (5)、烘乾 = (6)、切割 = (7)、研磨 = (8)、包裝 = (9)",
    );
    // 工序 stays free text, as the paper leaves it: the legend explains the
    // codes, it does not constrain the cell.
    const process = rows.columns.find((column) => column.label === "工序");
    expect(process?.type).toBe("TEXT");
  });

  it("refuses an empty legend rather than printing a blank ruled band", () => {
    if (rows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    expect(() =>
      sheetTemplateDefinitionSchema.parse({
        ...form,
        sections: [{ ...rows, legend: "   " }],
      }),
    ).toThrow();
  });
});

describe("CUT daily report transcriptions", () => {
  const personal = cutPersonalDailyReportV1;
  const team = cutDailyReportV1;
  const personalRows = personal.sections[1];
  const teamRows = team.sections[1];

  it("are CUT-owned, review-free and fingerprinted to the one supplied workbook", () => {
    for (const form of [personal, team]) {
      expect(form).toMatchObject({
        status: "APPROVED",
        ownerDepartmentCode: "CUT",
        allowedCreatorDepartmentCodes: ["CUT"],
        workflow: { requiresReview: false, approvalRoles: [] },
        headerLayout: "TITLE_FIELDS_RIGHT",
      });
      expect(form.source).toMatchObject({
        imageSha256:
          "3CB75CF8BC7B7FA59988D717F20191C2B617F33C39030974EE809D2C4A41B782",
        fileName: "生產日報表(CUT).xls",
      });
      expect(form.openQuestions).toEqual([]);
    }
    expect(personal.displayName).toBe("CUT個人生產日報表");
    expect(team.displayName).toBe("CUT生產日報表");
  });

  it("prints 個人生產日報表 as the worksheet sets it", () => {
    const header = personal.sections[0];
    if (header?.type !== "FIELDS") throw new Error("expected FIELDS");
    // 姓名 over 日期, beside the title.
    expect(header.fields.map((field) => [field.label, field.type])).toEqual([
      ["姓名", "TEXT"],
      ["日期", "DATE"],
    ]);
    if (personalRows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    expect(personalRows.columns.map((column) => column.label)).toEqual([
      "工作代號",
      "工作內容",
      "數量",
      "時間",
      "備註",
    ]);
    expect(personalRows.rowCount).toBe(6);
    expect(personalRows.rowNumbers).toBe(false);
    expect(personalRows.columnWidthUnits).toEqual([9, 48.63, 9.75, 9, 20.13]);
    // The 工作代號 key, on the worksheet's two lines, from the left.
    expect(personalRows.legend).toBe(
      "工作代號:\n1.捲繞 2.油壓定型 3.退模芯 4.抽真空 5.上膠 6.退爐 7.切割 8.研磨 9.包裝 10.其他",
    );
    expect(personalRows.legendAlign).toBe("START");
    expect(resolveDocumentIdentifier(personal)).toBe("文件編號：F/P5-04-01");
    expect(personal.documentCodePosition).toBe("BELOW_GRID_RIGHT");
  });

  it("prints 生產日報表 as eight people of eight rows, four to a page", () => {
    if (teamRows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    expect(teamRows.columns.map((column) => column.label)).toEqual([
      "姓名",
      "工作內容",
      "數量",
      "時間",
      "備註",
    ]);
    expect(teamRows.rowCount).toBe(64);
    expect(teamRows.rowGroups).toEqual({
      size: 8,
      spanningColumnKey: "name",
      numbered: true,
      numberWidthUnits: 2.25,
      perPage: 4,
    });
    // The worksheet's employee names are not part of the form.
    expect(JSON.stringify(team)).not.toMatch(/粘靜鴻|王家威|蔡佩珉|阿松|拉朋|巴迪|宋福/);
    const signatures = team.sections[2];
    if (signatures?.type !== "FIELDS") throw new Error("expected FIELDS");
    expect(signatures.fields.map((field) => field.label)).toEqual(["經理", "組長"]);
    // It prints no document identifier.
    expect(resolveDocumentIdentifier(team)).toBeNull();
  });

  it("hides the spanning column on every row of a block but its first", () => {
    if (teamRows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    expect(isRowGroupContinuation(teamRows, 0, "name")).toBe(false);
    expect(isRowGroupContinuation(teamRows, 1, "name")).toBe(true);
    expect(isRowGroupContinuation(teamRows, 7, "name")).toBe(true);
    expect(isRowGroupContinuation(teamRows, 8, "name")).toBe(false);
    expect(isRowGroupContinuation(teamRows, 9, "workContent")).toBe(false);
    if (personalRows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    expect(isRowGroupContinuation(personalRows, 3, "workCode")).toBe(false);
  });

  it("refuses row groups that do not fit their rows or columns", () => {
    if (teamRows?.type !== "FIXED_ROWS" || !teamRows.rowGroups) {
      throw new Error("expected grouped FIXED_ROWS");
    }
    const withRows = (rows: Record<string, unknown>) =>
      sheetTemplateDefinitionSchema.safeParse({
        ...team,
        sections: [team.sections[0], { ...teamRows, ...rows }, team.sections[2]],
      }).success;
    expect(withRows({})).toBe(true);
    // Not a whole number of blocks.
    expect(withRows({ rowCount: 60 })).toBe(false);
    // The spanning cell must lead the row.
    expect(withRows({ rowGroups: { ...teamRows.rowGroups, spanningColumnKey: "note" } })).toBe(false);
    // A block numbers itself; rows are not numbered as well.
    expect(withRows({ rowNumbers: true })).toBe(false);
    // A page break needs a second page to break to.
    expect(withRows({ rowGroups: { ...teamRows.rowGroups, perPage: 8 } })).toBe(false);
    // A legend alignment needs a legend.
    expect(withRows({ legendAlign: "START" })).toBe(false);
  });
});

// CUT成品檢查表 version 2 (the user, 2026-10-02).
describe("CUT成品檢查表 version 2", () => {
  const particulars = (form: typeof cutFinishedInspectionV2) => {
    const section = form.sections[1]!;
    if (section.type !== "FIELDS") throw new Error("particulars");
    return section;
  };

  it("lays the particulars on the document's six columns", () => {
    const section = particulars(cutFinishedInspectionV2);
    expect(section.fieldGrid).toEqual([7.85, 11.06, 12.6, 9, 4.76, 10.55]);
    // The column each label starts in, row by row, as the document rules them.
    const starts = resolveFieldRows(section).map((fields) => {
      let column = 0;
      return Object.fromEntries(
        fields.map((field) => {
          const start = column + 1;
          column += field.gridSpan!.label + field.gridSpan!.value;
          return [field.label, start];
        }),
      );
    });
    expect(starts).toEqual([
      { 客戶名: 1, 規格: 3 },
      { 材質: 1, 數量: 3, 日期: 5 },
      { 檢查工具: 1, 游標卡尺: 2, 審查員: 3, 判定: 5 },
    ]);
    // 規格's box runs to the right edge, as the document merges it.
    expect(section.fields.find((field) => field.key === "specification")!.gridSpan).toEqual({
      label: 1,
      value: 3,
    });
  });

  it("changes nothing but the layout, and leaves version 1 as published", () => {
    const strip = (form: typeof cutFinishedInspectionV2) =>
      JSON.stringify({
        ...form,
        sections: form.sections.map((section) =>
          section.type === "FIELDS"
            ? {
                ...section,
                fieldGrid: undefined,
                fields: section.fields.map(({ gridSpan: _span, ...field }) => field),
              }
            : section,
        ),
      });
    expect(strip(cutFinishedInspectionV2)).toBe(strip(cutFinishedInspectionV1));
    expect(particulars(cutFinishedInspectionV1).fieldGrid).toBeUndefined();
  });
});

describe("CUT成品檢查表 transcription", () => {
  const form = cutFinishedInspectionV1;
  const [header, particulars, dimensions, reference] = form.sections;

  it("is CUT-owned, review-free and fingerprinted to the supplied document", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "CUT成品檢查表",
      ownerDepartmentCode: "CUT",
      allowedCreatorDepartmentCodes: ["CUT"],
      workflow: { requiresReview: false, approvalRoles: [] },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "D6018AF484A1C8F4251F36700DE39A581FD3CB401C258538532873BC6C1A3403",
      fileName: "CUT成品檢查表.doc",
    });
    expect(resolveDocumentIdentifier(form)).toBe("文件編號：F/P5-02-02");
    // The document's own letterhead, with the current 新北市 address.
    expect(form.letterhead?.asset).toBe("/templates/cut/finished-inspection-letterhead.png");
    expect(form.letterhead?.alt).toContain("新北市土城區");
  });

  it("prints its particulars as the document rules them", () => {
    if (header?.type !== "FIELDS" || particulars?.type !== "FIELDS") {
      throw new Error("expected FIELDS");
    }
    expect(header.fields.map((field) => field.label)).toEqual(["工單號"]);
    expect(resolveFieldRows(particulars).map((row) => row.map((field) => field.label))).toEqual([
      ["客戶名", "規格"],
      ["材質", "數量", "日期"],
      ["檢查工具", "游標卡尺", "審查員", "判定"],
    ]);
    // 游標卡尺 is printed, not written; 判定 is ticked, OK or NG.
    const byLabel = new Map(particulars.fields.map((field) => [field.label, field]));
    expect(byLabel.get("檢查工具")?.printedOnly).toBe(true);
    expect(byLabel.get("游標卡尺")?.printedOnly).toBe(true);
    expect(byLabel.get("判定")?.choices).toEqual(["OK", "NG"]);
  });

  it("keeps the 外觀尺寸 register's headings, corner cell and proportions", () => {
    if (dimensions?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    expect(dimensions.caption).toEqual({ text: "外觀尺寸", note: "單位: mm" });
    expect(dimensions.cornerCell).toEqual({ across: "尺寸", down: "序號" });
    expect(dimensions.columns.map((column) => column.label)).toEqual([
      "檢查項次",
      "A",
      "B(Di)",
      "C(Do)",
      "D",
      "備註",
    ]);
    expect(dimensions.rowCount).toBe(9);
    expect(dimensions.columnWidthUnits).toEqual([81, 90, 90, 99, 90, 108]);
    // The corner is printed; every other cell is written.
    expect(isWrittenRowCell(dimensions, 0, "item")).toBe(false);
    expect(isWrittenRowCell(dimensions, 0, "a")).toBe(true);
    expect(isWrittenRowCell(dimensions, 1, "item")).toBe(true);
  });

  it("closes on the core views beside the 公差 table exactly as printed", () => {
    if (reference?.type !== "REFERENCE_BAND" || !reference.table) {
      throw new Error("expected REFERENCE_BAND with a table");
    }
    expect(reference.drawing?.asset).toBe("/templates/cut/finished-inspection-cores.svg");
    expect(reference.table.corner).toEqual({ across: "公差", down: "mm" });
    expect(reference.table.columns).toEqual([
      { label: "A", note: "積厚" },
      { label: "B", note: "內徑" },
      { label: "C", note: "外徑" },
      { label: "D", note: "高度" },
    ]);
    expect(reference.table.rows.map((row) => [row.label, ...row.values])).toEqual([
      ["6~25≦", "±0.5", "±0.5", "±0.5", "+0.4"],
      ["25~50≦", "±0.5", "±0.5", "±0.5", "+0.5"],
      ["50~75≦", "±0.8", "±1.0", "±0.75", "+0.5"],
      ["75~100≦", "±0.8", "±1.0", "±1.0", "+1.0"],
      ["100~150≦", "±1.2", "±1.5", "±1.3", "+1.0"],
      ["150~200≦", "±1.5", "±1.5", "±1.5", "+1.0"],
      ["200 ＞", "±1.5", "±2", "±2", "+1.0"],
    ]);
  });

  it("refuses boxes to tick on a date, and a reference row that is short", () => {
    if (dimensions?.type !== "FIXED_ROWS" || reference?.type !== "REFERENCE_BAND") {
      throw new Error("unexpected shape");
    }
    const withSections = (sections: unknown[]) =>
      sheetTemplateDefinitionSchema.safeParse({ ...form, sections }).success;
    expect(withSections([header, particulars, dimensions, reference])).toBe(true);
    const ticked = {
      ...dimensions,
      columns: dimensions.columns.map((column, index) =>
        index === 5 ? { ...column, type: "DATE", choices: ["OK", "NG"] } : column,
      ),
    };
    expect(withSections([header, particulars, ticked, reference])).toBe(false);
    const short = {
      ...reference,
      table: { ...reference.table!, rows: [{ label: "6~25≦", values: ["±0.5"] }] },
    };
    expect(withSections([header, particulars, dimensions, short])).toBe(false);
    // A corner cell and row groups both claim the first column.
    const both = {
      ...dimensions,
      rowGroups: { size: 3, spanningColumnKey: "item", numbered: false },
    };
    expect(withSections([header, particulars, both, reference])).toBe(false);
  });

  it("prints boxes to tick with the ticked one filled", () => {
    expect(formatChoices(["OK", "NG"], "OK")).toBe("■OK □NG");
    expect(formatChoices(["OK", "NG"], "")).toBe("□OK □NG");
  });
});

// Version 2 of the four lays each header on its worksheet's columns (the
// user, 2026-10-02).
describe("CUT 特性檢驗報告單 version 2 headers", () => {
  type Form = typeof cutCharacteristicInspectionV2;
  const particulars = (form: Form) => {
    const section = form.sections.find((s) => s.type === "FIELDS" && s.key === "particulars");
    if (section?.type !== "FIELDS") throw new Error("particulars");
    return section;
  };
  // The grid column (1-based) each printed box starts in, row by row.
  const starts = (form: Form) =>
    resolveFieldRows(particulars(form)).map((fields) => {
      let column = 0;
      return Object.fromEntries(
        fieldBoxes(fields).map((parts) => {
          const start = column + 1;
          column += parts[0]!.gridSpan!.label + parts[0]!.gridSpan!.value;
          return [parts[0]!.label, start];
        }),
      );
    });
  const pairs: [Form, Form][] = [
    [cutCharacteristicInspectionV1, cutCharacteristicInspectionV2],
    [cutCharacteristicInspectionSongmaoV1, cutCharacteristicInspectionSongmaoV2],
    [cutFactoryInspectionChiaoliV1, cutFactoryInspectionChiaoliV2],
    [cutCharacteristicInspectionShintaiV1, cutCharacteristicInspectionShintaiV2],
  ];

  it("lines CUT's and 崧貿's headers up on columns A–G", () => {
    const rows = [
      { 工單號: 1 },
      { 品名: 1, 規格: 3, 材質: 6 },
      { 電壓: 1, 頻率: 3, 匝數: 6 },
    ];
    expect(particulars(cutCharacteristicInspectionV2).fieldGrid).toEqual([
      7.88, 16.5, 14.38, 14.38, 13.5, 13.5, 13.88,
    ]);
    expect(starts(cutCharacteristicInspectionV2)).toEqual([{ 客戶: 1, 日期: 5 }, ...rows]);
    expect(starts(cutCharacteristicInspectionSongmaoV2)).toEqual([
      { 客戶: 1, 崧貿: 2, 日期: 5 },
      ...rows,
    ]);
  });

  it("sets the views beside 出貨數量, 抽樣數量 and 檢驗者, each box about column A wide", () => {
    for (const form of [cutCharacteristicInspectionV2, cutCharacteristicInspectionSongmaoV2]) {
      expect(form.sections.map((s) => s.key)).toEqual(["particulars", "tests", "closing"]);
      const closing = form.sections[2]!;
      if (closing.type !== "FIELDS") throw new Error("closing");
      expect(closing.fieldGrid).toEqual([7.88, 12.5, 73.64]);
      expect(closing.fields.map((field) => [field.label, field.unit, field.gridSpan])).toEqual([
        ["出貨數量", "PCS", { label: 1, value: 1 }],
        ["抽樣數量", "PCS", { label: 1, value: 1 }],
        ["檢驗者", undefined, { label: 1, value: 1 }],
      ]);
      expect(closing.asideDrawing).toMatchObject({
        asset: "/templates/cut/characteristic-views.svg",
        columns: 1,
        startRow: 1,
      });
    }
  });

  it("sets 信太's views beside 檢驗者 and 備註, under 出貨/檢驗數量 and the tolerance", () => {
    const keys = cutCharacteristicInspectionShintaiV2.sections.map((s) => s.key);
    expect(keys).toEqual(["particulars", "tests", "closing"]);
    const closing = cutCharacteristicInspectionShintaiV2.sections[2]!;
    if (closing.type !== "FIELDS") throw new Error("closing");
    expect(starts({ ...cutCharacteristicInspectionShintaiV2, sections: [{ ...closing, key: "particulars" }] })).toEqual([
      { "出貨/檢驗數量": 1, "尺寸容許差:C±1.0mm / B±1.0mm / D±0.5mm": 5 },
      { 檢驗者: 1 },
      { 備註: 1 },
    ]);
    expect(closing.asideDrawing).toMatchObject({
      asset: "/templates/cut/characteristic-views-toroid.svg",
      columns: 3,
      startRow: 2,
    });
  });

  it("lines 巧力's 電壓 and 匝數 up at A, and 品名 and 訂號 at C", () => {
    expect(starts(cutFactoryInspectionChiaoliV2)).toEqual([
      { "1.電壓": 1, 頻率: 3, 品名: 5 },
      { 匝數: 1, 訂號: 5 },
    ]);
  });

  it("lines 信太's header up on columns A–H, each pair of readings in one box", () => {
    const section = particulars(cutCharacteristicInspectionShintaiV2);
    const rows = starts(cutCharacteristicInspectionShintaiV2);
    expect(rows.slice(0, 3)).toEqual([
      { 客戶: 1, 信太: 2, 訂購單號: 3, 檢驗日期: 7 },
      { 品名: 1, 環型鐵心: 2, 規格: 3, 材質: 7 },
      { 頻率: 1, 匝數: 3, 客戶單號: 7 },
    ]);
    expect(Object.values(rows[3]!)).toEqual([1, 4, 6]);
    const boxes = fieldBoxes(resolveFieldRows(section)[3]!).map((parts) => parts.map((f) => f.key));
    expect(boxes).toEqual([["voltage1", "voltage2"], ["voltageNote"], ["currentMax", "currentMin"]]);
    const byKey = new Map(section.fields.map((field) => [field.key, field]));
    expect(byKey.get("voltage2")).toMatchObject({ prefix: "/", unit: "V", accessibleLabel: "電壓(2)" });
    expect(byKey.get("currentMin")).toMatchObject({ prefix: "/", unit: "mA", accessibleLabel: "電流(1)最小值" });
  });

  it("keeps every field and the register, and leaves version 1 as published", () => {
    const fieldKeys = (form: Form) =>
      form.sections.flatMap((s) => (s.type === "FIELDS" ? s.fields.map((field) => field.key) : []));
    for (const [first, second] of pairs) {
      const { sections: v2Sections, ...v2 } = second;
      const { sections: v1Sections, ...v1 } = first;
      expect(v2).toEqual(v1);
      // The register is untouched; only the bands around it are laid out anew.
      expect(v2Sections.filter((s) => s.type === "FIXED_ROWS")).toEqual(
        v1Sections.filter((s) => s.type === "FIXED_ROWS"),
      );
      expect(fieldKeys(second)).toEqual(fieldKeys(first));
      expect(particulars(second).fields.map((field) => field.key)).toEqual(
        particulars(first).fields.map((field) => field.key),
      );
      expect(particulars(first).fieldGrid).toBeUndefined();
    }
  });
});

describe("CUT 特性檢驗報告單 transcriptions", () => {
  const base = cutCharacteristicInspectionV1;
  const songmao = cutCharacteristicInspectionSongmaoV1;
  const chiaoli = cutFactoryInspectionChiaoliV1;
  const shintai = cutCharacteristicInspectionShintaiV1;
  const rowsOf = (form: typeof base) => {
    const rows = form.sections.find((section) => section.type === "FIXED_ROWS");
    if (rows?.type !== "FIXED_ROWS") throw new Error("expected FIXED_ROWS");
    return rows;
  };

  it("are four CUT forms, review-free, from the one supplied workbook", () => {
    for (const form of [base, songmao, chiaoli, shintai]) {
      expect(form).toMatchObject({
        status: "APPROVED",
        ownerDepartmentCode: "CUT",
        allowedCreatorDepartmentCodes: ["CUT"],
        workflow: { requiresReview: false, approvalRoles: [] },
      });
      expect(form.source).toMatchObject({
        imageSha256:
          "BCF3EDB75098ADA1B655A531435F1A474E0826E10B74DC8175BF0E837F480BEE",
        fileName: "特性檢驗表.xls",
      });
    }
    expect([base, songmao, chiaoli, shintai].map((form) => form.displayName)).toEqual([
      "特性檢驗報告單",
      "特性檢驗報告單（崧貿）",
      "出廠檢驗單（巧力）",
      "特性檢驗報告單（信太）",
    ]);
    // Three carry 加工製令單's letterhead; 巧力's addresses its customer instead.
    expect(base.letterhead?.asset).toBe("/templates/cut/letterhead.png");
    expect(chiaoli.letterhead).toBeUndefined();
    expect(resolveDocumentIdentifier(chiaoli)).toBeNull();
    expect(resolveDocumentIdentifier(shintai)).toBe("文件編號：F/P5-03-01");
  });

  it("writes the standard under each letter on the base form, and numbers nothing", () => {
    const rows = rowsOf(base);
    expect(rows.standardRow).toEqual({
      label: "標準值",
      corner: { across: "標準值", down: "測試值" },
      ruled: false,
    });
    expect(rows.rowCount).toBe(16);
    expect(rows.columns.map((column) => [column.label, column.unit ?? ""])).toEqual([
      ["測試值", ""],
      ["A", ""],
      ["B", ""],
      ["C", ""],
      ["D", ""],
      ["電流", "mA"],
      ["鐵損", "W"],
    ]);
    // The corner covers the standard row's first cell; the tests below are
    // counted from 1.
    expect(isWrittenRowCell(rows, 0, "sample")).toBe(false);
    expect(isWrittenRowCell(rows, 0, "a")).toBe(true);
    expect(isWrittenRowCell(rows, 1, "sample")).toBe(true);
    expect(describeRow(rows, 0)).toBe("標準值");
    expect(describeRow(rows, 1)).toBe("第 1 列");
    expect(describeRow(rows, 15)).toBe("第 15 列");
  });

  it("rules 崧貿's standard off and numbers its tests 1 to 15", () => {
    const rows = rowsOf(songmao);
    expect(rows.standardRow).toMatchObject({ corner: { across: "位置", down: "標準值" }, ruled: true });
    expect(rows.rowNumbers).toBe(true);
    // The corner stands in the number column, so it covers no data cell.
    expect(isWrittenRowCell(rows, 0, "a")).toBe(true);
    expect(printedRowNumber(rows, 1)).toBe(1);
    expect(printedRowNumber(rows, 15)).toBe(15);
    const particulars = songmao.sections[0];
    if (particulars?.type !== "FIELDS") throw new Error("expected FIELDS");
    expect(particulars.fields.slice(0, 2).map((field) => [field.label, field.printedOnly])).toEqual([
      ["客戶", true],
      ["崧貿", true],
    ]);
  });

  it("prints 巧力's ten readings as two blocks under its printed heading lines", () => {
    const rows = rowsOf(chiaoli);
    expect(rows.blocks).toEqual({ count: 2, gapUnits: 6.13 });
    expect(rows.rowCount).toBe(10);
    expect(rows.rowNumberLabel).toBe("序");
    expect(chiaoli.headerLines).toEqual([
      { text: "TO: 採購部　Tel:(03)346-6655　fax:(03)346-7835", placement: "ABOVE", align: "START" },
      { text: "永進矽鋼(股)公司", placement: "ABOVE", align: "CENTER" },
      { text: "客戶: 巧力工業股份有限公司", placement: "BELOW", align: "CENTER" },
    ]);
  });

  it("carries 信太's printed values, paired readings, ticks and red marks", () => {
    const particulars = shintai.sections[0];
    if (particulars?.type !== "FIELDS") throw new Error("expected FIELDS");
    const byKey = new Map(particulars.fields.map((field) => [field.key, field]));
    expect(byKey.get("customer")).toMatchObject({ label: "信太", printedOnly: true });
    expect(byKey.get("product")).toMatchObject({ label: "環型鐵心", printedOnly: true });
    expect(byKey.get("customerOrderNo")?.prefix).toBe("B");
    expect(byKey.get("inspectionDate")?.labelColor).toBe("#ff0000");
    expect(byKey.get("voltage2")).toMatchObject({ label: "/", accessibleLabel: "電壓(2)", unit: "V" });
    expect(byKey.get("currentMin")).toMatchObject({ label: "/", accessibleLabel: "電流(1)最小值", unit: "mA" });
    const check = rowsOf(shintai).columns.find((column) => column.key === "check");
    expect(check).toMatchObject({ choices: ["合格", "不合格"], choicesSeparator: " / " });
    expect(shintai.footerNote).toEqual({ text: "VER 2.0", color: "#ff0000" });
    expect(formatChoices(["合格", "不合格"], "不合格", " / ")).toBe("□合格 / ■不合格");
  });

  it("refuses shapes that cannot be printed", () => {
    const rows = rowsOf(base);
    const withRows = (form: typeof base, next: Record<string, unknown>) =>
      sheetTemplateDefinitionSchema.safeParse({
        ...form,
        sections: form.sections.map((section) =>
          section.type === "FIXED_ROWS" ? { ...section, ...next } : section,
        ),
      }).success;
    expect(withRows(base, {})).toBe(true);
    // A standard row and side-by-side blocks both reshape the register.
    expect(withRows(base, { blocks: { count: 2 } })).toBe(false);
    // Blocks must divide the rows evenly.
    expect(withRows(chiaoli, { rowCount: 9 })).toBe(false);
    // A standard row needs tests below it.
    expect(withRows(base, { rowCount: 1 })).toBe(false);
    // A separator only means something between boxes to tick.
    expect(
      withRows(base, {
        columns: rows.columns.map((column, index) =>
          index === 1 ? { ...column, choicesSeparator: " / " } : column,
        ),
      }),
    ).toBe(false);
    // A reference band prints something.
    expect(
      sheetTemplateDefinitionSchema.safeParse({
        ...base,
        sections: base.sections.map((section) =>
          section.type === "REFERENCE_BAND" ? { type: "REFERENCE_BAND", key: "views", label: "空" } : section,
        ),
      }).success,
    ).toBe(false);
  });
});

describe("不良率統計表 transcription", () => {
  const form = cutDefectRateV1;
  const [header, rows] = form.sections;

  it("is CUT-owned, review-free and fingerprinted to the supplied workbook", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "不良率統計表",
      ownerDepartmentCode: "CUT",
      allowedCreatorDepartmentCodes: ["CUT"],
      workflow: { requiresReview: false, approvalRoles: [] },
      headerLayout: "DATE_TITLE_DOCUMENT",
      documentCodePosition: "TOP_RIGHT",
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "44249A28F12105F56EA3F1C77692A8B3736904CF29A134AE27B6ED62326F17BB",
      fileName: "不良率統計表(空白).xlsx",
    });
    expect(resolveDocumentIdentifier(form)).toBe("文件編號：F/P5-09-02");
    expect(form.letterhead?.asset).toBe("/templates/cut/letterhead.png");
  });

  it("keeps the blank worksheet's month, headings, rows and proportions", () => {
    if (header?.type !== "FIELDS" || rows?.type !== "FIXED_ROWS") {
      throw new Error("unexpected shape");
    }
    expect(header.fields.map((field) => [field.label, field.type])).toEqual([["月份", "TEXT"]]);
    expect(rows.columns.map((column) => column.label)).toEqual([
      "工單號",
      "訂單數",
      "成品數",
      "不良數",
      "單顆重量",
      "良品總重",
      "不良重量",
    ]);
    expect(rows.rowCount).toBe(21);
    expect(rows.rowNumbers).toBe(false);
    expect(rows.columnWidthUnits).toEqual([16, 12, 12, 12, 12, 16, 12]);
    // The blank carries no formulas, and the worked example is not seeded.
    expect(rows.columns.every((column) => !column.computed)).toBe(true);
    expect(JSON.stringify(form)).not.toContain("DEMO-ORDER-C");
  });
});

describe("isWritableField", () => {
  it("is false for printed text, computed cells and spacers only", () => {
    expect(isWritableField({})).toBe(true);
    expect(isWritableField({ printedOnly: true })).toBe(false);
    expect(isWritableField({ spacer: true })).toBe(false);
    expect(
      isWritableField({ computed: { kind: "PRODUCT_ROUNDED_UP", factors: ["a", "b"] } }),
    ).toBe(false);
  });
});

describe("退火明細表 transcription", () => {
  const form = cutAnnealingListV1;

  it("is written in CUT, sent on to 燒頓, and never reviewed", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "退火明細表",
      ownerDepartmentCode: "CUT",
      allowedCreatorDepartmentCodes: ["CUT"],
      workflow: {
        requiresReview: false,
        approvalRoles: [],
        destinationDepartmentCode: "SHAO_DUN",
        avoidSelfHandoff: true,
      },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "6D3469A8DA4366D979D8CA1C3B47088782538301BFAA7A2C2A209452501576C8",
      fileName: "退火明細表.xlsx",
    });
    expect(resolveDocumentIdentifier(form)).toBe("文件編號：F/P5-06-03");
    expect(form.printLayout?.orientation).toBe("LANDSCAPE");
    // The same 新北市 letterhead as 成品檢查表.
    expect(form.letterhead).toEqual(cutFinishedInspectionV1.letterhead);
  });

  it("keeps the worksheet's particulars and its two edge-to-edge blocks", () => {
    const [firing, orders, signatures] = form.sections;
    if (firing?.type !== "FIELDS" || orders?.type !== "FIXED_ROWS" || signatures?.type !== "FIELDS") {
      throw new Error("unexpected shape");
    }
    expect(resolveFieldRows(firing).map((row) => row.map((field) => field.label))).toEqual([
      ["待燒日期", "編號", "起始時間"],
      ["退火日期", "爐號", "溫度"],
      ["完程日期", "程式編號", "外觀檢驗"],
    ]);
    const program = firing.fields.find((field) => field.key === "programNo");
    expect(program).toMatchObject({ prefix: "第", unit: "程式" });
    expect(firing.fields.find((field) => field.key === "appearance")?.choices).toEqual(["合格", "不合格"]);
    expect(orders.blocks).toEqual({ count: 2 });
    expect(orders.rowCount).toBe(18);
    expect(orders.columnWidthUnits).toEqual([2, 3, 2, 1, 1]);
    expect(signatures.fields.map((field) => field.label)).toEqual(["燒炖者", "填表人"]);
  });
});

// 退火明細表 version 2 (the user, 2026-10-02).
describe("退火明細表 version 2", () => {
  const firing = (form: typeof cutAnnealingListV2) => {
    const section = form.sections[0]!;
    if (section.type !== "FIELDS") throw new Error("particulars");
    return section;
  };

  it("lines the particulars up on three equal columns of label and box", () => {
    const section = firing(cutAnnealingListV2);
    expect(section.fieldGrid).toEqual([8, 25, 8, 25, 8, 26]);
    const rows = resolveFieldRows(section).map(fieldBoxes);
    expect(rows.map((boxes) => boxes.map((parts) => parts[0]!.label))).toEqual([
      ["待燒日期", "編號", "起始時間"],
      ["退火日期", "爐號", "溫度"],
      ["完程日期", "程式編號", "外觀檢驗"],
    ]);
    // Every label and box takes one column, so 編號, 爐號 and 程式編號 share
    // theirs, as do 起始時間, 溫度 and 外觀檢驗.
    for (const parts of rows.flat()) expect(parts[0]!.gridSpan).toEqual({ label: 1, value: 1 });
  });

  it("writes 程式編號 in three boxes: before 第, between, and after 程式", () => {
    const program = fieldBoxes(resolveFieldRows(firing(cutAnnealingListV2))[2]!)[1]!;
    expect(program.map((field) => field.key)).toEqual(["programBefore", "programNo", "programAfter"]);
    expect(program[1]).toMatchObject({ prefix: "第", unit: "程式" });
    expect(program.map((field) => field.accessibleLabel ?? field.label)).toEqual([
      "程式編號（第之前）",
      "程式編號（第幾程式）",
      "程式編號（程式之後）",
    ]);
  });

  it("changes nothing else, and leaves version 1 as published", () => {
    const { sections: v2Sections, ...v2 } = cutAnnealingListV2;
    const { sections: v1Sections, ...v1 } = cutAnnealingListV1;
    expect(v2).toEqual(v1);
    expect(v2Sections.slice(1)).toEqual(v1Sections.slice(1));
    expect(firing(cutAnnealingListV1).fieldGrid).toBeUndefined();
    expect(firing(cutAnnealingListV1).fields.some((field) => field.joinNext)).toBe(false);
  });

  it("refuses a shared box holding anything but plain write-on values", () => {
    const section = firing(cutAnnealingListV2);
    const broken = {
      ...cutAnnealingListV2,
      sections: [
        {
          ...section,
          fields: section.fields.map((field) =>
            field.key === "programAfter" ? { ...field, choices: ["合格", "不合格"] } : field,
          ),
        },
        ...cutAnnealingListV2.sections.slice(1),
      ],
    };
    expect(() => sheetTemplateDefinitionSchema.parse(broken)).toThrow(
      /programNo joins a plain write-on field/,
    );
  });
});

describe("燒炖質量記錄表 transcription", () => {
  const form = cutFiringQualityRecordV1;

  it("is written in CUT or 沖壓, sent on to 燒頓, and never reviewed", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "燒炖質量記錄表",
      ownerDepartmentCode: "CUT",
      allowedCreatorDepartmentCodes: ["CUT", "STAMPING"],
      headerLayout: "TITLE_ONLY",
      workflow: {
        requiresReview: false,
        approvalRoles: [],
        destinationDepartmentCode: "SHAO_DUN",
        avoidSelfHandoff: true,
      },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "04A94424DBA5ABF5EC61DFBFE2C7B1049FA3247E676FA204A8F0A9B3ECCF46C2",
      fileName: "燒炖質量記錄表.xls",
    });
    expect(resolveDocumentIdentifier(form)).toBe("文件編號：F/P4-01-02");
    expect(form.documentCodePosition).toBe("BELOW_GRID_RIGHT");
    expect(form.printLayout).toMatchObject({ paperSize: "A4", orientation: "LANDSCAPE" });
    expect(form.letterhead).toBeUndefined();
  });

  it("keeps the worksheet's twelve headings, broken where the paper breaks them", () => {
    const [rows] = form.sections;
    if (rows?.type !== "FIXED_ROWS" || form.sections.length !== 1) {
      throw new Error("unexpected shape");
    }
    expect(rows.rowNumbers).toBe(false);
    expect(rows.rowCount).toBe(10);
    expect(rows.columnWidthUnits).toEqual([12, 8, 10, 18, 32, 8, 8, 8, 8, 8, 8, 8.38]);
    expect(rows.columns.map((column) => column.label)).toEqual([
      "工單號",
      "日期",
      "客戶\n簡稱",
      "規格/材質",
      "數量",
      "爐號/\n胆號",
      "燒炖\n時間",
      "燒炖\n溫度",
      "掀蓋\n溫度",
      "外觀\n色澤",
      "備註",
      "裝箱日/\n時間",
    ]);
    // A heading broken for the paper is still one name to a screen reader.
    for (const column of rows.columns) {
      expect(column.accessibleLabel ?? column.label).not.toContain("\n");
    }
    expect(rows.columns.every((column) => column.type === "TEXT" && !column.required)).toBe(true);
  });
});

describe("待燒入庫表 transcription", () => {
  const form = stampingFiringIntakeV1;

  it("is 沖壓's, sent on to 燒頓, and never reviewed", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "待燒入庫表",
      ownerDepartmentCode: "STAMPING",
      allowedCreatorDepartmentCodes: ["STAMPING"],
      headerLayout: "TITLE_ONLY",
      workflow: {
        requiresReview: false,
        approvalRoles: [],
        destinationDepartmentCode: "SHAO_DUN",
        avoidSelfHandoff: true,
      },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "F8A6E55CC2B05A0D2C1EDBDEF1B5EDA0B71D8444C1989DE99CD22C089A7A6966",
      fileName: "待燒入庫表.xls",
    });
    expect(resolveDocumentIdentifier(form)).toBe("文件編號：F/P4-02-01");
    expect(form.documentCodePosition).toBe("BELOW_GRID_RIGHT");
    expect(form.printLayout).toMatchObject({ paperSize: "A4", orientation: "PORTRAIT" });
  });

  it("numbers its twenty-five rows under 序, beside the four written columns", () => {
    const [rows] = form.sections;
    if (rows?.type !== "FIXED_ROWS" || form.sections.length !== 1) {
      throw new Error("unexpected shape");
    }
    expect(rows.rowNumbers).toBe(true);
    expect(rows.rowNumberLabel).toBe("序");
    expect(rows.rowNumberWidthUnits).toBe(4);
    expect(rows.rowCount).toBe(25);
    expect(rows.columnWidthUnits).toEqual([9.38, 20, 35, 25]);
    expect(rows.columns.map((column) => column.label)).toEqual([
      "入庫日",
      "規格/材質",
      "重量/箱數",
      "倉位/備註",
    ]);
    expect(rows.columns.every((column) => column.type === "TEXT" && !column.required)).toBe(true);
  });
});

describe("產品需求表 transcription", () => {
  const form = stampingProductDemandV1;

  it("is 沖壓's, kept in 沖壓, and never reviewed", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "產品需求表",
      ownerDepartmentCode: "STAMPING",
      allowedCreatorDepartmentCodes: ["STAMPING"],
      workflow: {
        requiresReview: false,
        approvalRoles: [],
        destinationDepartmentCode: "STAMPING",
      },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "41DBEADE51F7CE393FE75584933E214F101E630C7A875571CA87A19C8AA0A20F",
      fileName: "產品需求表.xls",
    });
    expect(resolveDocumentIdentifier(form)).toBe("文件編號：F/M1-03-01");
    // The current 新北市 stationery.
    expect(form.letterhead).toEqual(cutFinishedInspectionV1.letterhead);
  });

  it("keeps six headings over twenty-two rows, 交期 ticked or written after 其他", () => {
    const [rows] = form.sections;
    if (rows?.type !== "FIXED_ROWS" || form.sections.length !== 1) {
      throw new Error("unexpected shape");
    }
    expect(rows.rowNumbers).toBe(false);
    expect(rows.rowCount).toBe(22);
    expect(rows.columnWidthUnits).toEqual([11.13, 20, 12, 12, 25, 10.13]);
    expect(rows.columns.map((column) => column.label)).toEqual([
      "製令NO：",
      "規格",
      "材質",
      "數量",
      "交期",
      "備註",
    ]);
    expect(rows.columns[0]?.accessibleLabel).toBe("製令NO");
    expect(rows.columns[4]).toMatchObject({
      choices: ["庫存", "其他"],
      choicesSeparator: "",
      choiceWriteIn: "其他",
    });
  });
});

describe("a box followed by a line to write on", () => {
  it("reads a written value back into its box and its line", () => {
    expect(readChoice("其他：2/23", "其他")).toEqual({ choice: "其他", text: "2/23" });
    expect(readChoice("其他", "其他")).toEqual({ choice: "其他", text: "" });
    expect(readChoice("庫存", "其他")).toEqual({ choice: "庫存", text: "" });
    // Without a write-in box the whole value is the box.
    expect(readChoice("其他：2/23")).toEqual({ choice: "其他：2/23", text: "" });
  });

  it("accepts only nothing, a box, or the write-in box with its line", () => {
    const choices = ["庫存", "其他"];
    expect(isChoiceValue(choices, "", "其他")).toBe(true);
    expect(isChoiceValue(choices, "庫存", "其他")).toBe(true);
    expect(isChoiceValue(choices, "其他：2/23", "其他")).toBe(true);
    expect(isChoiceValue(choices, "庫存：2/23", "其他")).toBe(false);
    expect(isChoiceValue(choices, "2/23", "其他")).toBe(false);
    // A form without a write-in box never takes one.
    expect(isChoiceValue(choices, "其他：2/23")).toBe(false);
  });

  it("prints the colon after the write-in box whether or not it is ticked", () => {
    expect(formatChoices(["庫存", "其他"], "", "", "其他")).toBe("□庫存□其他：");
    expect(formatChoices(["庫存", "其他"], "庫存", "", "其他")).toBe("■庫存□其他：");
    expect(formatChoices(["庫存", "其他"], "其他：2/23", "", "其他")).toBe("□庫存■其他：2/23");
  });

  it("must name one of the boxes", () => {
    const broken = structuredClone(stampingProductDemandV1) as unknown as {
      sections: { columns: { choiceWriteIn?: string }[] }[];
    };
    broken.sections[0]!.columns[4]!.choiceWriteIn = "外購";
    expect(sheetTemplateDefinitionSchema.safeParse(broken).success).toBe(false);
  });
});

describe("沖壓 生產作業看板 transcription", () => {
  const form = stampingProductionBoardV1;

  it("is 沖壓's, kept in 沖壓, and never reviewed", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "生產作業看板",
      ownerDepartmentCode: "STAMPING",
      allowedCreatorDepartmentCodes: ["STAMPING"],
      workflow: {
        requiresReview: false,
        approvalRoles: [],
        destinationDepartmentCode: "STAMPING",
      },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "F89FACBB61EF4F55D7EE5406D4A7A13863853A5ADB5110A0A0C14EBC8579C93C",
      fileName: "生產作業看板(沖壓).xlsx",
    });
    expect(resolveDocumentIdentifier(form)).toBe("文件編號：F/P2-09-01");
    expect(form.printLayout?.orientation).toBe("LANDSCAPE");
  });

  it("numbers twelve rows under 編號, the waiting job's 預計產量 named apart", () => {
    const [rows] = form.sections;
    if (rows?.type !== "FIXED_ROWS" || form.sections.length !== 1) {
      throw new Error("unexpected shape");
    }
    expect(rows.rowNumbers).toBe(true);
    expect(rows.rowNumberLabel).toBe("編號");
    expect(rows.rowCount).toBe(12);
    expect(rows.rowNumberWidthUnits).toBe(8.38);
    expect(rows.columnWidthUnits).toEqual([16, 8.38, 12, 8.38, 8.38, 8.38, 8.38, 20]);
    expect(rows.columns.map((column) => column.label)).toEqual([
      "規格材質", "日期", "預計產量", "待沖規格", "材質", "預計產量", "安裝日期", "備註",
    ]);
    // Every cell a screen reader announces is named once.
    const spoken = rows.columns.map((column) => column.accessibleLabel ?? column.label);
    expect(new Set(spoken).size).toBe(spoken.length);
  });
});

describe("沖壓 生產日報表 transcription", () => {
  const form = stampingDailyReportV1;
  const [header, jobs, back] = form.sections;
  if (header?.type !== "FIELDS" || jobs?.type !== "FIXED_ROWS" || back?.type !== "NUMBERED_BLANKS") {
    throw new Error("unexpected shape");
  }

  it("is 沖壓's, kept in 沖壓, and never reviewed", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "生產日報表",
      ownerDepartmentCode: "STAMPING",
      allowedCreatorDepartmentCodes: ["STAMPING"],
      workflow: { requiresReview: false, destinationDepartmentCode: "STAMPING" },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "B086B0C269A73B2DADB06666091F474F259C512ACA5BA283D86087B9141D9320",
      fileName: "生產日報表(沖壓).xlsx",
    });
    expect(resolveDocumentIdentifier(form)).toBe("文件編號：F/P2-10-01");
    expect(form.footerNote?.text).toBe(
      "PS.請將撕下之材料標纖貼在日報表背面，於下班後交回，謝謝大家的合作。",
    );
    expect(form.letterhead).toEqual(cutFinishedInspectionV1.letterhead);
  });

  it("prints 上班 as five boxes, 請假 with its hours written after", () => {
    const shift = header.fields.find((field) => field.key === "shift");
    expect(shift?.choices).toEqual(["未加班", "有加班", "假日加班3小時", "假日加班6小時", "請假"]);
    expect(
      formatChoices(shift!.choices!, "請假：4", shift!.choicesSeparator, shift!.choiceWriteIn, {
        separator: shift!.choiceWriteInSeparator,
        unit: shift!.choiceWriteInUnit,
      }),
    ).toBe("□未加班 □有加班 □假日加班3小時 □假日加班6小時 ■請假 4H");
  });

  it("prints fourteen cells over eighteen values, under two-row headings", () => {
    const cells = printedCells(jobs);
    expect(cells).toHaveLength(14);
    expect(jobs.columnWidthUnits).toHaveLength(14);
    expect(
      cells.filter((cell) => cell.layout).map((cell) => `${cell.columns.map((c) => c.key).join("+")}:${cell.layout}`),
    ).toEqual([
      "eBoxWeight+eBoxCount:INLINE",
      "iBoxWeight+iBoxCount:INLINE",
      "cGradeE+cGradeI:STACKED",
      "dGradeE+dGradeI:STACKED",
    ]);
    const [first, second] = headingRows(jobs);
    expect(first!.map((heading) => [heading.label, heading.cells, heading.rows])).toEqual([
      ["工單號", 1, 2],
      ["起訖時間", 1, 2],
      ["規格/\n材質", 1, 2],
      ["材料\n重量", 1, 2],
      ["箱重/箱數", 2, 2],
      ["N品", 1, 2],
      ["待燒", 1, 2],
      ["太陽日", 1, 2],
      ["次日續\n沖重量", 1, 2],
      ["不良品", 3, 1],
      ["異常原\n因備註", 1, 2],
    ]);
    expect(second!.map((heading) => heading.label)).toEqual(["C級", "D級", "報廢"]);
    // Every box is announced once, whole.
    const spoken = jobs.columns.map((column) => column.accessibleLabel ?? column.label);
    expect(new Set(spoken).size).toBe(spoken.length);
    expect(spoken.every((name) => !name.includes("\n"))).toBe(true);
  });

  it("keeps twelve spaces on the back, numbered down each column", () => {
    expect(back).toMatchObject({ count: 12, columns: 2, rows: 6, order: "DOWN", printedOnBack: true });
  });
});

describe("shared cells and heading groups", () => {
  const base = structuredClone(stampingDailyReportV1) as unknown as {
    sections: { columns?: Record<string, unknown>[]; headingGroups?: unknown[]; columnWidthUnits?: number[] }[];
  };

  it("needs one width per printed cell", () => {
    const broken = structuredClone(base);
    broken.sections[1]!.columnWidthUnits = Array.from({ length: 18 }, () => 1);
    expect(sheetTemplateDefinitionSchema.safeParse(broken).success).toBe(false);
  });

  it("joins only plain write-on boxes", () => {
    const broken = structuredClone(base);
    broken.sections[1]!.columns![5]!.choices = ["A", "B"];
    expect(sheetTemplateDefinitionSchema.safeParse(broken).success).toBe(false);
  });

  it("groups headings over whole printed cells", () => {
    const broken = structuredClone(base);
    // Starts inside the E cell.
    broken.sections[1]!.headingGroups = [
      { label: "箱數", columnKeys: ["eBoxCount", "iBoxWeight"], subheadings: false },
    ];
    expect(sheetTemplateDefinitionSchema.safeParse(broken).success).toBe(false);
  });
});

describe("首件/巡迴檢驗單 transcription", () => {
  const form = cutPatrolInspectionV1;
  const [job, firstPiece, rounds, tolerance, closing] = form.sections;
  if (
    job?.type !== "FIELDS" ||
    firstPiece?.type !== "MATRIX" ||
    rounds?.type !== "MATRIX" ||
    tolerance?.type !== "REFERENCE_BAND" ||
    closing?.type !== "FIELDS"
  ) {
    throw new Error("unexpected shape");
  }

  it("is CUT's, kept in CUT, and never reviewed", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "首件/巡迴檢驗單",
      ownerDepartmentCode: "CUT",
      allowedCreatorDepartmentCodes: ["CUT"],
      workflow: { requiresReview: false, destinationDepartmentCode: "CUT" },
    });
    expect(form.source).toMatchObject({
      imageSha256:
        "4BB1FDB5B7491A25A472A69A7D37879F7036B4F524CAC2E6B5E8923507B84E4F",
      fileName: "CUT-首件巡迴檢驗單.xlsx",
    });
    expect(resolveDocumentIdentifier(form)).toBe("文件編號：F/Q1-08-07");
    // The older 台北縣 stationery, as the worksheet carries it.
    expect(form.letterhead).toEqual(cutProcessingOrderV1.letterhead);
    expect(form.headerLines?.map((line) => [line.text, line.placement, line.align])).toEqual([
      ["單位：mm", "BOTTOM", "START"],
      ["判定: ✓合格 ✗不合格", "BOTTOM", "END"],
    ]);
  });

  it("prints 首件檢驗 with 檢測值 over three readings, ticks across them, and ✓/✗", () => {
    expect(isPrintedMatrix(firstPiece)).toBe(true);
    expect(firstPiece.columnWidthUnits).toHaveLength(matrixWidthSlots(firstPiece));
    expect(firstPiece.columns.find((column) => column.headingSpan)).toMatchObject({
      heading: "檢測值",
      headingSpan: 3,
    });
    const rows = firstPiece.groups.flatMap((group) => group.rows);
    expect(rows.map((row) => row.label)).toEqual([
      "A", "B1", "B2", "C1", "C2", "D", "E", "龜裂", "有無", "變形", "油壓", "浸漆", "烘箱",
    ]);
    const crack = rows.find((row) => row.key === "crack")!;
    // Ticked once across 標準 and the readings, and judged on its own.
    expect(matrixWrittenColumns(firstPiece, crack).map((column) => column.key)).toEqual([
      "standard",
      "verdict",
    ]);
    expect(rows.find((row) => row.key === "hydraulic")?.prefix).toBe("大於90PSI");
    expect(rows.find((row) => row.key === "oven")?.choices).toEqual(["是", "否"]);
    expect(firstPiece.aside).toMatchObject({
      field: { label: "類型", choices: ["C型", "環型"] },
      note: "※環形只檢驗:捲繞.尺寸及有無變形",
    });
  });

  it("heads each 製程 round with when it was checked", () => {
    expect(rounds.columns.map((column) => column.label)).toEqual([
      "第1次", "第2次", "第3次", "第4次", "第5次", "第6次",
    ]);
    expect(rounds.headingEntry?.parts.map((part) => part.unit)).toEqual(["日", "時", "分"]);
    expect(rounds.cornerCell).toEqual({ across: "檢驗時間", down: "品質特性" });
    const verdict = rounds.groups.at(-1)!;
    expect(verdict.label).toBeNull();
    expect(verdict.rows[0]?.choices).toEqual(["NG", "OK"]);
  });

  it("keeps the 公差 table as printed, 鋼捲號 beside it", () => {
    expect(tolerance.table?.rows.map((row) => row.label)).toEqual([
      "6～25≦", "25～50≦", "50～75≦", "75～100≦", "100～150≦", "150～200≦", "200＞",
    ]);
    expect(tolerance.table?.rows[2]?.values).toEqual(["±0.8", "±1.0", "±0.75", "±0.5"]);
    expect(tolerance.entry).toMatchObject({ key: "coilNumbers", label: "鋼捲號", multiline: true });
  });
});

describe("printed matrices", () => {
  const base = structuredClone(cutPatrolInspectionV1) as unknown as {
    sections: Record<string, unknown>[];
  };

  it("need a width for every printed column", () => {
    const broken = structuredClone(base);
    (broken.sections[1] as { columnWidthUnits: number[] }).columnWidthUnits = [1, 1, 1, 1, 1, 1];
    expect(sheetTemplateDefinitionSchema.safeParse(broken).success).toBe(false);
  });

  it("span adjacent columns only", () => {
    const broken = structuredClone(base);
    const section = broken.sections[1] as { groups: { rows: { spanColumns?: string[] }[] }[] };
    section.groups[1]!.rows[1]!.spanColumns = ["standard", "verdict"];
    expect(sheetTemplateDefinitionSchema.safeParse(broken).success).toBe(false);
  });

  it("leave every earlier matrix in its own layout", () => {
    expect(isPrintedMatrix(cutProcessingOrderV1.sections.find((section) => section.type === "MATRIX") as never)).toBe(false);
  });
});

describe("沖壓・平板剪 首件/巡迴檢驗單 transcription", () => {
  const form = stampingPatrolInspectionV1;
  const [job, firstPiece, rounds, packing, abnormal, judgement, closing] = form.sections;
  if (
    job?.type !== "FIELDS" ||
    firstPiece?.type !== "MATRIX" ||
    rounds?.type !== "MATRIX" ||
    packing?.type !== "FIELDS" ||
    abnormal?.type !== "FIELDS" ||
    judgement?.type !== "FIELDS" ||
    closing?.type !== "FIELDS"
  ) {
    throw new Error("unexpected shape");
  }

  it("is written by 沖壓 and 平板剪, each keeping its own, and never reviewed", () => {
    expect(form).toMatchObject({
      status: "APPROVED",
      displayName: "首件/巡迴檢驗單",
      ownerDepartmentCode: "STAMPING",
      allowedCreatorDepartmentCodes: ["STAMPING", "FLAT_SHEAR"],
      workflow: { requiresReview: false, staysInOrigin: true },
    });
    expect(form.source).toMatchObject({
      imageSha256: "6236C96AFDF3E2EF06E8E545230BC16068542E1788C90E9BF006747D2739F8D8",
      fileName: "EI+平板剪-首件巡迴檢驗單.xlsx",
    });
    expect(resolveDocumentIdentifier(form)).toBe("文件編號：F/Q1-01-03");
    expect(form.letterhead?.asset).toBe("/templates/stamping/patrol-inspection-letterhead.png");
  });

  it("prints 公差 beside a written 標準, and 積厚's mm", () => {
    expect(firstPiece.columnWidthUnits).toHaveLength(matrixWidthSlots(firstPiece));
    const rows = firstPiece.groups.flatMap((group) => group.rows);
    expect(rows.map((row) => row.label)).toEqual([
      "A", "K", "D", "N", "積厚", "", "孔徑∮Ho", "毛刺≦0.02mm", "板形", "料厚", "劃傷", "壓印", "鏽斑", "角度",
    ]);
    expect(rows.slice(0, 7).map((row) => row.standardValue)).toEqual([
      "≦0.1", "±0.1", "±0.1", "±0.1", "±1", null, "±0.1",
    ]);
    const a = rows[0]!;
    // 公差 is printed, so nothing is written there.
    expect(matrixRowCells(firstPiece, a).map((cell) => [cell.column.key, cell.printed])).toEqual([
      ["standard", false], ["tolerance", true], ["reading1", false], ["reading2", false], ["verdict", false],
    ]);
    expect(matrixWrittenColumns(firstPiece, a).map((column) => column.key)).toEqual([
      "standard", "reading1", "reading2", "verdict",
    ]);
    expect(rows.find((row) => row.key === "stack")?.cellUnits).toEqual({ standard: "mm" });
  });

  it("ticks 外觀 once across the readings and leaves 判定 to be written", () => {
    const scratch = firstPiece.groups.flatMap((group) => group.rows).find((row) => row.key === "scratch")!;
    const [spanned, verdict] = matrixWrittenColumns(firstPiece, scratch);
    expect(spanned?.key).toBe("standard");
    expect(matrixCellChoices(spanned!, scratch)).toEqual(["有", "無"]);
    expect(matrixCellChoices(verdict!, scratch)).toBeUndefined();
    expect(firstPiece.aside).toMatchObject({
      field: { label: "類型", choices: ["剪片", "EI"] },
      note: "尺寸公差：±0.1mm",
    });
  });

  it("writes each round's 製令單號 and 規格 above its time", () => {
    expect(rounds.groups[0]).toMatchObject({ key: "order", aboveHeading: true });
    expect(rounds.groups[0]?.rows.map((row) => row.label)).toEqual(["製令單號", "規格"]);
    expect(rounds.cornerCell).toEqual({ across: "檢驗時間", down: "質量特性" });
    const stack = rounds.groups.flatMap((group) => group.rows).find((row) => row.key === "stack")!;
    expect(Object.values(stack.cellUnits ?? {})).toEqual(["mm", "mm", "mm", "mm", "mm", "mm"]);
    // A round's 有/無 spans nothing, so it ticks in every round.
    const rust = rounds.groups.flatMap((group) => group.rows).find((row) => row.key === "rust")!;
    expect(rounds.columns.map((column) => matrixCellChoices(column, rust))).toEqual(
      Array(6).fill(["有", "無"]),
    );
  });

  it("closes with 重量 標識 包裝外觀, 異常描述, 品質判定 and 備註 審核", () => {
    expect(packing.fields.map((field) => field.label)).toEqual(["重量", "標識", "包裝外觀"]);
    expect(abnormal.fields.map((field) => field.label)).toEqual(["異常描述－材料", "異常描述－成品", "主管裁示"]);
    expect(judgement.fields[0]).toMatchObject({ label: "品質判定", choices: ["合格", "不合格"] });
    expect(closing.fields.map((field) => field.label)).toEqual(["備註", "審核"]);
  });
});

// 士電's 品名 is written on two lines (the user, 2026-10-02).
describe("CUT客戶訂單表（士電） version 2", () => {
  const rows = (form: typeof cutCustomerOrderShihlinV2) => {
    const section = form.sections[0]!;
    if (section.type !== "FIXED_ROWS") throw new Error("register");
    return section;
  };

  it("opens 品名 two lines tall and changes nothing else", () => {
    const name = rows(cutCustomerOrderShihlinV2).columns.find((column) => column.key === "productName")!;
    expect(name).toMatchObject({ label: "品名", multiline: true, lines: 2 });
    const strip = (form: typeof cutCustomerOrderShihlinV2) =>
      JSON.stringify(
        rows(form).columns.map(({ multiline: _multiline, lines: _lines, ...column }) => column),
      );
    expect(strip(cutCustomerOrderShihlinV2)).toBe(strip(cutCustomerOrderShihlinV1));
    expect(rows(cutCustomerOrderShihlinV1).columns.find((column) => column.key === "productName")).toMatchObject({
      multiline: false,
    });
  });

  it("refuses lines on a cell that is not multi-line", () => {
    const section = rows(cutCustomerOrderShihlinV2);
    const broken = {
      ...cutCustomerOrderShihlinV2,
      sections: [
        {
          ...section,
          columns: section.columns.map((column) =>
            column.key === "productName" ? { ...column, multiline: false } : column,
          ),
        },
        ...cutCustomerOrderShihlinV2.sections.slice(1),
      ],
    };
    expect(() => sheetTemplateDefinitionSchema.parse(broken)).toThrow(/lines on productName needs multiline/);
  });
});

// The header on the worksheet's own columns (the user, 2026-10-02).
describe("加工製令單 version 2 header grid", () => {
  const header = (form: typeof cutProcessingOrderV2) => {
    const section = form.sections[0]!;
    if (section.type !== "FIELDS") throw new Error("header");
    return section;
  };

  it("keeps version 1 as it was published", () => {
    expect(header(cutProcessingOrderV1).fieldGrid).toBeUndefined();
    expect(header(cutProcessingOrderV1).fields.some((field) => field.gridSpan)).toBe(false);
  });

  it("changes nothing but the header layout", () => {
    const strip = (form: typeof cutProcessingOrderV2) =>
      JSON.stringify({
        ...form,
        sections: form.sections.map((section) =>
          section.type === "FIELDS"
            ? { ...section, fieldGrid: undefined, fields: section.fields.map(({ gridSpan: _span, ...field }) => field) }
            : section,
        ),
      });
    expect(strip(cutProcessingOrderV2)).toBe(strip(cutProcessingOrderV1));
  });

  it("lays every row on the worksheet's ten columns, A to J", () => {
    const section = header(cutProcessingOrderV2);
    expect(section.fieldGrid).toEqual([3.25, 6.25, 14.63, 11.5, 9.88, 10.63, 8.75, 9.25, 7.25, 9.75]);
    // The column each label starts in, row by row, as the paper rules them.
    const starts = resolveFieldRows(section).map((fields) => {
      let column = 0;
      return Object.fromEntries(
        fields.map((field) => {
          const start = "ABCDEFGHIJ"[column]!;
          column += field.gridSpan!.label + field.gridSpan!.value;
          return [field.label, start];
        }),
      );
    });
    expect(starts).toEqual([
      { 客戶: "A", 客戶訂號: "D", 訂貨日: "G", 交期: "I" },
      { 鐵芯尺寸: "A", 訂購數量: "F", 預重單重: "H", KG: "J" },
      { 材質: "A", 捲繞壓力: "F", 約耗材總重: "H", KG: "J" },
      { 鋼捲號: "A", 領料重量: "F" },
      { 備註: "A" },
      { 退火編號: "A", 製令單交給生產部: "F", 工單號: "H" },
    ]);
    // The left labels all take A–B, so their boxes start together at C.
    for (const label of ["客戶", "鐵芯尺寸", "材質", "鋼捲號", "備註", "退火編號"]) {
      expect(section.fields.find((field) => field.label === label)!.gridSpan!.label).toBe(2);
    }
  });

  it("refuses a row that does not fill the columns, and a span without a grid", () => {
    const section = header(cutProcessingOrderV2);
    const broken = {
      ...cutProcessingOrderV2,
      sections: [
        { ...section, fields: section.fields.map((field) => (field.key === "note" ? { ...field, gridSpan: { label: 2, value: 7 } } : field)) },
        ...cutProcessingOrderV2.sections.slice(1),
      ],
    };
    expect(() => sheetTemplateDefinitionSchema.parse(broken)).toThrow(/row 5 takes 9 of 10 columns/);
    const loose = {
      ...cutProcessingOrderV2,
      sections: [{ ...section, fieldGrid: undefined }, ...cutProcessingOrderV2.sections.slice(1)],
    };
    expect(() => sheetTemplateDefinitionSchema.parse(loose)).toThrow(/gridSpan and asideDrawing need a fieldGrid/);
  });
});

// 裁剪需求表 version 2 lays its header on the document's columns (the user,
// 2026-10-02).
describe("裁剪需求表 version 2 header grid", () => {
  const header = (form: typeof flatShearCuttingRequestV2) => {
    const section = form.sections[0]!;
    if (section.type !== "FIELDS") throw new Error("header");
    return section;
  };
  // Each label's left edge and each box's width, in the document's points.
  const layout = (form: typeof flatShearCuttingRequestV2) => {
    const section = header(form);
    const edges = [0];
    for (const width of section.fieldGrid!) edges.push(edges.at(-1)! + width);
    return resolveFieldRows(section).map((fields) => {
      let column = 0;
      return fields.map((field) => {
        const left = edges[column]!;
        column += field.gridSpan!.label;
        const boxStart = edges[column]!;
        column += field.gridSpan!.value;
        return [field.label, Math.round(left * 10) / 10, Math.round((edges[column]! - boxStart) * 10) / 10];
      });
    });
  };

  it("reproduces the Word table's cells", () => {
    expect(layout(flatShearCuttingRequestV2)).toEqual([
      [["訂購日期", 0, 121.5], ["客戶名稱", 183.2, 113.6], ["交期", 359.5, 127.6]],
      [["工單號", 0, 92], ["材質", 153.7, 84.9], ["變壓器容量", 288.8, 64.3], ["積厚", 423.8, 71.1]],
      [["綁柱長度", 0, 92], ["台數", 153.7, 84.9], ["機台", 288.8, 64.3], ["作業員", 423.8, 71.1]],
    ]);
  });

  it("prints the 產品規格 row above the register's headings", () => {
    const products = flatShearCuttingRequestV2.sections.find((section) => section.key === "products");
    expect(products?.type === "FIXED_ROWS" && products.caption).toEqual({ text: "產品規格" });
  });

  it("changes nothing else, and leaves version 1 as published", () => {
    const strip = (form: typeof flatShearCuttingRequestV2) =>
      JSON.stringify({
        ...form,
        sections: form.sections.map((section) =>
          section.type === "FIELDS"
            ? { ...section, fieldGrid: undefined, fields: section.fields.map(({ gridSpan: _span, ...field }) => field) }
            : section.type === "FIXED_ROWS"
              ? { ...section, caption: undefined }
              : section,
        ),
      });
    expect(strip(flatShearCuttingRequestV2)).toBe(strip(flatShearCuttingRequestV1));
    expect(header(flatShearCuttingRequestV1).fieldGrid).toBeUndefined();
    const v1Products = flatShearCuttingRequestV1.sections.find((section) => section.key === "products");
    expect(v1Products?.type === "FIXED_ROWS" && v1Products.caption).toBeUndefined();
  });
});
