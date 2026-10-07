import "./load-env.js";
import { assertLocalDemoDatabase } from "./demo-target.js";
import argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import {
  departmentSeeds,
  resolveTemplateHeaderLayout,
  resolveTemplatePrintLayout,
  resolveDocumentIdentifier,
  sheetTemplateDefinitionSchema,
} from "@workflow/contracts";
import { createDatabase } from "../client.js";
import {
  departments,
  roleAssignments,
  sheetTemplates,
  sheetTemplateVersions,
  users,
} from "../schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
assertLocalDemoDatabase(databaseUrl, process.env.NODE_ENV, true);

const connection = createDatabase(databaseUrl, 1);

/** One stored version of a template, found by department, slug and number. */
async function templateVersion(
  departmentCode: string,
  slug: string,
  version: number,
) {
  const [row] = await connection.db
    .select({
      displayName: sheetTemplates.displayName,
      active: sheetTemplates.active,
      currentVersionNumber: sheetTemplates.currentVersionNumber,
      publishedAt: sheetTemplateVersions.publishedAt,
      requiresReview: sheetTemplateVersions.requiresReview,
      definition: sheetTemplateVersions.definition,
    })
    .from(sheetTemplates)
    .innerJoin(departments, eq(departments.id, sheetTemplates.departmentId))
    .innerJoin(
      sheetTemplateVersions,
      eq(sheetTemplateVersions.templateId, sheetTemplates.id),
    )
    .where(
      and(
        eq(departments.code, departmentCode),
        eq(sheetTemplates.slug, slug),
        eq(sheetTemplateVersions.version, version),
      ),
    )
    .limit(1);
  return row;
}

/**
 * A template published once and never revised, that nobody reviews: active,
 * on version 1, published, and stored as needing no review. Returns the
 * parsed definition for the form-specific checks that follow.
 */
async function unreviewedTemplate(departmentCode: string, slug: string, name: string, version = 1) {
  const row = await templateVersion(departmentCode, slug, version);
  if (
    !row ||
    !row.active ||
    row.currentVersionNumber !== version ||
    row.publishedAt === null ||
    row.requiresReview
  ) {
    throw new Error(`${name} activation state verification failed`);
  }
  return sheetTemplateDefinitionSchema.parse(row.definition);
}

