import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  departmentCodeSchema,
  rowMarksFor,
  sheetTemplateDefinitionSchema,
  type CreateSheetRequest,
  type DepartmentSheetHistoryQuery,
  type DepartmentStaffMember,
  type RealtimeSheetSnapshot,
  type RoleCode,
  type SessionUser,
  type SheetDueDateRequest,
  type SheetRowMarkRequest,
  type SheetStatusRequest,
  isFieldEditableInState,
  type SheetFieldHistoryEntry,
  type SheetFieldHistoryQuery,
  type SheetLifecycleRequest,
  type SheetMoveSubpageRequest,
  type SheetPatchRequest,
  type SheetSubmitRequest,
  type SheetApproveRequest,
  type SheetRejectRequest,
  type SheetTemplateDefinition,
} from "@workflow/contracts";
import {
  approvalRuns,
  approvalSteps,
  auditEvents,
  departmentMemberships,
  departmentSubpageIdentityPermissions,
  departmentSubpageTemplates,
  departmentSubpages,
  departments,
  notifications,
  outboxJobs,
  productionSheets,
  roleAssignments,
  sheetAssignments,
  sheetAttachments,
  sheetClientMutations,
  sheetFieldVersions,
  sheetHandoffs,
  sheetRouteParticipants,
  sheetRowMarks,
  sheetSubpageHistory,
  sheetTemplates,
  sheetTemplateVersions,
  sheetValues,
  users,
  type Database,
} from "@workflow/database";
import {
  approveCurrentStage,
  archiveCompletedWork,
  FIRST_REVIEW_STATE,
  rejectCurrentStage,
  requiredApprovalRole,
  canRouteWork,
  restoreArchivedWork,
  COMPANY_MANAGER_ROLES,
  isCompanyManager,
  managesDepartment,
  postApprovalDestination,
  canSetDueDate,
  changeProductionStatus,
} from "@workflow/domain";
import type { SheetSignature, SignatureRole } from "@workflow/sheet-document";
import {
  AuthorizationError,
  ConflictError,
  ResourceNotFoundError,
  ServiceUnavailableError,
  SheetConflictError,
} from "../auth/errors.js";
import type { RequestSecurityContext } from "../auth/service.js";
import {
  fieldRules,
  getFieldValue,
  initialValues,
  setFieldValue,
  validateFieldValue,
  reviewedDataFingerprint,
  validateForSubmission,
  type FieldRule,
} from "./values.js";

type TemplateRecord = {
  id: string;
  displayName: string;
  versionId: string;
  version: number;
  definition: SheetTemplateDefinition;
  requiresReview: boolean;
};

type SheetRow = typeof productionSheets.$inferSelect;
type SheetEditorKind = FieldRule["editableBy"][number];

function approvalRoleToSignatureRole(role: RoleCode): SignatureRole | null {
  switch (role) {
    case "SALES":
    case "ASSOCIATE":
    case "GENERAL_MANAGER":
      return role;
    default:
      return null;
  }
}

function taipeiSignatureTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(value)
    // ICU may put a narrow or no-break space before the time; the sheet page
    // and the PDF both show this string, so it is made an ordinary space.
    .replace(/[   ]/g, " ");
}

function actorSnapshot(user: SessionUser) {
  return {
    userId: user.id,
    roles: user.roles,
    memberships: user.memberships.map((membership) => ({
      departmentId: membership.departmentId,
      kind: membership.kind,
    })),
  };
}

export function escapeHistoryLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}


