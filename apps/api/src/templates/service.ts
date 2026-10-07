import { and, asc, eq, max } from "drizzle-orm";
import {
  sheetTemplateDefinitionSchema,
  type SaveTemplateVersionRequest,
  type SheetTemplateDefinition,
} from "@workflow/contracts";
import {
  auditEvents,
  departments,
  sheetTemplates,
  sheetTemplateVersions,
  templateClientMutations,
  type Database,
} from "@workflow/database";
import { ConflictError, ResourceNotFoundError } from "../auth/errors.js";
import type { RequestSecurityContext } from "../auth/service.js";

export class TemplateService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listForAdministration() {
    const rows = await this.db
      .select({
        id: sheetTemplates.id,
        slug: sheetTemplates.slug,
        displayName: sheetTemplates.displayName,
        description: sheetTemplates.description,
        active: sheetTemplates.active,
        currentVersionNumber: sheetTemplates.currentVersionNumber,
        departmentId: departments.id,
        departmentCode: departments.code,
        departmentName: departments.displayName,
        versionId: sheetTemplateVersions.id,
        version: sheetTemplateVersions.version,
        definition: sheetTemplateVersions.definition,
        requiresReview: sheetTemplateVersions.requiresReview,
        sourceReference: sheetTemplateVersions.sourceReference,
        changeNotes: sheetTemplateVersions.changeNotes,
        publishedAt: sheetTemplateVersions.publishedAt,
        createdAt: sheetTemplateVersions.createdAt,
      })
      .from(sheetTemplates)
      .innerJoin(
        departments,
        eq(departments.id, sheetTemplates.departmentId),
      )
      .leftJoin(
        sheetTemplateVersions,
        eq(sheetTemplateVersions.templateId, sheetTemplates.id),
      )
      .orderBy(
        asc(departments.displayName),
        asc(sheetTemplates.displayName),
        asc(sheetTemplateVersions.version),
      );

    const templates = new Map<
      string,
      {
        id: string;
        slug: string;
        displayName: string;
        description: string | null;
        active: boolean;
        currentVersionNumber: number | null;
        department: { id: string; code: string; displayName: string };
        versions: Array<Record<string, unknown>>;
      }
    >();

