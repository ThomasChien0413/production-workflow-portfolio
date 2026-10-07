import { and, asc, count, eq, gt, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import type {
  CreateDepartmentSubpageRequest,
  DeleteDepartmentSubpageRequest,
  ReplaceSubpageIdentityPermissionsRequest,
  ReplaceSubpageTemplatesRequest,
  SessionUser,
  UpdateDepartmentSubpageRequest,
} from "@workflow/contracts";
import { sheetTemplateDefinitionSchema } from "@workflow/contracts";
import {
  auditEvents,
  departmentMemberships,
  departments,
  departmentSubpageMutations,
  departmentSubpageIdentityPermissions,
  departmentSubpageTemplates,
  departmentSubpages,
  productionSheets,
  sheetTemplates,
  sheetTemplateVersions,
  users,
  type Database,
} from "@workflow/database";
import { managesDepartment } from "@workflow/domain";
import { AuthorizationError, ConflictError, ResourceNotFoundError } from "../auth/errors.js";
import type { RequestSecurityContext } from "../auth/service.js";

function actor(user: SessionUser) {
  return {
    userId: user.id,
    roles: user.roles,
    memberships: user.memberships.map((membership) => ({
      departmentId: membership.departmentId,
      kind: membership.kind,
    })),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export class DepartmentSubpageService {
  constructor(private readonly db: Database, private readonly now = () => new Date()) {}

  private canManage(user: SessionUser, departmentId: string): boolean {
    return user.roles.includes("ADMIN") ||
      user.roles.includes("GENERAL_MANAGER") ||
      managesDepartment(actor(user), departmentId);
  }

  private async requireDepartment(departmentId: string) {
    const [department] = await this.db.select().from(departments).where(
      and(eq(departments.id, departmentId), eq(departments.active, true)),
    ).limit(1);
    if (!department) throw new ResourceNotFoundError("找不到部門");
    return department;
  }

  private requireManager(user: SessionUser, departmentId: string): void {
    if (!this.canManage(user, departmentId)) {
      throw new AuthorizationError("只有該部門主管、ADMIN 或總經理可以管理子分頁");
    }
  }

  async list(user: SessionUser, departmentId: string) {
    const department = await this.requireDepartment(departmentId);
    const canManage = this.canManage(user, departmentId);
    const isDepartmentManager = managesDepartment(actor(user), departmentId);
    const [subpages, identityRows, selectedRows, membershipRows, templateRows] = await Promise.all([
      this.db.select({
        id: departmentSubpages.id,
        departmentId: departmentSubpages.departmentId,
        name: departmentSubpages.name,
        position: departmentSubpages.position,
        revision: departmentSubpages.revision,
        sheetCount: count(productionSheets.id),
      }).from(departmentSubpages)
        // Archived sheets are in 完工紀錄, not the subpage (the user, 2026-10-04).
        .leftJoin(productionSheets, and(eq(productionSheets.subpageId, departmentSubpages.id), ne(productionSheets.state, "ARCHIVED")))
        .where(eq(departmentSubpages.departmentId, departmentId))
        .groupBy(departmentSubpages.id)
        .orderBy(asc(departmentSubpages.position), asc(departmentSubpages.name), asc(departmentSubpages.id)),
      this.db.select().from(departmentSubpageIdentityPermissions)
        .innerJoin(departmentSubpages, eq(departmentSubpages.id, departmentSubpageIdentityPermissions.subpageId))
        .where(eq(departmentSubpages.departmentId, departmentId)),
      this.db.select({ subpageId: departmentSubpageTemplates.subpageId, templateId: departmentSubpageTemplates.templateId })
        .from(departmentSubpageTemplates)
        .innerJoin(departmentSubpages, eq(departmentSubpages.id, departmentSubpageTemplates.subpageId))
        .where(eq(departmentSubpages.departmentId, departmentId)),
      this.db.select({
        id: users.id,
        displayName: users.displayName,
        kind: departmentMemberships.kind,
      }).from(departmentMemberships)
        .innerJoin(users, eq(users.id, departmentMemberships.userId))
        .where(and(
          eq(departmentMemberships.departmentId, departmentId),
          eq(departmentMemberships.active, true),
        eq(users.active, true),
      ))
        .orderBy(asc(users.id), asc(departmentMemberships.kind)),
      canManage ? this.db.select({
        id: sheetTemplates.id,
        displayName: sheetTemplates.displayName,
        version: sheetTemplateVersions.version,
        definition: sheetTemplateVersions.definition,
      }).from(sheetTemplates)
        .innerJoin(sheetTemplateVersions, and(
          eq(sheetTemplateVersions.templateId, sheetTemplates.id),
          eq(sheetTemplateVersions.version, sheetTemplates.currentVersionNumber),
        ))
        .where(and(eq(sheetTemplates.active, true), sql`${sheetTemplateVersions.publishedAt} IS NOT NULL`))
        .orderBy(asc(sheetTemplates.displayName), asc(sheetTemplates.id)) : Promise.resolve([]),
    ]);

    const ownKinds = new Set(membershipRows.filter((row) => row.id === user.id).map((row) => row.kind));
    const ownPermissionSubpages = new Set(
      identityRows.filter((row) => ownKinds.has(row.department_subpage_identity_permissions.kind) && row.department_subpage_identity_permissions.canView)
        .map((row) => row.department_subpage_identity_permissions.subpageId),
    );
    const visible = canManage || user.roles.some((role) => ["ADMIN", "GENERAL_MANAGER", "ASSOCIATE", "SALES"].includes(role))
      ? subpages
      : subpages.filter((subpage) => ownPermissionSubpages.has(subpage.id));
    const eligibleTemplates = templateRows.flatMap((row) => {
      const parsed = sheetTemplateDefinitionSchema.safeParse(row.definition);
      return parsed.success && parsed.data.status === "APPROVED" && parsed.data.allowedCreatorDepartmentCodes.includes(department.code as typeof parsed.data.allowedCreatorDepartmentCodes[number])
        ? [{ id: row.id, displayName: row.displayName, documentCode: parsed.data.documentCode, version: row.version }]
        : [];
    });
    const groupedUsers = new Map<string, { id: string; displayName: string; kinds: typeof membershipRows[number]["kind"][]; manager: boolean }>();
    for (const row of membershipRows) {
      const existing = groupedUsers.get(row.id) ?? { id: row.id, displayName: row.displayName, kinds: [], manager: false };
      if (!existing.kinds.includes(row.kind)) existing.kinds.push(row.kind);
      if (row.kind === "MANAGER") existing.manager = true;
      groupedUsers.set(row.id, existing);
    }
    return {
      canManage,
      subpages: visible.map((subpage) => ({
        ...subpage,
        sheetCount: Number(subpage.sheetCount),
          capabilities: isDepartmentManager
            ? { canView: true, canCreate: true, canEdit: true, canSubmit: true }
            : {
                canView: this.isGlobalReader(user) || identityRows.some((row) => row.department_subpage_identity_permissions.subpageId === subpage.id && ownKinds.has(row.department_subpage_identity_permissions.kind) && row.department_subpage_identity_permissions.canView),
                canCreate: identityRows.some((row) => row.department_subpage_identity_permissions.subpageId === subpage.id && ownKinds.has(row.department_subpage_identity_permissions.kind) && row.department_subpage_identity_permissions.canCreate),
                canEdit: identityRows.some((row) => row.department_subpage_identity_permissions.subpageId === subpage.id && ownKinds.has(row.department_subpage_identity_permissions.kind) && row.department_subpage_identity_permissions.canEdit),
                canSubmit: identityRows.some((row) => row.department_subpage_identity_permissions.subpageId === subpage.id && ownKinds.has(row.department_subpage_identity_permissions.kind) && row.department_subpage_identity_permissions.canSubmit),
              },
          identityPermissions: canManage
            ? identityRows.filter((row) => row.department_subpage_identity_permissions.subpageId === subpage.id).map((row) => ({
                kind: row.department_subpage_identity_permissions.kind as "ORDER_TAKER" | "STAFF",
                canView: row.department_subpage_identity_permissions.canView,
                canCreate: row.department_subpage_identity_permissions.canCreate,
                canEdit: row.department_subpage_identity_permissions.canEdit,
                canSubmit: row.department_subpage_identity_permissions.canSubmit,
              }))
            : [],
          enabledTemplateIds: selectedRows.filter((row) => row.subpageId === subpage.id).map((row) => row.templateId),
        })),
      eligibleTemplates,
      eligibleUsers: canManage ? [...groupedUsers.values()] : [],
    };
  }

  private isGlobalReader(user: SessionUser): boolean {
    return user.roles.some((role) => ["ADMIN", "GENERAL_MANAGER", "ASSOCIATE", "SALES"].includes(role));
  }

  private async replay(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], user: SessionUser, mutationId: string, action: string, departmentId: string, subpageId?: string) {
    const [prior] = await tx.select().from(departmentSubpageMutations).where(and(
      eq(departmentSubpageMutations.actorUserId, user.id),
      eq(departmentSubpageMutations.clientMutationId, mutationId),
    )).limit(1);
    if (!prior) return null;
    if (prior.action !== action || prior.departmentId !== departmentId || (subpageId !== undefined && prior.subpageId !== subpageId)) throw new ConflictError("此操作識別碼已被其他操作使用");
    return { ...prior.result, replayed: true };
  }

  async create(user: SessionUser, departmentId: string, input: CreateDepartmentSubpageRequest, context: RequestSecurityContext) {
    await this.requireDepartment(departmentId);
    this.requireManager(user, departmentId);
    return this.db.transaction(async (tx) => {
      await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, departmentId)).for("update").limit(1);
      const prior = await this.replay(tx, user, input.clientMutationId, "CREATE", departmentId);
      if (prior) return prior;
      const [{ value: nextPosition = 0 } = { value: 0 }] = await tx.select({ value: count(departmentSubpages.id) })
        .from(departmentSubpages).where(eq(departmentSubpages.departmentId, departmentId));
      let created;
      try {
        [created] = await tx.insert(departmentSubpages).values({
          departmentId,
          name: input.name,
          position: Number(nextPosition),
          createdByUserId: user.id,
          updatedByUserId: user.id,
        }).returning();
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictError("此部門已有同名子分頁");
        throw error;
      }
      if (!created) throw new Error("Failed to create department subpage");
      const result = { action: "CREATE", subpageId: created.id, revision: created.revision, name: created.name };
      await tx.insert(departmentSubpageMutations).values({ actorUserId: user.id, clientMutationId: input.clientMutationId, action: "CREATE", departmentId, subpageId: created.id, result });
      await tx.insert(auditEvents).values({ actorUserId: user.id, action: "DEPARTMENT_SUBPAGE_CREATED", targetType: "DEPARTMENT_SUBPAGE", targetId: created.id, requestId: context.requestId, ipAddress: context.ipAddress, metadata: { departmentId, name: created.name } });
      return { ...result, replayed: false };
    });
  }

  async update(user: SessionUser, departmentId: string, subpageId: string, input: UpdateDepartmentSubpageRequest, context: RequestSecurityContext) {
    this.requireManager(user, departmentId);
    const now = this.now();
    return this.db.transaction(async (tx) => {
      await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, departmentId)).for("update").limit(1);
      const prior = await this.replay(tx, user, input.clientMutationId, "UPDATE", departmentId, subpageId);
      if (prior) return prior;
      const [existing] = await tx.select().from(departmentSubpages).where(and(eq(departmentSubpages.id, subpageId), eq(departmentSubpages.departmentId, departmentId))).for("update").limit(1);
      if (!existing) throw new ResourceNotFoundError("找不到子分頁");
      if (existing.revision !== input.revision) throw new ConflictError("子分頁已由其他人更新，請重新整理");
      if (input.position !== undefined && input.position !== existing.position) {
        const [{ value: total = 0 } = { value: 0 }] = await tx
          .select({ value: count(departmentSubpages.id) })
          .from(departmentSubpages)
          .where(eq(departmentSubpages.departmentId, departmentId));
        if (input.position >= Number(total)) throw new ConflictError("子分頁排序位置超出範圍");
        if (input.position < existing.position) {
          await tx.update(departmentSubpages)
            .set({ position: sql`${departmentSubpages.position} + 1`, revision: sql`${departmentSubpages.revision} + 1`, updatedByUserId: user.id, updatedAt: now })
            .where(and(
              eq(departmentSubpages.departmentId, departmentId),
              gte(departmentSubpages.position, input.position),
              lt(departmentSubpages.position, existing.position),
            ));
        } else {
          await tx.update(departmentSubpages)
            .set({ position: sql`${departmentSubpages.position} - 1`, revision: sql`${departmentSubpages.revision} + 1`, updatedByUserId: user.id, updatedAt: now })
            .where(and(
              eq(departmentSubpages.departmentId, departmentId),
              gt(departmentSubpages.position, existing.position),
              lte(departmentSubpages.position, input.position),
            ));
        }
      }
      let updated;
      try {
        [updated] = await tx.update(departmentSubpages).set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
          revision: existing.revision + 1,
          updatedByUserId: user.id,
          updatedAt: now,
        }).where(eq(departmentSubpages.id, subpageId)).returning();
      } catch (error) {
        if (isUniqueViolation(error)) throw new ConflictError("此部門已有同名子分頁");
        throw error;
      }
      if (!updated) throw new Error("Failed to update department subpage");
      const result = { action: "UPDATE", subpageId, revision: updated.revision, name: updated.name, position: updated.position };
      await tx.insert(departmentSubpageMutations).values({ actorUserId: user.id, clientMutationId: input.clientMutationId, action: "UPDATE", departmentId, subpageId, result });
      await tx.insert(auditEvents).values({ actorUserId: user.id, action: "DEPARTMENT_SUBPAGE_UPDATED", targetType: "DEPARTMENT_SUBPAGE", targetId: subpageId, requestId: context.requestId, ipAddress: context.ipAddress, metadata: { departmentId, before: { name: existing.name, position: existing.position, revision: existing.revision }, after: { name: updated.name, position: updated.position, revision: updated.revision } } });
      return { ...result, replayed: false };
    });
  }

  async replaceIdentityPermissions(user: SessionUser, departmentId: string, subpageId: string, input: ReplaceSubpageIdentityPermissionsRequest, context: RequestSecurityContext) {
    this.requireManager(user, departmentId);
    const now = this.now();
    return this.db.transaction(async (tx) => {
      await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, departmentId)).for("update").limit(1);
      const prior = await this.replay(tx, user, input.clientMutationId, "IDENTITIES", departmentId, subpageId);
      if (prior) return prior;
      const [subpage] = await tx.select().from(departmentSubpages).where(and(eq(departmentSubpages.id, subpageId), eq(departmentSubpages.departmentId, departmentId))).for("update").limit(1);
      if (!subpage) throw new ResourceNotFoundError("找不到子分頁");
      if (subpage.revision !== input.revision) throw new ConflictError("權限已由其他人更新，請重新整理");
      const previousPermissions = await tx.select({
        kind: departmentSubpageIdentityPermissions.kind,
        canView: departmentSubpageIdentityPermissions.canView,
        canCreate: departmentSubpageIdentityPermissions.canCreate,
        canEdit: departmentSubpageIdentityPermissions.canEdit,
        canSubmit: departmentSubpageIdentityPermissions.canSubmit,
      }).from(departmentSubpageIdentityPermissions).where(eq(departmentSubpageIdentityPermissions.subpageId, subpageId));
      await tx.delete(departmentSubpageIdentityPermissions).where(eq(departmentSubpageIdentityPermissions.subpageId, subpageId));
      await tx.insert(departmentSubpageIdentityPermissions).values(input.permissions.map((permission) => ({ ...permission, subpageId, updatedByUserId: user.id, createdAt: now, updatedAt: now })));
      const revision = subpage.revision + 1;
      await tx.update(departmentSubpages).set({ revision, updatedByUserId: user.id, updatedAt: now }).where(eq(departmentSubpages.id, subpageId));
      const result = { action: "IDENTITIES", subpageId, revision };
      await tx.insert(departmentSubpageMutations).values({ actorUserId: user.id, clientMutationId: input.clientMutationId, action: "IDENTITIES", departmentId, subpageId, result });
      await tx.insert(auditEvents).values({ actorUserId: user.id, action: "DEPARTMENT_SUBPAGE_IDENTITY_PERMISSIONS_REPLACED", targetType: "DEPARTMENT_SUBPAGE", targetId: subpageId, requestId: context.requestId, ipAddress: context.ipAddress, metadata: { departmentId, revision, before: previousPermissions, after: input.permissions } });
      return { ...result, replayed: false };
    });
  }

  async replaceTemplates(user: SessionUser, departmentId: string, subpageId: string, input: ReplaceSubpageTemplatesRequest, context: RequestSecurityContext) {
    this.requireManager(user, departmentId);
    const now = this.now();
    return this.db.transaction(async (tx) => {
      const [department] = await tx.select({ id: departments.id, code: departments.code }).from(departments)
        .where(and(eq(departments.id, departmentId), eq(departments.active, true))).for("update").limit(1);
      if (!department) throw new ResourceNotFoundError("找不到部門");
      const prior = await this.replay(tx, user, input.clientMutationId, "TEMPLATES", departmentId, subpageId);
      if (prior) return prior;
      const [subpage] = await tx.select().from(departmentSubpages).where(and(eq(departmentSubpages.id, subpageId), eq(departmentSubpages.departmentId, departmentId))).for("update").limit(1);
      if (!subpage) throw new ResourceNotFoundError("找不到子分頁");
      if (subpage.revision !== input.revision) throw new ConflictError("設定已由其他人更新，請重新整理");
      const candidates = input.templateIds.length === 0 ? [] : await tx.select({ id: sheetTemplates.id, definition: sheetTemplateVersions.definition })
        .from(sheetTemplates)
        .innerJoin(sheetTemplateVersions, and(eq(sheetTemplateVersions.templateId, sheetTemplates.id), eq(sheetTemplateVersions.version, sheetTemplates.currentVersionNumber)))
        .where(and(eq(sheetTemplates.active, true), sql`${sheetTemplateVersions.publishedAt} IS NOT NULL`, inArray(sheetTemplates.id, input.templateIds)));
      const validIds = new Set(candidates.flatMap((candidate) => {
        const parsed = sheetTemplateDefinitionSchema.safeParse(candidate.definition);
        return parsed.success && parsed.data.status === "APPROVED" && parsed.data.allowedCreatorDepartmentCodes.includes(department.code as typeof parsed.data.allowedCreatorDepartmentCodes[number]) ? [candidate.id] : [];
      }));
      if (validIds.size !== input.templateIds.length) throw new ConflictError("表單範本未啟用或不允許此部門建立");
      const before = await tx.select({ templateId: departmentSubpageTemplates.templateId }).from(departmentSubpageTemplates).where(eq(departmentSubpageTemplates.subpageId, subpageId));
      await tx.delete(departmentSubpageTemplates).where(eq(departmentSubpageTemplates.subpageId, subpageId));
      if (input.templateIds.length > 0) await tx.insert(departmentSubpageTemplates).values(input.templateIds.map((templateId) => ({ subpageId, templateId, createdAt: now })));
      const revision = subpage.revision + 1;
      await tx.update(departmentSubpages).set({ revision, updatedByUserId: user.id, updatedAt: now }).where(eq(departmentSubpages.id, subpageId));
      const result = { action: "TEMPLATES", subpageId, revision };
      await tx.insert(departmentSubpageMutations).values({ actorUserId: user.id, clientMutationId: input.clientMutationId, action: "TEMPLATES", departmentId, subpageId, result });
      await tx.insert(auditEvents).values({ actorUserId: user.id, action: "DEPARTMENT_SUBPAGE_TEMPLATES_REPLACED", targetType: "DEPARTMENT_SUBPAGE", targetId: subpageId, requestId: context.requestId, ipAddress: context.ipAddress, metadata: { departmentId, revision, before: before.map((row) => row.templateId), after: input.templateIds } });
      return { ...result, replayed: false };
    });
  }

  async sheetIds(subpageId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: productionSheets.id })
      .from(productionSheets)
      .where(eq(productionSheets.subpageId, subpageId));
    return rows.map((row) => row.id);
  }

  async remove(user: SessionUser, departmentId: string, subpageId: string, input: DeleteDepartmentSubpageRequest, context: RequestSecurityContext) {
    this.requireManager(user, departmentId);
    return this.db.transaction(async (tx) => {
      await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, departmentId)).for("update").limit(1);
      const prior = await this.replay(tx, user, input.clientMutationId, "DELETE", departmentId, subpageId);
      if (prior) return prior;
      const [subpage] = await tx.select().from(departmentSubpages).where(and(eq(departmentSubpages.id, subpageId), eq(departmentSubpages.departmentId, departmentId))).for("update").limit(1);
      if (!subpage) throw new ResourceNotFoundError("找不到子分頁");
      if (subpage.revision !== input.revision) throw new ConflictError("子分頁已由其他人更新，請重新整理");
      const [{ value = 0 } = { value: 0 }] = await tx.select({ value: count(productionSheets.id) }).from(productionSheets).where(eq(productionSheets.subpageId, subpageId));
      if (Number(value) > 0) throw new ConflictError("仍有生產單的子分頁不可刪除");
      const result = { action: "DELETE", subpageId, name: subpage.name };
      await tx.insert(departmentSubpageMutations).values({ actorUserId: user.id, clientMutationId: input.clientMutationId, action: "DELETE", departmentId, subpageId, result });
      await tx.insert(auditEvents).values({ actorUserId: user.id, action: "DEPARTMENT_SUBPAGE_DELETED", targetType: "DEPARTMENT_SUBPAGE", targetId: subpageId, requestId: context.requestId, ipAddress: context.ipAddress, metadata: { departmentId, name: subpage.name } });
      await tx.delete(departmentSubpages).where(eq(departmentSubpages.id, subpageId));
      await tx.update(departmentSubpages)
        .set({ position: sql`${departmentSubpages.position} - 1`, revision: sql`${departmentSubpages.revision} + 1`, updatedByUserId: user.id, updatedAt: this.now() })
        .where(and(eq(departmentSubpages.departmentId, departmentId), gt(departmentSubpages.position, subpage.position)));
      return { ...result, replayed: false };
    });
  }
}