export class SheetService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Whether a subpage's form ticks let this sheet's form be used there.
   *
   * The ticks decide what may be created in a subpage, what may be moved or
   * assigned into it, and what anyone but its 主管 may use there (the user's
   * decision, 2026-09-24). A form unticked after its sheets arrived leaves
   * them readable but no longer editable, submittable or workable by
   * 訂單人員 and 員工; the 主管 keeps full control so the work can still be
   * moved somewhere that allows it or finished.
   *
   * Only a form the subpage could tick is governed by its ticks: one its
   * department may create, active and published. A completed sheet may be
   * handed to any department, and a form arriving that way never appears in
   * the receiving department's checklist, so it is left to the identity
   * grants alone rather than becoming unassignable there. The same holds for
   * a form since retired, whose tick the settings page can no longer show.
   */
  private async formEnabledInSubpage(
    db: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
    subpageId: string,
    templateVersionId: string,
  ): Promise<boolean> {
    const [form] = await db
      .select({ templateId: sheetTemplateVersions.templateId })
      .from(sheetTemplateVersions)
      .where(eq(sheetTemplateVersions.id, templateVersionId))
      .limit(1);
    if (!form) return false;
    const [ticked] = await db
      .select({ templateId: departmentSubpageTemplates.templateId })
      .from(departmentSubpageTemplates)
      .where(
        and(
          eq(departmentSubpageTemplates.subpageId, subpageId),
          eq(departmentSubpageTemplates.templateId, form.templateId),
        ),
      )
      .limit(1);
    if (ticked) return true;

    const [subpage] = await db
      .select({ departmentCode: departments.code })
      .from(departmentSubpages)
      .innerJoin(departments, eq(departments.id, departmentSubpages.departmentId))
      .where(eq(departmentSubpages.id, subpageId))
      .limit(1);
    const [current] = await db
      .select({ definition: sheetTemplateVersions.definition })
      .from(sheetTemplates)
      .innerJoin(
        sheetTemplateVersions,
        and(
          eq(sheetTemplateVersions.templateId, sheetTemplates.id),
          eq(sheetTemplateVersions.version, sheetTemplates.currentVersionNumber),
        ),
      )
      .where(
        and(
          eq(sheetTemplates.id, form.templateId),
          eq(sheetTemplates.active, true),
          isNotNull(sheetTemplateVersions.publishedAt),
        ),
      )
      .limit(1);
    if (!subpage || !current) return true;
    const parsed = sheetTemplateDefinitionSchema.safeParse(current.definition);
    const tickable =
      parsed.success &&
      parsed.data.status === "APPROVED" &&
      parsed.data.allowedCreatorDepartmentCodes.includes(
        subpage.departmentCode as (typeof parsed.data.allowedCreatorDepartmentCodes)[number],
      );
    return !tickable;
  }

  private async loadTemplate(templateId: string): Promise<TemplateRecord> {
    const [row] = await this.db
      .select({
        id: sheetTemplates.id,
        displayName: sheetTemplates.displayName,
        active: sheetTemplates.active,
        currentVersionNumber: sheetTemplates.currentVersionNumber,
        versionId: sheetTemplateVersions.id,
        version: sheetTemplateVersions.version,
        definition: sheetTemplateVersions.definition,
        requiresReview: sheetTemplateVersions.requiresReview,
        publishedAt: sheetTemplateVersions.publishedAt,
      })
      .from(sheetTemplates)
      .innerJoin(
        sheetTemplateVersions,
        and(
          eq(sheetTemplateVersions.templateId, sheetTemplates.id),
          eq(sheetTemplateVersions.version, sheetTemplates.currentVersionNumber),
        ),
      )
      .where(eq(sheetTemplates.id, templateId))
      .limit(1);
    if (!row || !row.active || !row.publishedAt) throw new ResourceNotFoundError("找不到可用的表單範本");
    const parsed = sheetTemplateDefinitionSchema.safeParse(row.definition);
    if (!parsed.success || parsed.data.status !== "APPROVED") {
      throw new ConflictError("表單範本尚未核准使用");
    }
    return { ...row, definition: parsed.data };
  }

  private async loadTemplateForSheet(sheet: SheetRow): Promise<TemplateRecord> {
    const [row] = await this.db
      .select({
        id: sheetTemplates.id,
        displayName: sheetTemplates.displayName,
        versionId: sheetTemplateVersions.id,
        version: sheetTemplateVersions.version,
        definition: sheetTemplateVersions.definition,
        requiresReview: sheetTemplateVersions.requiresReview,
      })
      .from(sheetTemplateVersions)
      .innerJoin(sheetTemplates, eq(sheetTemplates.id, sheetTemplateVersions.templateId))
      .where(eq(sheetTemplateVersions.id, sheet.templateVersionId))
      .limit(1);
    if (!row) throw new ResourceNotFoundError("找不到表單範本版本");
    return { ...row, definition: sheetTemplateDefinitionSchema.parse(row.definition) };
  }

  async listAvailableTemplates(user: SessionUser, scope?: { departmentId: string; subpageId: string }) {
    const selected = await this.db
      .select({
        templateId: departmentSubpageTemplates.templateId,
        subpageId: departmentSubpages.id,
        departmentId: departments.id,
        departmentCode: departments.code,
      })
      .from(departmentSubpageTemplates)
      .innerJoin(departmentSubpages, eq(departmentSubpages.id, departmentSubpageTemplates.subpageId))
      .innerJoin(departments, eq(departments.id, departmentSubpages.departmentId))
      .where(and(
        eq(departments.active, true),
        ...(scope ? [eq(departmentSubpages.id, scope.subpageId), eq(departments.id, scope.departmentId)] : []),
      ));
    const permitted: typeof selected = [];
    const capabilityBySubpage = new Map<string, boolean>();
    for (const row of selected) {
      let canCreate = capabilityBySubpage.get(row.subpageId);
      if (canCreate === undefined) {
        canCreate = await this.subpageCapability(user, { currentDepartmentId: row.departmentId, subpageId: row.subpageId }, "canCreate");
        capabilityBySubpage.set(row.subpageId, canCreate);
      }
      if (canCreate) permitted.push(row);
    }
    const rows = [...new Set(permitted.map((row) => row.templateId))].map((id) => ({ id }));
    // One template that cannot be loaded — an unapproved definition, or one
    // written by a newer schema — must not take the whole list down with it.
    // The user would lose access to every other template for a reason that has
    // nothing to do with them.
    const loaded = await Promise.all(
      rows.map(async (row) => {
        try {
          return await this.loadTemplate(row.id);
        } catch {
          return null;
        }
      }),
    );
    const templates = loaded.filter(
      (template): template is Awaited<ReturnType<typeof this.loadTemplate>> =>
        template !== null,
    );
    return templates
      .filter((template) => permitted.some((row) => row.templateId === template.id &&
        template.definition.allowedCreatorDepartmentCodes.includes(row.departmentCode as typeof template.definition.allowedCreatorDepartmentCodes[number])))
      .map((template) => ({
        id: template.id,
        displayName: template.displayName,
        versionId: template.versionId,
        version: template.version,
        requiresReview: template.requiresReview,
        definition: template.definition,
      }));
  }

  async listDepartmentStaff(
    user: SessionUser,
    departmentId: string,
  ): Promise<DepartmentStaffMember[]> {
    if (!managesDepartment(actorSnapshot(user), departmentId)) {
      throw new AuthorizationError(
        "只有該部門的主管可以查看部門員工。",
      );
    }

    const [department] = await this.db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, departmentId), eq(departments.active, true)))
      .limit(1);
    if (!department) throw new ResourceNotFoundError("找不到部門。");

    const rows = await this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
      })
      .from(departmentMemberships)
      .innerJoin(users, eq(users.id, departmentMemberships.userId))
      .where(
        and(
          eq(departmentMemberships.departmentId, departmentId),
          eq(departmentMemberships.kind, "STAFF"),
          eq(departmentMemberships.active, true),
          eq(users.active, true),
        ),
      )
      .orderBy(asc(users.displayName), asc(users.username), asc(users.id));

    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
    }));
  }

  async realtimeSnapshot(
    user: SessionUser,
    sheetId: string,
    changedFields: readonly string[] = [],
  ): Promise<{
    sheet: RealtimeSheetSnapshot;
    canonicalValues: Record<string, unknown>;
  }> {
    const [sheet] = await this.db
      .select()
      .from(productionSheets)
      .where(eq(productionSheets.id, sheetId))
      .limit(1);
    if (!sheet) throw new ResourceNotFoundError("找不到生產單。");
    await this.requireReadable(user, sheet);

    let canonicalValues: Record<string, unknown> = {};
    if (changedFields.length > 0) {
      const [stored] = await this.db
        .select({ values: sheetValues.values })
        .from(sheetValues)
        .where(eq(sheetValues.sheetId, sheetId))
        .limit(1);
      if (!stored) throw new ResourceNotFoundError("找不到生產單內容。");
      canonicalValues = Object.fromEntries(
        changedFields.map((fieldKey) => [
          fieldKey,
          getFieldValue(stored.values, fieldKey),
        ]),
      );
    }

    return {
      sheet: {
        id: sheet.id,
        version: sheet.version,
        state: sheet.state,
        currentDepartmentId: sheet.currentDepartmentId,
        subpageId: sheet.subpageId,
        assignedUserId: sheet.assignedUserId,
        dueAt: sheet.dueAt?.toISOString() ?? null,
        updatedAt: sheet.updatedAt.toISOString(),
      },
      canonicalValues,
    };
  }

  async create(
    user: SessionUser,
    input: CreateSheetRequest,
    context: RequestSecurityContext,
  ) {
    const template = await this.loadTemplate(input.templateId);
    const [origin] = await this.db
      .select({ id: departments.id, code: departments.code })
      .from(departments)
      .where(and(eq(departments.id, input.originDepartmentId), eq(departments.active, true)))
      .limit(1);
    if (!origin) throw new ResourceNotFoundError("找不到部門");
    const originCode = departmentCodeSchema.parse(origin.code);
    if (!template.definition.allowedCreatorDepartmentCodes.includes(
      originCode as (typeof template.definition.allowedCreatorDepartmentCodes)[number],
    )) {
      throw new AuthorizationError("此表單不可由該部門建立");
    }
    const subpage = await this.requireSubpageCapability(
      user,
      input.subpageId,
      origin.id,
      "canCreate",
    );

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(productionSheets)
        .where(eq(productionSheets.id, input.clientMutationId))
        .limit(1);
      if (existing) {
        if (
          existing.createdByUserId !== user.id ||
          existing.templateVersionId !== template.versionId ||
          existing.originDepartmentId !== origin.id ||
          existing.subpageId !== input.subpageId
        ) {
          throw new ConflictError("此操作識別碼已被其他建立操作使用");
        }
        return { id: existing.id, version: existing.version, state: existing.state, replayed: true };
      }
        const [lockedSubpage] = await tx.select({ id: departmentSubpages.id, name: departmentSubpages.name })
          .from(departmentSubpages)
          .where(and(eq(departmentSubpages.id, subpage.id), eq(departmentSubpages.departmentId, origin.id)))
          .for("share")
          .limit(1);
        if (!lockedSubpage) throw new ConflictError("子分頁已被刪除，請重新選擇");

        const [currentTemplate] = await tx.select({ active: sheetTemplates.active, currentVersionNumber: sheetTemplates.currentVersionNumber })
          .from(sheetTemplates).where(eq(sheetTemplates.id, template.id)).for("share").limit(1);
        if (!currentTemplate?.active || currentTemplate.currentVersionNumber !== template.version) {
          throw new ConflictError("表單範本已更新，請重新選擇");
        }
        const [selectedTemplate] = await tx.select({ templateId: departmentSubpageTemplates.templateId })
          .from(departmentSubpageTemplates)
          .where(and(eq(departmentSubpageTemplates.subpageId, lockedSubpage.id), eq(departmentSubpageTemplates.templateId, template.id)))
          .limit(1);
        if (!selectedTemplate) throw new AuthorizationError("此子分頁未開放建立此表單");
        const activeIdentities = await tx.select({ kind: departmentMemberships.kind })
          .from(departmentMemberships)
          .innerJoin(users, and(eq(users.id, departmentMemberships.userId), eq(users.active, true)))
          .where(and(eq(departmentMemberships.userId, user.id), eq(departmentMemberships.departmentId, origin.id), eq(departmentMemberships.active, true)));
        const activeKinds = activeIdentities.map((row) => row.kind);
        // ADMIN and 總經理 create anywhere, as a 主管 does; their role is read
        // again under the transaction, like the memberships above.
        const companyManager = isCompanyManager(user) && (await tx.select({ role: roleAssignments.role })
          .from(roleAssignments)
          .innerJoin(users, and(eq(users.id, roleAssignments.userId), eq(users.active, true)))
          .where(and(eq(roleAssignments.userId, user.id), eq(roleAssignments.active, true), inArray(roleAssignments.role, [...COMPANY_MANAGER_ROLES])))
          .limit(1)).length > 0;
        if (!companyManager && !activeKinds.includes("MANAGER")) {
          const [grant] = await tx.select({ kind: departmentSubpageIdentityPermissions.kind })
            .from(departmentSubpageIdentityPermissions)
            .where(and(eq(departmentSubpageIdentityPermissions.subpageId, lockedSubpage.id), inArray(departmentSubpageIdentityPermissions.kind, activeKinds.length ? activeKinds : ["MANAGER"]), eq(departmentSubpageIdentityPermissions.canCreate, true)))
            .limit(1);
          if (!grant) throw new AuthorizationError("你沒有此子分頁的建立權限");
        }

        const [created] = await tx
        .insert(productionSheets)
        .values({
          id: input.clientMutationId,
          sheetNumber: input.clientMutationId,
          templateVersionId: template.versionId,
          originDepartmentId: origin.id,
          currentDepartmentId: origin.id,
          subpageId: lockedSubpage.id,
          createdByUserId: user.id,
          // No draft and no review (the user, 2026-09-30): a sheet starts at
          // 待生產, and its status is set by hand from there.
          state: "READY",
        })
        .returning();
      if (!created) throw new Error("Failed to create production sheet");
      await tx.insert(sheetValues).values({
        sheetId: created.id,
        values: initialValues(template.definition),
      });
      await tx.insert(sheetSubpageHistory).values({
        sheetId: created.id,
        actorUserId: user.id,
        toDepartmentId: origin.id,
        toDepartmentName:
          user.memberships.find((membership) => membership.departmentId === origin.id)
            ?.departmentName ?? origin.code,
        toSubpageId: lockedSubpage.id,
        toSubpageName: lockedSubpage.name,
        reason: "CREATED",
        requestId: context.requestId,
      });
      await tx.insert(auditEvents).values({
        actorUserId: user.id,
        action: "SHEET_CREATED",
        targetType: "PRODUCTION_SHEET",
        targetId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: {
          templateId: template.id,
          templateVersionId: template.versionId,
          originDepartmentId: origin.id,
          subpageId: lockedSubpage.id,
        },
      });
      return { id: created.id, version: created.version, state: created.state, replayed: false };
    });
  }

  private isGlobalReader(user: SessionUser): boolean {
    return user.roles.some((role) =>
      ["ADMIN", "GENERAL_MANAGER", "ASSOCIATE", "SALES"].includes(role),
    );
  }

  private async subpageCapability(
    user: SessionUser,
    sheet: Pick<SheetRow, "currentDepartmentId" | "subpageId"> &
      Partial<Pick<SheetRow, "templateVersionId">>,
    capability: "canView" | "canCreate" | "canEdit" | "canSubmit",
  ): Promise<boolean> {
    if (capability === "canView" && this.isGlobalReader(user)) return true;
    if (managesDepartment(actorSnapshot(user), sheet.currentDepartmentId)) return true;
    if (!sheet.subpageId) return false;
    // Using an existing sheet also needs its form ticked for the subpage it
    // is in. Viewing does not: an unticked form's sheets stay readable. The
    // creation path checks the form itself, with no sheet yet to pass here.
    if (
      (capability === "canEdit" || capability === "canSubmit") &&
      sheet.templateVersionId &&
      !(await this.formEnabledInSubpage(this.db, sheet.subpageId, sheet.templateVersionId))
    ) {
      return false;
    }
    const [permission] = await this.db
      .select({ allowed: departmentSubpageIdentityPermissions[capability] })
      .from(departmentSubpageIdentityPermissions)
      .innerJoin(
        departmentSubpages,
        eq(departmentSubpages.id, departmentSubpageIdentityPermissions.subpageId),
      )
      .innerJoin(
        departmentMemberships,
        and(
          eq(departmentMemberships.userId, user.id),
          eq(departmentMemberships.departmentId, departmentSubpages.departmentId),
          eq(departmentMemberships.kind, departmentSubpageIdentityPermissions.kind),
          eq(departmentMemberships.active, true),
        ),
      )
      .innerJoin(users, and(eq(users.id, user.id), eq(users.active, true)))
      .where(
        and(
          eq(departmentSubpageIdentityPermissions.subpageId, sheet.subpageId),
          eq(departmentSubpages.departmentId, sheet.currentDepartmentId),
          eq(departmentSubpageIdentityPermissions[capability], true),
        ),
      )
      .limit(1);
    return permission?.allowed === true;
  }

  private async requireSubpageCapability(
    user: SessionUser,
    subpageId: string,
    departmentId: string,
    capability: "canView" | "canCreate" | "canEdit" | "canSubmit",
  ) {
    const [subpage] = await this.db
      .select()
      .from(departmentSubpages)
      .where(
        and(
          eq(departmentSubpages.id, subpageId),
          eq(departmentSubpages.departmentId, departmentId),
        ),
      )
      .limit(1);
    if (!subpage) throw new ResourceNotFoundError("找不到子分頁");
    if (
      !(await this.subpageCapability(
        user,
        { currentDepartmentId: departmentId, subpageId },
        capability,
      ))
    ) {
      throw new AuthorizationError("你沒有此子分頁的操作權限");
    }
    return subpage;
  }

  private async requireReadable(user: SessionUser, sheet: SheetRow): Promise<void> {
    if (!(await this.subpageCapability(user, sheet, "canView"))) {
      throw new AuthorizationError();
    }
  }

  private async editorKinds(user: SessionUser, sheet: SheetRow): Promise<SheetEditorKind[]> {
    return (await this.subpageCapability(user, sheet, "canEdit"))
      ? ["ORIGIN_MANAGER", "ORIGIN_ORDER_TAKER", "ORIGIN_STAFF"]
      : [];
  }

  async attachmentAccess(user: SessionUser, sheetId: string) {
    const [sheet] = await this.db
      .select()
      .from(productionSheets)
      .where(eq(productionSheets.id, sheetId))
      .limit(1);
    if (!sheet) throw new ResourceNotFoundError("找不到生產表單");
    await this.requireReadable(user, sheet);
    const template = await this.loadTemplateForSheet(sheet);
    const editorKinds = await this.editorKinds(user, sheet);
    const canModify = [...fieldRules(template.definition).values()].some(
      (rule) =>
        editorKinds.some((editor) => rule.editableBy.includes(editor)) &&
        isFieldEditableInState(rule.editableStates, sheet.state),
    );
    return {
      sheetId: sheet.id,
      sheetVersion: sheet.version,
      state: sheet.state,
      canModify,
    };
  }

  async requireAttachmentModifiable(user: SessionUser, sheetId: string) {
    const access = await this.attachmentAccess(user, sheetId);
    if (!access.canModify) {
      throw new AuthorizationError("目前無法修改此生產單的附件");
    }
    return access;
  }

  async listDepartmentSheetHistory(
    user: SessionUser,
    departmentId: string,
    query: DepartmentSheetHistoryQuery,
  ) {
    const [department] = await this.db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, departmentId), eq(departments.active, true)))
      .limit(1);
    if (!department) throw new ResourceNotFoundError("找不到部門。");
    const unrestricted =
      this.isGlobalReader(user) || managesDepartment(actorSnapshot(user), departmentId);
    const readableSubpageIds = unrestricted
      ? []
      : (
          await this.db
            .selectDistinct({ id: departmentSubpages.id })
            .from(departmentSubpageIdentityPermissions)
            .innerJoin(
              departmentSubpages,
              eq(departmentSubpages.id, departmentSubpageIdentityPermissions.subpageId),
            )
            .innerJoin(
              departmentMemberships,
              and(
                eq(departmentMemberships.userId, user.id),
                eq(departmentMemberships.departmentId, departmentId),
                eq(departmentMemberships.kind, departmentSubpageIdentityPermissions.kind),
                eq(departmentMemberships.active, true),
              ),
            )
            .innerJoin(users, and(eq(users.id, user.id), eq(users.active, true)))
            .where(
              and(
                eq(departmentSubpages.departmentId, departmentId),
                eq(departmentSubpageIdentityPermissions.canView, true),
              ),
            )
        ).map((row) => row.id);
    if (!unrestricted && readableSubpageIds.length === 0) {
      throw new AuthorizationError("你沒有此部門完工紀錄的查看權限。");
    }

    const finalRecordConditions: SQL[] = [
      eq(productionSheets.currentDepartmentId, departmentId),
      // 完工紀錄 holds archived sheets only (the user, 2026-10-04); a 已完成
      // sheet stays in its subpage until its 主管 archives it.
      eq(productionSheets.state, "ARCHIVED"),
      isNotNull(productionSheets.completedAt),
      isNotNull(productionSheets.subpageId),
    ];
    if (!unrestricted) finalRecordConditions.push(inArray(productionSheets.subpageId, readableSubpageIds));
    const resultConditions = [...finalRecordConditions];
    if (query.subpageId) resultConditions.push(eq(productionSheets.subpageId, query.subpageId));
    if (query.templateId) resultConditions.push(eq(sheetTemplates.id, query.templateId));
    if (query.from) {
      resultConditions.push(gte(productionSheets.completedAt, new Date(query.from)));
    }
    if (query.to) {
      resultConditions.push(lte(productionSheets.completedAt, new Date(query.to)));
    }
    if (query.q) {
      const pattern = `%${escapeHistoryLike(query.q)}%`;
      const searchableValues = sql<boolean>`
        jsonb_path_query_array(
          ${sheetValues.values},
          '$.** ? (@.type() == "string" || @.type() == "number")'
        )::text ILIKE ${pattern} ESCAPE ${"\\"}
      `;
      const search = or(
        ilike(productionSheets.sheetNumber, pattern),
        ilike(sheetTemplates.displayName, pattern),
        searchableValues,
      );
      if (search) resultConditions.push(search);
    }

    const order: SQL[] = [];
    switch (query.sort) {
      case "sheetNumber":
        order.push(
          query.direction === "asc"
            ? asc(productionSheets.sheetNumber)
            : desc(productionSheets.sheetNumber),
        );
        break;
      case "template":
        order.push(
          query.direction === "asc"
            ? asc(sheetTemplates.displayName)
            : desc(sheetTemplates.displayName),
        );
        break;
      case "completedAt":
        order.push(
          query.direction === "asc"
            ? asc(productionSheets.completedAt)
            : desc(productionSheets.completedAt),
        );
        break;
    }
    order.push(
      query.direction === "asc"
        ? asc(productionSheets.id)
        : desc(productionSheets.id),
    );

    // Nobody is assigned any more (the user, 2026-09-30), so 完工紀錄 names no
    // 負責員工 (the user, 2026-10-04).
    const [rows, totalRows, templateOptions, subpageOptions] = await Promise.all([
      this.db
        .select({
          id: productionSheets.id,
          sheetNumber: productionSheets.sheetNumber,
          state: productionSheets.state,
          subpageId: departmentSubpages.id,
          subpageName: departmentSubpages.name,
          templateId: sheetTemplates.id,
          templateDisplayName: sheetTemplates.displayName,
          completedAt: productionSheets.completedAt,
          archivedAt: productionSheets.archivedAt,
        })
        .from(productionSheets)
        .innerJoin(departmentSubpages, eq(departmentSubpages.id, productionSheets.subpageId))
        .innerJoin(
          sheetTemplateVersions,
          eq(sheetTemplateVersions.id, productionSheets.templateVersionId),
        )
        .innerJoin(sheetTemplates, eq(sheetTemplates.id, sheetTemplateVersions.templateId))
        .innerJoin(sheetValues, eq(sheetValues.sheetId, productionSheets.id))
        .where(and(...resultConditions))
        .orderBy(...order)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ value: count() })
        .from(productionSheets)
        .innerJoin(departmentSubpages, eq(departmentSubpages.id, productionSheets.subpageId))
        .innerJoin(
          sheetTemplateVersions,
          eq(sheetTemplateVersions.id, productionSheets.templateVersionId),
        )
        .innerJoin(sheetTemplates, eq(sheetTemplates.id, sheetTemplateVersions.templateId))
        .innerJoin(sheetValues, eq(sheetValues.sheetId, productionSheets.id))
        .where(and(...resultConditions)),
      this.db
        .selectDistinct({
          id: sheetTemplates.id,
          displayName: sheetTemplates.displayName,
        })
        .from(productionSheets)
        .innerJoin(departmentSubpages, eq(departmentSubpages.id, productionSheets.subpageId))
        .innerJoin(
          sheetTemplateVersions,
          eq(sheetTemplateVersions.id, productionSheets.templateVersionId),
        )
        .innerJoin(sheetTemplates, eq(sheetTemplates.id, sheetTemplateVersions.templateId))
        .where(and(...finalRecordConditions))
        .orderBy(asc(sheetTemplates.displayName), asc(sheetTemplates.id)),
      this.db
        .selectDistinct({
          id: departmentSubpages.id,
          displayName: departmentSubpages.name,
          position: departmentSubpages.position,
        })
        .from(productionSheets)
        .innerJoin(departmentSubpages, eq(departmentSubpages.id, productionSheets.subpageId))
        .where(and(...finalRecordConditions))
        .orderBy(asc(departmentSubpages.position), asc(departmentSubpages.name), asc(departmentSubpages.id)),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id as string,
        sheetNumber: row.sheetNumber as string,
        state: row.state as "COMPLETED" | "ARCHIVED",
        subpage: { id: row.subpageId as string, name: row.subpageName as string },
        template: {
          id: row.templateId as string,
          displayName: row.templateDisplayName as string,
        },
        completedAt: (row.completedAt as Date).toISOString(),
        archivedAt: row.archivedAt
          ? (row.archivedAt as Date).toISOString()
          : null,
      })),
      filterOptions: {
        templates: templateOptions,
        subpages: subpageOptions.map(({ id, displayName }) => ({ id, displayName })),
      },
      page: query.page,
      pageSize: query.pageSize,
      total: Number(totalRows[0]?.value ?? 0),
    };
  }

  async list(
    user: SessionUser,
    filters: {
      state?: SheetRow["state"] | undefined;
      departmentId?: string | undefined;
      subpageId?: string | undefined;
    },
  ) {
    const conditions: SQL[] = [];
    // An archived sheet is found only in 完工紀錄 (the user, 2026-10-04): the
    // working lists leave it out unless it is asked for by name.
    conditions.push(
      filters.state ? eq(productionSheets.state, filters.state) : ne(productionSheets.state, "ARCHIVED"),
    );
    if (filters.departmentId) {
      conditions.push(eq(productionSheets.currentDepartmentId, filters.departmentId));
    }
    if (filters.subpageId) conditions.push(eq(productionSheets.subpageId, filters.subpageId));
    const condition = this.viewableSheetCondition(user);
    if (condition) conditions.push(condition);
    // Each sheet carries its form's name: the lists show that rather than the
    // sheet number, which is a UUID nobody reads (the user, 2026-09-30).
    return this.db
      .select({
        id: productionSheets.id,
        sheetNumber: productionSheets.sheetNumber,
        templateName: sheetTemplates.displayName,
        state: productionSheets.state,
        version: productionSheets.version,
        originDepartmentId: productionSheets.originDepartmentId,
        currentDepartmentId: productionSheets.currentDepartmentId,
        subpageId: productionSheets.subpageId,
        assignedUserId: productionSheets.assignedUserId,
        dueAt: productionSheets.dueAt,
        updatedAt: productionSheets.updatedAt,
      })
      .from(productionSheets)
      .innerJoin(sheetTemplateVersions, eq(sheetTemplateVersions.id, productionSheets.templateVersionId))
      .innerJoin(sheetTemplates, eq(sheetTemplates.id, sheetTemplateVersions.templateId))
      .where(and(...conditions))
      .orderBy(desc(productionSheets.updatedAt), desc(productionSheets.id));
  }

  /**
   * `subpageCapability(user, sheet, "canView")` as one SQL condition on
   * `production_sheets`, so a list is decided in a single query rather than
   * one or more per sheet. Keep the two in step. `undefined` means every sheet
   * is readable. Viewing does not depend on form ticks.
   */
  private viewableSheetCondition(user: SessionUser): SQL | undefined {
    // Global readers, and company managers, whom `managesDepartment` admits
    // to every department.
    if (this.isGlobalReader(user) || isCompanyManager(user)) return undefined;
    const managedDepartmentIds = user.memberships
      .filter((membership) => membership.kind === "MANAGER")
      .map((membership) => membership.departmentId);
    const granted = exists(
      this.db
        .select({ subpageId: departmentSubpageIdentityPermissions.subpageId })
        .from(departmentSubpageIdentityPermissions)
        .innerJoin(
          departmentSubpages,
          eq(departmentSubpages.id, departmentSubpageIdentityPermissions.subpageId),
        )
        .innerJoin(
          departmentMemberships,
          and(
            eq(departmentMemberships.userId, user.id),
            eq(departmentMemberships.departmentId, departmentSubpages.departmentId),
            eq(departmentMemberships.kind, departmentSubpageIdentityPermissions.kind),
            eq(departmentMemberships.active, true),
          ),
        )
        .innerJoin(users, and(eq(users.id, user.id), eq(users.active, true)))
        .where(
          and(
            eq(departmentSubpageIdentityPermissions.subpageId, productionSheets.subpageId),
            eq(departmentSubpages.departmentId, productionSheets.currentDepartmentId),
            eq(departmentSubpageIdentityPermissions.canView, true),
          ),
        ),
    );
    return managedDepartmentIds.length > 0
      ? or(inArray(productionSheets.currentDepartmentId, managedDepartmentIds), granted)!
      : granted;
  }

  async detail(user: SessionUser, sheetId: string) {
    const [sheet] = await this.db
      .select()
      .from(productionSheets)
      .where(eq(productionSheets.id, sheetId))
      .limit(1);
    if (!sheet) throw new ResourceNotFoundError("找不到生產表單");
    await this.requireReadable(user, sheet);
    const template = await this.loadTemplateForSheet(sheet);
    const [storedValues, approvals, handoffs, assignments, canEdit, canSubmit] = await Promise.all([
      this.db.select().from(sheetValues).where(eq(sheetValues.sheetId, sheetId)).limit(1),
      this.db
        .select({
          runId: approvalRuns.id,
          runNumber: approvalRuns.runNumber,
          runStatus: approvalRuns.status,
          submittedAt: approvalRuns.submittedAt,
          completedAt: approvalRuns.completedAt,
          sequence: approvalSteps.sequence,
          requiredRole: approvalSteps.requiredRole,
          reviewerUserId: approvalSteps.reviewerUserId,
          decision: approvalSteps.decision,
          comment: approvalSteps.comment,
          decidedAt: approvalSteps.decidedAt,
        })
        .from(approvalRuns)
        .innerJoin(approvalSteps, eq(approvalSteps.approvalRunId, approvalRuns.id))
        .where(eq(approvalRuns.sheetId, sheetId))
        .orderBy(asc(approvalRuns.runNumber), asc(approvalSteps.sequence)),
      this.db
        .select()
        .from(sheetHandoffs)
        .where(eq(sheetHandoffs.sheetId, sheetId))
        .orderBy(asc(sheetHandoffs.sequence)),
      this.db
        .select({
          id: sheetAssignments.id,
          departmentId: sheetAssignments.departmentId,
          assignedUserId: sheetAssignments.assignedUserId,
          assignedByUserId: sheetAssignments.assignedByUserId,
          dueAt: sheetAssignments.dueAt,
          endedAt: sheetAssignments.endedAt,
          createdAt: sheetAssignments.createdAt,
        })
        .from(sheetAssignments)
        .where(eq(sheetAssignments.sheetId, sheetId))
        .orderBy(asc(sheetAssignments.createdAt)),
      this.subpageCapability(user, sheet, "canEdit"),
      this.subpageCapability(user, sheet, "canSubmit"),
    ]);
    // Whether the subpage the sheet is in still allows its form. A sheet
    // waiting in 待分派 has no subpage yet, so nothing has been refused.
    const formEnabledInSubpage = sheet.subpageId
      ? await this.formEnabledInSubpage(this.db, sheet.subpageId, sheet.templateVersionId)
      : true;
    // Where sending it on takes it, for a form whose workflow leads elsewhere
    // and that has not gone yet: the page names the destination on the button.
    const destination = ["DRAFT", "RETURNED", "READY"].includes(sheet.state)
      ? await this.pendingReleaseDestination(this.db, sheet, template)
      : null;
    // 分條申請單 is reviewed before it goes on (the user, 2026-10-01).
    const [reviewOutstanding, signatures] = await Promise.all([
      this.reviewOutstanding(this.db, sheet, template),
      this.signatures(sheetId),
    ]);
    // Rows the receiving department ticks off (the user, 2026-10-03).
    const rowMarks = await this.rowMarking(user, sheet, template, reviewOutstanding);
    return {
      ...sheet,
      template: {
        id: template.id,
        displayName: template.displayName,
        versionId: template.versionId,
        version: template.version,
        definition: template.definition,
      },
      values: storedValues[0]?.values ?? {},
      approvals,
      handoffs,
      assignments,
      formEnabledInSubpage,
      releaseDestination: destination
        ? { code: destination.code, displayName: destination.displayName }
        : null,
      review: {
        required: template.definition.workflow.requiresReview,
        outstanding: reviewOutstanding,
        stageRole: requiredApprovalRole(sheet.state),
      },
      signatures,
      rowMarks,
      permissions: { canView: true, canEdit, canSubmit },
    };
  }

  /**
   * The row ticks a sheet shows, or null where its form takes none or they do
   * not apply yet. 分條申請單's rows are ticked by 分條's 主管 once the sheet
   * is in 分條 with its review done (the user, 2026-10-03); before that, and
   * in any other department, it shows none.
   */
  private async rowMarking(
    user: SessionUser,
    sheet: SheetRow,
    template: TemplateRecord,
    reviewOutstanding: boolean,
  ): Promise<{ sectionKey: string; marked: number[]; canMark: boolean } | null> {
    const form = rowMarksFor(template.definition.templateKey);
    if (!form || reviewOutstanding) return null;
    const [department] = await this.db
      .select({ code: departments.code })
      .from(departments)
      .where(eq(departments.id, sheet.currentDepartmentId))
      .limit(1);
    if (department?.code !== form.departmentCode) return null;
    const rows = await this.db
      .select({ rowIndex: sheetRowMarks.rowIndex })
      .from(sheetRowMarks)
      .where(and(eq(sheetRowMarks.sheetId, sheet.id), eq(sheetRowMarks.sectionKey, form.sectionKey)))
      .orderBy(asc(sheetRowMarks.rowIndex));
    return {
      sectionKey: form.sectionKey,
      marked: rows.map((row) => row.rowIndex),
      canMark:
        sheet.state !== "ARCHIVED" &&
        managesDepartment(actorSnapshot(user), sheet.currentDepartmentId),
    };
  }

  /** Tick or untick one row (the user, 2026-10-03). */
  async setRowMark(
    user: SessionUser,
    sheetId: string,
    input: SheetRowMarkRequest,
    context: RequestSecurityContext,
  ) {
    return this.db.transaction(async (tx) => {
      const [sheet] = await tx.select().from(productionSheets)
        .where(eq(productionSheets.id, sheetId)).for("update").limit(1);
      if (!sheet) throw new ResourceNotFoundError("找不到生產表單");
      const prior = await this.priorAction(tx, sheetId, input.clientMutationId, user.id, "SET_ROW_MARK");
      if (prior) return prior;
      await this.requireReadable(user, sheet);
      const template = await this.loadTemplateForSheet(sheet);
      const form = rowMarksFor(template.definition.templateKey);
      const section = template.definition.sections.find((candidate) => candidate.key === input.sectionKey);
      if (
        !form ||
        form.sectionKey !== input.sectionKey ||
        section?.type !== "FIXED_ROWS" ||
        input.rowIndex >= section.rowCount
      ) {
        throw new ConflictError("此表單的這一列不能勾選");
      }
      const [department] = await tx
        .select({ code: departments.code })
        .from(departments)
        .where(eq(departments.id, sheet.currentDepartmentId))
        .limit(1);
      if (department?.code !== form.departmentCode || (await this.reviewOutstanding(tx, sheet, template))) {
        throw new ConflictError("生產單送達分條並完成審核後才能勾選");
      }
      if (!managesDepartment(actorSnapshot(user), sheet.currentDepartmentId)) {
        throw new AuthorizationError("只有分條主管可以勾選");
      }
      if (sheet.state === "ARCHIVED") throw new ConflictError("已封存的生產單不能勾選");
      if (input.marked) {
        await tx
          .insert(sheetRowMarks)
          .values({ sheetId, sectionKey: input.sectionKey, rowIndex: input.rowIndex, markedByUserId: user.id })
          .onConflictDoNothing();
      } else {
        await tx.delete(sheetRowMarks).where(and(
          eq(sheetRowMarks.sheetId, sheetId),
          eq(sheetRowMarks.sectionKey, input.sectionKey),
          eq(sheetRowMarks.rowIndex, input.rowIndex),
        ));
      }
      const result = {
        action: "SET_ROW_MARK",
        sheetId,
        sectionKey: input.sectionKey,
        rowIndex: input.rowIndex,
        marked: input.marked,
      };
      await tx.insert(sheetClientMutations).values({
        sheetId,
        clientMutationId: input.clientMutationId,
        actorUserId: user.id,
        result,
      });
      await tx.insert(auditEvents).values({
        actorUserId: user.id,
        action: "SHEET_ROW_MARK_SET",
        targetType: "PRODUCTION_SHEET",
        targetId: sheetId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: {
          departmentId: sheet.currentDepartmentId,
          sectionKey: input.sectionKey,
          rowIndex: input.rowIndex,
          marked: input.marked,
        },
      });
      return { ...result, replayed: false };
    });
  }

  async pdfSnapshot(
    user: SessionUser,
    sheetId: string,
    retry = 0,
  ): Promise<{
    sheetId: string;
    sheetVersion: number;
    templateVersionId: string;
    state: SheetRow["state"];
    definition: SheetTemplateDefinition;
    values: Record<string, unknown>;
    signatures: Partial<Record<SignatureRole, SheetSignature>>;
  }> {
    const sheet = await this.detail(user, sheetId);
    const signatures = sheet.signatures;

    const [current] = await this.db
      .select({ version: productionSheets.version, updatedAt: productionSheets.updatedAt })
      .from(productionSheets)
      .where(eq(productionSheets.id, sheetId))
      .limit(1);
    if (
      !current ||
      current.version !== sheet.version ||
      current.updatedAt.getTime() !== sheet.updatedAt.getTime()
    ) {
      if (retry >= 2) {
        throw new ServiceUnavailableError(
          "生產單正在更新，請稍後再下載 PDF。",
        );
      }
      return this.pdfSnapshot(user, sheetId, retry + 1);
    }

    return {
      sheetId: sheet.id,
      sheetVersion: sheet.version,
      templateVersionId: sheet.templateVersionId,
      state: sheet.state,
      definition: sheet.template.definition,
      values: sheet.values,
      signatures,
    };
  }

  async recordPdfDownload(
    user: SessionUser,
    snapshot: {
      sheetId: string;
      sheetVersion: number;
      templateVersionId: string;
      state: SheetRow["state"];
    },
    context: RequestSecurityContext,
  ): Promise<void> {
    const [sheet] = await this.db
      .select()
      .from(productionSheets)
      .where(eq(productionSheets.id, snapshot.sheetId))
      .limit(1);
    if (!sheet) throw new ResourceNotFoundError("找不到生產表單");
    await this.requireReadable(user, sheet);
    await this.db.insert(auditEvents).values({
      actorUserId: user.id,
      action: "SHEET_PDF_DOWNLOADED",
      targetType: "PRODUCTION_SHEET",
      targetId: snapshot.sheetId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      metadata: {
        sheetVersion: snapshot.sheetVersion,
        templateVersionId: snapshot.templateVersionId,
        state: snapshot.state,
      },
    });
  }

  async fieldHistory(
    user: SessionUser,
    sheetId: string,
    query: SheetFieldHistoryQuery,
  ) {
    const [sheet] = await this.db
      .select()
      .from(productionSheets)
      .where(eq(productionSheets.id, sheetId))
      .limit(1);
    if (!sheet) throw new ResourceNotFoundError("找不到生產表單");
    await this.requireReadable(user, sheet);

    const events = await this.db
      .select({
        auditEventId: auditEvents.id,
        actorUserId: auditEvents.actorUserId,
        actorUsername: users.username,
        actorDisplayName: users.displayName,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(
        and(
          eq(auditEvents.targetType, "PRODUCTION_SHEET"),
          eq(auditEvents.targetId, sheetId),
          eq(auditEvents.action, "SHEET_VALUES_PATCHED"),
        ),
      )
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id));

    const entries: SheetFieldHistoryEntry[] = [];
    for (const event of events) {
      const metadata = event.metadata;
      const baseVersion = metadata.baseVersion;
      const newVersion = metadata.newVersion;
      const changedFields = metadata.changedFields;
      if (
        !Number.isInteger(baseVersion) ||
        typeof baseVersion !== "number" ||
        baseVersion < 0 ||
        !Number.isInteger(newVersion) ||
        typeof newVersion !== "number" ||
        newVersion < 1 ||
        !Array.isArray(changedFields)
      ) {
        continue;
      }

      const actor =
        event.actorUserId && event.actorUsername && event.actorDisplayName
          ? {
              id: event.actorUserId,
              username: event.actorUsername,
              displayName: event.actorDisplayName,
            }
          : null;
      for (const fieldKey of changedFields) {
        if (
          typeof fieldKey !== "string" ||
          fieldKey.length < 1 ||
          fieldKey.length > 128 ||
          (query.fieldKey && query.fieldKey !== fieldKey)
        ) {
          continue;
        }
        entries.push({
          auditEventId: event.auditEventId,
          fieldKey,
          actor,
          baseVersion,
          newVersion,
          approvalInvalidated: metadata.approvalInvalidated === true,
          createdAt: event.createdAt.toISOString(),
        });
      }
    }

    const offset = (query.page - 1) * query.pageSize;
    return {
      items: entries.slice(offset, offset + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: entries.length,
    };
  }

  async patchValues(
    user: SessionUser,
    sheetId: string,
    input: SheetPatchRequest,
    context: RequestSecurityContext,
  ) {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [sheet] = await tx
        .select()
        .from(productionSheets)
        .where(eq(productionSheets.id, sheetId))
        .for("update")
        .limit(1);
      if (!sheet) throw new ResourceNotFoundError("找不到生產表單");

      const [priorMutation] = await tx
        .select()
        .from(sheetClientMutations)
        .where(
          and(
            eq(sheetClientMutations.sheetId, sheetId),
            eq(sheetClientMutations.clientMutationId, input.clientMutationId),
          ),
        )
        .limit(1);
      if (priorMutation) {
        if (priorMutation.actorUserId !== user.id || priorMutation.result.action !== "PATCH_VALUES") {
          throw new ConflictError("此操作識別碼已被其他操作使用");
        }
        return { ...priorMutation.result, replayed: true };
      }

      const template = await this.loadTemplateForSheet(sheet);
      const editorKinds = await this.editorKinds(user, sheet);
      if (editorKinds.length === 0) {
        throw new AuthorizationError("你沒有權限修改此表單內容");
      }
      if (input.baseVersion > sheet.version) {
        throw new SheetConflictError("用戶端版本高於伺服器版本", {
          serverVersion: sheet.version,
        });
      }
      const rules = fieldRules(template.definition);
      const [stored] = await tx
        .select()
        .from(sheetValues)
        .where(eq(sheetValues.sheetId, sheetId))
        .for("update")
        .limit(1);
      if (!stored) throw new Error("Sheet values are missing");
      for (const change of input.changes) {
        const rule = rules.get(change.fieldKey);
        if (!rule) {
          throw new AuthorizationError(`目前狀態不可修改欄位 ${change.fieldKey}`);
        }
        validateFieldValue(change.fieldKey, rule, change.value);
        // Review is retired (the user, 2026-09-30): nothing is approved, so a
        // change invalidates nothing. A field is changed only where it is
        // editable, 草稿's fields now open in 待生產 and 生產中.
        if (!isFieldEditableInState(rule.editableStates, sheet.state)) {
          throw new AuthorizationError(`目前狀態不可修改欄位 ${change.fieldKey}`);
        }
      }
      const versions = await tx
        .select()
        .from(sheetFieldVersions)
        .where(
          and(
            eq(sheetFieldVersions.sheetId, sheetId),
            inArray(
              sheetFieldVersions.fieldKey,
              input.changes.map((change) => change.fieldKey),
            ),
          ),
        );
      const conflictingFields = versions
        .filter((version) => version.version > input.baseVersion)
        .map((version) => version.fieldKey);
      if (conflictingFields.length > 0) {
        throw new SheetConflictError("部分欄位已有較新版本", {
          conflictingFields,
          serverVersion: sheet.version,
          serverValues: Object.fromEntries(
            conflictingFields.map((fieldKey) => [
              fieldKey,
              getFieldValue(stored.values, fieldKey),
            ]),
          ),
        });
      }

      const values = structuredClone(stored.values);
      for (const change of input.changes) setFieldValue(values, change.fieldKey, change.value);

      /*
       * A field bound to the deadline writes the sheet's own `dueAt`, so the
       * overdue queue and the daily reminder run from the date printed on the
       * form. Cleared when the cell is emptied — a deadline nobody can see on
       * the sheet has no business making it late. Anything unparseable is left
       * alone rather than guessed at; the cell keeps whatever was typed, which
       * is the behaviour of every other free-text cell on these forms.
       */
      let boundDueAt: Date | null | undefined;
      for (const change of input.changes) {
        if (rules.get(change.fieldKey)?.bindsTo !== "DUE_AT") continue;
        const raw = typeof change.value === "string" ? change.value.trim() : "";
        if (raw === "") {
          boundDueAt = null;
          continue;
        }
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) boundDueAt = parsed;
      }

      const newVersion = sheet.version + 1;
      const nextState = sheet.state;
      await tx.update(sheetValues).set({ values, updatedAt: now }).where(eq(sheetValues.sheetId, sheetId));
      await tx
        .update(productionSheets)
        .set({
          version: newVersion,
          ...(boundDueAt !== undefined ? { dueAt: boundDueAt } : {}),
          updatedAt: now,
        })
        .where(eq(productionSheets.id, sheetId));
      for (const change of input.changes) {
        await tx
          .insert(sheetFieldVersions)
          .values({
            sheetId,
            fieldKey: change.fieldKey,
            version: newVersion,
            updatedByUserId: user.id,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [sheetFieldVersions.sheetId, sheetFieldVersions.fieldKey],
            set: { version: newVersion, updatedByUserId: user.id, updatedAt: now },
          });
      }
      const result = {
        action: "PATCH_VALUES",
        sheetId,
        version: newVersion,
        changedFields: input.changes.map((change) => change.fieldKey),
        approvalInvalidated: false,
        state: nextState,
        invalidatedRunNumber: null,
      };
      await tx.insert(sheetClientMutations).values({
        sheetId,
        clientMutationId: input.clientMutationId,
        actorUserId: user.id,
        result,
      });
      await tx.insert(auditEvents).values({
        actorUserId: user.id,
        action: "SHEET_VALUES_PATCHED",
        targetType: "PRODUCTION_SHEET",
        targetId: sheetId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: {
          baseVersion: input.baseVersion,
          newVersion,
          changedFields: result.changedFields,
          previousState: sheet.state,
          state: nextState,
        },
      });
      return result;
    });
  }

  private async enqueue(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    recipientUserId: string,
    sheetId: string,
    eventType: string,
    summary: string,
    deduplicationKey: string,
  ): Promise<void> {
    const now = this.now();
    await tx
      .insert(notifications)
      .values({
        recipientUserId,
        sheetId,
        channel: "IN_APP",
        eventType,
        summary,
        deepLink: `/sheets/${sheetId}`,
        state: "DELIVERED",
        deduplicationKey: `${deduplicationKey}:IN_APP`,
        deliveredAt: now,
      })
      .onConflictDoNothing({ target: notifications.deduplicationKey });
    // Pushed to the recipient's phones and browsers (the user, 2026-10-04).
    const [push] = await tx
      .insert(notifications)
      .values({
        recipientUserId,
        sheetId,
        channel: "PUSH",
        eventType,
        summary,
        deepLink: `/sheets/${sheetId}`,
        state: "PENDING",
        deduplicationKey: `${deduplicationKey}:PUSH`,
      })
      .onConflictDoNothing({ target: notifications.deduplicationKey })
      .returning({ id: notifications.id });
    if (push) {
      await tx
        .insert(outboxJobs)
        .values({
          jobType: "PUSH_NOTIFICATION",
          payload: { notificationId: push.id },
          deduplicationKey: `${deduplicationKey}:PUSH_JOB`,
        })
        .onConflictDoNothing({ target: outboxJobs.deduplicationKey });
    }
  }

  private async priorAction(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    sheetId: string,
    mutationId: string,
    userId: string,
    action: string,
  ): Promise<Record<string, unknown> | null> {
    const [prior] = await tx
      .select()
      .from(sheetClientMutations)
      .where(and(eq(sheetClientMutations.sheetId, sheetId), eq(sheetClientMutations.clientMutationId, mutationId)))
      .limit(1);
    if (!prior) return null;
    if (prior.actorUserId !== userId || prior.result.action !== action) {
      throw new ConflictError("此操作識別碼已被其他操作使用");
    }
    return { ...prior.result, replayed: true };
  }

  /**
   * Where a sheet's workflow sends it on release, when that is somewhere
   * other than where it is: 分條申請單 goes to 分條 once review completes,
   * 退火明細表 to 燒頓 once CUT hands it on. Null when it stays put.
   */
  private async workflowDestination(
    db: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
    sheet: Pick<SheetRow, "currentDepartmentId">,
    template: TemplateRecord,
  ): Promise<{ id: string; code: string; displayName: string } | null> {
    // A form two departments keep for themselves — 沖壓 and 平板剪's
    // 首件/巡迴檢驗單 — stays wherever it was written.
    if (template.definition.workflow.staysInOrigin) return null;
    const [current] = await db
      .select({ code: departments.code })
      .from(departments)
      .where(eq(departments.id, sheet.currentDepartmentId))
      .limit(1);
    const [destination] = await db
      .select({ id: departments.id, code: departments.code, displayName: departments.displayName })
      .from(departments)
      .where(eq(departments.code, template.definition.workflow.destinationDepartmentCode))
      .limit(1);
    if (!current || !destination) throw new Error("Workflow department is missing");
    const routeTo = postApprovalDestination(
      current.code as Parameters<typeof postApprovalDestination>[0],
      destination.code as Parameters<typeof postApprovalDestination>[1],
      template.definition.workflow.avoidSelfHandoff,
    );
    return routeTo && destination.id !== sheet.currentDepartmentId ? destination : null;
  }

  /**
   * Where sending the sheet on would take it, while it has not gone: its
   * workflow leads to another department and it has never been handed on.
   * A sheet handed back to the department that wrote it — 分條申請單 returned
   * to CUT — is not sent again; it is worked there like any other.
   */
  private async pendingReleaseDestination(
    db: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
    sheet: Pick<SheetRow, "id" | "currentDepartmentId">,
    template: TemplateRecord,
  ): Promise<{ id: string; code: string; displayName: string } | null> {
    const destination = await this.workflowDestination(db, sheet, template);
    if (!destination) return null;
    const [routed] = await db
      .select({ id: sheetHandoffs.id })
      .from(sheetHandoffs)
      .where(eq(sheetHandoffs.sheetId, sheet.id))
      .limit(1);
    return routed ? null : destination;
  }

  /**
   * Move a released sheet to its workflow's destination, as a handoff would:
   * one immutable handoff entry, the sending department's managers kept as
   * route participants, and the sheet arriving unassigned and in no subpage,
   * so it waits in the destination's 待分派 and only that department's grants
   * apply to it. Returns the handoff sequence.
   */
  private async routeToDestination(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    sheet: SheetRow,
    destination: { id: string; displayName: string },
    options: {
      actorUserId: string;
      sentByUserId: string;
      note: string;
      trigger: "APPROVAL" | "SUBMISSION";
      context: RequestSecurityContext;
    },
  ): Promise<number> {
    const [sequenceAggregate] = await tx
      .select({ value: max(sheetHandoffs.sequence) })
      .from(sheetHandoffs)
      .where(eq(sheetHandoffs.sheetId, sheet.id));
    const sequence = (sequenceAggregate?.value ?? 0) + 1;
    await tx.insert(sheetHandoffs).values({
      sheetId: sheet.id,
      sequence,
      sourceDepartmentId: sheet.currentDepartmentId,
      destinationDepartmentId: destination.id,
      sentByUserId: options.sentByUserId,
      note: options.note,
    });
    for (const managerUserId of await this.activeManagerIds(tx, sheet.currentDepartmentId)) {
      await tx
        .insert(sheetRouteParticipants)
        .values({ sheetId: sheet.id, managerUserId, departmentId: sheet.currentDepartmentId })
        .onConflictDoNothing({
          target: [sheetRouteParticipants.sheetId, sheetRouteParticipants.managerUserId],
        });
    }
    await tx
      .update(productionSheets)
      .set({
        currentDepartmentId: destination.id,
        subpageId: null,
        assignedUserId: null,
        dueAt: null,
        completedAt: null,
      })
      .where(eq(productionSheets.id, sheet.id));
    const [[sourceDepartment], [sourceSubpage]] = await Promise.all([
      tx.select({ name: departments.displayName }).from(departments).where(eq(departments.id, sheet.currentDepartmentId)).limit(1),
      sheet.subpageId
        ? tx.select({ id: departmentSubpages.id, name: departmentSubpages.name }).from(departmentSubpages).where(eq(departmentSubpages.id, sheet.subpageId)).limit(1)
        : Promise.resolve([]),
    ]);
    await tx.insert(sheetSubpageHistory).values({
      sheetId: sheet.id,
      actorUserId: options.actorUserId,
      fromDepartmentId: sheet.currentDepartmentId,
      fromDepartmentName: sourceDepartment?.name ?? null,
      fromSubpageId: sourceSubpage?.id ?? null,
      fromSubpageName: sourceSubpage?.name ?? null,
      toDepartmentId: destination.id,
      toDepartmentName: destination.displayName,
      toSubpageId: null,
      toSubpageName: null,
      reason: "HANDOFF_PENDING",
      requestId: options.context.requestId,
    });
    await tx.insert(auditEvents).values({
      actorUserId: options.actorUserId,
      action: "SHEET_ROUTED",
      targetType: "PRODUCTION_SHEET",
      targetId: sheet.id,
      requestId: options.context.requestId,
      ipAddress: options.context.ipAddress,
      metadata: {
        sequence,
        sourceDepartmentId: sheet.currentDepartmentId,
        destinationDepartmentId: destination.id,
        ...(options.trigger === "APPROVAL"
          ? { automaticAfterApproval: true }
          : { automaticAfterSubmission: true }),
      },
    });
    return sequence;
  }

  private async activeManagerIds(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    departmentId: string,
  ): Promise<string[]> {
    const managers = await tx
      .select({ userId: departmentMemberships.userId })
      .from(departmentMemberships)
      .innerJoin(users, eq(users.id, departmentMemberships.userId))
      .where(
        and(
          eq(departmentMemberships.departmentId, departmentId),
          eq(departmentMemberships.kind, "MANAGER"),
          eq(departmentMemberships.active, true),
          eq(users.active, true),
        ),
      );
    return managers.map((manager) => manager.userId);
  }

  /**
   * Set or clear a sheet's 交期. Work is no longer assigned to a person (the
   * user, 2026-09-30): the subpage's identity grants decide who works on a
   * sheet, and the department's 主管 set the 交期 on its own. Overdue
   * reminders go to that department's 主管.
   */
  async setDueDate(
    user: SessionUser,
    sheetId: string,
    input: SheetDueDateRequest,
    context: RequestSecurityContext,
  ) {
    const now = this.now();
    const dueAt = input.dueAt === null ? null : new Date(input.dueAt);
    return this.db.transaction(async (tx) => {
      const [sheet] = await tx.select().from(productionSheets)
        .where(eq(productionSheets.id, sheetId)).for("update").limit(1);
      if (!sheet) throw new ResourceNotFoundError("找不到生產表單");
      const prior = await this.priorAction(tx, sheetId, input.clientMutationId, user.id, "SET_DUE_DATE");
      if (prior) return prior;
      if (!managesDepartment(actorSnapshot(user), sheet.currentDepartmentId)) {
        throw new AuthorizationError("只有目前部門主管可以設定交期");
      }
      if (!canSetDueDate(sheet.state)) throw new ConflictError("已完成或已封存的生產單不能設定交期");
      if (sheet.version !== input.baseVersion) throw new ConflictError("生產單已更新，請重新整理後再設定交期");
      if (dueAt !== null && dueAt <= now) throw new ConflictError("交期必須晚於目前時間");
      const version = sheet.version + 1;
      await tx.update(productionSheets)
        .set({ dueAt, version, updatedAt: now })
        .where(eq(productionSheets.id, sheetId));
      const result = { action: "SET_DUE_DATE", sheetId, dueAt: dueAt?.toISOString() ?? null, version };
      await tx.insert(sheetClientMutations).values({
        sheetId,
        clientMutationId: input.clientMutationId,
        actorUserId: user.id,
        result,
      });
      await tx.insert(auditEvents).values({
        actorUserId: user.id,
        action: "SHEET_DUE_DATE_SET",
        targetType: "PRODUCTION_SHEET",
        targetId: sheetId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: {
          departmentId: sheet.currentDepartmentId,
          fromDueAt: sheet.dueAt?.toISOString() ?? null,
          dueAt: dueAt?.toISOString() ?? null,
        },
      });
      return { ...result, replayed: false };
    });
  }

  async moveSubpage(
    user: SessionUser,
    sheetId: string,
    input: SheetMoveSubpageRequest,
    context: RequestSecurityContext,
  ) {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [sheet] = await tx.select().from(productionSheets)
        .where(eq(productionSheets.id, sheetId)).for("update").limit(1);
      if (!sheet) throw new ResourceNotFoundError("找不到生產表單");
      const prior = await this.priorAction(tx, sheetId, input.clientMutationId, user.id, "MOVE_SUBPAGE");
      if (prior) return prior;
      if (!managesDepartment(actorSnapshot(user), sheet.currentDepartmentId)) {
        throw new AuthorizationError("只有目前部門主管可以移動生產單");
      }
      if (sheet.version !== input.baseVersion) throw new ConflictError("生產單已更新，請重新整理後再移動");
      const [destination] = await tx.select().from(departmentSubpages).where(and(
        eq(departmentSubpages.id, input.subpageId),
        eq(departmentSubpages.departmentId, sheet.currentDepartmentId),
      )).for("key share").limit(1);
      if (!destination) throw new ResourceNotFoundError("找不到目的子分頁");
      if (sheet.subpageId === destination.id) throw new ConflictError("生產單已在此子分頁");
      // A sheet enters a subpage only under a form that subpage allows —
      // completed and archived records included, so every sheet a subpage
      // holds was a ticked form when it arrived.
      if (!(await this.formEnabledInSubpage(tx, destination.id, sheet.templateVersionId))) {
        throw new ConflictError("目的子分頁未開放這個表單，請先在子分頁設定中勾選");
      }

      const finalState = sheet.state === "COMPLETED" || sheet.state === "ARCHIVED";

      const [[source], [department]] = await Promise.all([
        sheet.subpageId ? tx.select().from(departmentSubpages).where(eq(departmentSubpages.id, sheet.subpageId)).limit(1) : Promise.resolve([]),
        tx.select({ name: departments.displayName }).from(departments).where(eq(departments.id, sheet.currentDepartmentId)).limit(1),
      ]);
      const version = sheet.version + 1;
      await tx.update(productionSheets).set({ subpageId: destination.id, version, updatedAt: now }).where(eq(productionSheets.id, sheetId));
      await tx.insert(sheetSubpageHistory).values({
        sheetId, actorUserId: user.id,
        fromDepartmentId: sheet.currentDepartmentId, fromDepartmentName: department?.name ?? null,
        fromSubpageId: source?.id ?? null, fromSubpageName: source?.name ?? null,
        toDepartmentId: sheet.currentDepartmentId, toDepartmentName: department?.name ?? null,
        toSubpageId: destination.id, toSubpageName: destination.name,
        reason: finalState ? "FINAL_RECLASSIFIED" : "MOVED", requestId: context.requestId,
      });
      const result = { action: "MOVE_SUBPAGE", sheetId, subpageId: destination.id, state: sheet.state, version };
      await tx.insert(sheetClientMutations).values({ sheetId, clientMutationId: input.clientMutationId, actorUserId: user.id, result });
      await tx.insert(auditEvents).values({ actorUserId: user.id, action: "SHEET_SUBPAGE_CHANGED", targetType: "PRODUCTION_SHEET", targetId: sheetId, requestId: context.requestId, ipAddress: context.ipAddress, metadata: { fromSubpageId: sheet.subpageId, toSubpageId: destination.id, state: sheet.state } });
      return { ...result, replayed: false };
    });
  }

  /**
   * Set a sheet's production status by hand (the user, 2026-09-30): 待生產,
   * 生產中 or 已完成, in any order, until it is handed on or archived. Anyone
   * who may modify it in its subpage does, form tick included. A sheet waiting
   * in 待分派 has no subpage yet, and one still to be sent to its workflow's
   * department is that department's to set.
   */
  async setStatus(
    user: SessionUser,
    sheetId: string,
    input: SheetStatusRequest,
    context: RequestSecurityContext,
  ) {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [sheet] = await tx.select().from(productionSheets)
        .where(eq(productionSheets.id, sheetId)).for("update").limit(1);
      if (!sheet) throw new ResourceNotFoundError("找不到生產表單");
      const prior = await this.priorAction(tx, sheetId, input.clientMutationId, user.id, "SET_STATUS");
      if (prior) return prior;
      if (!sheet.subpageId) {
        throw new ConflictError("請先由部門主管將生產單放入子分頁");
      }
      if (!(await this.subpageCapability(user, sheet, "canEdit"))) {
        throw new AuthorizationError("你沒有此子分頁的修改權限，無法更新生產狀態");
      }
      if (sheet.version !== input.baseVersion) {
        throw new ConflictError("生產單已更新，請重新整理後再更新狀態");
      }
      const template = await this.loadTemplateForSheet(sheet);
      if (await this.reviewOutstanding(tx, sheet, template)) {
        throw new ConflictError("請先送出審核，審核完成後才可更新生產狀態");
      }
      const pending = await this.pendingReleaseDestination(tx, sheet, template);
      if (pending) {
        throw new ConflictError(`請先送交${pending.displayName}，由${pending.displayName}更新生產狀態`);
      }
      let state: SheetRow["state"];
      try {
        state = changeProductionStatus(sheet.state, input.state);
      } catch {
        throw new ConflictError(sheet.state === input.state ? "生產單已是此狀態" : "目前狀態不可更新生產狀態");
      }
      const version = sheet.version + 1;
      await tx.update(productionSheets)
        .set({ state, completedAt: state === "COMPLETED" ? now : null, version, updatedAt: now })
        .where(eq(productionSheets.id, sheetId));
      const result = { action: "SET_STATUS", sheetId, state, version };
      await tx.insert(sheetClientMutations).values({
        sheetId,
        clientMutationId: input.clientMutationId,
        actorUserId: user.id,
        result,
      });
      await tx.insert(auditEvents).values({
        actorUserId: user.id,
        action: "SHEET_STATUS_CHANGED",
        targetType: "PRODUCTION_SHEET",
        targetId: sheetId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: { departmentId: sheet.currentDepartmentId, fromState: sheet.state, state },
      });
      // Finishing is what the department's 主管 and the route's earlier 主管
      // wait to hear: the sheet is theirs to archive.
      if (state === "COMPLETED") {
        const routeParticipants = await tx
          .select({ userId: sheetRouteParticipants.managerUserId })
          .from(sheetRouteParticipants)
          .where(eq(sheetRouteParticipants.sheetId, sheetId));
        const recipients = new Set<string>([
          ...(await this.activeManagerIds(tx, sheet.currentDepartmentId)),
          ...routeParticipants.map((participant) => participant.userId),
        ]);
        for (const recipientId of recipients) {
          await this.enqueue(
            tx,
            recipientId,
            sheetId,
            "SHEET_WORK_COMPLETED",
            "生產表單的目前部門工作已完成",
            `${input.clientMutationId}:COMPLETED:${recipientId}`,
          );
        }
      }
      return { ...result, replayed: false };
    });
  }

  async archive(
    user: SessionUser,
    sheetId: string,
    input: SheetLifecycleRequest,
    context: RequestSecurityContext,
  ) {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [sheet] = await tx
        .select()
        .from(productionSheets)
        .where(eq(productionSheets.id, sheetId))
        .for("update")
        .limit(1);
      if (!sheet) throw new ResourceNotFoundError("找不到生產表單");
      const prior = await this.priorAction(
        tx,
        sheetId,
        input.clientMutationId,
        user.id,
        "ARCHIVE",
      );
      if (prior) return prior;
      if (!canRouteWork(actorSnapshot(user), sheet.currentDepartmentId)) {
        throw new AuthorizationError("只有目前部門主管可以封存生產表單");
      }
      if (sheet.state !== "COMPLETED") {
        throw new ConflictError("只有已完成的生產表單可以封存");
      }

      const state = archiveCompletedWork(sheet.state);
      await tx
        .update(productionSheets)
        .set({ state, archivedAt: now, updatedAt: now })
        .where(eq(productionSheets.id, sheetId));
      const result = {
        action: "ARCHIVE",
        sheetId,
        state,
        archivedAt: now.toISOString(),
      };
      await tx.insert(sheetClientMutations).values({
        sheetId,
        clientMutationId: input.clientMutationId,
        actorUserId: user.id,
        result,
      });
      await tx.insert(auditEvents).values({
        actorUserId: user.id,
        action: "SHEET_ARCHIVED",
        targetType: "PRODUCTION_SHEET",
        targetId: sheetId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: {
          departmentId: sheet.currentDepartmentId,
          assignedUserId: sheet.assignedUserId,
          dueAt: sheet.dueAt?.toISOString() ?? null,
          completedAt: sheet.completedAt?.toISOString() ?? null,
        },
      });

      const [activeAssignee, routeParticipants] = await Promise.all([
        sheet.assignedUserId
          ? tx
              .select({ userId: users.id })
              .from(users)
              .where(
                and(eq(users.id, sheet.assignedUserId), eq(users.active, true)),
              )
              .limit(1)
          : Promise.resolve([]),
        tx
          .select({ userId: sheetRouteParticipants.managerUserId })
          .from(sheetRouteParticipants)
          .innerJoin(users, eq(users.id, sheetRouteParticipants.managerUserId))
          .where(
            and(
              eq(sheetRouteParticipants.sheetId, sheetId),
              eq(users.active, true),
            ),
          ),
      ]);
      const recipients = new Set<string>([
        ...activeAssignee.map((recipient) => recipient.userId),
        ...(await this.activeManagerIds(tx, sheet.currentDepartmentId)),
        ...routeParticipants.map((participant) => participant.userId),
      ]);
      for (const recipientId of recipients) {
        await this.enqueue(
          tx,
          recipientId,
          sheetId,
          "SHEET_ARCHIVED",
          "生產單已封存。",
          `${input.clientMutationId}:ARCHIVED:${recipientId}`,
        );
      }
      return result;
    });
  }

  /**
   * Brings an archived sheet back to its subpage as 已完成 (the user,
   * 2026-10-04): its department's 主管 finds it in 完工紀錄. Archiving keeps the
   * subpage, and a subpage holding any sheet cannot be deleted, so it is still
   * there. The one-year deletion clock stops; archiving again starts a new one.
   */
  /**
   * Deletes an archived sheet now rather than a year after 封存 (the user,
   * 2026-10-04), at its department's 主管's or ADMIN's/總經理's word. It is
   * the retention worker's deletion: attachment files are queued for removal,
   * an audit event records it without sheet values, and the sheet row goes,
   * cascading to its values, history, attachment rows and notifications. The
   * client mutation is kept in the audit event, so a repeated request replays.
   */
  async remove(
    user: SessionUser,
    sheetId: string,
    input: SheetLifecycleRequest,
    context: RequestSecurityContext,
  ) {
    return this.db.transaction(async (tx) => {
      const [sheet] = await tx
        .select()
        .from(productionSheets)
        .where(eq(productionSheets.id, sheetId))
        .for("update")
        .limit(1);
      if (!sheet) {
        const [prior] = await tx
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "SHEET_DELETED"),
              eq(auditEvents.targetId, sheetId),
              eq(auditEvents.actorUserId, user.id),
              sql`${auditEvents.metadata} ->> 'clientMutationId' = ${input.clientMutationId}`,
            ),
          )
          .limit(1);
        if (prior) return { action: "DELETE", sheetId, replayed: true };
        throw new ResourceNotFoundError("找不到生產表單");
      }
      if (!canRouteWork(actorSnapshot(user), sheet.currentDepartmentId)) {
        throw new AuthorizationError("只有目前部門主管可以刪除生產單");
      }
      if (sheet.state !== "ARCHIVED") {
        throw new ConflictError("只有已封存的生產單可以刪除");
      }
      const [template] = await tx
        .select({ slug: sheetTemplates.slug, version: sheetTemplateVersions.version })
        .from(sheetTemplateVersions)
        .innerJoin(sheetTemplates, eq(sheetTemplates.id, sheetTemplateVersions.templateId))
        .where(eq(sheetTemplateVersions.id, sheet.templateVersionId))
        .limit(1);
      const files = await tx
        .select({
          id: sheetAttachments.id,
          storageKey: sheetAttachments.storageKey,
          storageVersionId: sheetAttachments.storageVersionId,
        })
        .from(sheetAttachments)
        .where(and(eq(sheetAttachments.sheetId, sheetId), isNull(sheetAttachments.deletedAt)));
      if (files.length > 0) {
        await tx
          .insert(outboxJobs)
          .values(
            files.map((file) => ({
              jobType: "SHEET_ATTACHMENT_DELETE",
              payload: {
                attachmentId: file.id,
                storageKey: file.storageKey,
                storageVersionId: file.storageVersionId,
              },
              deduplicationKey: `sheet-attachment-delete:${file.id}`,
            })),
          )
          .onConflictDoNothing();
      }
      await tx.insert(auditEvents).values({
        actorUserId: user.id,
        action: "SHEET_DELETED",
        targetType: "PRODUCTION_SHEET",
        targetId: sheetId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: {
          clientMutationId: input.clientMutationId,
          sheetNumber: sheet.sheetNumber,
          departmentId: sheet.currentDepartmentId,
          subpageId: sheet.subpageId,
          template: template ? `${template.slug}@${template.version}` : null,
          archivedAt: sheet.archivedAt?.toISOString() ?? null,
          attachmentFiles: files.length,
        },
      });
      await tx.delete(productionSheets).where(eq(productionSheets.id, sheetId));
      return { action: "DELETE", sheetId, replayed: false };
    });
  }

  async restore(
    user: SessionUser,
    sheetId: string,
    input: SheetLifecycleRequest,
    context: RequestSecurityContext,
  ) {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [sheet] = await tx
        .select()
        .from(productionSheets)
        .where(eq(productionSheets.id, sheetId))
        .for("update")
        .limit(1);
      if (!sheet) throw new ResourceNotFoundError("找不到生產表單");
      const prior = await this.priorAction(tx, sheetId, input.clientMutationId, user.id, "RESTORE");
      if (prior) return prior;
      if (!canRouteWork(actorSnapshot(user), sheet.currentDepartmentId)) {
        throw new AuthorizationError("只有目前部門主管可以恢復已封存的生產單");
      }
      if (sheet.state !== "ARCHIVED") {
        throw new ConflictError("只有已封存的生產單可以恢復");
      }
      const state = restoreArchivedWork(sheet.state);
      const version = sheet.version + 1;
      await tx
        .update(productionSheets)
        .set({ state, archivedAt: null, version, updatedAt: now })
        .where(eq(productionSheets.id, sheetId));
      const result = { action: "RESTORE", sheetId, state, subpageId: sheet.subpageId, version };
      await tx.insert(sheetClientMutations).values({
        sheetId,
        clientMutationId: input.clientMutationId,
        actorUserId: user.id,
        result,
      });
      await tx.insert(auditEvents).values({
        actorUserId: user.id,
        action: "SHEET_RESTORED",
        targetType: "PRODUCTION_SHEET",
        targetId: sheetId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: {
          departmentId: sheet.currentDepartmentId,
          subpageId: sheet.subpageId,
          archivedAt: sheet.archivedAt?.toISOString() ?? null,
        },
      });
      return { ...result, replayed: false };
    });
  }

  async submit(
    user: SessionUser,
    sheetId: string,
    input: SheetSubmitRequest,
    context: RequestSecurityContext,
  ) {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [sheet] = await tx.select().from(productionSheets).where(eq(productionSheets.id, sheetId)).for("update").limit(1);
      if (!sheet) throw new ResourceNotFoundError("找不到生產表單");
      const prior = await this.priorAction(tx, sheetId, input.clientMutationId, user.id, "SUBMIT");
      if (prior) return prior;
      const template = await this.loadTemplateForSheet(sheet);
      if (!(await this.subpageCapability(user, sheet, "canSubmit"))) {
        throw new AuthorizationError("你沒有此子分頁的送交權限");
      }
      // No draft and no review (the user, 2026-09-30). What is left of
      // submitting is sending a sheet on to the department its workflow leads
      // to — 退火明細表 to 燒頓, 分條申請單 to 分條 — once, from 待生產. A
      // sheet from before still in 草稿 or 已退回 is released to 待生產 here.
      if (!["DRAFT", "RETURNED", "READY"].includes(sheet.state)) {
        throw new ConflictError("目前狀態不可送交");
      }
      if (await this.reviewOutstanding(tx, sheet, template)) {
        return this.submitForReview(tx, user, sheet, template, input, context);
      }
      const releaseTo = await this.pendingReleaseDestination(tx, sheet, template);
      if (sheet.state === "READY" && !releaseTo) {
        throw new ConflictError("這張生產單不需送交，請直接更新生產狀態");
      }
      const [stored] = await tx.select().from(sheetValues).where(eq(sheetValues.sheetId, sheetId)).limit(1);
      if (!stored) throw new Error("Sheet values are missing");
      const validationIssues = validateForSubmission(template.definition, stored.values);
      if (validationIssues.length > 0) {
        throw new SheetConflictError("表單尚未填寫完整", { validationIssues });
      }
      // Someone there has to be able to take it.
      const releaseManagerIds = releaseTo
        ? await this.activeManagerIds(tx, releaseTo.id)
        : [];
      if (releaseTo && releaseManagerIds.length === 0) {
        throw new ConflictError(`${releaseTo.displayName}尚未設定有效主管，無法送交`);
      }

      const state = "READY" as const;
      await tx.update(productionSheets).set({ state, updatedAt: now }).where(eq(productionSheets.id, sheetId));
      if (releaseTo) {
        await this.routeToDestination(tx, sheet, releaseTo, {
          actorUserId: user.id,
          sentByUserId: user.id,
          note: `送交後自動送至${releaseTo.displayName}部門`,
          trigger: "SUBMISSION",
          context,
        });
        for (const managerUserId of releaseManagerIds) {
          await this.enqueue(
            tx,
            managerUserId,
            sheetId,
            "SHEET_HANDED_OFF",
            `生產表單已送至${releaseTo.displayName}，等待部門主管放入子分頁`,
            `${input.clientMutationId}:HANDOFF:${managerUserId}`,
          );
        }
      }
      const result = {
        action: "SUBMIT",
        sheetId,
        state,
        routedTo: releaseTo ? { departmentId: releaseTo.id, displayName: releaseTo.displayName } : null,
      };
      await tx.insert(sheetClientMutations).values({ sheetId, clientMutationId: input.clientMutationId, actorUserId: user.id, result });
      await tx.insert(auditEvents).values({
        actorUserId: user.id,
        action: "SHEET_SUBMITTED",
        targetType: "PRODUCTION_SHEET",
        targetId: sheetId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: { state, routedTo: releaseTo?.id ?? null },
      });
      return result;
    });
  }

  /**
   * Whether this sheet still owes its review: its form requires one, it has
   * never been approved, and it has not been sent on. A sheet sent on before
   * review was restored (2026-10-01) owes none.
   */
  private async reviewOutstanding(
    db: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
    sheet: Pick<SheetRow, "id">,
    template: TemplateRecord,
  ): Promise<boolean> {
    if (!template.definition.workflow.requiresReview) return false;
    const [[approved], [routed]] = await Promise.all([
      db
        .select({ id: approvalRuns.id })
        .from(approvalRuns)
        .where(and(eq(approvalRuns.sheetId, sheet.id), eq(approvalRuns.status, "APPROVED")))
        .limit(1),
      db
        .select({ id: sheetHandoffs.id })
        .from(sheetHandoffs)
        .where(eq(sheetHandoffs.sheetId, sheet.id))
        .limit(1),
    ]);
    return !approved && !routed;
  }

  /** The active holders of a review role. Each role has one at most. */
  private async activeRoleHolderIds(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    role: RoleCode,
  ): Promise<string[]> {
    const holders = await tx
      .select({ userId: roleAssignments.userId })
      .from(roleAssignments)
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .where(and(eq(roleAssignments.role, role), eq(roleAssignments.active, true), eq(users.active, true)));
    return holders.map((holder) => holder.userId);
  }

  /**
   * 送出審核: open an approval run with one step per review role, in order,
   * lock the sheet at the first stage and tell 業務. The values are checked
   * and fingerprinted, every review role must have someone, and where the
   * sheet will go once approved must have a 主管 to take it.
   */
  private async submitForReview(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    user: SessionUser,
    sheet: SheetRow,
    template: TemplateRecord,
    input: SheetSubmitRequest,
    context: RequestSecurityContext,
  ) {
    const now = this.now();
    const [stored] = await tx.select().from(sheetValues).where(eq(sheetValues.sheetId, sheet.id)).limit(1);
    if (!stored) throw new Error("Sheet values are missing");
    const validationIssues = validateForSubmission(template.definition, stored.values);
    if (validationIssues.length > 0) {
      throw new SheetConflictError("表單尚未填寫完整", { validationIssues });
    }
    const roles = template.definition.workflow.approvalRoles;
    const holders = new Map<RoleCode, string[]>();
    for (const role of roles) holders.set(role, await this.activeRoleHolderIds(tx, role));
    const missingRoles = roles.filter((role) => (holders.get(role) ?? []).length === 0);
    if (missingRoles.length > 0) {
      throw new SheetConflictError("審核人員尚未設定", { missingRoles });
    }
    const destination = await this.workflowDestination(tx, sheet, template);
    if (destination && (await this.activeManagerIds(tx, destination.id)).length === 0) {
      throw new ConflictError(`${destination.displayName}尚未設定有效主管，無法送出審核`);
    }

    const [runAggregate] = await tx
      .select({ value: max(approvalRuns.runNumber) })
      .from(approvalRuns)
      .where(eq(approvalRuns.sheetId, sheet.id));
    const runNumber = (runAggregate?.value ?? 0) + 1;
    const [run] = await tx
      .insert(approvalRuns)
      .values({
        sheetId: sheet.id,
        runNumber,
        reviewedDataFingerprint: reviewedDataFingerprint(template.definition, stored.values),
        submittedByUserId: user.id,
      })
      .returning({ id: approvalRuns.id });
    if (!run) throw new Error("Failed to create approval run");
    await tx.insert(approvalSteps).values(
      roles.map((role, index) => ({
        approvalRunId: run.id,
        sequence: index + 1,
        requiredRole: role,
        reviewerUserId: holders.get(role)![0]!,
      })),
    );
    const state = FIRST_REVIEW_STATE;
    await tx.update(productionSheets).set({ state, updatedAt: now }).where(eq(productionSheets.id, sheet.id));
    const result = { action: "SUBMIT", sheetId: sheet.id, state, runNumber, routedTo: null };
    await tx.insert(sheetClientMutations).values({
      sheetId: sheet.id,
      clientMutationId: input.clientMutationId,
      actorUserId: user.id,
      result,
    });
    await tx.insert(auditEvents).values({
      actorUserId: user.id,
      action: "SHEET_SUBMITTED",
      targetType: "PRODUCTION_SHEET",
      targetId: sheet.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      metadata: { state, runNumber, review: true },
    });
    const firstRole = requiredApprovalRole(state)!;
    for (const reviewerId of holders.get(firstRole) ?? []) {
      await this.enqueue(
        tx,
        reviewerId,
        sheet.id,
        "SHEET_REVIEW_REQUIRED",
        "有一張生產表單等待您的審核",
        `${input.clientMutationId}:REVIEW:${firstRole}:${reviewerId}`,
      );
    }
    return result;
  }

  async approve(
    user: SessionUser,
    sheetId: string,
    input: SheetApproveRequest,
    context: RequestSecurityContext,
  ) {
    return this.review(user, sheetId, input, "APPROVE", context);
  }

  async reject(
    user: SessionUser,
    sheetId: string,
    input: SheetRejectRequest,
    context: RequestSecurityContext,
  ) {
    return this.review(user, sheetId, input, "REJECT", context);
  }

  /**
   * 核准 or 退回 at the current stage, by whoever holds its role now. The step
   * records who decided. 核准 by 總經理 completes the run and sends the sheet
   * to 分條, or leaves it in 分條 when 分條 wrote it; 退回 at any stage returns
   * it, unlocked, to the department that wrote it, to be sent again from 業務.
   */
  private async review(
    user: SessionUser,
    sheetId: string,
    input: SheetApproveRequest | SheetRejectRequest,
    action: "APPROVE" | "REJECT",
    context: RequestSecurityContext,
  ) {
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [sheet] = await tx.select().from(productionSheets).where(eq(productionSheets.id, sheetId)).for("update").limit(1);
      if (!sheet) throw new ResourceNotFoundError("找不到生產表單");
      const prior = await this.priorAction(tx, sheetId, input.clientMutationId, user.id, action);
      if (prior) return prior;
      const requiredRole = requiredApprovalRole(sheet.state);
      if (!requiredRole) throw new ConflictError("此表單目前不在審核中");
      if (!user.roles.includes(requiredRole)) throw new AuthorizationError("目前不是您的審核階段");

      const [run] = await tx
        .select()
        .from(approvalRuns)
        .where(and(eq(approvalRuns.sheetId, sheetId), eq(approvalRuns.status, "PENDING")))
        .orderBy(desc(approvalRuns.runNumber))
        .limit(1);
      if (!run) throw new ConflictError("找不到進行中的審核流程");
      const [step] = await tx
        .select()
        .from(approvalSteps)
        .where(
          and(
            eq(approvalSteps.approvalRunId, run.id),
            eq(approvalSteps.requiredRole, requiredRole),
            eq(approvalSteps.decision, "PENDING"),
          ),
        )
        .limit(1);
      if (!step) throw new ConflictError("找不到此審核階段");

      const template = await this.loadTemplateForSheet(sheet);
      let nextState: SheetRow["state"];
      let routedTo: { id: string; displayName: string } | null = null;
      if (action === "REJECT") {
        nextState = rejectCurrentStage(sheet.state, input.comment ?? "");
        await tx
          .update(approvalSteps)
          .set({ decision: "REJECTED", reviewerUserId: user.id, comment: input.comment, decidedAt: now })
          .where(eq(approvalSteps.id, step.id));
        await tx.update(approvalRuns).set({ status: "RETURNED", completedAt: now }).where(eq(approvalRuns.id, run.id));
      } else {
        nextState = approveCurrentStage(sheet.state);
        await tx
          .update(approvalSteps)
          .set({ decision: "APPROVED", reviewerUserId: user.id, comment: input.comment ?? null, decidedAt: now })
          .where(eq(approvalSteps.id, step.id));
        if (nextState === "READY") {
          await tx.update(approvalRuns).set({ status: "APPROVED", completedAt: now }).where(eq(approvalRuns.id, run.id));
          const destination = await this.workflowDestination(tx, sheet, template);
          if (destination) {
            if ((await this.activeManagerIds(tx, destination.id)).length === 0) {
              throw new ConflictError(`${destination.displayName}尚未設定有效主管，無法完成審核`);
            }
            await this.routeToDestination(tx, sheet, destination, {
              actorUserId: user.id,
              sentByUserId: run.submittedByUserId,
              note: `審核完成後自動送至${destination.displayName}部門`,
              trigger: "APPROVAL",
              context,
            });
            routedTo = destination;
          }
        }
      }

      await tx.update(productionSheets).set({ state: nextState, updatedAt: now }).where(eq(productionSheets.id, sheetId));
      const result = {
        action,
        sheetId,
        state: nextState,
        runNumber: run.runNumber,
        routedTo: routedTo ? { departmentId: routedTo.id, displayName: routedTo.displayName } : null,
      };
      await tx.insert(sheetClientMutations).values({ sheetId, clientMutationId: input.clientMutationId, actorUserId: user.id, result });
      await tx.insert(auditEvents).values({
        actorUserId: user.id,
        action: action === "APPROVE" ? "SHEET_APPROVED_STAGE" : "SHEET_RETURNED",
        targetType: "PRODUCTION_SHEET",
        targetId: sheetId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        metadata: { runNumber: run.runNumber, role: requiredRole, state: nextState, commentProvided: Boolean(input.comment) },
      });

      // Who hears about it: the writing department on 退回 and on completion,
      // the next reviewer while it is still under review, and 分條's 主管 once
      // it arrives there.
      const writers = new Set<string>([
        sheet.createdByUserId,
        ...(await this.activeManagerIds(tx, sheet.currentDepartmentId)),
      ]);
      if (action === "REJECT") {
        for (const recipientId of writers) {
          await this.enqueue(tx, recipientId, sheetId, "SHEET_RETURNED", "生產表單已退回修改", `${input.clientMutationId}:RETURNED:${recipientId}`);
        }
      } else if (nextState !== "READY") {
        const nextRole = requiredApprovalRole(nextState)!;
        for (const reviewerId of await this.activeRoleHolderIds(tx, nextRole)) {
          await this.enqueue(tx, reviewerId, sheetId, "SHEET_REVIEW_REQUIRED", "有一張生產表單等待您的審核", `${input.clientMutationId}:REVIEW:${nextRole}:${reviewerId}`);
        }
      } else {
        for (const recipientId of writers) {
          await this.enqueue(tx, recipientId, sheetId, "SHEET_READY", "生產表單已完成審核", `${input.clientMutationId}:READY:${recipientId}`);
        }
        if (routedTo) {
          for (const managerUserId of await this.activeManagerIds(tx, routedTo.id)) {
            await this.enqueue(
              tx,
              managerUserId,
              sheetId,
              "SHEET_HANDED_OFF",
              `生產表單已完成審核並送至${routedTo.displayName}，等待部門主管放入子分頁`,
              `${input.clientMutationId}:HANDOFF:${managerUserId}`,
            );
          }
        }
      }
      return result;
    });
  }

  /**
   * The names in a reviewed form's signature boxes, for the sheet page and
   * its PDF alike (the user, 2026-10-01): 申請單位 is the department the sheet
   * came from, with when it was sent for review, and 業務, 協理 and 總經理 each
   * whoever approved their stage, with the Taipei time. Only the current round counts: after 退回 the boxes are
   * empty again until it is sent anew, and an approved round keeps them.
   */
  private async signatures(
    sheetId: string,
  ): Promise<Partial<Record<SignatureRole, SheetSignature>>> {
    const [latestRun] = await this.db
      .select({
        id: approvalRuns.id,
        status: approvalRuns.status,
        submittedByUserId: approvalRuns.submittedByUserId,
        submittedAt: approvalRuns.submittedAt,
      })
      .from(approvalRuns)
      .where(eq(approvalRuns.sheetId, sheetId))
      .orderBy(desc(approvalRuns.runNumber))
      .limit(1);
    const signatures: Partial<Record<SignatureRole, SheetSignature>> = {};
    if (!latestRun || (latestRun.status !== "PENDING" && latestRun.status !== "APPROVED")) {
      return signatures;
    }
    const approvedSteps = await this.db
      .select({
        requiredRole: approvalSteps.requiredRole,
        reviewerUserId: approvalSteps.reviewerUserId,
        decidedAt: approvalSteps.decidedAt,
      })
      .from(approvalSteps)
      .where(
        and(
          eq(approvalSteps.approvalRunId, latestRun.id),
          eq(approvalSteps.decision, "APPROVED"),
        ),
      );
    const reviewerIds = [
      ...new Set(approvedSteps.flatMap((step) => (step.reviewerUserId ? [step.reviewerUserId] : []))),
    ];
    const [people, [origin]] = await Promise.all([
      reviewerIds.length > 0
        ? this.db
            .select({ id: users.id, displayName: users.displayName })
            .from(users)
            .where(inArray(users.id, reviewerIds))
        : Promise.resolve([]),
      this.db
        .select({ displayName: departments.displayName })
        .from(productionSheets)
        .innerJoin(departments, eq(departments.id, productionSheets.originDepartmentId))
        .where(eq(productionSheets.id, sheetId))
        .limit(1),
    ]);
    const names = new Map(people.map((person) => [person.id, person.displayName]));
    // 申請單位 names the department, not the person (the user, 2026-10-01).
    if (origin) {
      signatures.ORIGIN_MANAGER = {
        displayName: origin.displayName,
        decidedAt: taipeiSignatureTime(latestRun.submittedAt),
      };
    }
    for (const step of approvedSteps) {
      if (!step.reviewerUserId || !step.decidedAt) continue;
      const displayName = names.get(step.reviewerUserId);
      const signatureRole = approvalRoleToSignatureRole(step.requiredRole);
      if (displayName && signatureRole) {
        signatures[signatureRole] = {
          displayName,
          decidedAt: taipeiSignatureTime(step.decidedAt),
        };
      }
    }
    return signatures;
  }
}