try {
  const [membershipPrimaryKey] = await connection.client<
    { definition: string }[]
  >`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conname = 'department_memberships_user_department_kind_pk'
      and contype = 'p'
  `;
  if (
    membershipPrimaryKey?.definition !==
    "PRIMARY KEY (user_id, department_id, kind)"
  ) {
    throw new Error("Department membership primary key verification failed");
  }

  const seededDepartments = await connection.db
    .select({ code: departments.code, displayName: departments.displayName })
    .from(departments)
    .where(eq(departments.active, true));

  for (const expected of departmentSeeds) {
    const actual = seededDepartments.find((row) => row.code === expected.code);
    if (!actual || actual.displayName !== expected.displayName) {
      throw new Error(`Department seed verification failed for ${expected.code}`);
    }
  }

  const [admin] = await connection.db
    .select({
      username: users.username,
      passwordHash: users.passwordHash,
      passwordWarning: users.passwordWarning,
    })
    .from(users)
    .innerJoin(
      roleAssignments,
      and(
        eq(roleAssignments.userId, users.id),
        eq(roleAssignments.role, "ADMIN"),
        eq(roleAssignments.active, true),
      ),
    )
    .where(eq(users.username, "admin"))
    .limit(1);

  if (!admin || !admin.passwordWarning) {
    throw new Error("Bootstrap administrator verification failed");
  }
  if (!(await argon2.verify(admin.passwordHash, "DemoOnly2026!"))) {
    throw new Error("Bootstrap administrator password verification failed");
  }

  const slittingTemplate = await templateVersion("SLITTING", "slitting-request", 1);
  if (
    !slittingTemplate ||
    !slittingTemplate.active ||
    slittingTemplate.currentVersionNumber !== 3 ||
    slittingTemplate.publishedAt === null
  ) {
    throw new Error("分條申請單 activation state verification failed");
  }
  const definition = sheetTemplateDefinitionSchema.parse(
    slittingTemplate.definition,
  );
  const storedRequestV1 = slittingTemplate.definition as Record<string, unknown>;
  if ("printLayout" in storedRequestV1 || "headerLayout" in storedRequestV1) {
    throw new Error("分條申請單 version 1 immutability verification failed");
  }
  if (
    definition.status !== "APPROVED" ||
    definition.openQuestions.length > 0 ||
    // 燒頓 is the one department that may not create this sheet.
    definition.allowedCreatorDepartmentCodes.includes("SHAO_DUN") ||
    !definition.workflow.requiresReview ||
    definition.workflow.destinationDepartmentCode !== "SLITTING" ||
    !definition.workflow.avoidSelfHandoff
  ) {
    throw new Error("分條申請單 definition verification failed");
  }

  const rowSection = definition.sections.find(
    (section) => section.type === "FIXED_ROWS",
  );
  if (
    rowSection?.type !== "FIXED_ROWS" ||
    rowSection.rowCount !== 8 ||
    rowSection.rowRequirement !== "COMPLETE_IF_STARTED" ||
    rowSection.minimumCompletedRows !== 1
  ) {
    throw new Error("分條申請單 row rule verification failed");
  }

  if (
    resolveTemplateHeaderLayout(definition) !== "DATE_TITLE_DOCUMENT" ||
    resolveTemplatePrintLayout(definition).orientation !== "LANDSCAPE"
  ) {
    throw new Error("分條申請單 legacy layout verification failed");
  }

  const slittingRequestV2 = await templateVersion("SLITTING", "slitting-request", 2);
  const requestV2Definition = sheetTemplateDefinitionSchema.parse(
    slittingRequestV2?.definition,
  );
  if (
    !slittingRequestV2?.publishedAt ||
    requestV2Definition.headerLayout !== "DATE_TITLE_DOCUMENT" ||
    requestV2Definition.printLayout?.orientation !== "LANDSCAPE" ||
    requestV2Definition.allowedCreatorKinds.join(",") !== "MANAGER" ||
    requestV2Definition.allowedSubmitterKinds.join(",") !== "MANAGER"
  ) {
    throw new Error("分條申請單 version 2 layout verification failed");
  }

  const slittingRequestV3 = await templateVersion("SLITTING", "slitting-request", 3);
  const requestV3Definition = sheetTemplateDefinitionSchema.parse(
    slittingRequestV3?.definition,
  );
  const requestV3Fields = requestV3Definition.sections.flatMap((section) =>
    section.type === "FIELDS"
      ? section.fields
      : section.type === "FIXED_ROWS"
        ? section.columns
        : [],
  );
  if (
    !slittingRequestV3?.publishedAt ||
    requestV3Definition.allowedCreatorKinds.join(",") !==
      "MANAGER,ORDER_TAKER" ||
    requestV3Definition.allowedEditorKinds?.join(",") !==
      "MANAGER,ORDER_TAKER" ||
    requestV3Definition.allowedSubmitterKinds.join(",") !==
      "MANAGER,ORDER_TAKER" ||
    requestV3Definition.staffEditScope !== "ANY_IN_DEPARTMENT" ||
    requestV3Definition.allowedCreatorDepartmentCodes.includes("SHAO_DUN") ||
    requestV3Fields.some(
      (field) =>
        field.editableBy.join(",") !==
        "ORIGIN_MANAGER,ORIGIN_ORDER_TAKER",
    )
  ) {
    throw new Error("分條申請單 version 3 permission verification failed");
  }

  const productionV1 = await templateVersion("SLITTING", "slitting-production-order", 1);
  const productionV2 = await templateVersion("SLITTING", "slitting-production-order", 2);
  if (
    !productionV1?.publishedAt ||
    !productionV2?.publishedAt ||
    productionV1.currentVersionNumber !== 2 ||
    productionV2.currentVersionNumber !== 2
  ) {
    throw new Error("分條製令單 version activation verification failed");
  }
  const storedProductionV1 = productionV1.definition as Record<string, unknown>;
  if ("printLayout" in storedProductionV1 || "headerLayout" in storedProductionV1) {
    throw new Error("分條製令單 version 1 immutability verification failed");
  }
  const productionV1Definition = sheetTemplateDefinitionSchema.parse(
    productionV1.definition,
  );
  const productionV2Definition = sheetTemplateDefinitionSchema.parse(
    productionV2.definition,
  );
  if (
    resolveTemplateHeaderLayout(productionV1Definition) !== "TITLE_ONLY" ||
    resolveTemplatePrintLayout(productionV1Definition).orientation !== "LANDSCAPE" ||
    productionV2Definition.headerLayout !== "TITLE_ONLY" ||
    productionV2Definition.printLayout?.orientation !== "LANDSCAPE"
  ) {
    throw new Error("分條製令單 layout version verification failed");
  }

  const knifeLayout = await unreviewedTemplate("SLITTING", "slitting-knife-layout", "分條排刀單");
  const knifeRows = knifeLayout.sections.find(
    (section) => section.type === "FIXED_ROWS",
  );
  if (
    knifeLayout.status !== "APPROVED" ||
    knifeLayout.allowedCreatorKinds.join(",") !== "MANAGER,STAFF" ||
    knifeLayout.workflow.requiresReview ||
    knifeLayout.documentCodePosition !== "BELOW_GRID_RIGHT" ||
    knifeLayout.headerLayout !== "TITLE_LEFT_DATE_RIGHT" ||
    knifeRows?.type !== "FIXED_ROWS" ||
    knifeRows.rowNumberLabel !== "序" ||
    knifeRows.rowCount !== 10 ||
    knifeRows.columnWidthUnits?.join(",") !==
      "12.625,26.625,12.625,12.625,26.625"
  ) {
    throw new Error("分條排刀單 definition verification failed");
  }

  const warehouseIntake = await unreviewedTemplate("WAREHOUSE", "warehouse-location-intake", "倉位入庫表");
  const warehouseRows = warehouseIntake.sections.find(
    (section) => section.type === "FIXED_ROWS",
  );
  if (
    warehouseIntake.status !== "APPROVED" ||
    warehouseIntake.allowedCreatorKinds.join(",") !== "MANAGER,STAFF" ||
    warehouseIntake.staffEditScope !== "ANY_IN_DEPARTMENT" ||
    warehouseIntake.workflow.requiresReview ||
    warehouseIntake.documentLabel !== "文件編號：" ||
    warehouseIntake.documentCodePosition !== "BELOW_GRID_RIGHT" ||
    warehouseIntake.headerLayout !== "TITLE_ONLY" ||
    warehouseRows?.type !== "FIXED_ROWS" ||
    warehouseRows.rowNumberLabel !== "序" ||
    warehouseRows.rowCount !== 28 ||
    warehouseRows.columnWidthUnits?.join(",") !== "10.5,11.63,31.13,15.13,16.75"
  ) {
    throw new Error("倉位入庫表 definition verification failed");
  }

  // Version 2 lays the header on the document's columns (2026-10-02);
  // version 1 stays published for its sheets.
  const cuttingRequest = await unreviewedTemplate("FLAT_SHEAR", "flat-shear-cutting-request", "裁剪需求表", 2);
  const cuttingRequestV1 = await templateVersion("FLAT_SHEAR", "flat-shear-cutting-request", 1);
  const cuttingRows = cuttingRequest.sections.find(
    (section) => section.type === "FIXED_ROWS",
  );
  const cuttingDiagrams = cuttingRequest.sections.find(
    (section) => section.type === "DIAGRAMS",
  );
  const cuttingHeader = cuttingRequest.sections.find(
    (section) => section.type === "FIELDS",
  );
  const deliveryDate =
    cuttingHeader?.type === "FIELDS"
      ? cuttingHeader.fields.find((field) => field.key === "deliveryDate")
      : undefined;
  if (
    cuttingRequest.status !== "APPROVED" ||
    cuttingRequest.allowedCreatorKinds.join(",") !== "MANAGER,ORDER_TAKER" ||
    cuttingRequest.allowedEditorKinds?.join(",") !== "MANAGER,ORDER_TAKER,STAFF" ||
    cuttingRequest.staffEditScope !== "ANY_IN_DEPARTMENT" ||
    cuttingRequest.workflow.requiresReview ||
    cuttingRequest.documentLabel !== "文件編號：" ||
    cuttingRequest.documentCode !== "F/M1-08-02" ||
    cuttingRequest.documentCodePosition !== "BELOW_GRID_RIGHT" ||
    cuttingRequest.headerLayout !== "TITLE_ONLY" ||
    // The deadline the overdue queue reads comes from this cell, so a
    // definition that has lost the binding is a silently broken reminder.
    deliveryDate?.type !== "DATE" ||
    deliveryDate.bindsTo !== "DUE_AT" ||
    // The unit is printed inside the write-on cell, not folded into the
    // label and not ruled a cell of its own.
    cuttingHeader?.type !== "FIELDS" ||
    cuttingHeader.fields.find((field) => field.key === "transformerCapacity")
      ?.unit !== "KVA" ||
    cuttingHeader.fields.find((field) => field.key === "stackThickness")
      ?.unit !== "m/m" ||
    cuttingHeader.fields.some((field) => field.label.includes("KVA")) ||
    cuttingHeader.fieldGrid?.length !== 10 ||
    cuttingRows?.type !== "FIXED_ROWS" ||
    cuttingRows.caption?.text !== "產品規格" ||
    cuttingHeader.fields.some((field) => !field.gridSpan) ||
    !cuttingRequestV1 ||
    cuttingRequestV1.publishedAt === null ||
    cuttingRows?.type !== "FIXED_ROWS" ||
    cuttingRows.rowNumberLabel !== "項目" ||
    cuttingRows.rowCount !== 10 ||
    cuttingRows.columnWidthUnits?.join(",") !== "1624,1633,1633,1633,1633,1652" ||
    cuttingDiagrams?.type !== "DIAGRAMS" ||
    cuttingDiagrams.items.length !== 3
  ) {
    throw new Error("裁剪需求表 definition verification failed");
  }

  const eiOrder = await unreviewedTemplate("STAMPING", "stamping-ei-customer-order", "EI客戶訂購表");
  const eiOrderRows = eiOrder.sections.find(
    (section) => section.type === "FIXED_ROWS",
  );
  if (
    eiOrder.status !== "APPROVED" ||
    eiOrder.allowedCreatorKinds.join(",") !== "MANAGER,ORDER_TAKER" ||
    eiOrder.allowedEditorKinds?.join(",") !== "MANAGER,ORDER_TAKER" ||
    eiOrder.staffEditScope !== "ANY_IN_DEPARTMENT" ||
    eiOrder.workflow.requiresReview ||
    eiOrder.documentLabel !== "文件編號：" ||
    eiOrder.documentCode !== "F/P2-08-01" ||
    eiOrder.documentCodePosition !== "BELOW_GRID_RIGHT" ||
    eiOrder.headerLayout !== "TITLE_ONLY" ||
    eiOrder.printLayout?.orientation !== "PORTRAIT" ||
    eiOrderRows?.type !== "FIXED_ROWS" ||
    // The paper numbers nothing: its first column is 訂日.
    eiOrderRows.rowNumbers !== false ||
    eiOrderRows.rowNumberWidthUnits !== undefined ||
    eiOrderRows.rowCount !== 24 ||
    eiOrderRows.columnWidthUnits?.join(",") !== "5,14.25,35,10.25,8.13,6,14.75"
  ) {
    throw new Error("EI客戶訂購表 definition verification failed");
  }

  // Version 2 lays the header on the worksheet's columns (2026-10-02);
  // version 1 stays published for the sheets made from it.
  const cutOrder = await unreviewedTemplate("CUT", "cut-processing-order", "加工製令單", 2);
  const cutOrderV1 = await templateVersion("CUT", "cut-processing-order", 1);
  const cutOrderGrid = cutOrder.sections.find((section) => section.type === "FIELDS");
  if (
    !cutOrderV1 ||
    cutOrderV1.publishedAt === null ||
    cutOrderGrid?.type !== "FIELDS" ||
    cutOrderGrid.fieldGrid?.length !== 10 ||
    cutOrderGrid.fields.some((field) => !field.gridSpan)
  ) {
    throw new Error("加工製令單 version 2 header grid verification failed");
  }
  const cutOrderHeader = cutOrder.sections.find(
    (section) => section.type === "FIELDS",
  );
  const cutOrderProcess = cutOrder.sections.find(
    (section) => section.type === "MATRIX",
  );
  if (
    cutOrder.status !== "APPROVED" ||
    cutOrder.allowedCreatorKinds.join(",") !== "MANAGER,ORDER_TAKER" ||
    cutOrder.allowedEditorKinds?.join(",") !== "MANAGER,ORDER_TAKER" ||
    cutOrder.staffEditScope !== "ANY_IN_DEPARTMENT" ||
    cutOrder.workflow.requiresReview ||
    cutOrder.documentCode !== "F/P5-05-05" ||
    cutOrder.documentCodePosition !== "BELOW_GRID_RIGHT" ||
    cutOrder.headerLayout !== "TITLE_ONLY" ||
    cutOrder.printLayout?.orientation !== "PORTRAIT" ||
    cutOrderHeader?.type !== "FIELDS" ||
    // The paper's own six header rows, counting the cells it rules for
    // printed text as the cells they are.
    cutOrderHeader.fieldRows?.join(",") !== "4,4,4,2,1,3" ||
    cutOrderHeader.fields.length !== 18 ||
    // KG twice and 製令單交給生產部 once: printed, never filled in.
    cutOrderHeader.fields.filter((field) => field.printedOnly).length !== 3 ||
    cutOrderHeader.fields.some(
      (field) => field.label.includes("KG") && !field.printedOnly,
    ) ||
    cutOrder.letterhead?.asset !== "/templates/cut/letterhead.png" ||
    cutOrderProcess?.type !== "MATRIX" ||
    cutOrderProcess.label !== "工作流程" ||
    cutOrderProcess.columns.length !== 8 ||
    // The printed rule is a second line, not part of the heading.
    cutOrderProcess.columns[3]?.label !== "首件檢驗" ||
    cutOrderProcess.columns[3]?.note !== "依據F/Q-08檢驗" ||
    cutOrderProcess.groups[0]?.rows.length !== 9 ||
    // Row labels plus one per column.
    cutOrderProcess.columnWidthUnits?.length !== 9
  ) {
    throw new Error("加工製令單 definition verification failed");
  }

  // CUT's three customer order registers. They are three separate templates,
  // not versions of one, so the operator can pick the right paper when the
  // sheet is created; each is checked against its own worksheet.
  const cutOrderRegisters = [
    {
      slug: "cut-customer-order",
      displayName: "CUT客戶訂購表",
      documentIdentifier: "文件編號：F/P5-07-01",
      headerLayout: "TITLE_ONLY",
      documentCodePosition: "BELOW_GRID_RIGHT",
      rowCount: 25,
      columns: "訂貨日,客戶,品名/規格,數量,單價,交期,備註,訂號/工單號",
      columnWidthUnits: "8.38,10.13,25,6.25,7.5,4.75,17.75,19.5",
      headerNote: undefined,
      diagonal: "訂貨日",
      greyHeadings: "",
      filledColumns: "",
      spacers: 0,
      computed: "",
    },
    {
      slug: "cut-customer-order-da-yin",
      displayName: "客戶訂購表（大銀·直得）",
      // This form prints no document identifier, and one is not invented.
      documentIdentifier: null,
      headerLayout: "TITLE_ONLY",
      documentCodePosition: "BELOW_GRID_RIGHT",
      rowCount: 16,
      columns:
        "日期,採購單號/工單號,品號/品名/規格,模具編號/圖號,數量PCS,單價,總金額,旭日期,出貨日期,入帳年/月,備註",
      columnWidthUnits:
        "6.75,12.63,21.13,20.38,9.5,9.5,10.25,7.88,7.88,7.88,8.5",
      headerNote: undefined,
      diagonal: "日期,旭日期,出貨日期,入帳年/月",
      greyHeadings:
        "日期,採購單號/工單號,品號/品名/規格,模具編號/圖號,數量PCS,單價,總金額,旭日期,出貨日期,入帳年/月,備註",
      filledColumns: "單價:#ffff00",
      spacers: 0,
      computed: "",
    },
    {
      slug: "cut-customer-order-shihlin",
      // Version 2 writes 品名 on two lines (2026-10-02).
      version: 2,
      displayName: "CUT客戶訂單表（士電）",
      documentIdentifier: "文件編號：F/P5-07-01",
      // This one prints its identifier above the grid, not below it.
      headerLayout: "DATE_TITLE_DOCUMENT",
      documentCodePosition: "TOP_RIGHT",
      rowCount: 21,
      // The spacer prints no heading; the weight block follows it.
      columns: "訂日,訂購案號,出貨日期,品名,數量,標籤,交期,備註,日期/發票號碼,,單顆重量,總重",
      columnWidthUnits: "3.63,17.5,2.13,27.25,5.25,2.5,4.38,15.5,14.25,2,6.13,5",
      // The paper names the customer this register belongs to.
      headerNote: "士林電機",
      diagonal: "",
      greyHeadings: "單顆重量,總重",
      filledColumns: "",
      spacers: 1,
      computed: "總重=quantity*unitWeight",
    },
  ] as const;

  for (const expected of cutOrderRegisters) {
    const version = "version" in expected ? expected.version : 1;
    const row = await templateVersion("CUT", expected.slug, version);
    if (
      !row ||
      !row.active ||
      row.currentVersionNumber !== version ||
      row.publishedAt === null ||
      row.requiresReview ||
      // The picker separates these three by name, so the names must differ.
      row.displayName !== expected.displayName
    ) {
      throw new Error(`${expected.displayName} activation state verification failed`);
    }
    const definition = sheetTemplateDefinitionSchema.parse(row.definition);
    const rows = definition.sections[0];
    if (
      definition.status !== "APPROVED" ||
      definition.allowedCreatorKinds.join(",") !== "MANAGER,ORDER_TAKER" ||
      definition.allowedEditorKinds?.join(",") !== "MANAGER,ORDER_TAKER" ||
      definition.staffEditScope !== "ANY_IN_DEPARTMENT" ||
      definition.workflow.requiresReview ||
      definition.headerLayout !== expected.headerLayout ||
      definition.documentCodePosition !== expected.documentCodePosition ||
      resolveDocumentIdentifier(definition) !== expected.documentIdentifier ||
      definition.printLayout?.orientation !== "PORTRAIT" ||
      definition.sections.length !== 1 ||
      rows?.type !== "FIXED_ROWS" ||
      // None of the three number their rows; each starts with its own column.
      rows.rowNumbers !== false ||
      rows.rowNumberWidthUnits !== undefined ||
      rows.rowCount !== expected.rowCount ||
      rows.columns.map((column) => column.label).join(",") !== expected.columns ||
      rows.columns.some((column) => column.required || column.reviewed) ||
      // The cells these worksheets fill with their own colours.
      rows.columns
        .filter((column) => column.headingFill)
        .map((column) => column.label)
        .join(",") !== expected.greyHeadings ||
      rows.columns
        .filter((column) => column.cellFill)
        .map((column) => `${column.label}:${column.cellFill}`)
        .join(",") !== expected.filledColumns ||
      // The gap the paper leaves, and the cell it works out for itself.
      rows.columns.filter((column) => column.spacer).length !== expected.spacers ||
      rows.columns
        .filter((column) => column.computed)
        .map((column) => `${column.label}=${column.computed?.factors.join("*")}`)
        .join(",") !== expected.computed ||
      rows.columnWidthUnits?.join(",") !== expected.columnWidthUnits ||
      definition.headerNote !== expected.headerNote ||
      // The date columns the paper rules corner to corner.
      rows.columns
        .filter((column) => column.diagonalSplit)
        .map((column) => column.label)
        .join(",") !== expected.diagonal
    ) {
      throw new Error(`${expected.displayName} definition verification failed`);
    }
  }

  // 生產作業看板: CUT's production board. Landscape, where the registers above
  // are portrait, and the one form whose register closes on a printed legend.
  const board = await unreviewedTemplate("CUT", "cut-production-board", "生產作業看板");
  const boardRows = board.sections[0];
  if (
    board.displayName !== "生產作業看板" ||
    board.allowedCreatorDepartmentCodes.join(",") !== "CUT" ||
    board.workflow.requiresReview ||
    resolveDocumentIdentifier(board) !== "文件編號：F/P5-01-01" ||
    board.documentCodePosition !== "BELOW_GRID_RIGHT" ||
    board.printLayout?.orientation !== "LANDSCAPE" ||
    board.sections.length !== 1 ||
    boardRows?.type !== "FIXED_ROWS" ||
    boardRows.rowNumbers !== false ||
    boardRows.rowCount !== 8 ||
    boardRows.columns.map((column) => column.label).join(",") !==
      "工單號,規格,材質,數量,工序,交期,備註" ||
    boardRows.columnWidthUnits?.join(",") !== "12,16,12,15,25,12,25" ||
    // Printed exactly as the worksheet has it: it is what the operator reads
    // to know which number to write in 工序.
    boardRows.legend !==
      "定義： 捲繞 = (1)、油壓定型 = (2)、燒炖 = (3)、退模芯 = (4)、抽真空 = (5)、烘乾 = (6)、切割 = (7)、研磨 = (8)、包裝 = (9)"
  ) {
    throw new Error("生產作業看板 definition verification failed");
  }

  // CUT templates published after the board, each reviewed nowhere.
  const cutTemplate = (slug: string, name: string, version = 1) =>
    unreviewedTemplate("CUT", slug, name, version);

  const personal = await cutTemplate("cut-personal-daily-report", "個人生產日報表");
  const [personalHeader, personalRows] = personal.sections;
  if (
    personal.displayName !== "CUT個人生產日報表" ||
    personal.allowedCreatorDepartmentCodes.join(",") !== "CUT" ||
    personal.workflow.requiresReview ||
    resolveDocumentIdentifier(personal) !== "文件編號：F/P5-04-01" ||
    personal.documentCodePosition !== "BELOW_GRID_RIGHT" ||
    personal.headerLayout !== "TITLE_FIELDS_RIGHT" ||
    personal.sections.length !== 2 ||
    personalHeader?.type !== "FIELDS" ||
    personalHeader.fields.map((field) => field.label).join(",") !== "姓名,日期" ||
    personalRows?.type !== "FIXED_ROWS" ||
    personalRows.rowNumbers !== false ||
    personalRows.rowCount !== 6 ||
    personalRows.columns.map((column) => column.label).join(",") !==
      "工作代號,工作內容,數量,時間,備註" ||
    personalRows.columnWidthUnits?.join(",") !== "9,48.63,9.75,9,20.13" ||
    personalRows.legendAlign !== "START" ||
    personalRows.legend !==
      "工作代號:\n1.捲繞 2.油壓定型 3.退模芯 4.抽真空 5.上膠 6.退爐 7.切割 8.研磨 9.包裝 10.其他"
  ) {
    throw new Error("個人生產日報表 definition verification failed");
  }

  const team = await cutTemplate("cut-daily-report", "生產日報表");
  const [teamHeader, teamRows, teamSignatures] = team.sections;
  if (
    team.displayName !== "CUT生產日報表" ||
    team.allowedCreatorDepartmentCodes.join(",") !== "CUT" ||
    team.workflow.requiresReview ||
    // The form prints no document identifier.
    resolveDocumentIdentifier(team) !== null ||
    team.headerLayout !== "TITLE_FIELDS_RIGHT" ||
    team.sections.length !== 3 ||
    teamHeader?.type !== "FIELDS" ||
    teamHeader.fields.map((field) => field.label).join(",") !== "日期" ||
    teamRows?.type !== "FIXED_ROWS" ||
    teamRows.rowNumbers !== false ||
    teamRows.rowCount !== 64 ||
    teamRows.columns.map((column) => column.label).join(",") !==
      "姓名,工作內容,數量,時間,備註" ||
    teamRows.rowGroups?.size !== 8 ||
    teamRows.rowGroups.spanningColumnKey !== "name" ||
    !teamRows.rowGroups.numbered ||
    teamRows.rowGroups.perPage !== 4 ||
    teamSignatures?.type !== "FIELDS" ||
    teamSignatures.fields.map((field) => field.label).join(",") !== "經理,組長"
  ) {
    throw new Error("生產日報表 definition verification failed");
  }

  // CUT成品檢查表: no review, a tick-box 判定, a corner-headed register and a
  // closing reference band.
  // Version 2 lays the particulars on the document's columns (2026-10-02);
  // version 1 stays published for its sheets.
  const inspection = await cutTemplate("cut-finished-inspection", "成品檢查表", 2);
  const inspectionV1 = await templateVersion("CUT", "cut-finished-inspection", 1);
  const [inspectionHeader, particulars, dimensions, reference] = inspection.sections;
  const verdict =
    particulars?.type === "FIELDS"
      ? particulars.fields.find((field) => field.key === "verdict")
      : undefined;
  if (
    inspection.displayName !== "CUT成品檢查表" ||
    inspection.allowedCreatorDepartmentCodes.join(",") !== "CUT" ||
    inspection.workflow.requiresReview ||
    resolveDocumentIdentifier(inspection) !== "文件編號：F/P5-02-02" ||
    inspection.documentCodePosition !== "BELOW_GRID_RIGHT" ||
    inspection.letterhead?.asset !== "/templates/cut/finished-inspection-letterhead.png" ||
    inspection.sections.length !== 4 ||
    inspectionHeader?.type !== "FIELDS" ||
    inspectionHeader.fields.map((field) => field.label).join(",") !== "工單號" ||
    particulars?.type !== "FIELDS" ||
    particulars.fields.map((field) => field.label).join(",") !==
      "客戶名,規格,材質,數量,日期,檢查工具,游標卡尺,審查員,判定" ||
    particulars.fieldRows?.join(",") !== "2,3,4" ||
    particulars.fieldGrid?.join(",") !== "7.85,11.06,12.6,9,4.76,10.55" ||
    particulars.fields.some((field) => !field.gridSpan) ||
    !inspectionV1 ||
    inspectionV1.publishedAt === null ||
    verdict?.choices?.join(",") !== "OK,NG" ||
    dimensions?.type !== "FIXED_ROWS" ||
    dimensions.rowCount !== 9 ||
    dimensions.columns.map((column) => column.label).join(",") !==
      "檢查項次,A,B(Di),C(Do),D,備註" ||
    dimensions.columnWidthUnits?.join(",") !== "81,90,90,99,90,108" ||
    dimensions.caption?.text !== "外觀尺寸" ||
    dimensions.caption.note !== "單位: mm" ||
    dimensions.cornerCell?.across !== "尺寸" ||
    dimensions.cornerCell.down !== "序號" ||
    reference?.type !== "REFERENCE_BAND" ||
    reference.drawing?.asset !== "/templates/cut/finished-inspection-cores.svg" ||
    reference.table?.rows.length !== 7 ||
    reference.table?.columns.map((column) => column.label).join(",") !== "A,B,C,D"
  ) {
    throw new Error("成品檢查表 definition verification failed");
  }

  // CUT's characteristic inspections: four forms from one workbook.
  // Version 2 of each lays the header on the worksheet's columns
  // (2026-10-02); version 1 stays published for its sheets.
  const characteristic = await cutTemplate("cut-characteristic-inspection", "特性檢驗報告單", 2);
  const songmao = await cutTemplate("cut-characteristic-inspection-songmao", "特性檢驗報告單（崧貿）", 2);
  const chiaoli = await cutTemplate("cut-factory-inspection-chiaoli", "出廠檢驗單（巧力）", 2);
  const shintai = await cutTemplate("cut-characteristic-inspection-shintai", "特性檢驗報告單（信太）", 2);
  for (const slug of [
    "cut-characteristic-inspection",
    "cut-characteristic-inspection-songmao",
    "cut-factory-inspection-chiaoli",
    "cut-characteristic-inspection-shintai",
  ]) {
    const first = await templateVersion("CUT", slug, 1);
    if (!first || first.publishedAt === null) {
      throw new Error(`${slug} version 1 is no longer published`);
    }
  }
  const gridOf = (definition: typeof characteristic) =>
    definition.sections.find((section) => section.type === "FIELDS" && section.key === "particulars");
  const testsOf = (definition: typeof characteristic) =>
    definition.sections.find((section) => section.type === "FIXED_ROWS");
  const baseTests = testsOf(characteristic);
  const songmaoTests = testsOf(songmao);
  const chiaoliRows = testsOf(chiaoli);
  const shintaiTests = testsOf(shintai);
  const shintaiCheck =
    shintaiTests?.type === "FIXED_ROWS"
      ? shintaiTests.columns.find((column) => column.key === "check")
      : undefined;
  if (
    [characteristic, songmao, chiaoli, shintai].some(
      (definition) =>
        definition.allowedCreatorDepartmentCodes.join(",") !== "CUT" ||
        definition.workflow.requiresReview,
    ) ||
    characteristic.displayName !== "特性檢驗報告單" ||
    resolveDocumentIdentifier(characteristic) !== "文件編號：F/P5-03-01" ||
    baseTests?.type !== "FIXED_ROWS" ||
    baseTests.rowCount !== 16 ||
    baseTests.standardRow?.ruled !== false ||
    baseTests.standardRow.corner.across !== "標準值" ||
    baseTests.columns.map((column) => column.label).join(",") !== "測試值,A,B,C,D,電流,鐵損" ||
    songmaoTests?.type !== "FIXED_ROWS" ||
    songmaoTests.rowNumbers !== true ||
    songmaoTests.standardRow?.ruled !== true ||
    songmaoTests.standardRow.corner.across !== "位置" ||
    chiaoli.letterhead !== undefined ||
    resolveDocumentIdentifier(chiaoli) !== null ||
    chiaoli.headerLines?.length !== 3 ||
    chiaoliRows?.type !== "FIXED_ROWS" ||
    chiaoliRows.rowCount !== 10 ||
    chiaoliRows.blocks?.count !== 2 ||
    shintai.footerNote?.text !== "VER 2.0" ||
    shintaiTests?.type !== "FIXED_ROWS" ||
    shintaiTests.rowCount !== 15 ||
    shintaiCheck?.choices?.join(",") !== "合格,不合格" ||
    [characteristic, songmao, chiaoli, shintai].some((definition) => {
      const particulars = gridOf(definition);
      return particulars?.type !== "FIELDS" || !particulars.fieldGrid;
    })
  ) {
    throw new Error("特性檢驗報告單 definitions verification failed");
  }

  // 月份不良率統計表: a month, then twenty-one work orders.
  const defectRate = await cutTemplate("cut-defect-rate", "不良率統計表");
  const [defectHeader, defectRows] = defectRate.sections;
  if (
    defectRate.displayName !== "不良率統計表" ||
    defectRate.allowedCreatorDepartmentCodes.join(",") !== "CUT" ||
    defectRate.workflow.requiresReview ||
    resolveDocumentIdentifier(defectRate) !== "文件編號：F/P5-09-02" ||
    defectRate.documentCodePosition !== "TOP_RIGHT" ||
    defectHeader?.type !== "FIELDS" ||
    defectHeader.fields.map((field) => field.label).join(",") !== "月份" ||
    defectRows?.type !== "FIXED_ROWS" ||
    defectRows.rowCount !== 21 ||
    defectRows.columns.map((column) => column.label).join(",") !==
      "工單號,訂單數,成品數,不良數,單顆重量,良品總重,不良重量" ||
    defectRows.columnWidthUnits?.join(",") !== "16,12,12,12,12,16,12"
  ) {
    throw new Error("不良率統計表 definition verification failed");
  }

  // 退火明細表: written in CUT, handed on to 燒頓.
  // Version 2 lines up the particulars and boxes 程式編號 on both sides of
  // 第 … 程式 (2026-10-02); version 1 stays published for its sheets.
  const annealing = await cutTemplate("cut-annealing-list", "退火明細表", 2);
  const annealingV1 = await templateVersion("CUT", "cut-annealing-list", 1);
  const annealingOrders = annealing.sections.find((section) => section.type === "FIXED_ROWS");
  const annealingFiring = annealing.sections.find((section) => section.type === "FIELDS");
  if (
    !annealingV1 ||
    annealingV1.publishedAt === null ||
    annealingFiring?.type !== "FIELDS" ||
    annealingFiring.fieldGrid?.length !== 6 ||
    annealingFiring.fields
      .filter((field) => field.key.startsWith("program"))
      .map((field) => field.key)
      .join(",") !== "programBefore,programNo,programAfter" ||
    annealing.displayName !== "退火明細表" ||
    annealing.allowedCreatorDepartmentCodes.join(",") !== "CUT" ||
    annealing.workflow.requiresReview ||
    annealing.workflow.destinationDepartmentCode !== "SHAO_DUN" ||
    resolveDocumentIdentifier(annealing) !== "文件編號：F/P5-06-03" ||
    annealing.printLayout?.orientation !== "LANDSCAPE" ||
    annealingOrders?.type !== "FIXED_ROWS" ||
    annealingOrders.rowCount !== 18 ||
    annealingOrders.blocks?.count !== 2 ||
    annealingOrders.blocks.gapUnits !== undefined ||
    annealingOrders.columns.map((column) => column.label).join(",") !== "工單號,規格,材質,數量,重量"
  ) {
    throw new Error("退火明細表 definition verification failed");
  }

  // 首件/巡迴檢驗單: two printed matrices, the 公差 table and 鋼捲號.
  const patrol = await cutTemplate("cut-patrol-inspection", "首件/巡迴檢驗單");
  const [patrolJob, firstPiece, rounds, tolerance, patrolClosing] = patrol.sections;
  if (
    patrol.displayName !== "首件/巡迴檢驗單" ||
    patrol.workflow.requiresReview ||
    resolveDocumentIdentifier(patrol) !== "文件編號：F/Q1-08-07" ||
    patrol.letterhead?.asset !== "/templates/cut/letterhead.png" ||
    patrolJob?.type !== "FIELDS" ||
    patrolJob.fields.length !== 6 ||
    firstPiece?.type !== "MATRIX" ||
    firstPiece.sideLabel !== "首件檢驗" ||
    firstPiece.aside?.drawing.asset !== "/templates/cut/patrol-inspection-cores.svg" ||
    firstPiece.aside.field.choices?.join(",") !== "C型,環型" ||
    firstPiece.groups.flatMap((group) => group.rows).length !== 13 ||
    firstPiece.columns.find((column) => column.key === "verdict")?.choices?.join(",") !== "✓,✗" ||
    rounds?.type !== "MATRIX" ||
    rounds.columns.length !== 6 ||
    rounds.headingEntry?.parts.map((part) => part.unit).join("") !== "日時分" ||
    rounds.cornerCell?.across !== "檢驗時間" ||
    tolerance?.type !== "REFERENCE_BAND" ||
    tolerance.table?.rows.length !== 7 ||
    tolerance.entry?.label !== "鋼捲號" ||
    patrolClosing?.type !== "FIELDS"
  ) {
    throw new Error("首件/巡迴檢驗單 definition verification failed");
  }

  // 燒炖質量記錄表: written in CUT or 沖壓, handed on to 燒頓.
  const firing = await cutTemplate("cut-firing-quality-record", "燒炖質量記錄表");
  const [firingRows] = firing.sections;
  if (
    firing.displayName !== "燒炖質量記錄表" ||
    firing.allowedCreatorDepartmentCodes.join(",") !== "CUT,STAMPING" ||
    firing.workflow.requiresReview ||
    firing.workflow.destinationDepartmentCode !== "SHAO_DUN" ||
    resolveDocumentIdentifier(firing) !== "文件編號：F/P4-01-02" ||
    firing.documentCodePosition !== "BELOW_GRID_RIGHT" ||
    firing.printLayout?.orientation !== "LANDSCAPE" ||
    firing.sections.length !== 1 ||
    firingRows?.type !== "FIXED_ROWS" ||
    firingRows.rowNumbers !== false ||
    firingRows.rowCount !== 10 ||
    firingRows.columns.map((column) => column.accessibleLabel ?? column.label).join(",") !==
      "工單號,日期,客戶簡稱,規格/材質,數量,爐號/胆號,燒炖時間,燒炖溫度,掀蓋溫度,外觀色澤,備註,裝箱日/時間"
  ) {
    throw new Error("燒炖質量記錄表 definition verification failed");
  }

  // 待燒入庫表: 沖壓's, handed on to 燒頓.
  const intake = await unreviewedTemplate("STAMPING", "stamping-firing-intake", "待燒入庫表");
  const [intakeRows] = intake.sections;
  if (
    intake.displayName !== "待燒入庫表" ||
    intake.allowedCreatorDepartmentCodes.join(",") !== "STAMPING" ||
    intake.workflow.requiresReview ||
    intake.workflow.destinationDepartmentCode !== "SHAO_DUN" ||
    resolveDocumentIdentifier(intake) !== "文件編號：F/P4-02-01" ||
    intake.printLayout?.orientation !== "PORTRAIT" ||
    intake.sections.length !== 1 ||
    intakeRows?.type !== "FIXED_ROWS" ||
    !intakeRows.rowNumbers ||
    intakeRows.rowNumberLabel !== "序" ||
    intakeRows.rowCount !== 25 ||
    intakeRows.columns.map((column) => column.label).join(",") !==
      "入庫日,規格/材質,重量/箱數,倉位/備註"
  ) {
    throw new Error("待燒入庫表 definition verification failed");
  }

  // 產品需求表: 沖壓's, with 交期 ticked as 庫存 or written after 其他.
  const demand = await unreviewedTemplate("STAMPING", "stamping-product-demand", "產品需求表");
  const [demandRows] = demand.sections;
  const delivery =
    demandRows?.type === "FIXED_ROWS"
      ? demandRows.columns.find((column) => column.key === "delivery")
      : undefined;
  if (
    demand.displayName !== "產品需求表" ||
    demand.allowedCreatorDepartmentCodes.join(",") !== "STAMPING" ||
    demand.workflow.requiresReview ||
    demand.workflow.destinationDepartmentCode !== "STAMPING" ||
    resolveDocumentIdentifier(demand) !== "文件編號：F/M1-03-01" ||
    demand.letterhead?.asset !== "/templates/cut/finished-inspection-letterhead.png" ||
    demandRows?.type !== "FIXED_ROWS" ||
    demandRows.rowNumbers !== false ||
    demandRows.rowCount !== 22 ||
    demandRows.columns.map((column) => column.label).join(",") !==
      "製令NO：,規格,材質,數量,交期,備註" ||
    delivery?.choices?.join(",") !== "庫存,其他" ||
    delivery.choiceWriteIn !== "其他"
  ) {
    throw new Error("產品需求表 definition verification failed");
  }

  // 沖壓's 生產作業看板: what is on the press and what waits for it.
  const stampingBoard = await unreviewedTemplate(
    "STAMPING",
    "stamping-production-board",
    "沖壓生產作業看板",
  );
  const [stampingBoardRows] = stampingBoard.sections;
  if (
    stampingBoard.displayName !== "生產作業看板" ||
    stampingBoard.allowedCreatorDepartmentCodes.join(",") !== "STAMPING" ||
    stampingBoard.workflow.requiresReview ||
    resolveDocumentIdentifier(stampingBoard) !== "文件編號：F/P2-09-01" ||
    stampingBoard.printLayout?.orientation !== "LANDSCAPE" ||
    stampingBoardRows?.type !== "FIXED_ROWS" ||
    !stampingBoardRows.rowNumbers ||
    stampingBoardRows.rowNumberLabel !== "編號" ||
    stampingBoardRows.rowCount !== 12 ||
    stampingBoardRows.columns.map((column) => column.label).join(",") !==
      "規格材質,日期,預計產量,待沖規格,材質,預計產量,安裝日期,備註"
  ) {
    throw new Error("沖壓生產作業看板 definition verification failed");
  }

  // 沖壓's 生產日報表: two-row headings, shared cells, and a back side.
  const stampingDaily = await unreviewedTemplate(
    "STAMPING",
    "stamping-daily-report",
    "沖壓生產日報表",
  );
  const [dailyHeader, dailyJobs, dailyBack] = stampingDaily.sections;
  if (
    stampingDaily.displayName !== "生產日報表" ||
    stampingDaily.allowedCreatorDepartmentCodes.join(",") !== "STAMPING" ||
    stampingDaily.workflow.requiresReview ||
    resolveDocumentIdentifier(stampingDaily) !== "文件編號：F/P2-10-01" ||
    dailyHeader?.type !== "FIELDS" ||
    dailyHeader.fields.find((field) => field.key === "shift")?.choiceWriteIn !== "請假" ||
    dailyJobs?.type !== "FIXED_ROWS" ||
    dailyJobs.rowCount !== 8 ||
    dailyJobs.columns.length !== 18 ||
    dailyJobs.headingGroups?.map((group) => group.label).join(",") !== "箱重/箱數,不良品" ||
    dailyJobs.columns.filter((column) => column.joinNext).length !== 4 ||
    dailyBack?.type !== "NUMBERED_BLANKS" ||
    dailyBack.count !== 12 ||
    dailyBack.order !== "DOWN" ||
    !dailyBack.printedOnBack
  ) {
    throw new Error("沖壓生產日報表 definition verification failed");
  }

  process.stdout.write("Database seed verification passed.\n");
} finally {
  await connection.close();
}
