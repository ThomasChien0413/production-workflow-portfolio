import "./load-env.js";
import { assertLocalDemoDatabase } from "./demo-target.js";
import argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import {
  cutAnnealingListV1,
  cutAnnealingListV2,
  cutPatrolInspectionV1,
  cutFiringQualityRecordV1,
  cutCustomerOrderDaYinV1,
  cutCustomerOrderShihlinV1,
  cutCustomerOrderShihlinV2,
  cutCustomerOrderV1,
  cutCharacteristicInspectionShintaiV1,
  cutCharacteristicInspectionShintaiV2,
  cutCharacteristicInspectionSongmaoV1,
  cutCharacteristicInspectionSongmaoV2,
  cutCharacteristicInspectionV1,
  cutCharacteristicInspectionV2,
  cutDailyReportV1,
  cutDefectRateV1,
  cutFactoryInspectionChiaoliV1,
  cutFactoryInspectionChiaoliV2,
  cutFinishedInspectionV1,
  cutFinishedInspectionV2,
  cutPersonalDailyReportV1,
  cutProcessingOrderV1,
  cutProcessingOrderV2,
  cutProductionBoardV1,
  departmentSeeds,
  flatShearCuttingRequestV1,
  flatShearCuttingRequestV2,
  slittingKnifeLayoutV1,
  slittingProductionOrderV1,
  slittingProductionOrderV2,
  slittingRequestV1,
  slittingRequestV2,
  slittingRequestV3,
  type SheetTemplateDefinition,
  stampingEiCustomerOrderV1,
  stampingFiringIntakeV1,
  stampingProductDemandV1,
  stampingProductionBoardV1,
  stampingDailyReportV1,
  stampingPatrolInspectionV1,
  warehouseLocationIntakeV1,
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
assertLocalDemoDatabase(databaseUrl);

const connection = createDatabase(databaseUrl, 1);

try {
  await connection.db.transaction(async (tx) => {
    for (const department of departmentSeeds) {
      await tx
        .insert(departments)
        .values({
          code: department.code,
          slug: department.slug,
          displayName: department.displayName,
        })
        .onConflictDoUpdate({
          target: departments.code,
          set: {
            slug: department.slug,
            displayName: department.displayName,
            active: true,
            updatedAt: new Date(),
          },
        });
    }
    // No default subpage (the user, 2026-10-03): each department's 主管
    // creates its subpages and ticks their forms. Migration 0008's 未分類, on
    // a database that had departments then, is left as it is.

    const [slittingDepartment] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.code, "SLITTING"))
      .limit(1);
    if (!slittingDepartment) {
      throw new Error("SLITTING department is required for template seed");
    }

    const publishedAt = new Date();

    await tx
      .insert(sheetTemplates)
      .values({
        departmentId: slittingDepartment.id,
        slug: slittingRequestV1.templateKey,
        displayName: slittingRequestV1.displayName,
        description: "依使用者提供影像轉錄，欄位規則已於 2026-08-08 確認。",
        active: true,
        currentVersionNumber: 3,
      })
      .onConflictDoUpdate({
        target: [sheetTemplates.departmentId, sheetTemplates.slug],
        set: {
          displayName: slittingRequestV1.displayName,
          description: "依使用者提供影像轉錄，欄位規則已於 2026-08-08 確認。",
          active: true,
          currentVersionNumber: 3,
          updatedAt: publishedAt,
        },
      });

    const [slittingRequestTemplate] = await tx
      .select({ id: sheetTemplates.id })
      .from(sheetTemplates)
      .where(
        and(
          eq(sheetTemplates.departmentId, slittingDepartment.id),
          eq(sheetTemplates.slug, slittingRequestV1.templateKey),
        ),
      )
      .limit(1);
    if (!slittingRequestTemplate) {
      throw new Error("Failed to seed 分條申請單 template");
    }

    const versionValues = {
      templateId: slittingRequestTemplate.id,
      version: 1,
      definition: slittingRequestV1,
      requiresReview: true,
      sourceReference:
        "user-image:2026-08-08:sha256:CC7046978DF5796DA884D94D921D39927948446171ECBC79384919EE75F93C40",
      changeNotes:
        "Transcribed from the supplied image; field rules confirmed by the user on 2026-08-08.",
      publishedAt,
    };
    const [existingVersion] = await tx
      .select({
        id: sheetTemplateVersions.id,
        publishedAt: sheetTemplateVersions.publishedAt,
      })
      .from(sheetTemplateVersions)
      .where(
        and(
          eq(sheetTemplateVersions.templateId, slittingRequestTemplate.id),
          eq(sheetTemplateVersions.version, 1),
        ),
      )
      .limit(1);
    if (!existingVersion) {
      await tx.insert(sheetTemplateVersions).values(versionValues);
    } else if (existingVersion.publishedAt === null) {
      // Only the still-unpublished draft is upgraded in place. Once a version
      // is published it is immutable (DESIGN.md §6); a later change must create
      // a new version rather than rewrite this one.
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: versionValues.definition,
          requiresReview: versionValues.requiresReview,
          sourceReference: versionValues.sourceReference,
          changeNotes: versionValues.changeNotes,
          publishedAt: versionValues.publishedAt,
        })
        .where(eq(sheetTemplateVersions.id, existingVersion.id));
    }

    const requestVersionTwoValues = {
      templateId: slittingRequestTemplate.id,
      version: 2,
      definition: slittingRequestV2,
      requiresReview: true,
      sourceReference: versionValues.sourceReference,
      changeNotes:
        "Adds the user-approved A4 landscape PDF layout without changing the published version 1 definition.",
      publishedAt,
    };
    const [existingRequestVersionTwo] = await tx
      .select({
        id: sheetTemplateVersions.id,
        publishedAt: sheetTemplateVersions.publishedAt,
      })
      .from(sheetTemplateVersions)
      .where(
        and(
          eq(sheetTemplateVersions.templateId, slittingRequestTemplate.id),
          eq(sheetTemplateVersions.version, 2),
        ),
      )
      .limit(1);
    if (!existingRequestVersionTwo) {
      await tx.insert(sheetTemplateVersions).values(requestVersionTwoValues);
    } else if (existingRequestVersionTwo.publishedAt === null) {
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: requestVersionTwoValues.definition,
          requiresReview: requestVersionTwoValues.requiresReview,
          sourceReference: requestVersionTwoValues.sourceReference,
          changeNotes: requestVersionTwoValues.changeNotes,
          publishedAt: requestVersionTwoValues.publishedAt,
        })
        .where(eq(sheetTemplateVersions.id, existingRequestVersionTwo.id));
    }

    const requestVersionThreeValues = {
      templateId: slittingRequestTemplate.id,
      version: 3,
      definition: slittingRequestV3,
      requiresReview: true,
      sourceReference: versionValues.sourceReference,
      changeNotes:
        "Allows active 訂單人員 in an allowed origin department to create, edit, and submit DRAFT/RETURNED requests; versions 1 and 2 remain unchanged.",
      publishedAt,
    };
    const [existingRequestVersionThree] = await tx
      .select({
        id: sheetTemplateVersions.id,
        publishedAt: sheetTemplateVersions.publishedAt,
      })
      .from(sheetTemplateVersions)
      .where(
        and(
          eq(sheetTemplateVersions.templateId, slittingRequestTemplate.id),
          eq(sheetTemplateVersions.version, 3),
        ),
      )
      .limit(1);
    if (!existingRequestVersionThree) {
      await tx.insert(sheetTemplateVersions).values(requestVersionThreeValues);
    } else if (existingRequestVersionThree.publishedAt === null) {
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: requestVersionThreeValues.definition,
          requiresReview: requestVersionThreeValues.requiresReview,
          sourceReference: requestVersionThreeValues.sourceReference,
          changeNotes: requestVersionThreeValues.changeNotes,
          publishedAt: requestVersionThreeValues.publishedAt,
        })
        .where(eq(sheetTemplateVersions.id, existingRequestVersionThree.id));
    }

    // 分條製令單. Active from 2026-08-11: the user supplied the source document
    // and answered all ten open questions, so the definition is APPROVED and
    // version 1 is published like 分條申請單 above.
    await tx
      .insert(sheetTemplates)
      .values({
        departmentId: slittingDepartment.id,
        slug: slittingProductionOrderV1.templateKey,
        displayName: slittingProductionOrderV1.displayName,
        description: "依使用者提供的 Word 文件轉錄，欄位規則已於 2026-08-11 確認。",
        active: true,
        currentVersionNumber: 2,
      })
      .onConflictDoUpdate({
        target: [sheetTemplates.departmentId, sheetTemplates.slug],
        set: {
          displayName: slittingProductionOrderV1.displayName,
          description: "依使用者提供的 Word 文件轉錄，欄位規則已於 2026-08-11 確認。",
          active: true,
          currentVersionNumber: 2,
          updatedAt: publishedAt,
        },
      });

    const [productionOrderTemplate] = await tx
      .select({ id: sheetTemplates.id })
      .from(sheetTemplates)
      .where(
        and(
          eq(sheetTemplates.departmentId, slittingDepartment.id),
          eq(sheetTemplates.slug, slittingProductionOrderV1.templateKey),
        ),
      )
      .limit(1);
    if (!productionOrderTemplate) {
      throw new Error("Failed to seed 分條製令單 template");
    }

    const [existingOrderVersion] = await tx
      .select({
        id: sheetTemplateVersions.id,
        publishedAt: sheetTemplateVersions.publishedAt,
      })
      .from(sheetTemplateVersions)
      .where(
        and(
          eq(sheetTemplateVersions.templateId, productionOrderTemplate.id),
          eq(sheetTemplateVersions.version, 1),
        ),
      )
      .limit(1);
    const orderValues = {
      templateId: productionOrderTemplate.id,
      version: 1,
      definition: slittingProductionOrderV1,
      requiresReview: false,
      sourceReference:
        "user-document:2026-08-11:分條製令單.docx:sha256:4488FA67CE4B3F548025EAF668CA5719DCF47B343BA3CEF0935313AF45CF52D2",
      changeNotes:
        "Transcribed from the supplied Word document; all ten open questions answered by the user on 2026-08-11.",
      publishedAt,
    };
    if (!existingOrderVersion) {
      await tx.insert(sheetTemplateVersions).values(orderValues);
    } else if (existingOrderVersion.publishedAt === null) {
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: orderValues.definition,
          requiresReview: orderValues.requiresReview,
          sourceReference: orderValues.sourceReference,
          changeNotes: orderValues.changeNotes,
          publishedAt: orderValues.publishedAt,
        })
        .where(eq(sheetTemplateVersions.id, existingOrderVersion.id));
    }

    const orderVersionTwoValues = {
      templateId: productionOrderTemplate.id,
      version: 2,
      definition: slittingProductionOrderV2,
      requiresReview: false,
      sourceReference: orderValues.sourceReference,
      changeNotes:
        "Adds the explicit title-band and user-approved A4 landscape PDF layout without changing the published version 1 definition.",
      publishedAt,
    };
    const [existingOrderVersionTwo] = await tx
      .select({
        id: sheetTemplateVersions.id,
        publishedAt: sheetTemplateVersions.publishedAt,
      })
      .from(sheetTemplateVersions)
      .where(
        and(
          eq(sheetTemplateVersions.templateId, productionOrderTemplate.id),
          eq(sheetTemplateVersions.version, 2),
        ),
      )
      .limit(1);
    if (!existingOrderVersionTwo) {
      await tx.insert(sheetTemplateVersions).values(orderVersionTwoValues);
    } else if (existingOrderVersionTwo.publishedAt === null) {
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: orderVersionTwoValues.definition,
          requiresReview: orderVersionTwoValues.requiresReview,
          sourceReference: orderVersionTwoValues.sourceReference,
          changeNotes: orderVersionTwoValues.changeNotes,
          publishedAt: orderVersionTwoValues.publishedAt,
        })
        .where(eq(sheetTemplateVersions.id, existingOrderVersionTwo.id));
    }

    // 分條排刀單. Active from 2026-08-11 from the supplied XLSX. The template
    // explicitly opts both 分條 主管 and 員工 into creation and keeps the
    // spreadsheet's visible wording and relative column widths.
    await tx
      .insert(sheetTemplates)
      .values({
        departmentId: slittingDepartment.id,
        slug: slittingKnifeLayoutV1.templateKey,
        displayName: slittingKnifeLayoutV1.displayName,
        description: "依使用者提供的 XLSX 轉錄，保留原始欄位、比例與十列版面。",
        active: true,
        currentVersionNumber: 1,
      })
      .onConflictDoUpdate({
        target: [sheetTemplates.departmentId, sheetTemplates.slug],
        set: {
          displayName: slittingKnifeLayoutV1.displayName,
          description: "依使用者提供的 XLSX 轉錄，保留原始欄位、比例與十列版面。",
          active: true,
          currentVersionNumber: 1,
          updatedAt: publishedAt,
        },
      });

    const [knifeLayoutTemplate] = await tx
      .select({ id: sheetTemplates.id })
      .from(sheetTemplates)
      .where(
        and(
          eq(sheetTemplates.departmentId, slittingDepartment.id),
          eq(sheetTemplates.slug, slittingKnifeLayoutV1.templateKey),
        ),
      )
      .limit(1);
    if (!knifeLayoutTemplate) {
      throw new Error("Failed to seed 分條排刀單 template");
    }

    const [existingKnifeLayoutVersion] = await tx
      .select({
        id: sheetTemplateVersions.id,
        publishedAt: sheetTemplateVersions.publishedAt,
      })
      .from(sheetTemplateVersions)
      .where(
        and(
          eq(sheetTemplateVersions.templateId, knifeLayoutTemplate.id),
          eq(sheetTemplateVersions.version, 1),
        ),
      )
      .limit(1);
    const knifeLayoutValues = {
      templateId: knifeLayoutTemplate.id,
      version: 1,
      definition: slittingKnifeLayoutV1,
      requiresReview: false,
      sourceReference:
        "user-workbook:2026-08-11:分條排刀單.xlsx:sha256:A44CD98D46521C34E008AA16F4D7EC83F6ED0F63F55F6376F2A9D0012F138A04",
      changeNotes:
        "Transcribed from the supplied XLSX with exact visible labels, ten rows, and source column proportions.",
      publishedAt,
    };
    if (!existingKnifeLayoutVersion) {
      await tx.insert(sheetTemplateVersions).values(knifeLayoutValues);
    } else if (existingKnifeLayoutVersion.publishedAt === null) {
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: knifeLayoutValues.definition,
          requiresReview: knifeLayoutValues.requiresReview,
          sourceReference: knifeLayoutValues.sourceReference,
          changeNotes: knifeLayoutValues.changeNotes,
          publishedAt: knifeLayoutValues.publishedAt,
        })
        .where(eq(sheetTemplateVersions.id, existingKnifeLayoutVersion.id));
    }

    // 倉位入庫表. Active from 2026-08-13 from the supplied legacy workbook. It
    // is the only production sheet 倉管 has, needs no review, and both of the
    // department's employees may edit any of its sheets.
    const [warehouseDepartment] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.code, "WAREHOUSE"))
      .limit(1);
    if (!warehouseDepartment) {
      throw new Error("WAREHOUSE department is required for template seed");
    }

    const warehouseDescription =
      "依使用者提供的 XLS 轉錄，保留原始欄位、比例與二十八列版面。";
    await tx
      .insert(sheetTemplates)
      .values({
        departmentId: warehouseDepartment.id,
        slug: warehouseLocationIntakeV1.templateKey,
        displayName: warehouseLocationIntakeV1.displayName,
        description: warehouseDescription,
        active: true,
        currentVersionNumber: 1,
      })
      .onConflictDoUpdate({
        target: [sheetTemplates.departmentId, sheetTemplates.slug],
        set: {
          displayName: warehouseLocationIntakeV1.displayName,
          description: warehouseDescription,
          active: true,
          currentVersionNumber: 1,
          updatedAt: publishedAt,
        },
      });

    const [warehouseIntakeTemplate] = await tx
      .select({ id: sheetTemplates.id })
      .from(sheetTemplates)
      .where(
        and(
          eq(sheetTemplates.departmentId, warehouseDepartment.id),
          eq(sheetTemplates.slug, warehouseLocationIntakeV1.templateKey),
        ),
      )
      .limit(1);
    if (!warehouseIntakeTemplate) {
      throw new Error("Failed to seed 倉位入庫表 template");
    }

    const [existingWarehouseIntakeVersion] = await tx
      .select({
        id: sheetTemplateVersions.id,
        publishedAt: sheetTemplateVersions.publishedAt,
      })
      .from(sheetTemplateVersions)
      .where(
        and(
          eq(sheetTemplateVersions.templateId, warehouseIntakeTemplate.id),
          eq(sheetTemplateVersions.version, 1),
        ),
      )
      .limit(1);
    const warehouseIntakeValues = {
      templateId: warehouseIntakeTemplate.id,
      version: 1,
      definition: warehouseLocationIntakeV1,
      requiresReview: false,
      sourceReference:
        "user-workbook:2026-08-13:倉位入庫表.xls:sha256:19208C8211BBB956AC4EE3A3C581B52A839A47E5436F65E5A4E6251733F7D2C8",
      changeNotes:
        "Transcribed from the 倉位入庫 worksheet of the supplied XLS with exact visible labels, twenty-eight rows, and source column proportions.",
      publishedAt,
    };
    if (!existingWarehouseIntakeVersion) {
      await tx.insert(sheetTemplateVersions).values(warehouseIntakeValues);
    } else if (existingWarehouseIntakeVersion.publishedAt === null) {
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: warehouseIntakeValues.definition,
          requiresReview: warehouseIntakeValues.requiresReview,
          sourceReference: warehouseIntakeValues.sourceReference,
          changeNotes: warehouseIntakeValues.changeNotes,
          publishedAt: warehouseIntakeValues.publishedAt,
        })
        .where(eq(sheetTemplateVersions.id, existingWarehouseIntakeVersion.id));
    }

    // 裁剪需求表. Active from 2026-08-15 from the supplied DOCX. 平板剪's own
    // sheet: 訂單人員 open it with what the customer ordered, the 主管 fills the
    // production side, and 員工 correct either. No review.
    const [flatShearDepartment] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.code, "FLAT_SHEAR"))
      .limit(1);
    if (!flatShearDepartment) {
      throw new Error("FLAT_SHEAR department is required for template seed");
    }

    const cuttingRequestDescription =
      "依使用者提供的 DOCX 轉錄，保留原始欄位、十列產品規格與三張積鐵芯疊法圖。";
    await tx
      .insert(sheetTemplates)
      .values({
        departmentId: flatShearDepartment.id,
        slug: flatShearCuttingRequestV1.templateKey,
        displayName: flatShearCuttingRequestV1.displayName,
        description: cuttingRequestDescription,
        active: true,
        currentVersionNumber: 2,
      })
      .onConflictDoUpdate({
        target: [sheetTemplates.departmentId, sheetTemplates.slug],
        set: {
          displayName: flatShearCuttingRequestV1.displayName,
          description: cuttingRequestDescription,
          active: true,
          currentVersionNumber: 2,
          updatedAt: publishedAt,
        },
      });

    const [cuttingRequestTemplate] = await tx
      .select({ id: sheetTemplates.id })
      .from(sheetTemplates)
      .where(
        and(
          eq(sheetTemplates.departmentId, flatShearDepartment.id),
          eq(sheetTemplates.slug, flatShearCuttingRequestV1.templateKey),
        ),
      )
      .limit(1);
    if (!cuttingRequestTemplate) {
      throw new Error("Failed to seed 裁剪需求表 template");
    }

    const [existingCuttingRequestVersion] = await tx
      .select({
        id: sheetTemplateVersions.id,
        publishedAt: sheetTemplateVersions.publishedAt,
      })
      .from(sheetTemplateVersions)
      .where(
        and(
          eq(sheetTemplateVersions.templateId, cuttingRequestTemplate.id),
          eq(sheetTemplateVersions.version, 1),
        ),
      )
      .limit(1);
    const cuttingRequestValues = {
      templateId: cuttingRequestTemplate.id,
      version: 1,
      definition: flatShearCuttingRequestV1,
      requiresReview: false,
      sourceReference:
        "user-document:2026-08-15:裁剪需求表.docx:sha256:AC1896205DA368B1AFE9037152089A85ABABEA45CC507E9B6D958D22CD7B01C5",
      changeNotes:
        "Transcribed from the supplied DOCX with the printed labels, ten 產品規格 rows, the source column proportions, and the three 積鐵芯疊法 drawings. 交期 is bound to the sheet deadline.",
      publishedAt,
    };
    if (!existingCuttingRequestVersion) {
      await tx.insert(sheetTemplateVersions).values(cuttingRequestValues);
    } else if (existingCuttingRequestVersion.publishedAt === null) {
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: cuttingRequestValues.definition,
          requiresReview: cuttingRequestValues.requiresReview,
          sourceReference: cuttingRequestValues.sourceReference,
          changeNotes: cuttingRequestValues.changeNotes,
          publishedAt: cuttingRequestValues.publishedAt,
        })
        .where(eq(sheetTemplateVersions.id, existingCuttingRequestVersion.id));
    }

    // Version 2 (the user, 2026-10-02): the header on the document's own
    // columns. Sheets made from version 1 keep it.
    const cuttingRequestVersionTwoValues = {
      templateId: cuttingRequestTemplate.id,
      version: 2,
      definition: flatShearCuttingRequestV2,
      requiresReview: false,
      sourceReference: cuttingRequestValues.sourceReference,
      changeNotes:
        "Lays the header on the Word table's own columns (every edge any row draws: 61.7, 92, 29.5, 20.7, 42, 42.9, 70.7, 64.3, 56.5, 71.1 pt), so labels and boxes line up and keep the document's sizes, and prints the table's 產品規格 row above the register's headings, which version 1 left out (user requests 2026-10-02). Fields and rules are unchanged.",
      publishedAt,
    };
    const [existingCuttingRequestVersionTwo] = await tx
      .select({
        id: sheetTemplateVersions.id,
        publishedAt: sheetTemplateVersions.publishedAt,
      })
      .from(sheetTemplateVersions)
      .where(
        and(
          eq(sheetTemplateVersions.templateId, cuttingRequestTemplate.id),
          eq(sheetTemplateVersions.version, 2),
        ),
      )
      .limit(1);
    if (!existingCuttingRequestVersionTwo) {
      await tx.insert(sheetTemplateVersions).values(cuttingRequestVersionTwoValues);
    } else if (existingCuttingRequestVersionTwo.publishedAt === null) {
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: cuttingRequestVersionTwoValues.definition,
          requiresReview: cuttingRequestVersionTwoValues.requiresReview,
          sourceReference: cuttingRequestVersionTwoValues.sourceReference,
          changeNotes: cuttingRequestVersionTwoValues.changeNotes,
          publishedAt: cuttingRequestVersionTwoValues.publishedAt,
        })
        .where(eq(sheetTemplateVersions.id, existingCuttingRequestVersionTwo.id));
    }

    // EI客戶訂購表. Active from 2026-08-21 from the supplied legacy workbook.
    // 沖壓's customer order register: no review, and only 主管 and 訂單人員
    // open or maintain it.
    const [stampingDepartment] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.code, "STAMPING"))
      .limit(1);
    if (!stampingDepartment) {
      throw new Error("STAMPING department is required for template seed");
    }

    const eiOrderDescription =
      "依使用者提供的 XLS 轉錄，保留原始欄位、比例與二十四列版面。";
    await tx
      .insert(sheetTemplates)
      .values({
        departmentId: stampingDepartment.id,
        slug: stampingEiCustomerOrderV1.templateKey,
        displayName: stampingEiCustomerOrderV1.displayName,
        description: eiOrderDescription,
        active: true,
        currentVersionNumber: 1,
      })
      .onConflictDoUpdate({
        target: [sheetTemplates.departmentId, sheetTemplates.slug],
        set: {
          displayName: stampingEiCustomerOrderV1.displayName,
          description: eiOrderDescription,
          active: true,
          currentVersionNumber: 1,
          updatedAt: publishedAt,
        },
      });

    const [eiOrderTemplate] = await tx
      .select({ id: sheetTemplates.id })
      .from(sheetTemplates)
      .where(
        and(
          eq(sheetTemplates.departmentId, stampingDepartment.id),
          eq(sheetTemplates.slug, stampingEiCustomerOrderV1.templateKey),
        ),
      )
      .limit(1);
    if (!eiOrderTemplate) {
      throw new Error("Failed to seed EI客戶訂購表 template");
    }

    const [existingEiOrderVersion] = await tx
      .select({
        id: sheetTemplateVersions.id,
        publishedAt: sheetTemplateVersions.publishedAt,
      })
      .from(sheetTemplateVersions)
      .where(
        and(
          eq(sheetTemplateVersions.templateId, eiOrderTemplate.id),
          eq(sheetTemplateVersions.version, 1),
        ),
      )
      .limit(1);
    const eiOrderValues = {
      templateId: eiOrderTemplate.id,
      version: 1,
      definition: stampingEiCustomerOrderV1,
      requiresReview: false,
      sourceReference:
        "user-workbook:2026-08-21:EI客戶訂購表.xls:sha256:DB0AA3A590DAF268AEDB8394DA67EE33BA6D2906C022CDBA01DE0C66465B0841",
      changeNotes:
        "Transcribed from the EI worksheet of the supplied XLS with the printed headings, twenty-four rows, source column proportions, and no row-number column.",
      publishedAt,
    };
    if (!existingEiOrderVersion) {
      await tx.insert(sheetTemplateVersions).values(eiOrderValues);
    } else if (existingEiOrderVersion.publishedAt === null) {
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: eiOrderValues.definition,
          requiresReview: eiOrderValues.requiresReview,
          sourceReference: eiOrderValues.sourceReference,
          changeNotes: eiOrderValues.changeNotes,
          publishedAt: eiOrderValues.publishedAt,
        })
        .where(eq(sheetTemplateVersions.id, existingEiOrderVersion.id));
    }

    // 加工製令單. Active from 2026-08-21 from the supplied legacy workbook.
    // CUT's processing work order: no review, and only 主管 and 訂單人員 open
    // or maintain it.
    const [cutDepartment] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.code, "CUT"))
      .limit(1);
    if (!cutDepartment) {
      throw new Error("CUT department is required for template seed");
    }

    const cutOrderDescription =
      "依使用者提供的 XLS 轉錄，保留原始標題、六列表頭與九道工作流程。";
    await tx
      .insert(sheetTemplates)
      .values({
        departmentId: cutDepartment.id,
        slug: cutProcessingOrderV1.templateKey,
        displayName: cutProcessingOrderV1.displayName,
        description: cutOrderDescription,
        active: true,
        currentVersionNumber: 2,
      })
      .onConflictDoUpdate({
        target: [sheetTemplates.departmentId, sheetTemplates.slug],
        set: {
          displayName: cutProcessingOrderV1.displayName,
          description: cutOrderDescription,
          active: true,
          currentVersionNumber: 2,
          updatedAt: publishedAt,
        },
      });

    const [cutOrderTemplate] = await tx
      .select({ id: sheetTemplates.id })
      .from(sheetTemplates)
      .where(
        and(
          eq(sheetTemplates.departmentId, cutDepartment.id),
          eq(sheetTemplates.slug, cutProcessingOrderV1.templateKey),
        ),
      )
      .limit(1);
    if (!cutOrderTemplate) {
      throw new Error("Failed to seed 加工製令單 template");
    }

    const [existingCutOrderVersion] = await tx
      .select({
        id: sheetTemplateVersions.id,
        publishedAt: sheetTemplateVersions.publishedAt,
      })
      .from(sheetTemplateVersions)
      .where(
        and(
          eq(sheetTemplateVersions.templateId, cutOrderTemplate.id),
          eq(sheetTemplateVersions.version, 1),
        ),
      )
      .limit(1);
    const cutOrderValues = {
      templateId: cutOrderTemplate.id,
      version: 1,
      definition: cutProcessingOrderV1,
      requiresReview: false,
      sourceReference:
        "user-workbook:2026-08-21:加工製令單.xls:sha256:8EB87FFE7EBD5C18263561E0373D23A6600A63346CC2536F2F9C72422F203642",
      changeNotes:
        "Transcribed from the 新 worksheet of the supplied XLS with the printed header rows, the nine-step process table, and the source column proportions. The company letterhead and the workbook's zero-sized leftover line objects are not form content and are excluded.",
      publishedAt,
    };
    if (!existingCutOrderVersion) {
      await tx.insert(sheetTemplateVersions).values(cutOrderValues);
    } else if (existingCutOrderVersion.publishedAt === null) {
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: cutOrderValues.definition,
          requiresReview: cutOrderValues.requiresReview,
          sourceReference: cutOrderValues.sourceReference,
          changeNotes: cutOrderValues.changeNotes,
          publishedAt: cutOrderValues.publishedAt,
        })
        .where(eq(sheetTemplateVersions.id, existingCutOrderVersion.id));
    }

    // Version 2 (the user, 2026-10-02): the header on the worksheet's own
    // columns, so its labels and boxes line up. Sheets made from version 1
    // keep it.
    const cutOrderVersionTwoValues = {
      templateId: cutOrderTemplate.id,
      version: 2,
      definition: cutProcessingOrderV2,
      requiresReview: false,
      sourceReference: cutOrderValues.sourceReference,
      changeNotes:
        "Lays the header on the worksheet's ten columns (A–J, its own widths) so 客戶, 鐵芯尺寸, 材質, 鋼捲號, 備註 and 退火編號 share columns A–B, 訂購數量, 捲繞壓力 and 領料重量 column F, and 預重單重 and 約耗材總重 column H, as the paper does. Fields and rules are unchanged.",
      publishedAt,
    };
    const [existingCutOrderVersionTwo] = await tx
      .select({
        id: sheetTemplateVersions.id,
        publishedAt: sheetTemplateVersions.publishedAt,
      })
      .from(sheetTemplateVersions)
      .where(
        and(
          eq(sheetTemplateVersions.templateId, cutOrderTemplate.id),
          eq(sheetTemplateVersions.version, 2),
        ),
      )
      .limit(1);
    if (!existingCutOrderVersionTwo) {
      await tx.insert(sheetTemplateVersions).values(cutOrderVersionTwoValues);
    } else if (existingCutOrderVersionTwo.publishedAt === null) {
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: cutOrderVersionTwoValues.definition,
          requiresReview: cutOrderVersionTwoValues.requiresReview,
          sourceReference: cutOrderVersionTwoValues.sourceReference,
          changeNotes: cutOrderVersionTwoValues.changeNotes,
          publishedAt: cutOrderVersionTwoValues.publishedAt,
        })
        .where(eq(sheetTemplateVersions.id, existingCutOrderVersionTwo.id));
    }

    // Later templates share their publish shape, so they go through one
    // helper rather than another copy of the block above for each. Like every
    // block here it only writes a version that is not yet published:
    // published definitions are immutable.
    const publishTemplate = async (
      departmentId: string,
      definition: SheetTemplateDefinition,
      description: string,
      sourceReference: string,
      changeNotes: string,
      // Versions published after the first, in order; the last is current.
      laterVersions: readonly { definition: SheetTemplateDefinition; changeNotes: string }[] = [],
    ) => {
      const currentVersionNumber = 1 + laterVersions.length;
      await tx
        .insert(sheetTemplates)
        .values({
          departmentId,
          slug: definition.templateKey,
          displayName: definition.displayName,
          description,
          active: true,
          currentVersionNumber,
        })
        .onConflictDoUpdate({
          target: [sheetTemplates.departmentId, sheetTemplates.slug],
          set: {
            displayName: definition.displayName,
            description,
            active: true,
            currentVersionNumber,
            updatedAt: publishedAt,
          },
        });

      const [template] = await tx
        .select({ id: sheetTemplates.id })
        .from(sheetTemplates)
        .where(
          and(
            eq(sheetTemplates.departmentId, departmentId),
            eq(sheetTemplates.slug, definition.templateKey),
          ),
        )
        .limit(1);
      if (!template) {
        throw new Error(`Failed to seed ${definition.displayName} template`);
      }

      const versions = [{ definition, changeNotes }, ...laterVersions];
      for (const [index, version] of versions.entries()) {
        const [existingVersion] = await tx
          .select({
            id: sheetTemplateVersions.id,
            publishedAt: sheetTemplateVersions.publishedAt,
          })
          .from(sheetTemplateVersions)
          .where(
            and(
              eq(sheetTemplateVersions.templateId, template.id),
              eq(sheetTemplateVersions.version, index + 1),
            ),
          )
          .limit(1);
        const values = {
          templateId: template.id,
          version: index + 1,
          definition: version.definition,
          requiresReview: version.definition.workflow.requiresReview,
          sourceReference,
          changeNotes: version.changeNotes,
          publishedAt,
        };
        if (!existingVersion) {
          await tx.insert(sheetTemplateVersions).values(values);
        } else if (existingVersion.publishedAt === null) {
          await tx
            .update(sheetTemplateVersions)
            .set({
              definition: values.definition,
              requiresReview: values.requiresReview,
              sourceReference: values.sourceReference,
              changeNotes: values.changeNotes,
              publishedAt: values.publishedAt,
            })
            .where(eq(sheetTemplateVersions.id, existingVersion.id));
        }
      }
    };
    const publishCutTemplate = (
      definition: SheetTemplateDefinition,
      description: string,
      sourceReference: string,
      changeNotes: string,
      laterVersions: readonly { definition: SheetTemplateDefinition; changeNotes: string }[] = [],
    ) => publishTemplate(cutDepartment.id, definition, description, sourceReference, changeNotes, laterVersions);

    const cutRegisterSource =
      "user-workbook:2026-09-17:CUT客戶訂購表.xlsx:sha256:2335C6241D8E962C30E69A41059D7160C4D85B02AB148003DEA68F4F872A0D29";
    await publishCutTemplate(
      cutCustomerOrderV1,
      "依使用者提供的 XLSX 轉錄，八欄二十五列的客戶訂購登記表。",
      cutRegisterSource,
      "Transcribed from the CUT worksheet of the supplied workbook with its eight printed headings, twenty-five unnumbered rows and the source column proportions.",
    );
    await publishCutTemplate(
      cutCustomerOrderDaYinV1,
      "依使用者提供的 XLSX 轉錄，大銀與直得專用的十一欄客戶訂購登記表。",
      cutRegisterSource,
      "Transcribed from the 大銀.直得 worksheet. Its sixteen printed rows exclude the worksheet's hidden rows, and no document identifier is seeded because the form prints none.",
    );
    await publishCutTemplate(
      cutCustomerOrderShihlinV1,
      "依使用者提供的 XLSX 轉錄，士林電機專用的九欄客戶訂單登記表。",
      cutRegisterSource,
      "Transcribed from the 士電 worksheet. Only its printed structure is taken: the worksheet's live customer rows and its formula-driven weight calculator are not seeded.",
      [
        {
          definition: cutCustomerOrderShihlinV2,
          changeNotes:
            "品名 is one cell written on two lines, as the worksheet's own entries are, so its box takes two lines (user request 2026-10-02). Nothing else changes.",
        },
      ],
    );

    await publishCutTemplate(
      cutProductionBoardV1,
      "依使用者提供的 XLSX 轉錄，七欄八列的生產作業看板，附工序代號定義。",
      "user-workbook:2026-09-24:生產作業看板(CUT).xlsx:sha256:81E8B8EEA58B7389853A6B7CAC7E989BB32CBDC3DC804CC6A196EAC99365B900",
      "Transcribed from the single worksheet of the supplied workbook: seven printed headings over eight unnumbered rows, the 工序 code legend exactly as printed, the source column proportions, and A4 landscape.",
    );

    // CUT's two daily reports come from one workbook, and neither is reviewed.
    const cutDailyReportSource =
      "user-workbook:2026-09-25:生產日報表(CUT).xls:sha256:3CB75CF8BC7B7FA59988D717F20191C2B617F33C39030974EE809D2C4A41B782";
    await publishCutTemplate(
      cutPersonalDailyReportV1,
      "依使用者提供的 XLS 轉錄，個人每日工作紀錄：姓名、日期、六列工作，附工作代號說明。",
      cutDailyReportSource,
      "Transcribed from the CUT個人生產日報表 worksheet: 姓名 and 日期 beside the title, five printed headings over six unnumbered rows at the source proportions, the ten 工作代號 codes as printed, and F/P5-04-01 below the grid. The worksheet's second copy on the same page, printed for cutting in half, is not repeated.",
    );
    await publishCutTemplate(
      cutDailyReportV1,
      "依使用者提供的 XLS 轉錄，八人每日生產紀錄：每人八列，姓名跨列填寫，每頁四人。",
      cutDailyReportSource,
      "Transcribed from the CUT生產日報表(1) and (2) worksheets as one form: 日期 beside the title, eight people of eight rows each with the name in a cell spanning their rows and their number outside the box, four to a printed page, and 經理 / 組長 signatures below. The worksheets' printed employee names are not seeded; names are written per sheet.",
    );

    await publishCutTemplate(
      cutFinishedInspectionV1,
      "依使用者提供的 DOC 轉錄，成品外觀尺寸檢查表：基本資料、判定、九列尺寸紀錄，附尺寸位置圖與公差表。",
      "user-document:2026-09-25:CUT成品檢查表.doc:sha256:D6018AF484A1C8F4251F36700DE39A581FD3CB401C258538532873BC6C1A3403",
      "Transcribed from the Word form: its current letterhead, 工單號 above the box, three rows of particulars with 檢查工具 printed as 游標卡尺 and 判定 as OK/NG boxes, the 外觀尺寸 register in mm with its 尺寸 / 序號 corner cell over nine rows at the table's proportions, and the core views redrawn from the document's shapes beside the 公差 table, with F/P5-02-02 below.",
      [
        {
          definition: cutFinishedInspectionV2,
          changeNotes:
            "The particulars sit on the document's own six columns (78.5, 110.6, 126, 90, 47.6, 105.5 pt), so 客戶名, 材質 and 檢查工具 line up with boxes the same size, as do 規格, 數量 and 審查員, and 日期 and 判定; 規格's box runs to the right edge as the document merges it (user request 2026-10-02). Nothing else changes.",
        },
      ],
    );

    // CUT's characteristic inspections: one workbook, four layouts, none
    // reviewed.
    const characteristicSource =
      "user-workbook:2026-09-26:特性檢驗表.xls:sha256:BCF3EDB75098ADA1B655A531435F1A474E0826E10B74DC8175BF0E837F480BEE";
    // Version 2 of each (user request 2026-10-02): the header on its
    // worksheet's columns.
    const characteristicGrid = (definition: SheetTemplateDefinition) => [
      {
        definition,
        changeNotes:
          "The header sits on the worksheet's own columns, so labels and boxes line up from row to row as on the other forms, and below the register the A–D views sit beside the fields in the room the short 出貨數量 and 抽樣數量 boxes leave, larger than before, as the worksheet sets them (user requests 2026-10-02). Fields and rules are unchanged; 信太's paired 電壓 and 電流(1) readings share one box each, as the worksheet writes them.",
      },
    ];
    await publishCutTemplate(
      cutCharacteristicInspectionV1,
      "依使用者提供的 XLS 轉錄，特性檢驗報告單：基本資料、標準值與十五列測試值（A–D、電流、鐵損），附量測位置圖。",
      characteristicSource,
      "Transcribed from the CUT and 士電 worksheets as one form: 客戶 written per sheet, the 標準值 / 測試值 corner with the standard written under each heading letter, fifteen test rows at the worksheet's proportions with mA and W printed in their cells, 出貨數量 and 抽樣數量, the core views redrawn from the worksheet's shapes, 檢驗者, and F/P5-03-01.",
      characteristicGrid(cutCharacteristicInspectionV2),
    );
    await publishCutTemplate(
      cutCharacteristicInspectionSongmaoV1,
      "依使用者提供的 XLS 轉錄，崧貿專用特性檢驗報告單：標準值列與十五列編號測試值。",
      characteristicSource,
      "Transcribed from the identical 崧貿-大, 崧貿-小 and 崧貿-樣品 worksheets as one form: 客戶 printed as 崧貿, the 位置 / 標準值 corner over a ruled standard row printing MA and W, and tests numbered 1 to 15.",
      characteristicGrid(cutCharacteristicInspectionSongmaoV2),
    );
    await publishCutTemplate(
      cutFactoryInspectionChiaoliV1,
      "依使用者提供的 XLS 轉錄，巧力工業出廠檢驗單：十筆激磁電流，序 1–5 與 6–10 並列。",
      characteristicSource,
      "Transcribed from the 巧力D5-10015 worksheet: addressed to 巧力工業's 採購部 with its telephone and fax, the company name over the title, 電壓 頻率 品名 匝數 訂號, and ten 激磁電流 readings in mA printed as two side-by-side blocks. The form prints no letterhead and no document identifier.",
      characteristicGrid(cutFactoryInspectionChiaoliV2),
    );
    await publishCutTemplate(
      cutCharacteristicInspectionShintaiV1,
      "依使用者提供的 XLS 轉錄，信太專用特性檢驗報告單 2.0 版：十五列尺寸與電流，逐列勾選合格或不合格。",
      characteristicSource,
      "Transcribed from the 信太版本 2.0 worksheet: 客戶 信太 and 品名 環型鐵心 printed, 客戶單號 with its printed B, paired 電壓 and 電流(1) maximum / minimum readings beside the voltage note, fifteen rows of A(積厚)–D(寬度), 電流(1), 電流(2) and a 合格 / 不合格 tick, the red 尺寸容許差, 檢驗者, 備註, the toroid's views and the red VER 2.0 mark.",
      characteristicGrid(cutCharacteristicInspectionShintaiV2),
    );

    await publishCutTemplate(
      cutDefectRateV1,
      "依使用者提供的 XLSX 轉錄，月份不良率統計表：月份，二十一列工單的訂單數、成品數、不良數與重量。",
      "user-workbook:2026-09-26:不良率統計表(空白).xlsx:sha256:44249A28F12105F56EA3F1C77692A8B3736904CF29A134AE27B6ED62326F17BB",
      "Transcribed from the blank worksheet: the letterhead, 月份 before the title and F/P5-09-02 at the right, and seven printed headings over twenty-one unnumbered rows at the worksheet's proportions. The worked June example on the second worksheet is not seeded.",
    );

    await publishCutTemplate(
      cutAnnealingListV1,
      "依使用者提供的 XLSX 轉錄，退火明細表：CUT 填寫工單，送交後轉至燒頓記錄退火。",
      "user-workbook:2026-09-27:退火明細表.xlsx:sha256:6D3469A8DA4366D979D8CA1C3B47088782538301BFAA7A2C2A209452501576C8",
      "Transcribed from the 20260306版 worksheet, A4 landscape: the current letterhead, three rows of firing particulars with 程式編號 printed 第 … 程式 and 外觀檢驗 as 合格 / 不合格 boxes, two edge-to-edge blocks of 工單號 規格 材質 數量 重量 over nine rows each, 燒炖者 and 填表人, and F/P5-06-03. Created in CUT; handing it on sends it to 燒頓.",
      [
        {
          definition: cutAnnealingListV2,
          changeNotes:
            "The particulars sit on three equal columns of label and box, so 編號, 爐號 and 程式編號 line up with boxes the same size, as do 起始時間, 溫度 and 外觀檢驗; 程式編號 takes a box before 第 and after 程式 as well as between them (user request 2026-10-02). Nothing else changes.",
        },
      ],
    );

    await publishCutTemplate(
      cutPatrolInspectionV1,
      "依使用者提供的 XLSX 轉錄，首件/巡迴檢驗單：首件檢驗與六次製程檢驗，附鐵心尺寸圖與公差表。",
      "user-workbook:2026-09-29:CUT-首件巡迴檢驗單.xlsx:sha256:4BB1FDB5B7491A25A472A69A7D37879F7036B4F524CAC2E6B5E8923507B84E4F",
      "Transcribed from the 20260716改 worksheet, A4 portrait: the older 台北縣 stationery, the title, 生產日期/班次 品管員 作業人員 and 製令單號 規格/材質 機床, 首件檢驗 (捲繞 A–D and 切割 E with 標準 and three 檢測值, 龜裂 研磨 變形 油壓 浸漆 烘箱 ticked across them, a ✓/✗ 判定 on every row, and beside them the C型 and 環型 views redrawn from the worksheet's shapes with 類型 and the note), 製程檢驗 (six rounds headed ＿日 ＿時 ＿分, the same measurements, 有/無 and NG/OK), the 公差 table beside 鋼捲號, 單位：mm and the ✓/✗ key, 備註 and 審核, and F/Q1-08-07.",
    );

    // Owned by CUT, whose folder the worksheet came from, and created in CUT
    // or 沖壓: the seed ticks it in both departments' default subpages.
    await publishCutTemplate(
      cutFiringQualityRecordV1,
      "依使用者提供的 XLS 轉錄，燒炖質量記錄表：CUT 或沖壓填寫每爐燒炖紀錄，送交後轉至燒頓。",
      "user-workbook:2026-09-28:燒炖質量記錄表.xls:sha256:04A94424DBA5ABF5EC61DFBFE2C7B1049FA3247E676FA204A8F0A9B3ECCF46C2",
      "Transcribed from the Sheet1 worksheet, A4 landscape: the title, twelve printed headings broken where the worksheet breaks them — 爐號/胆號 kept as printed — over ten unnumbered rows at the worksheet's proportions, and F/P4-01-02 below the box. Created in CUT or 沖壓; handing it on sends it to 燒頓.",
    );

    // 沖壓's own: written there and handed on to 燒頓.
    await publishTemplate(
      stampingDepartment.id,
      stampingFiringIntakeV1,
      "依使用者提供的 XLS 轉錄，待燒入庫表：沖壓登記待燒入庫品項，送交後轉至燒頓。",
      "user-workbook:2026-09-28:待燒入庫表.xls:sha256:F8A6E55CC2B05A0D2C1EDBDEF1B5EDA0B71D8444C1989DE99CD22C089A7A6966",
      "Transcribed from the 待燒入庫單 worksheet, A4 portrait: the title 待燒入庫表, 序 numbered 1 to 25, 入庫日 規格/材質 重量/箱數 倉位/備註 at the worksheet's proportions, and F/P4-02-01 below the box. The workbook's other worksheets (領料單, 分條日報, 分條-黃, 分條-姚) are separate forms and are not seeded. Created in 沖壓; handing it on sends it to 燒頓.",
    );

    await publishTemplate(
      stampingDepartment.id,
      stampingProductDemandV1,
      "依使用者提供的 XLS 轉錄，產品需求表：製令、規格、材質、數量，交期勾選庫存或其他並填寫。",
      "user-workbook:2026-09-28:產品需求表.xls:sha256:41DBEADE51F7CE393FE75584933E214F101E630C7A875571CA87A19C8AA0A20F",
      "Transcribed from Sheet1, A4 portrait: the current 新北市 letterhead, the title, 製令NO：/ 規格 / 材質 / 數量 / 交期 / 備註 over twenty-two unnumbered rows at the worksheet's proportions, 交期 as □庫存□其他：with a line written after 其他, and F/M1-03-01 below the box. The 涵宇 worksheet is the user's worked example and is not seeded.",
    );

    await publishTemplate(
      stampingDepartment.id,
      stampingProductionBoardV1,
      "依使用者提供的 XLSX 轉錄，沖壓生產作業看板：編號十二列，在沖與待沖的規格、材質、產量與安裝日期。",
      "user-workbook:2026-09-28:生產作業看板(沖壓).xlsx:sha256:F89FACBB61EF4F55D7EE5406D4A7A13863853A5ADB5110A0A0C14EBC8579C93C",
      "Transcribed from Sheet1, A4 landscape: 編號 numbering twelve rows beside 規格材質 日期 預計產量 and 待沖規格 材質 預計產量 安裝日期, then 備註, at the worksheet's proportions, with F/P2-09-01 below the box. The worksheet prints no title; as with CUT's board, the name comes from the file without the department.",
    );

    await publishTemplate(
      stampingDepartment.id,
      stampingDailyReportV1,
      "依使用者提供的 XLSX 轉錄，沖壓生產日報表：正面八列生產紀錄與不良品，背面十二格材料標籤。",
      "user-workbook:2026-09-29:生產日報表(沖壓).xlsx:sha256:B086B0C269A73B2DADB06666091F474F259C512ACA5BA283D86087B9141D9320",
      "Transcribed from both sides. 正面, A4 landscape: the current 新北市 letterhead, the title, 日期 and 上班 (□未加班 □有加班 □假日加班3小時 □假日加班6小時 □請假 ＿H) on one line, eight rows under two-row headings — 箱重/箱數 as E: ＿K* ＿箱 and I: ＿K* ＿箱, 不良品 as C級 and D級 each E: ＿K over I: ＿K and 報廢 ＿K — then the PS note and F/P2-10-01. 背面, A4 portrait: twelve spaces, 1–6 down the left and 7–12 down the right, for the material labels.",
    );

    // Owned by 沖壓 and written by 沖壓 and 平板剪, each keeping its own: the
    // seed ticks it in both departments' default subpages.
    await publishTemplate(
      stampingDepartment.id,
      stampingPatrolInspectionV1,
      "依使用者提供的 XLSX 轉錄，沖壓・平板剪首件/巡迴檢驗單：首件檢驗與六次製程檢驗，附剪片與 EI 尺寸圖。",
      "user-workbook:2026-09-30:EI+平板剪-首件巡迴檢驗單.xlsx:sha256:6236C96AFDF3E2EF06E8E545230BC16068542E1788C90E9BF006747D2739F8D8",
      "Transcribed from the EI+平板剪(1150924改) worksheet, A4 portrait: the black-and-white 台北縣 letterhead, the title, 生產日期/班次 品管員 作業人員 and 製令單號 規格/材質 機床/模具, 首件檢驗 (尺寸 A K D N and 積厚 in mm, a blank line and 孔徑∮Ho, each with a written 標準, a printed 公差, two 檢測值 and 判定; 毛刺≦0.02mm 板形 料厚 written across them; 外觀 劃傷 壓印 鏽斑 角度 ticked 有 or 無; beside them the 剪片 and EI views redrawn from the worksheet's shapes, 類型 and 尺寸公差：±0.1mm), 製程檢驗 (each round's 製令單號 and 規格 above its ＿日 ＿時 ＿分, the same measurements, 有/無 and NG/OK), 重量 標識 包裝外觀, 異常描述 材料 and 成品 with 主管裁示, 品質判定 合格/不合格, 備註 審核 and 單位：mm, and F/Q1-01-03. Written in 沖壓 or 平板剪 and kept there; no review.",
    );

    const [existingAdmin] = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(
        roleAssignments,
        and(
          eq(roleAssignments.userId, users.id),
          eq(roleAssignments.role, "ADMIN"),
          eq(roleAssignments.active, true),
        ),
      )
      .limit(1);

    if (existingAdmin) return;

    const [usernameCollision] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, "admin"))
      .limit(1);

    if (usernameCollision) {
      throw new Error(
        "Cannot bootstrap ADMIN because username 'admin' already exists without the ADMIN role",
      );
    }

    const passwordHash = await argon2.hash("DemoOnly2026!", { type: argon2.argon2id });
    const [admin] = await tx
      .insert(users)
      .values({
        username: "admin",
        displayName: "系統管理員",
        passwordHash,
        passwordWarning: true,
      })
      .returning({ id: users.id });

    if (!admin) throw new Error("Failed to create bootstrap ADMIN");

    await tx.insert(roleAssignments).values({
      userId: admin.id,
      role: "ADMIN",
    });
  });

  process.stdout.write(
    "Departments, templates, and bootstrap administrator are ready.\n",
  );
} finally {
  await connection.close();
}