    for (const row of rows) {
      let template = templates.get(row.id);
      if (!template) {
        template = {
          id: row.id,
          slug: row.slug,
          displayName: row.displayName,
          description: row.description,
          active: row.active,
          currentVersionNumber: row.currentVersionNumber,
          department: {
            id: row.departmentId,
            code: row.departmentCode,
            displayName: row.departmentName,
          },
          versions: [],
        };
        templates.set(row.id, template);
      }
      if (!row.versionId || row.version === null || !row.definition) continue;
      const parsed = sheetTemplateDefinitionSchema.safeParse(row.definition);
      template.versions.push({
        id: row.versionId,
        version: row.version,
        definition: parsed.success ? parsed.data : null,
        definitionValid: parsed.success,
        requiresReview: row.requiresReview,
        sourceReference: row.sourceReference,
        changeNotes: row.changeNotes,
        publishedAt: row.publishedAt,
        createdAt: row.createdAt,
      });
    }
    return [...templates.values()];
  }

  async getForAdministration(templateId: string) {
    const templates = await this.listForAdministration();
    const template = templates.find((item) => item.id === templateId);
    if (!template) throw new ResourceNotFoundError("找不到表單範本");
    return template;
  }

  async createDraftVersion(
    templateId: string,
    input: SaveTemplateVersionRequest,
    actorUserId: string,
    context: RequestSecurityContext,
  ) {
    const created = await this.db.transaction(async (tx) => {
      const template = await this.lockTemplate(tx, templateId);
      const prior = await this.priorMutation(
        tx,
        actorUserId,
        input.clientMutationId,
        "CREATE_VERSION",
        templateId,
      );
      if (prior) return prior;
      await this.assertDefinitionIdentity(
        tx,
        template,
        input.definition,
      );
      const [versionAggregate] = await tx
        .select({ value: max(sheetTemplateVersions.version) })
        .from(sheetTemplateVersions)
        .where(eq(sheetTemplateVersions.templateId, templateId));
      const version = (versionAggregate?.value ?? 0) + 1;
      const [row] = await tx
        .insert(sheetTemplateVersions)
        .values({
          templateId,
          version,
          definition: input.definition,
          requiresReview: input.definition.workflow.requiresReview,
          sourceReference: input.sourceReference,
          changeNotes: input.changeNotes,
        })
        .returning({ id: sheetTemplateVersions.id });
      if (!row) throw new Error("Failed to create template version");
      const result = {
        action: "CREATE_VERSION",
        templateId,
        versionId: row.id,
        version,
      };
      await tx.insert(auditEvents).values({
        actorUserId,
        action: "TEMPLATE_VERSION_CREATED",
        targetType: "SHEET_TEMPLATE_VERSION",
        targetId: row.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: this.versionAuditMetadata(
          templateId,
          version,
          input.definition,
        ),
      });
      await this.recordMutation(
        tx,
        actorUserId,
        input.clientMutationId,
        result,
        row.id,
      );
      return result;
    });
    return {
      ...created,
      template: await this.getForAdministration(templateId),
    };
  }

  async replaceDraftVersion(
    templateId: string,
    versionId: string,
    input: SaveTemplateVersionRequest,
    actorUserId: string,
    context: RequestSecurityContext,
  ) {
    const mutation = await this.db.transaction(async (tx) => {
      const template = await this.lockTemplate(tx, templateId);
      const prior = await this.priorMutation(
        tx,
        actorUserId,
        input.clientMutationId,
        "UPDATE_VERSION",
        templateId,
        versionId,
      );
      if (prior) return prior;
      await this.assertDefinitionIdentity(
        tx,
        template,
        input.definition,
      );
      const [version] = await tx
        .select({
          id: sheetTemplateVersions.id,
          version: sheetTemplateVersions.version,
          publishedAt: sheetTemplateVersions.publishedAt,
        })
        .from(sheetTemplateVersions)
        .where(
          and(
            eq(sheetTemplateVersions.id, versionId),
            eq(sheetTemplateVersions.templateId, templateId),
          ),
        )
        .for("update")
        .limit(1);
      if (!version) throw new ResourceNotFoundError("找不到表單範本版本");
      if (version.publishedAt) {
        throw new ConflictError("已發布的表單範本版本不可修改，請建立新版本");
      }
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: input.definition,
          requiresReview: input.definition.workflow.requiresReview,
          sourceReference: input.sourceReference,
          changeNotes: input.changeNotes,
        })
        .where(eq(sheetTemplateVersions.id, versionId));
      await tx.insert(auditEvents).values({
        actorUserId,
        action: "TEMPLATE_VERSION_UPDATED",
        targetType: "SHEET_TEMPLATE_VERSION",
        targetId: versionId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: this.versionAuditMetadata(
          templateId,
          version.version,
          input.definition,
        ),
      });
      const result = {
        action: "UPDATE_VERSION",
        templateId,
        versionId,
      };
      await this.recordMutation(
        tx,
        actorUserId,
        input.clientMutationId,
        result,
        versionId,
      );
      return result;
    });
    return {
      ...mutation,
      template: await this.getForAdministration(templateId),
    };
  }

  async publishVersion(
    templateId: string,
    versionId: string,
    active: boolean,
    clientMutationId: string,
    actorUserId: string,
    context: RequestSecurityContext,
  ) {
    const mutation = await this.db.transaction(async (tx) => {
      const template = await this.lockTemplate(tx, templateId);
      const prior = await this.priorMutation(
        tx,
        actorUserId,
        clientMutationId,
        "PUBLISH_VERSION",
        templateId,
        versionId,
      );
      if (prior) return prior;
      const [version] = await tx
        .select()
        .from(sheetTemplateVersions)
        .where(
          and(
            eq(sheetTemplateVersions.id, versionId),
            eq(sheetTemplateVersions.templateId, templateId),
          ),
        )
        .for("update")
        .limit(1);
      if (!version) throw new ResourceNotFoundError("找不到表單範本版本");
      if (version.publishedAt) {
        throw new ConflictError("此表單範本版本已發布");
      }
      if (
        template.currentVersionNumber !== null &&
        version.version <= template.currentVersionNumber
      ) {
        throw new ConflictError("不可發布早於或等於目前版本的草稿");
      }
      const parsed = sheetTemplateDefinitionSchema.safeParse(version.definition);
      if (!parsed.success || parsed.data.status !== "APPROVED") {
        throw new ConflictError("表單範本仍有未確認內容，無法發布");
      }
      if (!parsed.data.printLayout) {
        throw new ConflictError("發布前必須設定列印版面");
      }
      await this.assertDefinitionIdentity(tx, template, parsed.data);
      const now = this.now();
      await tx
        .update(sheetTemplateVersions)
        .set({
          definition: parsed.data,
          requiresReview: parsed.data.workflow.requiresReview,
          publishedByUserId: actorUserId,
          publishedAt: now,
        })
        .where(eq(sheetTemplateVersions.id, versionId));
      await tx
        .update(sheetTemplates)
        .set({
          displayName: parsed.data.displayName,
          currentVersionNumber: version.version,
          active,
          updatedAt: now,
        })
        .where(eq(sheetTemplates.id, templateId));
      await tx.insert(auditEvents).values({
        actorUserId,
        action: "TEMPLATE_VERSION_PUBLISHED",
        targetType: "SHEET_TEMPLATE_VERSION",
        targetId: versionId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: {
          ...this.versionAuditMetadata(
            templateId,
            version.version,
            parsed.data,
          ),
          previousCurrentVersionNumber: template.currentVersionNumber,
          previousActive: template.active,
          active,
        },
      });
      const result = {
        action: "PUBLISH_VERSION",
        templateId,
        versionId,
        version: version.version,
        active,
      };
      await this.recordMutation(
        tx,
        actorUserId,
        clientMutationId,
        result,
        versionId,
      );
      return result;
    });
    return {
      ...mutation,
      template: await this.getForAdministration(templateId),
    };
  }

  async setActive(
    templateId: string,
    active: boolean,
    clientMutationId: string,
    actorUserId: string,
    context: RequestSecurityContext,
  ) {
    const mutation = await this.db.transaction(async (tx) => {
      const template = await this.lockTemplate(tx, templateId);
      const prior = await this.priorMutation(
        tx,
        actorUserId,
        clientMutationId,
        "SET_ACTIVE",
        templateId,
      );
      if (prior) return prior;
      const result = {
        action: "SET_ACTIVE",
        templateId,
        active,
      };
      if (template.active === active) {
        await this.recordMutation(
          tx,
          actorUserId,
          clientMutationId,
          result,
          null,
        );
        return result;
      }
      if (active) {
        if (template.currentVersionNumber === null) {
          throw new ConflictError("表單範本尚無已發布版本，無法啟用");
        }
        const [published] = await tx
          .select({
            id: sheetTemplateVersions.id,
            definition: sheetTemplateVersions.definition,
            publishedAt: sheetTemplateVersions.publishedAt,
          })
          .from(sheetTemplateVersions)
          .where(
            and(
              eq(sheetTemplateVersions.templateId, templateId),
              eq(
                sheetTemplateVersions.version,
                template.currentVersionNumber,
              ),
            ),
          )
          .limit(1);
        const parsed = published
          ? sheetTemplateDefinitionSchema.safeParse(published.definition)
          : null;
        if (
          !published?.publishedAt ||
          !parsed?.success ||
          parsed.data.status !== "APPROVED"
        ) {
          throw new ConflictError("找不到目前已發布的表單範本版本");
        }
      }
      await tx
        .update(sheetTemplates)
        .set({ active, updatedAt: this.now() })
        .where(eq(sheetTemplates.id, templateId));
      await tx.insert(auditEvents).values({
        actorUserId,
        action: active ? "TEMPLATE_ACTIVATED" : "TEMPLATE_RETIRED",
        targetType: "SHEET_TEMPLATE",
        targetId: templateId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: {
          currentVersionNumber: template.currentVersionNumber,
          previousActive: template.active,
          active,
        },
      });
      await this.recordMutation(
        tx,
        actorUserId,
        clientMutationId,
        result,
        null,
      );
      return result;
    });
    return {
      ...mutation,
      template: await this.getForAdministration(templateId),
    };
  }

  private async priorMutation(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    actorUserId: string,
    clientMutationId: string,
    action: string,
    templateId: string,
    versionId?: string,
  ) {
    const [prior] = await tx
      .select({
        action: templateClientMutations.action,
        templateId: templateClientMutations.templateId,
        versionId: templateClientMutations.versionId,
        result: templateClientMutations.result,
      })
      .from(templateClientMutations)
      .where(
        and(
          eq(templateClientMutations.actorUserId, actorUserId),
          eq(templateClientMutations.clientMutationId, clientMutationId),
        ),
      )
      .limit(1);
    if (!prior) return null;
    if (
      prior.action !== action ||
      prior.templateId !== templateId ||
      (versionId !== undefined && prior.versionId !== versionId)
    ) {
      throw new ConflictError("此操作識別碼已被其他範本操作使用");
    }
    return { ...prior.result, replayed: true };
  }

  private async recordMutation(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    actorUserId: string,
    clientMutationId: string,
    result: Record<string, unknown>,
    versionId: string | null,
  ): Promise<void> {
    await tx.insert(templateClientMutations).values({
      actorUserId,
      clientMutationId,
      action: String(result.action),
      templateId: String(result.templateId),
      versionId,
      result,
    });
  }

  private async lockTemplate(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    templateId: string,
  ) {
    const [template] = await tx
      .select({
        id: sheetTemplates.id,
        slug: sheetTemplates.slug,
        departmentId: sheetTemplates.departmentId,
        active: sheetTemplates.active,
        currentVersionNumber: sheetTemplates.currentVersionNumber,
      })
      .from(sheetTemplates)
      .where(eq(sheetTemplates.id, templateId))
      .for("update")
      .limit(1);
    if (!template) throw new ResourceNotFoundError("找不到表單範本");
    return template;
  }

  private async assertDefinitionIdentity(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    template: { slug: string; departmentId: string },
    definition: SheetTemplateDefinition,
  ): Promise<void> {
    const [department] = await tx
      .select({ code: departments.code })
      .from(departments)
      .where(eq(departments.id, template.departmentId))
      .limit(1);
    if (!department) throw new Error("Template department is missing");
    if (
      definition.templateKey !== template.slug ||
      definition.ownerDepartmentCode !== department.code
    ) {
      throw new ConflictError("表單範本識別或所屬部門不符");
    }
  }

  private versionAuditMetadata(
    templateId: string,
    version: number,
    definition: SheetTemplateDefinition,
  ) {
    return {
      templateId,
      version,
      definitionStatus: definition.status,
      sourceImageSha256: definition.source.imageSha256,
      requiresReview: definition.workflow.requiresReview,
    };
  }
}
